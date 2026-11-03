-- ==============================================================================
-- Taskly - Rollback Strategy Script
-- File: scripts/001_rollback.sql
-- ==============================================================================
-- CRITICAL SAFETY RULES:
--   1. NEVER RESTORE PUBLIC ACCESS: The legacy policies granting unrestricted
--      anonymous access ('Allow public read access' etc.) MUST NEVER BE RESTORED.
--      Restoring public access would expose private user tasks to the internet.
--   2. KEEP RLS ENABLED & FORCED: Row Level Security must remain active at all times.
--   3. PRESERVE TASK DATA (TIER 1 DEFAULT): By default, executing this script
--      applies Tier 1 (Quarantine Mode). It freezes ALL reads and writes for all
--      users while preserving 100% of tasks, columns, and foreign keys intact.
--   4. IRREVERSIBLE OPERATION WARNING (TIER 2 ONLY): Dropping 'user_id' will
--      PERMANENTLY DESTROY all user task ownership associations.
-- ==============================================================================

-- ==============================================================================
-- TIER 1: SAFE MAINTENANCE / QUARANTINE MODE (ACTIVE & EXECUTABLE BY DEFAULT)
-- ==============================================================================
-- Purpose:
--   Immediately quarantines public.todos by blocking all SELECT, INSERT, UPDATE,
--   and DELETE operations for both authenticated and anonymous users.
--
-- Guarantees:
--   - Authenticated users CANNOT read tasks (USING false).
--   - Authenticated users CANNOT create, modify, or delete tasks (WITH CHECK false).
--   - Anonymous and PUBLIC roles have ZERO access (grants revoked, zero policies).
--   - Row Level Security remains strictly ENABLED and FORCED.
--   - All table data, user_id values, foreign key constraints, and indexes are
--     100% PRESERVED.
-- ==============================================================================

BEGIN;

-- 1. Drop the four authenticated policies so no existing rule grants access
DROP POLICY IF EXISTS "todos_select_authenticated" ON public.todos;
DROP POLICY IF EXISTS "todos_insert_authenticated" ON public.todos;
DROP POLICY IF EXISTS "todos_update_authenticated" ON public.todos;
DROP POLICY IF EXISTS "todos_delete_authenticated" ON public.todos;

-- 2. Drop the four legacy public policies if present
DROP POLICY IF EXISTS "Allow public read access" ON public.todos;
DROP POLICY IF EXISTS "Allow public insert access" ON public.todos;
DROP POLICY IF EXISTS "Allow public update access" ON public.todos;
DROP POLICY IF EXISTS "Allow public delete access" ON public.todos;

-- 3. Dynamic purge of ANY other policy on public.todos
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' 
      AND tablename = 'todos'
      AND policyname NOT IN ('todos_quarantine_lockdown')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.todos', pol.policyname);
    RAISE NOTICE 'Quarantine: Dropped active policy on public.todos: %', pol.policyname;
  END LOOP;
END $$;

-- 4. Install strict quarantine lockdown policy for authenticated role
--    USING (false) blocks all reads (SELECT) and targets of UPDATE/DELETE.
--    WITH CHECK (false) blocks all writes (INSERT and UPDATE).
DROP POLICY IF EXISTS "todos_quarantine_lockdown" ON public.todos;
CREATE POLICY "todos_quarantine_lockdown" ON public.todos
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- 5. Ensure Row Level Security remains strictly enabled and forced
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todos FORCE ROW LEVEL SECURITY;

-- 6. Ensure no table privileges exist for public or anonymous roles
REVOKE ALL ON TABLE public.todos FROM PUBLIC;
REVOKE ALL ON TABLE public.todos FROM anon;

COMMIT;

DO $$
BEGIN
  RAISE NOTICE '=======================================================';
  RAISE NOTICE 'Tier 1 Quarantine Mode Activated Successfully!';
  RAISE NOTICE 'STATUS:';
  RAISE NOTICE '  - All SELECT, INSERT, UPDATE, DELETE policies: DROPPED';
  RAISE NOTICE '  - Authenticated access: FULLY BLOCKED (USING false / WITH CHECK false)';
  RAISE NOTICE '  - Anonymous/Public access: REVOKED (Zero access)';
  RAISE NOTICE '  - Row Level Security: ENABLED & FORCED';
  RAISE NOTICE '  - Data preservation: 100% of tasks, columns, and foreign keys INTACT';
  RAISE NOTICE 'To resume normal multi-user operation after fixing application issues,';
  RAISE NOTICE 're-run scripts/001_multi_user_isolation.sql.';
  RAISE NOTICE '=======================================================';
END $$;


-- ==============================================================================
-- TIER 2: CONTROLLED SCHEMA ROLLBACK (DESTRUCTIVE - ONLY FOR DISASTER RECOVERY)
-- ==============================================================================
-- CAUTION:
--   - This tier removes column user_id and foreign key fk_todos_user.
--   - Any user ownership data will be permanently wiped.
--   - RLS remains strictly ENABLED. Unrestricted public access is NEVER restored.
--   - To execute Tier 2, uncomment the block below and run in Supabase SQL Editor.
-- ==============================================================================
/*
BEGIN;

-- Step A: Verify whether tasks exist before dropping ownership
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.todos WHERE user_id IS NOT NULL;
  IF v_count > 0 THEN
    RAISE WARNING 'CAUTION: % record(s) currently have user_id assigned. Dropping user_id will permanently destroy their ownership metadata.', v_count;
  END IF;
END $$;

-- Step B: Drop the quarantine lockdown policy
DROP POLICY IF EXISTS "todos_quarantine_lockdown" ON public.todos;

-- Step C: Drop multi-tenant query performance indexes
DROP INDEX IF EXISTS public.idx_todos_user_completed;
DROP INDEX IF EXISTS public.idx_todos_user_created;
DROP INDEX IF EXISTS public.idx_todos_user_id;

-- Step D: Drop foreign key constraint
ALTER TABLE public.todos 
  DROP CONSTRAINT IF EXISTS fk_todos_user;

-- Step E: Drop user_id column (IRREVERSIBLE)
ALTER TABLE public.todos 
  DROP COLUMN IF EXISTS user_id;

-- Step F: Maintain Strict Security Barrier (Zero Public Access Restored)
DROP POLICY IF EXISTS "todos_reversal_lockdown" ON public.todos;
CREATE POLICY "todos_reversal_lockdown" ON public.todos
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- Step G: Ensure RLS remains enabled and forced
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todos FORCE ROW LEVEL SECURITY;

-- Step H: Keep table privileges revoked from anon and public
REVOKE ALL ON TABLE public.todos FROM PUBLIC;
REVOKE ALL ON TABLE public.todos FROM anon;

COMMIT;

DO $$
BEGIN
  RAISE NOTICE 'Tier 2 schema reversal completed. Public access remains blocked.';
END $$;
*/
