-- ==============================================================================
-- Taskly - Post-Migration Verification & Validation Script
-- File: scripts/001_post_migration_check.sql
-- ==============================================================================
-- Purpose:
--   Comprehensive security and schema validation suite for public.todos.
--   Enforces all 6 strict multi-user tenant isolation criteria:
--     1. Foreign key fk_todos_user references auth.users(id) with ON DELETE RESTRICT.
--     2. Exactly 4 policies exist on public.todos.
--     3. Every policy targets ONLY the 'authenticated' role.
--     4. Exact USING and WITH CHECK expressions match: (auth.uid() = user_id).
--     5. Zero table privileges remain for 'anon' and 'PUBLIC'.
--     6. Row Level Security is enabled and forced on public.todos.
--
-- Instructions:
--   1. Open Supabase Dashboard: https://supabase.com/dashboard
--   2. Select your Project -> SQL Editor -> "+ New query".
--   3. Paste this entire script and click "Run".
--   4. The DO $$ block asserts each requirement and raises an exception on failure.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- Section 1: Detailed Schema & Column Inspection
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

-- ------------------------------------------------------------------------------
-- Section 2: Detailed Foreign Key Constraint & ON DELETE Action
-- ------------------------------------------------------------------------------
SELECT
  c.conname AS constraint_name,
  fn.nspname AS referenced_schema,
  ft.relname AS referenced_table,
  fa.attname AS referenced_column,
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
JOIN pg_class ft ON ft.oid = c.confrelid
JOIN pg_namespace fn ON fn.oid = ft.relnamespace
JOIN pg_attribute fa ON fa.attrelid = ft.oid AND fa.attnum = c.confkey[1]
WHERE n.nspname = 'public'
  AND t.relname = 'todos'
  AND c.conname = 'fk_todos_user';

-- ------------------------------------------------------------------------------
-- Section 3: Row Level Security (RLS) Status
-- ------------------------------------------------------------------------------
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'todos';

-- ------------------------------------------------------------------------------
-- Section 4: Active RLS Policies Inspection
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- Section 5: Table Privileges Audit
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
-- Section 6: Multi-Tenant Indexes
-- ------------------------------------------------------------------------------
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'todos'
ORDER BY indexname;

-- ------------------------------------------------------------------------------
-- Section 7: Strict Automated Assertions (Fails Closed If Any Check Fails)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  -- Foreign key checks
  v_fk_deltype CHAR(1);
  v_fk_schema VARCHAR;
  v_fk_table VARCHAR;
  v_fk_col VARCHAR;
  -- RLS checks
  v_rls_enabled BOOLEAN;
  v_rls_forced BOOLEAN;
  -- Policy checks
  v_policy_count INTEGER;
  v_legacy_policy_count INTEGER;
  v_non_auth_policy_count INTEGER;
  v_qual TEXT;
  v_with_check TEXT;
  v_roles TEXT[];
  v_cmd TEXT;
  -- Privilege checks
  v_anon_priv_count INTEGER;
  v_auth_privileges TEXT[];
  v_grantable_priv_count INTEGER;
BEGIN
  -- ----------------------------------------------------------------------------
  -- 1. Check user_id column structure (UUID NOT NULL) and all task metadata columns
  -- ----------------------------------------------------------------------------
  -- Check user_id column presence
  PERFORM 1
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'todos'
    AND column_name = 'user_id';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: column user_id does not exist on public.todos';
  END IF;

  -- Check user_id data type is uuid
  PERFORM 1
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'todos'
    AND column_name = 'user_id'
    AND data_type = 'uuid';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: column user_id type must be uuid';
  END IF;

  -- Check user_id is NOT NULL
  PERFORM 1
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'todos'
    AND column_name = 'user_id'
    AND is_nullable = 'NO';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: column user_id is nullable (expected NOT NULL)';
  END IF;

  -- Verify all extended task metadata columns exist with correct types
  PERFORM 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'todos' AND column_name = 'description' AND data_type = 'text';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: column description (text) does not exist on public.todos';
  END IF;

  PERFORM 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'todos' AND column_name = 'time' AND data_type = 'character varying';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: column time (character varying) does not exist on public.todos';
  END IF;

  PERFORM 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'todos' AND column_name = 'priority' AND data_type = 'character varying';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: column priority (character varying) does not exist on public.todos';
  END IF;

  PERFORM 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'todos' AND column_name = 'category' AND data_type = 'character varying';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: column category (character varying) does not exist on public.todos';
  END IF;

  PERFORM 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'todos' AND column_name = 'reminder' AND data_type = 'boolean';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: column reminder (boolean) does not exist on public.todos';
  END IF;

  -- Verify baseline task columns
  PERFORM 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'todos' AND column_name = 'id' AND data_type = 'text';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: column id (text) does not exist on public.todos';
  END IF;

  PERFORM 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'todos' AND column_name = 'title' AND data_type = 'character varying';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: column title (character varying) does not exist on public.todos';
  END IF;

  PERFORM 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'todos' AND column_name = 'completed' AND data_type = 'boolean';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: column completed (boolean) does not exist on public.todos';
  END IF;

  PERFORM 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'todos' AND column_name = 'due_date' AND data_type = 'character varying';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: column due_date (character varying) does not exist on public.todos';
  END IF;

  PERFORM 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'todos' AND column_name = 'created_at' AND data_type = 'timestamp with time zone';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: column created_at (timestamp with time zone) does not exist on public.todos';
  END IF;

  PERFORM 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'todos' AND column_name = 'updated_at' AND data_type = 'timestamp with time zone';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: column updated_at (timestamp with time zone) does not exist on public.todos';
  END IF;

  -- ----------------------------------------------------------------------------
  -- 2. Verify Foreign Key Constraint: fk_todos_user -> auth.users(id) ON DELETE RESTRICT
  -- ----------------------------------------------------------------------------
  SELECT
    c.confdeltype,
    fn.nspname,
    ft.relname,
    fa.attname
  INTO v_fk_deltype, v_fk_schema, v_fk_table, v_fk_col
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_class ft ON ft.oid = c.confrelid
  JOIN pg_namespace fn ON fn.oid = ft.relnamespace
  JOIN pg_attribute fa ON fa.attrelid = ft.oid AND fa.attnum = c.confkey[1]
  WHERE n.nspname = 'public'
    AND t.relname = 'todos'
    AND c.conname = 'fk_todos_user';

  IF v_fk_schema IS NULL THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: Foreign key constraint fk_todos_user does not exist on public.todos';
  END IF;

  IF v_fk_schema <> 'auth' OR v_fk_table <> 'users' OR v_fk_col <> 'id' THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: fk_todos_user must reference auth.users(id), but references %.%(%)', v_fk_schema, v_fk_table, v_fk_col;
  END IF;

  IF v_fk_deltype <> 'r' THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: fk_todos_user ON DELETE action is "%" (expected "r" for ON DELETE RESTRICT)', v_fk_deltype;
  END IF;

  -- ----------------------------------------------------------------------------
  -- 3. Verify Row Level Security (RLS) is Enabled and Forced
  -- ----------------------------------------------------------------------------
  SELECT c.relrowsecurity, c.relforcerowsecurity
  INTO v_rls_enabled, v_rls_forced
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'todos';

  IF NOT v_rls_enabled THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: Row Level Security is NOT enabled on public.todos';
  END IF;

  IF NOT v_rls_forced THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: Row Level Security is NOT forced on public.todos';
  END IF;

  -- ----------------------------------------------------------------------------
  -- 4. Verify Total Policy Count is Exactly Four
  -- ----------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'todos';

  IF v_policy_count <> 4 THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: Expected exactly 4 policies on public.todos, found %', v_policy_count;
  END IF;

  -- Verify no policy targets any role other than authenticated
  SELECT COUNT(*) INTO v_non_auth_policy_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'todos'
    AND roles <> '{authenticated}';

  IF v_non_auth_policy_count > 0 THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: Found % policy/policies targeting roles other than authenticated', v_non_auth_policy_count;
  END IF;

  -- Verify no legacy public policies remain
  SELECT COUNT(*) INTO v_legacy_policy_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'todos'
    AND policyname IN (
      'Allow public read access',
      'Allow public insert access',
      'Allow public update access',
      'Allow public delete access'
    );

  IF v_legacy_policy_count > 0 THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: % legacy public policy/policies still exist', v_legacy_policy_count;
  END IF;

  -- ----------------------------------------------------------------------------
  -- 5. Verify Exact Expressions for Each of the Four Authenticated Policies
  -- ----------------------------------------------------------------------------
  -- Policy 1: SELECT
  SELECT qual, with_check, roles::text[], cmd
  INTO v_qual, v_with_check, v_roles, v_cmd
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'todos' AND policyname = 'todos_select_authenticated';

  IF v_cmd IS NULL THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: Policy todos_select_authenticated is missing';
  END IF;
  IF v_cmd <> 'SELECT' THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: todos_select_authenticated cmd is % (expected SELECT)', v_cmd;
  END IF;
  IF v_roles <> '{authenticated}' THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: todos_select_authenticated roles is % (expected {authenticated})', v_roles;
  END IF;
  IF replace(v_qual, ' ', '') <> '(auth.uid()=user_id)' THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: todos_select_authenticated USING clause is "%" (expected "(auth.uid() = user_id)")', v_qual;
  END IF;
  IF v_with_check IS NOT NULL THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: todos_select_authenticated WITH CHECK clause must be NULL, got %', v_with_check;
  END IF;

  -- Policy 2: INSERT
  SELECT qual, with_check, roles::text[], cmd
  INTO v_qual, v_with_check, v_roles, v_cmd
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'todos' AND policyname = 'todos_insert_authenticated';

  IF v_cmd IS NULL THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: Policy todos_insert_authenticated is missing';
  END IF;
  IF v_cmd <> 'INSERT' THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: todos_insert_authenticated cmd is % (expected INSERT)', v_cmd;
  END IF;
  IF v_roles <> '{authenticated}' THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: todos_insert_authenticated roles is % (expected {authenticated})', v_roles;
  END IF;
  IF v_qual IS NOT NULL THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: todos_insert_authenticated USING clause must be NULL, got %', v_qual;
  END IF;
  IF replace(v_with_check, ' ', '') <> '(auth.uid()=user_id)' THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: todos_insert_authenticated WITH CHECK clause is "%" (expected "(auth.uid() = user_id)")', v_with_check;
  END IF;

  -- Policy 3: UPDATE
  SELECT qual, with_check, roles::text[], cmd
  INTO v_qual, v_with_check, v_roles, v_cmd
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'todos' AND policyname = 'todos_update_authenticated';

  IF v_cmd IS NULL THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: Policy todos_update_authenticated is missing';
  END IF;
  IF v_cmd <> 'UPDATE' THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: todos_update_authenticated cmd is % (expected UPDATE)', v_cmd;
  END IF;
  IF v_roles <> '{authenticated}' THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: todos_update_authenticated roles is % (expected {authenticated})', v_roles;
  END IF;
  IF replace(v_qual, ' ', '') <> '(auth.uid()=user_id)' THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: todos_update_authenticated USING clause is "%" (expected "(auth.uid() = user_id)")', v_qual;
  END IF;
  IF replace(v_with_check, ' ', '') <> '(auth.uid()=user_id)' THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: todos_update_authenticated WITH CHECK clause is "%" (expected "(auth.uid() = user_id)")', v_with_check;
  END IF;

  -- Policy 4: DELETE
  SELECT qual, with_check, roles::text[], cmd
  INTO v_qual, v_with_check, v_roles, v_cmd
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'todos' AND policyname = 'todos_delete_authenticated';

  IF v_cmd IS NULL THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: Policy todos_delete_authenticated is missing';
  END IF;
  IF v_cmd <> 'DELETE' THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: todos_delete_authenticated cmd is % (expected DELETE)', v_cmd;
  END IF;
  IF v_roles <> '{authenticated}' THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: todos_delete_authenticated roles is % (expected {authenticated})', v_roles;
  END IF;
  IF replace(v_qual, ' ', '') <> '(auth.uid()=user_id)' THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: todos_delete_authenticated USING clause is "%" (expected "(auth.uid() = user_id)")', v_qual;
  END IF;
  IF v_with_check IS NOT NULL THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: todos_delete_authenticated WITH CHECK clause must be NULL, got %', v_with_check;
  END IF;

  -- ----------------------------------------------------------------------------
  -- 6. Verify Table Privileges (anon & PUBLIC have 0; authenticated has EXACT CRUD)
  -- ----------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_anon_priv_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'todos' AND grantee IN ('anon', 'PUBLIC');

  IF v_anon_priv_count > 0 THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: anon/PUBLIC still holds % privilege(s) on public.todos', v_anon_priv_count;
  END IF;

  -- Verify authenticated role has EXACTLY the four required CRUD privileges: DELETE, INSERT, SELECT, UPDATE
  SELECT ARRAY_AGG(DISTINCT privilege_type ORDER BY privilege_type)
  INTO v_auth_privileges
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'todos'
    AND grantee = 'authenticated';

  IF v_auth_privileges IS NULL OR v_auth_privileges <> ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::TEXT[] THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: authenticated role privileges on public.todos are % (expected exactly [DELETE, INSERT, SELECT, UPDATE])', v_auth_privileges;
  END IF;

  -- Verify none of the authenticated grants has is_grantable = 'YES'
  SELECT COUNT(*) INTO v_grantable_priv_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'todos'
    AND grantee = 'authenticated'
    AND is_grantable = 'YES';

  IF v_grantable_priv_count > 0 THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: authenticated role has % grantable privilege(s) (with ADMIN/GRANT OPTION) on public.todos; expected 0', v_grantable_priv_count;
  END IF;

  -- ----------------------------------------------------------------------------
  -- 7. Verify Index Presence
  -- ----------------------------------------------------------------------------
  PERFORM 1
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'todos'
    AND indexname = 'idx_todos_user_id';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: Index idx_todos_user_id does not exist';
  END IF;

  -- ----------------------------------------------------------------------------
  -- All Checks Passed
  -- ----------------------------------------------------------------------------
  RAISE NOTICE '=======================================================';
  RAISE NOTICE 'SUCCESS: ALL MULTI-USER SECURITY ASSERTIONS VERIFIED!';
  RAISE NOTICE '  1. user_id UUID NOT NULL:            VERIFIED
  1b.All task metadata columns verified:VERIFIED';
  RAISE NOTICE '  2. Foreign key to auth.users(id):    VERIFIED';
  RAISE NOTICE '  3. ON DELETE RESTRICT action:        VERIFIED';
  RAISE NOTICE '  4. Row Level Security enabled&forced:VERIFIED';
  RAISE NOTICE '  5. Exactly 4 policies on todos:      VERIFIED';
  RAISE NOTICE '  6. Target role authenticated only:   VERIFIED';
  RAISE NOTICE '  7. Exact USING & WITH CHECK clauses: VERIFIED';
  RAISE NOTICE '  8. authenticated exact CRUD / anon=0:VERIFIED';
  RAISE NOTICE '  9. Multi-tenant indexes:             VERIFIED';
  RAISE NOTICE '=======================================================';
END $$;
