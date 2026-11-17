-- ==============================================================================
-- Taskly - Staging Continuation Pre-Flight Check (Migrations 001 & 002 Verification)
-- File: scripts/staging_continuation_preflight.sql
-- ==============================================================================
-- Target Project: mbmqybxwibvqzomssopw (Staging)
-- Read-Only:
--   1. Confirms Base todos, Migration 001, 001 Fix, and Migration 002 are applied.
--   2. Verifies table existence, relkind, RLS, and FORCE RLS on public.todos.
--   3. Verifies public.todos.user_id exists, has type UUID, and is NOT NULL.
--   4. Verifies primary keys on all 5 tables.
--   5. Verifies unique constraints on the 4 Smart Lists tables.
--   6. Verifies all 6 foreign keys with exact referencing/referenced columns and ON DELETE actions.
--   7. Verifies exact table privileges via PostgreSQL ACL inspection (aclexplode).
--   8. Verifies all 20 RLS policies (exact names, role, permissive, USING, WITH CHECK, and absence of clauses).
--   9. Confirms clean continuation state:
--      - Absence of all 11 columns added by Migration 003.
--      - Absence of trigger function and trigger from Migration 003.
--      - Absence of all 10 customer support tables created by Migration 007.
--
-- Security:
--   Strictly read-only.
--   Strictly fail-closed (RAISE EXCEPTION on any failure).
--   All catalog queries strictly scoped to the public schema.
-- ==============================================================================
DO $$
DECLARE
  v_err TEXT := '';
  v_tbl RECORD;
  v_pk RECORD;
  v_uq RECORD;
  v_fk RECORD;
  v_pol RECORD;
  v_col RECORD;
  v_supp_tbl RECORD;
  v_count INT;
  v_auth_privileges TEXT[];
  v_grantable_count INT;
  v_forbidden_count INT;
  v_unauth_count INT;
  v_public_nsp OID;
BEGIN
  -- ----------------------------------------------------------------------------
  -- 0. Resolve Public Namespace OID
  -- ----------------------------------------------------------------------------
  SELECT oid INTO v_public_nsp FROM pg_namespace WHERE nspname = 'public';
  IF v_public_nsp IS NULL THEN
    RAISE EXCEPTION 'STAGING CONTINUATION PRE-FLIGHT FAILED: Namespace "public" not found in pg_namespace.';
  END IF;

  -- ----------------------------------------------------------------------------
  -- 1. Table Existence, relkind, RLS, and FORCE RLS Verification (5 tables)
  -- ----------------------------------------------------------------------------
  FOR v_tbl IN
    WITH expected_tables(relname, expected_rls, expected_forced) AS (
      VALUES
        ('todos', true, true),
        ('smart_routines', true, false),
        ('smart_routine_completions', true, false),
        ('smart_routine_reports', true, false),
        ('smart_routine_settings', true, false)
    )
    SELECT et.relname, et.expected_rls, et.expected_forced, c.relrowsecurity, c.relforcerowsecurity
    FROM expected_tables et
    LEFT JOIN pg_class c ON c.relname = et.relname
      AND c.relnamespace = v_public_nsp
      AND c.relkind = 'r'
  LOOP
    IF v_tbl.relrowsecurity IS NULL THEN
      v_err := v_err || format(' Missing table: public.%s;', v_tbl.relname);
    ELSIF v_tbl.relrowsecurity <> v_tbl.expected_rls THEN
      v_err := v_err || format(' Table public.%s RLS is %s, expected %s;', v_tbl.relname, v_tbl.relrowsecurity, v_tbl.expected_rls);
    ELSIF v_tbl.relforcerowsecurity <> v_tbl.expected_forced THEN
      v_err := v_err || format(' Table public.%s FORCE RLS is %s, expected %s;', v_tbl.relname, v_tbl.relforcerowsecurity, v_tbl.expected_forced);
    END IF;
  END LOOP;

  -- ----------------------------------------------------------------------------
  -- 2. Core Column Verification: public.todos.user_id (UUID NOT NULL)
  -- ----------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'todos'
      AND column_name = 'user_id'
      AND data_type = 'uuid'
      AND is_nullable = 'NO'
  ) THEN
    v_err := v_err || ' Missing or invalid public.todos.user_id (expected UUID NOT NULL);';
  END IF;

  -- ----------------------------------------------------------------------------
  -- 3. Primary Key Verification (All 5 tables)
  -- ----------------------------------------------------------------------------
  FOR v_pk IN
    WITH expected_pks(table_name, col_names) AS (
      VALUES
        ('todos', ARRAY['id']::text[]),
        ('smart_routines', ARRAY['id']::text[]),
        ('smart_routine_completions', ARRAY['id']::text[]),
        ('smart_routine_reports', ARRAY['id']::text[]),
        ('smart_routine_settings', ARRAY['user_id']::text[])
    )
    SELECT
      ep.table_name, ep.col_names,
      c.conname, c.actual_cols
    FROM expected_pks ep
    LEFT JOIN (
      SELECT
        t.relname AS tbl,
        c.conname,
        ARRAY(
          SELECT a.attname::text
          FROM unnest(c.conkey) AS ck(attnum)
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ck.attnum
          ORDER BY a.attname
        ) AS actual_cols
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relnamespace = v_public_nsp
        AND t.relkind = 'r'
        AND c.contype = 'p'
    ) c ON c.tbl = ep.table_name
       AND c.actual_cols = ep.col_names
  LOOP
    IF v_pk.conname IS NULL THEN
      v_err := v_err || format(' Missing PRIMARY KEY on public.%s(%s);',
        v_pk.table_name, array_to_string(v_pk.col_names, ','));
    END IF;
  END LOOP;

  -- ----------------------------------------------------------------------------
  -- 4. Unique Constraints Verification (Smart Lists tables)
  -- ----------------------------------------------------------------------------
  -- Total explicit unique constraints (contype = 'u') on the 4 Smart Lists tables must be exactly 2
  SELECT COUNT(*) INTO v_count
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  WHERE t.relnamespace = v_public_nsp
    AND t.relkind = 'r'
    AND t.relname IN ('smart_routines', 'smart_routine_completions', 'smart_routine_reports', 'smart_routine_settings')
    AND c.contype = 'u';

  IF v_count <> 2 THEN
    v_err := v_err || format(' Unique constraint count on Smart Lists tables is %s, expected exactly 2;', v_count);
  END IF;

  FOR v_uq IN
    WITH expected_uqs(table_name, con_name, col_names) AS (
      VALUES
        ('smart_routine_completions', 'uq_smart_completions_user_routine_date', ARRAY['date', 'routine_id', 'user_id']::text[]),
        ('smart_routine_reports', 'uq_smart_reports_user_date', ARRAY['date', 'user_id']::text[])
    )
    SELECT
      eu.table_name, eu.con_name, eu.col_names,
      c.conname, c.actual_cols
    FROM expected_uqs eu
    LEFT JOIN (
      SELECT
        t.relname AS tbl,
        c.conname,
        ARRAY(
          SELECT a.attname::text
          FROM unnest(c.conkey) AS ck(attnum)
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ck.attnum
          ORDER BY a.attname
        ) AS actual_cols
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relnamespace = v_public_nsp
        AND t.relkind = 'r'
        AND c.contype = 'u'
    ) c ON c.tbl = eu.table_name
       AND c.actual_cols = eu.col_names
  LOOP
    IF v_uq.conname IS NULL THEN
      v_err := v_err || format(' Missing UNIQUE constraint on public.%s(%s);',
        v_uq.table_name, array_to_string(v_uq.col_names, ','));
    ELSIF v_uq.conname <> v_uq.con_name THEN
      v_err := v_err || format(' UNIQUE constraint on public.%s has name "%s", expected "%s";',
        v_uq.table_name, v_uq.conname, v_uq.con_name);
    END IF;
  END LOOP;

  -- ----------------------------------------------------------------------------
  -- 5. Foreign Key Constraints & Exact ON DELETE Actions (All 6 FKs)
  -- ----------------------------------------------------------------------------
  -- Total foreign keys count on the 5 core tables must be exactly 6
  SELECT COUNT(*) INTO v_count
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  WHERE t.relnamespace = v_public_nsp
    AND t.relkind = 'r'
    AND t.relname IN ('todos', 'smart_routines', 'smart_routine_completions', 'smart_routine_reports', 'smart_routine_settings')
    AND c.contype = 'f';

  IF v_count <> 6 THEN
    v_err := v_err || format(' Foreign key count on core tables is %s, expected exactly 6;', v_count);
  END IF;

  FOR v_fk IN
    WITH expected_fks(table_name, col_names, ref_schema, ref_table, ref_col_names, expected_on_delete) AS (
      VALUES
        ('todos', ARRAY['user_id']::text[], 'auth', 'users', ARRAY['id']::text[], 'r'), -- RESTRICT
        ('smart_routines', ARRAY['user_id']::text[], 'auth', 'users', ARRAY['id']::text[], 'c'), -- CASCADE
        ('smart_routine_completions', ARRAY['user_id']::text[], 'auth', 'users', ARRAY['id']::text[], 'c'),
        ('smart_routine_completions', ARRAY['routine_id']::text[], 'public', 'smart_routines', ARRAY['id']::text[], 'c'),
        ('smart_routine_reports', ARRAY['user_id']::text[], 'auth', 'users', ARRAY['id']::text[], 'c'),
        ('smart_routine_settings', ARRAY['user_id']::text[], 'auth', 'users', ARRAY['id']::text[], 'c')
    )
    SELECT
      ef.table_name, ef.col_names, ef.ref_schema, ef.ref_table, ef.ref_col_names, ef.expected_on_delete,
      c.confdeltype, c.conname
    FROM expected_fks ef
    LEFT JOIN (
      SELECT
        t.relname AS tbl,
        ref_n.nspname AS r_schema,
        ref_t.relname AS r_tbl,
        c.conname,
        c.confdeltype,
        ARRAY(SELECT a.attname::text FROM unnest(c.conkey) AS ck(attnum) JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ck.attnum ORDER BY a.attname) AS cols,
        ARRAY(SELECT a.attname::text FROM unnest(c.confkey) AS cfk(attnum) JOIN pg_attribute a ON a.attrelid = ref_t.oid AND a.attnum = cfk.attnum ORDER BY a.attname) AS r_cols
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_class ref_t ON c.confrelid = ref_t.oid
      JOIN pg_namespace ref_n ON ref_t.relnamespace = ref_n.oid
      WHERE c.contype = 'f'
        AND t.relnamespace = v_public_nsp
        AND t.relkind = 'r'
    ) c ON c.tbl = ef.table_name
       AND c.r_schema = ef.ref_schema
       AND c.r_tbl = ef.ref_table
       AND c.cols = ef.col_names
       AND c.r_cols = ef.ref_col_names
  LOOP
    IF v_fk.confdeltype IS NULL THEN
      v_err := v_err || format(' Missing FK on public.%s(%s) -> %s.%s(%s);',
        v_fk.table_name, array_to_string(v_fk.col_names, ','), v_fk.ref_schema, v_fk.ref_table, array_to_string(v_fk.ref_col_names, ','));
    ELSIF v_fk.confdeltype <> v_fk.expected_on_delete THEN
      v_err := v_err || format(' FK on public.%s(%s) ON DELETE action is "%s", expected "%s";',
        v_fk.table_name, array_to_string(v_fk.col_names, ','), v_fk.confdeltype, v_fk.expected_on_delete);
    END IF;
  END LOOP;

  -- ----------------------------------------------------------------------------
  -- 6. Table Privileges via PostgreSQL ACL Inspection (aclexplode)
  -- ----------------------------------------------------------------------------
  FOR v_tbl IN
    SELECT unnest(ARRAY[
      'todos', 'smart_routines', 'smart_routine_completions',
      'smart_routine_reports', 'smart_routine_settings'
    ]) AS relname
  LOOP
    WITH table_acl AS (
      SELECT
        CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END AS grantee_name,
        a.privilege_type,
        a.is_grantable
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
      LEFT JOIN pg_roles r ON r.oid = a.grantee
      WHERE c.relnamespace = v_public_nsp
        AND c.relname = v_tbl.relname
        AND c.relkind = 'r'
    )
    SELECT
      ARRAY_AGG(DISTINCT privilege_type ORDER BY privilege_type) FILTER (WHERE grantee_name = 'authenticated'),
      COUNT(*) FILTER (WHERE grantee_name = 'authenticated' AND is_grantable = true),
      COUNT(*) FILTER (WHERE grantee_name = 'authenticated' AND privilege_type IN ('REFERENCES', 'TRIGGER', 'TRUNCATE')),
      COUNT(*) FILTER (WHERE grantee_name IN ('anon', 'PUBLIC'))
    INTO v_auth_privileges, v_grantable_count, v_forbidden_count, v_unauth_count
    FROM table_acl;

    IF v_auth_privileges IS NULL OR v_auth_privileges <> ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::TEXT[] THEN
      v_err := v_err || format(' public.%s authenticated privileges are %s, expected [DELETE, INSERT, SELECT, UPDATE];',
        v_tbl.relname, coalesce(array_to_string(v_auth_privileges, ','), 'NONE'));
    END IF;
    IF v_grantable_count > 0 THEN
      v_err := v_err || format(' public.%s authenticated has %s grantable privileges;', v_tbl.relname, v_grantable_count);
    END IF;
    IF v_forbidden_count > 0 THEN
      v_err := v_err || format(' public.%s authenticated retains REFERENCES/TRIGGER/TRUNCATE;', v_tbl.relname);
    END IF;
    IF v_unauth_count > 0 THEN
      v_err := v_err || format(' public.%s anon/PUBLIC retains %s privileges;', v_tbl.relname, v_unauth_count);
    END IF;
  END LOOP;

  -- ----------------------------------------------------------------------------
  -- 7. Policy Verification (Exactly 20 policies across the 5 tables)
  -- ----------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('todos', 'smart_routines', 'smart_routine_completions', 'smart_routine_reports', 'smart_routine_settings');

  IF v_count <> 20 THEN
    v_err := v_err || format(' Total policy count on Core & Smart Lists tables is %s, expected exactly 20;', v_count);
  END IF;

  FOR v_pol IN
    WITH expected_policies(table_name, policy_name, cmd, check_qual, check_with_check) AS (
      VALUES
        ('todos', 'todos_select_authenticated', 'SELECT', true, false),
        ('todos', 'todos_insert_authenticated', 'INSERT', false, true),
        ('todos', 'todos_update_authenticated', 'UPDATE', true, true),
        ('todos', 'todos_delete_authenticated', 'DELETE', true, false),

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
    SELECT
      ep.table_name, ep.policy_name, ep.cmd AS exp_cmd, ep.check_qual, ep.check_with_check,
      p.policyname, p.cmd, p.permissive, p.roles, p.qual, p.with_check
    FROM expected_policies ep
    LEFT JOIN pg_policies p
      ON p.schemaname = 'public' AND p.tablename = ep.table_name AND p.policyname = ep.policy_name
  LOOP
    IF v_pol.policyname IS NULL THEN
      v_err := v_err || format(' Missing policy: %s on %s;', v_pol.policy_name, v_pol.table_name);
    ELSIF v_pol.cmd <> v_pol.exp_cmd THEN
      v_err := v_err || format(' Policy %s command is %s, expected %s;', v_pol.policy_name, v_pol.cmd, v_pol.exp_cmd);
    ELSIF v_pol.permissive <> 'PERMISSIVE' THEN
      v_err := v_err || format(' Policy %s permissive is %s, expected PERMISSIVE;', v_pol.policy_name, v_pol.permissive);
    ELSIF v_pol.roles <> ARRAY['authenticated'::name] THEN
      v_err := v_err || format(' Policy %s target roles are %s, expected {authenticated};', v_pol.policy_name, array_to_string(v_pol.roles, ','));
    END IF;

    -- Verify presence or absence of USING clause
    IF v_pol.check_qual THEN
      IF v_pol.qual IS NULL OR regexp_replace(lower(v_pol.qual), '["\s]', '', 'g') !~ '^(\(+auth\.uid\(\)=user_id\)+|\(+user_id=auth\.uid\(\)\)+)$' THEN
        v_err := v_err || format(' Policy %s USING expression mismatch: %s;', v_pol.policy_name, coalesce(v_pol.qual, 'NULL'));
      END IF;
    ELSE
      IF v_pol.qual IS NOT NULL THEN
        v_err := v_err || format(' Policy %s has unexpected USING clause: %s;', v_pol.policy_name, v_pol.qual);
      END IF;
    END IF;

    -- Verify presence or absence of WITH CHECK clause
    IF v_pol.check_with_check THEN
      IF v_pol.with_check IS NULL OR regexp_replace(lower(v_pol.with_check), '["\s]', '', 'g') !~ '^(\(+auth\.uid\(\)=user_id\)+|\(+user_id=auth\.uid\(\)\)+)$' THEN
        v_err := v_err || format(' Policy %s WITH CHECK expression mismatch: %s;', v_pol.policy_name, coalesce(v_pol.with_check, 'NULL'));
      END IF;
    ELSE
      IF v_pol.with_check IS NOT NULL THEN
        v_err := v_err || format(' Policy %s has unexpected WITH CHECK clause: %s;', v_pol.policy_name, v_pol.with_check);
      END IF;
    END IF;
  END LOOP;

  -- ----------------------------------------------------------------------------
  -- 8. Clean Continuation State: Ensure Migrations 003 & 007 are NOT yet applied
  -- ----------------------------------------------------------------------------
  -- 8.1 Verify ALL 11 columns added by Migration 003 are ABSENT in public schema
  FOR v_col IN
    WITH m003_cols(table_name, column_name) AS (
      VALUES
        ('smart_routine_completions', 'status'),
        ('smart_routine_completions', 'postponed_to'),
        ('smart_routine_completions', 'cancellation_reason'),
        ('smart_routine_completions', 'updated_at'),
        ('smart_routine_reports', 'eligible_count'),
        ('smart_routine_reports', 'postponed_count'),
        ('smart_routine_reports', 'cancelled_count'),
        ('smart_routine_reports', 'postponed_routines'),
        ('smart_routine_reports', 'cancelled_routines'),
        ('smart_routine_reports', 'is_streak_qualified'),
        ('smart_routine_settings', 'streak_threshold')
    )
    SELECT mc.table_name, mc.column_name
    FROM m003_cols mc
    JOIN information_schema.columns c
      ON c.table_schema = 'public'
     AND c.table_name = mc.table_name
     AND c.column_name = mc.column_name
  LOOP
    v_err := v_err || format(' Column public.%s.%s already exists (Migration 003 appears already applied);',
      v_col.table_name, v_col.column_name);
  END LOOP;

  -- 8.2 Habit streak trigger function and trigger should not exist yet in public schema
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.pronamespace = v_public_nsp AND p.proname = 'fn_sync_smart_completion_status'
  ) THEN
    v_err := v_err || ' Function public.fn_sync_smart_completion_status already exists (Migration 003 appears already applied);';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger tg
    JOIN pg_class t ON tg.tgrelid = t.oid
    WHERE t.relnamespace = v_public_nsp AND tg.tgname = 'trg_sync_smart_completion_status'
  ) THEN
    v_err := v_err || ' Trigger trg_sync_smart_completion_status already exists (Migration 003 appears already applied);';
  END IF;

  -- 8.3 Verify ALL 10 support tables created by Migration 007 are ABSENT in public schema
  FOR v_supp_tbl IN
    SELECT c.relname
    FROM pg_class c
    WHERE c.relnamespace = v_public_nsp
      AND c.relkind = 'r'
      AND c.relname IN (
        'support_tickets',
        'support_ticket_messages',
        'support_ticket_routing',
        'support_quarantined_messages',
        'support_ticket_events',
        'support_security_incidents',
        'support_email_outbox',
        'inbound_webhook_events',
        'support_ticket_idempotency',
        'support_message_idempotency'
      )
  LOOP
    v_err := v_err || format(' Customer support table public.%s already exists (Migration 007 appears already applied);', v_supp_tbl.relname);
  END LOOP;

  -- ----------------------------------------------------------------------------
  -- 9. Final Verdict & Fail-Closed Reporting
  -- ----------------------------------------------------------------------------
  IF length(v_err) > 0 THEN
    RAISE EXCEPTION 'STAGING CONTINUATION PRE-FLIGHT VERIFICATION FAILED:%', v_err;
  END IF;

  RAISE NOTICE '================================================================================';
  RAISE NOTICE 'STAGING CONTINUATION PRE-FLIGHT VERIFICATION PASSED:';
  RAISE NOTICE '  - Table Catalog:     5 tables verified in public (todos with FORCE RLS; 4 smart tables with RLS)';
  RAISE NOTICE '  - Core Todos Column: public.todos.user_id verified (UUID NOT NULL)';
  RAISE NOTICE '  - Primary Keys:      5 PKs verified (todos, smart_routines, completions, reports on id; settings on user_id)';
  RAISE NOTICE '  - Unique Constraints:2 UNIQUE constraints verified:';
  RAISE NOTICE '                       * smart_routine_completions(user_id, routine_id, date) [uq_smart_completions_user_routine_date]';
  RAISE NOTICE '                       * smart_routine_reports(user_id, date) [uq_smart_reports_user_date]';
  RAISE NOTICE '  - Foreign Keys:      6 FKs verified with exact ON DELETE actions:';
  RAISE NOTICE '                       * public.todos(user_id) -> auth.users(id) [ON DELETE RESTRICT]';
  RAISE NOTICE '                       * public.smart_routines(user_id) -> auth.users(id) [ON DELETE CASCADE]';
  RAISE NOTICE '                       * public.smart_routine_completions(user_id) -> auth.users(id) [ON DELETE CASCADE]';
  RAISE NOTICE '                       * public.smart_routine_completions(routine_id) -> public.smart_routines(id) [ON DELETE CASCADE]';
  RAISE NOTICE '                       * public.smart_routine_reports(user_id) -> auth.users(id) [ON DELETE CASCADE]';
  RAISE NOTICE '                       * public.smart_routine_settings(user_id) -> auth.users(id) [ON DELETE CASCADE]';
  RAISE NOTICE '  - Table Privileges:  5 tables verified via aclexplode in public schema:';
  RAISE NOTICE '                       * authenticated: strictly [DELETE, INSERT, SELECT, UPDATE], 0 grantable';
  RAISE NOTICE '                       * REFERENCES, TRIGGER, TRUNCATE: strictly absent';
  RAISE NOTICE '                       * anon and PUBLIC: 0 privileges';
  RAISE NOTICE '  - RLS Policies:      Exactly 20 policies verified (4 per table, authenticated only, auth.uid() = user_id)';
  RAISE NOTICE '                       Verified exact USING / WITH CHECK expressions and expected absence of clauses';
  RAISE NOTICE '  - Clean Continuation:All 11 Migration 003 columns, trigger, function, and all 10 Migration 007 support tables confirmed unapplied';
  RAISE NOTICE 'Staging database mbmqybxwibvqzomssopw is certified ready for Migration 003.';
  RAISE NOTICE '================================================================================';
END $$;
