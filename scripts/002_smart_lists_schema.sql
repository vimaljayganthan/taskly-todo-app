-- ==============================================================================
-- Taskly - Production Database Migration: Smart Lists Feature
-- File: scripts/002_smart_lists_schema.sql
-- ==============================================================================
-- Target: Supabase PostgreSQL
-- Features:
--   1. smart_routines: Routine definitions (title, order_index, user_id)
--   2. smart_routine_completions: Date-specific completion state & carry-forward
--   3. smart_routine_reports: Daily summary reports & carry-forward decisions
--   4. smart_routine_settings: User reminder preferences (time, enabled)
-- Security:
--   1. Strict Row Level Security (RLS) enforcing auth.uid() = user_id for all operations.
--   2. Table privileges lockdown: authenticated CRUD only (REFERENCES, TRIGGER, TRUNCATE revoked).
--   3. All privileges revoked from anon and PUBLIC.
--   4. Transactional assertions verifying RLS status, exact policies (4 per table, authenticated only, auth.uid() = user_id), and privileges.
-- ==============================================================================

BEGIN;

-- 1. smart_routines table
CREATE TABLE IF NOT EXISTS public.smart_routines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title VARCHAR(150) NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_smart_routines_user_order 
  ON public.smart_routines (user_id, order_index ASC, created_at ASC);

ALTER TABLE public.smart_routines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "smart_routines_select_policy" ON public.smart_routines;
CREATE POLICY "smart_routines_select_policy" ON public.smart_routines
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_routines_insert_policy" ON public.smart_routines;
CREATE POLICY "smart_routines_insert_policy" ON public.smart_routines
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_routines_update_policy" ON public.smart_routines;
CREATE POLICY "smart_routines_update_policy" ON public.smart_routines
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_routines_delete_policy" ON public.smart_routines;
CREATE POLICY "smart_routines_delete_policy" ON public.smart_routines
  FOR DELETE TO authenticated USING (auth.uid() = user_id);


-- 2. smart_routine_completions table
CREATE TABLE IF NOT EXISTS public.smart_routine_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  routine_id UUID NOT NULL REFERENCES public.smart_routines(id) ON DELETE CASCADE,
  date VARCHAR(10) NOT NULL, -- Format: YYYY-MM-DD
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ DEFAULT NULL,
  carried_forward BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_smart_completions_user_routine_date UNIQUE (user_id, routine_id, date)
);

CREATE INDEX IF NOT EXISTS idx_smart_completions_user_date 
  ON public.smart_routine_completions (user_id, date);

ALTER TABLE public.smart_routine_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "smart_completions_select_policy" ON public.smart_routine_completions;
CREATE POLICY "smart_completions_select_policy" ON public.smart_routine_completions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_completions_insert_policy" ON public.smart_routine_completions;
CREATE POLICY "smart_completions_insert_policy" ON public.smart_routine_completions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_completions_update_policy" ON public.smart_routine_completions;
CREATE POLICY "smart_completions_update_policy" ON public.smart_routine_completions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_completions_delete_policy" ON public.smart_routine_completions;
CREATE POLICY "smart_completions_delete_policy" ON public.smart_routine_completions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);


-- 3. smart_routine_reports table
CREATE TABLE IF NOT EXISTS public.smart_routine_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date VARCHAR(10) NOT NULL, -- Format: YYYY-MM-DD
  total_routines INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  incomplete_count INTEGER NOT NULL DEFAULT 0,
  completion_rate INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'Not Started',
  completed_routines JSONB NOT NULL DEFAULT '[]'::jsonb,
  incomplete_routines JSONB NOT NULL DEFAULT '[]'::jsonb,
  carry_forward_decision VARCHAR(20) DEFAULT 'pending', -- 'yes', 'no', 'pending'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NULL,
  CONSTRAINT uq_smart_reports_user_date UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_smart_reports_user_date 
  ON public.smart_routine_reports (user_id, date DESC);

ALTER TABLE public.smart_routine_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "smart_reports_select_policy" ON public.smart_routine_reports;
CREATE POLICY "smart_reports_select_policy" ON public.smart_routine_reports
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_reports_insert_policy" ON public.smart_routine_reports;
CREATE POLICY "smart_reports_insert_policy" ON public.smart_routine_reports
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_reports_update_policy" ON public.smart_routine_reports;
CREATE POLICY "smart_reports_update_policy" ON public.smart_routine_reports
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_reports_delete_policy" ON public.smart_routine_reports;
CREATE POLICY "smart_reports_delete_policy" ON public.smart_routine_reports
  FOR DELETE TO authenticated USING (auth.uid() = user_id);


-- 4. smart_routine_settings table
CREATE TABLE IF NOT EXISTS public.smart_routine_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  daily_summary_enabled BOOLEAN NOT NULL DEFAULT true,
  daily_summary_time VARCHAR(10) NOT NULL DEFAULT '22:00',
  timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.smart_routine_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "smart_settings_select_policy" ON public.smart_routine_settings;
CREATE POLICY "smart_settings_select_policy" ON public.smart_routine_settings
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_settings_insert_policy" ON public.smart_routine_settings;
CREATE POLICY "smart_settings_insert_policy" ON public.smart_routine_settings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_settings_update_policy" ON public.smart_routine_settings;
CREATE POLICY "smart_settings_update_policy" ON public.smart_routine_settings
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_settings_delete_policy" ON public.smart_routine_settings;
CREATE POLICY "smart_settings_delete_policy" ON public.smart_routine_settings
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- Step 5: Table Privileges Lockdown & Hardening
-- ------------------------------------------------------------------------------
-- Defense-in-depth: Revoke all privileges from anon and PUBLIC.
-- Explicitly revoke REFERENCES, TRIGGER, and TRUNCATE from authenticated.
-- Grant strictly SELECT, INSERT, UPDATE, DELETE to authenticated.
-- ------------------------------------------------------------------------------
REVOKE ALL ON TABLE public.smart_routines FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.smart_routine_completions FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.smart_routine_reports FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.smart_routine_settings FROM anon, PUBLIC;

REVOKE REFERENCES, TRIGGER, TRUNCATE ON TABLE public.smart_routines FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON TABLE public.smart_routine_completions FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON TABLE public.smart_routine_reports FROM authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON TABLE public.smart_routine_settings FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.smart_routines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.smart_routine_completions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.smart_routine_reports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.smart_routine_settings TO authenticated;

-- ------------------------------------------------------------------------------
-- Step 6: Transactional Verification Assertions (RLS, Policies & Privileges)
-- ------------------------------------------------------------------------------
-- Fails closed if any table lacks RLS, policy count is not exactly 4, any policy
-- has unexpected command/role/expression, any unexpected policy exists, or any
-- table retains excess privileges.
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_tbl RECORD;
  v_pol RECORD;
  v_auth_privileges TEXT[];
  v_grantable_count INTEGER;
  v_unauth_count INTEGER;
  v_rls_enabled BOOLEAN;
  v_table_policy_count INTEGER;
  v_unexpected_pol_names TEXT;
BEGIN
  -- Part A: Table-Level RLS, Policy Counts, and Privileges Lockdown Checks
  FOR v_tbl IN
    SELECT unnest(ARRAY[
      'smart_routines',
      'smart_routine_completions',
      'smart_routine_reports',
      'smart_routine_settings'
    ]) AS table_name
  LOOP
    -- 1. Assert RLS is enabled
    SELECT c.relrowsecurity INTO v_rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = v_tbl.table_name;

    IF v_rls_enabled IS NOT TRUE THEN
      RAISE EXCEPTION 'VERIFICATION FAILED: RLS is not enabled on public.%', v_tbl.table_name;
    END IF;

    -- 2. Assert exactly four policies per table
    SELECT COUNT(*) INTO v_table_policy_count
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = v_tbl.table_name;

    IF v_table_policy_count <> 4 THEN
      RAISE EXCEPTION 'VERIFICATION FAILED: Expected exactly 4 policies on public.%, found %',
        v_tbl.table_name, v_table_policy_count;
    END IF;

    -- 3. Assert exact authenticated privileges [DELETE, INSERT, SELECT, UPDATE]
    SELECT ARRAY_AGG(DISTINCT privilege_type ORDER BY privilege_type)
    INTO v_auth_privileges
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = v_tbl.table_name
      AND grantee = 'authenticated';

    IF v_auth_privileges IS NULL OR v_auth_privileges <> ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::TEXT[] THEN
      RAISE EXCEPTION 'VERIFICATION FAILED: authenticated role privileges on public.% are % (expected exactly [DELETE, INSERT, SELECT, UPDATE])',
        v_tbl.table_name, coalesce(array_to_string(v_auth_privileges, ','), 'NONE');
    END IF;

    -- 4. Assert zero grantable permissions for authenticated
    SELECT COUNT(*) INTO v_grantable_count
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = v_tbl.table_name
      AND grantee = 'authenticated'
      AND is_grantable = 'YES';

    IF v_grantable_count > 0 THEN
      RAISE EXCEPTION 'VERIFICATION FAILED: authenticated role has % grantable privilege(s) on public.%; expected 0',
        v_grantable_count, v_tbl.table_name;
    END IF;

    -- 5. Assert zero privileges granted to anon or PUBLIC
    SELECT COUNT(*) INTO v_unauth_count
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = v_tbl.table_name
      AND grantee IN ('anon', 'PUBLIC');

    IF v_unauth_count > 0 THEN
      RAISE EXCEPTION 'VERIFICATION FAILED: anon/PUBLIC retains % privilege(s) on public.%; expected 0',
        v_unauth_count, v_tbl.table_name;
    END IF;
  END LOOP;

  -- Part B: Fail-Closed Guard Against Unexpected Policies
  SELECT string_agg(quote_ident(policyname), ', ')
  INTO v_unexpected_pol_names
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('smart_routines', 'smart_routine_completions', 'smart_routine_reports', 'smart_routine_settings')
    AND policyname NOT IN (
      'smart_routines_select_policy', 'smart_routines_insert_policy', 'smart_routines_update_policy', 'smart_routines_delete_policy',
      'smart_completions_select_policy', 'smart_completions_insert_policy', 'smart_completions_update_policy', 'smart_completions_delete_policy',
      'smart_reports_select_policy', 'smart_reports_insert_policy', 'smart_reports_update_policy', 'smart_reports_delete_policy',
      'smart_settings_select_policy', 'smart_settings_insert_policy', 'smart_settings_update_policy', 'smart_settings_delete_policy'
    );

  IF v_unexpected_pol_names IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: Unexpected policy/policies detected on Smart Lists tables: %', v_unexpected_pol_names;
  END IF;

  -- Part C: Detailed Policy Structure and Ownership Expression Assertions
  FOR v_pol IN
    WITH expected_policies(table_name, policy_name, command_type, check_qual, check_with_check) AS (
      VALUES
        ('smart_routines', 'smart_routines_select_policy', 'SELECT', true, false),
        ('smart_routines', 'smart_routines_insert_policy', 'INSERT', false, true),
        ('smart_routines', 'smart_routines_update_policy', 'UPDATE', true, true),
        ('smart_routines', 'smart_routines_delete_policy', 'DELETE', true, false),

        ('smart_routine_completions', 'smart_completions_select_policy', 'SELECT', true, false),
        ('smart_routine_completions', 'smart_completions_insert_policy', 'INSERT', false, true),
        ('smart_routine_completions', 'smart_completions_update_policy', 'UPDATE', true, true),
        ('smart_routine_completions', 'smart_completions_delete_policy', 'DELETE', true, false),

        ('smart_routine_reports', 'smart_reports_select_policy', 'SELECT', true, false),
        ('smart_routine_reports', 'smart_reports_insert_policy', 'INSERT', false, true),
        ('smart_routine_reports', 'smart_reports_update_policy', 'UPDATE', true, true),
        ('smart_routine_reports', 'smart_reports_delete_policy', 'DELETE', true, false),

        ('smart_routine_settings', 'smart_settings_select_policy', 'SELECT', true, false),
        ('smart_routine_settings', 'smart_settings_insert_policy', 'INSERT', false, true),
        ('smart_routine_settings', 'smart_settings_update_policy', 'UPDATE', true, true),
        ('smart_routine_settings', 'smart_settings_delete_policy', 'DELETE', true, false)
    )
    SELECT ep.table_name, ep.policy_name, ep.command_type, ep.check_qual, ep.check_with_check,
           p.cmd, p.permissive, p.roles, p.qual, p.with_check
    FROM expected_policies ep
    LEFT JOIN pg_policies p
      ON p.schemaname = 'public'
     AND p.tablename = ep.table_name
     AND p.policyname = ep.policy_name
  LOOP
    -- 1. Assert policy existence
    IF v_pol.cmd IS NULL THEN
      RAISE EXCEPTION 'VERIFICATION FAILED: Expected policy %.% does not exist',
        v_pol.table_name, v_pol.policy_name;
    END IF;

    -- 2. Assert command type (one SELECT, INSERT, UPDATE, DELETE per table)
    IF v_pol.cmd <> v_pol.command_type THEN
      RAISE EXCEPTION 'VERIFICATION FAILED: Policy %.% has command %, expected %',
        v_pol.table_name, v_pol.policy_name, v_pol.cmd, v_pol.command_type;
    END IF;

    -- 3. Assert target role is strictly {authenticated}
    IF v_pol.roles IS NULL OR v_pol.roles <> ARRAY['authenticated'::name] THEN
      RAISE EXCEPTION 'VERIFICATION FAILED: Policy %.% targets role(s) %, expected {authenticated}',
        v_pol.table_name, v_pol.policy_name, coalesce(array_to_string(v_pol.roles, ','), 'NONE');
    END IF;

    -- 4. Assert policy is PERMISSIVE
    IF v_pol.permissive <> 'PERMISSIVE' THEN
      RAISE EXCEPTION 'VERIFICATION FAILED: Policy %.% is %, expected PERMISSIVE',
        v_pol.table_name, v_pol.policy_name, v_pol.permissive;
    END IF;

    -- 5. Verify USING clause (qual) for SELECT, UPDATE, DELETE
    IF v_pol.check_qual THEN
      IF v_pol.qual IS NULL THEN
        RAISE EXCEPTION 'VERIFICATION FAILED: Policy %.% has NULL USING clause',
          v_pol.table_name, v_pol.policy_name;
      ELSIF regexp_replace(lower(v_pol.qual), '["\s]', '', 'g') !~ '^(\(+auth\.uid\(\)=user_id\)+|\(+user_id=auth\.uid\(\)\)+)$' THEN
        RAISE EXCEPTION 'VERIFICATION FAILED: Policy %.% USING clause is unsafe: % (expected auth.uid() = user_id)',
          v_pol.table_name, v_pol.policy_name, v_pol.qual;
      END IF;
    END IF;

    -- 6. Verify WITH CHECK clause for INSERT, UPDATE
    IF v_pol.check_with_check THEN
      IF v_pol.with_check IS NULL THEN
        RAISE EXCEPTION 'VERIFICATION FAILED: Policy %.% has NULL WITH CHECK clause',
          v_pol.table_name, v_pol.policy_name;
      ELSIF regexp_replace(lower(v_pol.with_check), '["\s]', '', 'g') !~ '^(\(+auth\.uid\(\)=user_id\)+|\(+user_id=auth\.uid\(\)\)+)$' THEN
        RAISE EXCEPTION 'VERIFICATION FAILED: Policy %.% WITH CHECK clause is unsafe: % (expected auth.uid() = user_id)',
          v_pol.table_name, v_pol.policy_name, v_pol.with_check;
      END IF;
    END IF;
  END LOOP;

  RAISE NOTICE '=======================================================';
  RAISE NOTICE 'SUCCESS: Smart Lists schema privileges & policies verified!';
  RAISE NOTICE 'Tables:      smart_routines, completions, reports, settings';
  RAISE NOTICE 'RLS:         ENABLED on all 4 tables';
  RAISE NOTICE 'Policies:    exactly 4 per table (16 total), all authenticated only';
  RAISE NOTICE 'Ownership:   (auth.uid() = user_id) verified on all USING/WITH CHECK clauses';
  RAISE NOTICE 'Privileges:  authenticated CRUD only (REFERENCES/TRIGGER/TRUNCATE revoked)';
  RAISE NOTICE 'Revoked:     ALL from anon and PUBLIC';
  RAISE NOTICE '=======================================================';
END $$;

COMMIT;

