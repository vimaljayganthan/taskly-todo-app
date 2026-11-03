-- ==============================================================================
-- Taskly - Pre-Migration Verification & Inspection Script
-- File: scripts/001_pre_migration_check.sql
-- ==============================================================================
-- Purpose:
--   Read-only inspection of the current production database state before running
--   scripts/001_multi_user_isolation.sql.
--
-- Instructions:
--   1. Open Supabase Dashboard: https://supabase.com/dashboard
--   2. Select your Project -> SQL Editor -> "+ New query".
--   3. Paste this entire script and click "Run".
--   4. Review all output tables to confirm current database state.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Table Existence & Column Structure Check
-- ------------------------------------------------------------------------------
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'todos'
ORDER BY ordinal_position;

-- Explicit check: Does user_id column already exist?
SELECT 
  EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'todos' 
      AND column_name = 'user_id'
  ) AS user_id_column_exists;

-- ------------------------------------------------------------------------------
-- 2. Existing Records Count & Data Audit
-- ------------------------------------------------------------------------------
-- Verifies whether public.todos is currently empty as expected
SELECT 
  COUNT(*) AS total_existing_records
FROM public.todos;

-- ------------------------------------------------------------------------------
-- 3. Row Level Security (RLS) Status Check
-- ------------------------------------------------------------------------------
-- Inspects whether RLS is enabled (relrowsecurity) and forced (relforcerowsecurity)
SELECT 
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' 
  AND c.relname = 'todos';

-- ------------------------------------------------------------------------------
-- 4. Existing RLS Policies Audit
-- ------------------------------------------------------------------------------
-- Lists all active policies on public.todos and highlights public/anon access
SELECT 
  policyname,
  permissive,
  roles::text[] AS applicable_roles,
  cmd AS command,
  qual AS using_expression,
  with_check AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public' 
  AND tablename = 'todos'
ORDER BY policyname;

-- Specifically check for the 4 legacy public policies:
SELECT 
  policyname,
  roles::text[] AS applicable_roles,
  cmd
FROM pg_policies
WHERE schemaname = 'public' 
  AND tablename = 'todos'
  AND policyname IN (
    'Allow public read access',
    'Allow public insert access',
    'Allow public update access',
    'Allow public delete access'
  );

-- ------------------------------------------------------------------------------
-- 5. Table Privileges Audit (Grants to anon, authenticated, public)
-- ------------------------------------------------------------------------------
SELECT 
  grantee,
  privilege_type,
  is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public' 
  AND table_name = 'todos'
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
ORDER BY grantee, privilege_type;

-- ------------------------------------------------------------------------------
-- 6. Constraints & Foreign Keys Audit
-- ------------------------------------------------------------------------------
SELECT 
  conname AS constraint_name,
  contype AS constraint_type,
  pg_get_constraintdef(c.oid) AS constraint_definition,
  CASE c.confdeltype
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
    ELSE c.confdeltype::text
  END AS on_delete_action
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public' 
  AND t.relname = 'todos';

-- ------------------------------------------------------------------------------
-- 7. Automated Pre-Flight Diagnostic Summary
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  rec_count INTEGER;
  col_exists BOOLEAN;
  legacy_policy_count INTEGER;
BEGIN
  -- Count records
  SELECT COUNT(*) INTO rec_count FROM public.todos;
  
  -- Check user_id column
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'todos' AND column_name = 'user_id'
  ) INTO col_exists;

  -- Count legacy policies
  SELECT COUNT(*) INTO legacy_policy_count 
  FROM pg_policies 
  WHERE schemaname = 'public' 
    AND tablename = 'todos' 
    AND policyname IN (
      'Allow public read access',
      'Allow public insert access',
      'Allow public update access',
      'Allow public delete access'
    );

  RAISE NOTICE '=======================================================';
  RAISE NOTICE 'Taskly Pre-Migration Inspection Summary:';
  RAISE NOTICE '  - Total rows in public.todos: %', rec_count;
  RAISE NOTICE '  - user_id column present:     %', col_exists;
  RAISE NOTICE '  - Legacy public policies:     % found', legacy_policy_count;
  IF rec_count = 0 THEN
    RAISE NOTICE '  - Table is empty: SAFE for NOT NULL user_id migration.';
  ELSE
    RAISE NOTICE '  - Table has % rows: Records MUST be assigned a valid user UUID before enforcing NOT NULL.', rec_count;
  END IF;
  RAISE NOTICE '=======================================================';
END $$;

