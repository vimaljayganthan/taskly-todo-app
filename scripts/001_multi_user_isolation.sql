-- ==============================================================================
-- Taskly - Production Database Migration: Multi-User Tenant Isolation
-- File: scripts/001_multi_user_isolation.sql
-- ==============================================================================
-- Target: Supabase PostgreSQL (public.todos)
-- Security & Safety Architecture:
--   1. Transactional execution (BEGIN ... COMMIT).
--   2. Add user_id UUID referencing auth.users(id).
--   3. Foreign key enforced with ON DELETE RESTRICT (protects user task data).
--   4. Mandatory user_id (NOT NULL) for strict tenant isolation.
--   5. Enable and FORCE Row Level Security (RLS).
--   6. Remove the four legacy public policies by exact names.
--   7. Purge any other unvetted policies on public.todos (idempotent).
--   8. Create four strict policies for role 'authenticated' using auth.uid() = user_id:
--        - SELECT: USING (auth.uid() = user_id)
--        - INSERT: WITH CHECK (auth.uid() = user_id)
--        - UPDATE: USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)
--        - DELETE: USING (auth.uid() = user_id)
--   9. Revoke all privileges from 'anon' and 'PUBLIC'; grant CRUD to 'authenticated'.
--  10. Fail-closed data safety: Never delete existing tasks or invent user ownership.
--
-- Manual Execution Instructions:
--   1. Navigate to your Supabase Project: https://supabase.com/dashboard
--   2. Open SQL Editor -> Click "+ New query".
--   3. Run scripts/001_pre_migration_check.sql first to verify current state.
--   4. Paste this entire file into the SQL Editor and click "Run".
--   5. Run scripts/001_post_migration_check.sql to verify all security assertions pass.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- Step 1: Pre-Flight Safety Verification
-- ------------------------------------------------------------------------------
-- Validates table state before making any alterations.
-- In accordance with data safety rules:
--   - Does NOT delete any existing tasks.
--   - Does NOT invent fake or placeholder user ownership.
--   - If unowned records exist, it raises an exception and aborts the transaction.
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  rec_count INTEGER;
  unowned_count INTEGER;
  col_exists BOOLEAN;
BEGIN
  -- Verify public.todos table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'todos'
  ) THEN
    RAISE EXCEPTION 'Table public.todos does not exist. Aborting migration.';
  END IF;

  -- Check whether user_id column is already present
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'todos' AND column_name = 'user_id'
  ) INTO col_exists;

  -- Count existing rows
  SELECT COUNT(*) INTO rec_count FROM public.todos;

  IF col_exists THEN
    SELECT COUNT(*) INTO unowned_count FROM public.todos WHERE user_id IS NULL;
  ELSE
    unowned_count := rec_count;
  END IF;

  RAISE NOTICE 'Safety check: public.todos has % total row(s), % unowned row(s).', rec_count, unowned_count;

  -- Abort if existing records cannot safely satisfy NOT NULL constraint
  IF unowned_count > 0 THEN
    RAISE EXCEPTION 
      'MIGRATION ABORTED: public.todos contains % record(s) without user_id. '
      'Safety policy forbids deleting existing tasks or inventing fake user ownership. '
      'Please back up and assign valid user UUIDs to existing rows before running this migration.',
      unowned_count;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- Step 2: Add user_id and Extended Task Metadata Columns (Idempotent)
-- ------------------------------------------------------------------------------
-- Adds tenant ownership column and all supported application metadata fields.
-- Existing columns (id, title, completed, due_date, created_at, updated_at) are preserved.
-- ------------------------------------------------------------------------------
ALTER TABLE public.todos 
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS time VARCHAR(20) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'Medium',
  ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'Personal',
  ADD COLUMN IF NOT EXISTS reminder BOOLEAN DEFAULT false;

-- ------------------------------------------------------------------------------
-- Step 3: Foreign Key Constraint referencing auth.users(id) with ON DELETE RESTRICT
-- ------------------------------------------------------------------------------
-- FOREIGN KEY ON DELETE BEHAVIOR SPECIFICATION:
--
-- ON DELETE RESTRICT is strictly enforced:
--   - Prevents accidental deletion of user accounts in auth.users if they have
--     active task history in public.todos.
--   - Guarantees data preservation: An account cannot be purged without deliberate
--     prior task cleanup or archival.
--   - Eliminates cascading catastrophic data loss from accidental user deletion.
--
-- Rigorous Idempotency & Conflict Detection:
--   1. Detects ANY constraint named fk_todos_user on public.todos regardless of type.
--   2. If it exists but is a different constraint type (e.g. check, unique, primary key),
--      it raises an EXCEPTION and aborts the migration rather than silently dropping it.
--   3. If it is a foreign key, validates all properties:
--        - Local constrained column is user_id
--        - Referenced table is auth.users
--        - Referenced column is id
--        - ON DELETE action is RESTRICT (confdeltype = 'r')
--      If all properties match, preserves it without disruption.
--   4. If it is a foreign key with incorrect properties, safely replaces it.
--   5. If it does not exist, creates it.
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_contype CHAR(1);
  v_is_valid BOOLEAN := false;
BEGIN
  -- 1. Detect any constraint named fk_todos_user on public.todos regardless of constraint type
  SELECT c.contype
  INTO v_contype
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public' 
    AND t.relname = 'todos' 
    AND c.conname = 'fk_todos_user';

  IF v_contype IS NOT NULL THEN
    -- If it exists but is NOT a foreign key (contype <> 'f'), fail closed immediately
    IF v_contype <> 'f' THEN
      RAISE EXCEPTION 
        'MIGRATION ABORTED: Constraint fk_todos_user on public.todos exists but is not a foreign key (contype = "%"). '
        'Refusing to drop or replace an unexpected non-foreign-key constraint.', 
        v_contype;
    END IF;

    -- It is a foreign key. Validate all properties:
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = c.conkey[1]
      JOIN pg_class ft ON ft.oid = c.confrelid
      JOIN pg_namespace fn ON fn.oid = ft.relnamespace
      JOIN pg_attribute fa ON fa.attrelid = ft.oid AND fa.attnum = c.confkey[1]
      WHERE n.nspname = 'public'
        AND t.relname = 'todos'
        AND c.conname = 'fk_todos_user'
        AND c.contype = 'f'
        AND a.attname = 'user_id'
        AND fn.nspname = 'auth'
        AND ft.relname = 'users'
        AND fa.attname = 'id'
        AND c.confdeltype = 'r'
        AND array_length(c.conkey, 1) = 1
        AND array_length(c.confkey, 1) = 1
    ) INTO v_is_valid;

    IF v_is_valid THEN
      RAISE NOTICE 'Foreign key fk_todos_user already exists with all verified properties (public.todos.user_id -> auth.users.id ON DELETE RESTRICT). Preserving existing constraint.';
    ELSE
      RAISE NOTICE 'Existing foreign key fk_todos_user has incorrect properties. Safely replacing...';
      ALTER TABLE public.todos DROP CONSTRAINT fk_todos_user;
      ALTER TABLE public.todos
        ADD CONSTRAINT fk_todos_user
        FOREIGN KEY (user_id)
        REFERENCES auth.users(id)
        ON DELETE RESTRICT;
      RAISE NOTICE 'Replaced fk_todos_user with verified ON DELETE RESTRICT foreign key.';
    END IF;
  ELSE
    -- Constraint does not exist; create it
    ALTER TABLE public.todos
      ADD CONSTRAINT fk_todos_user
      FOREIGN KEY (user_id)
      REFERENCES auth.users(id)
      ON DELETE RESTRICT;
    RAISE NOTICE 'Foreign key constraint fk_todos_user (ON DELETE RESTRICT) created successfully.';
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- Step 4: Enforce Mandatory user_id (NOT NULL)
-- ------------------------------------------------------------------------------
-- Guarantees that every subsequent INSERT must provide a valid user_id.
-- ------------------------------------------------------------------------------
ALTER TABLE public.todos 
  ALTER COLUMN user_id SET NOT NULL;

-- ------------------------------------------------------------------------------
-- Step 5: Create Multi-Tenant Performance Indexes
-- ------------------------------------------------------------------------------
-- Optimizes per-user filtering, sorting, and foreign key verification lookups.
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_todos_user_id 
  ON public.todos (user_id);

CREATE INDEX IF NOT EXISTS idx_todos_user_created 
  ON public.todos (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_todos_user_completed 
  ON public.todos (user_id, completed);

-- ------------------------------------------------------------------------------
-- Step 6: Enable and Enforce Row Level Security (RLS)
-- ------------------------------------------------------------------------------
-- FORCE ROW LEVEL SECURITY ensures table owners / postgres roles adhere to RLS.
-- ------------------------------------------------------------------------------
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todos FORCE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- Step 7: Remove All Four Confirmed Legacy Public Policies by Exact Name
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow public read access" ON public.todos;
DROP POLICY IF EXISTS "Allow public insert access" ON public.todos;
DROP POLICY IF EXISTS "Allow public update access" ON public.todos;
DROP POLICY IF EXISTS "Allow public delete access" ON public.todos;

-- ------------------------------------------------------------------------------
-- Step 8: Purge Any Other Legacy / Permissive Policies on public.todos
-- ------------------------------------------------------------------------------
-- Ensures no unvetted legacy policy remains on public.todos that could grant
-- unintended access. Idempotently preserves only the four strict policies below.
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' 
      AND tablename = 'todos'
      AND policyname NOT IN (
        'todos_select_authenticated',
        'todos_insert_authenticated',
        'todos_update_authenticated',
        'todos_delete_authenticated'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.todos', pol.policyname);
    RAISE NOTICE 'Dropped legacy policy on public.todos: %', pol.policyname;
  END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- Step 9: Create Four Strict Tenant-Isolated Authenticated Policies
-- ------------------------------------------------------------------------------
-- All policies target ONLY the 'authenticated' role.
-- Anonymous (anon) and unauthenticated users receive zero access.
-- ------------------------------------------------------------------------------

-- 1. SELECT: Users can only read tasks where user_id matches their auth.uid()
DROP POLICY IF EXISTS "todos_select_authenticated" ON public.todos;
CREATE POLICY "todos_select_authenticated" ON public.todos
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 2. INSERT: Users can only insert tasks where user_id matches their auth.uid()
DROP POLICY IF EXISTS "todos_insert_authenticated" ON public.todos;
CREATE POLICY "todos_insert_authenticated" ON public.todos
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 3. UPDATE: Users can only update their own tasks and cannot reassign user_id
DROP POLICY IF EXISTS "todos_update_authenticated" ON public.todos;
CREATE POLICY "todos_update_authenticated" ON public.todos
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 4. DELETE: Users can only delete their own tasks
DROP POLICY IF EXISTS "todos_delete_authenticated" ON public.todos;
CREATE POLICY "todos_delete_authenticated" ON public.todos
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- Step 10: Table Privileges Lockdown
-- ------------------------------------------------------------------------------
-- Defense-in-depth: Revoke all table-level privileges from anon and PUBLIC.
-- Grant only required CRUD privileges to authenticated.
-- ------------------------------------------------------------------------------
REVOKE ALL ON TABLE public.todos FROM PUBLIC;
REVOKE ALL ON TABLE public.todos FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE 
  ON TABLE public.todos 
  TO authenticated;

COMMIT;

-- Verification notice upon successful commit
DO $$
BEGIN
  RAISE NOTICE '=======================================================';
  RAISE NOTICE 'Taskly Multi-User Isolation Migration Applied Successfully!';
  RAISE NOTICE 'Table:        public.todos';
  RAISE NOTICE 'Columns:      user_id UUID NOT NULL + extended task metadata (description, time, priority, category, reminder)';
  RAISE NOTICE 'Foreign Key:  REFERENCES auth.users(id) ON DELETE RESTRICT';
  RAISE NOTICE 'RLS:          ENABLED & FORCED';
  RAISE NOTICE 'Policies:     4 authenticated tenant-isolated policies';
  RAISE NOTICE 'Privileges:   authenticated CRUD only (anon/PUBLIC revoked)';
  RAISE NOTICE 'Please run scripts/001_post_migration_check.sql next.';
  RAISE NOTICE '=======================================================';
END $$;
