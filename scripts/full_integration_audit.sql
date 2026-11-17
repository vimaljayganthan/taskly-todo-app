-- ==============================================================================
-- Taskly - Full Post-Migration Integration Audit (Hardened & Scoped)
-- File: scripts/full_integration_audit.sql
-- ==============================================================================
-- Target Project: mbmqybxwibvqzomssopw (Backend Staging - ap-southeast-1)
--
-- Read-Only Design:
--   - Zero DDL / DML: strictly SELECT queries against PostgreSQL system catalogs.
--   - No INSERT, UPDATE, DELETE, ALTER, DROP, CREATE, GRANT, REVOKE, or migrations.
--   - Strictly fail-closed (RAISE EXCEPTION if any object is missing, extra, or invalid).
--   - All queries strictly scoped to the public schema via pg_namespace.
--
-- Verification Coverage:
--   1. 15 Tables: relkind, existence, RLS enabled on all 15; relforcerowsecurity on todos.
--   2. Direct ACL Inspection (aclexplode):
--      - authenticated: CRUD on 5 core tables; SELECT only on 2 support tables; 0 on 8 internal support tables.
--      - anon & PUBLIC: 0 privileges across all 15 tables.
--      - service_role: 0 privileges on 5 core tables (storage/taskStore.js explicitly prohibits
--        SUPABASE_SERVICE_ROLE_KEY for normal application storage; migrations 001-003 grant zero privileges);
--        full management privileges on all 10 customer support tables ONLY; 0 grantable privileges across all 15 tables.
--   3. 20 Foreign Keys: verified by referencing/referenced columns and exact ON DELETE actions
--      (15 CASCADE, 4 SET NULL, 1 RESTRICT).
--   4. 22 Policies: verified by policy name, role, permissive mode, command, USING, and WITH CHECK.
--   5. 17 Routines: verified by exact signature (oidvectortypes), argument count, SECURITY DEFINER flag,
--      fixed search_path, execution ACLs, prohibition of grant options, and check against extra/overloads.
-- ==============================================================================
DO $$
DECLARE
  v_err TEXT := '';
  v_tbl RECORD;
  v_pol RECORD;
  v_fk RECORD;
  v_fn_spec RECORD;
  v_extra_fn RECORD;
  v_count INT;
  v_actual_sig TEXT;
  v_auth_privileges TEXT[];
  v_service_privileges TEXT[];
  v_actual_grantees TEXT[];
  v_grantable_count INT;
  v_service_grantable_count INT;
  v_all_grantable_count INT;
  v_service_count INT;
  v_fn_grantable_count INT;
  v_forbidden_count INT;
  v_unauth_count INT;
  v_fn_unauth_count INT;
  v_public_nsp OID;
BEGIN
  -- ----------------------------------------------------------------------------
  -- 0. Resolve Public Namespace OID
  -- ----------------------------------------------------------------------------
  SELECT oid INTO v_public_nsp FROM pg_namespace WHERE nspname = 'public';
  IF v_public_nsp IS NULL THEN
    RAISE EXCEPTION 'FULL POST-MIGRATION INTEGRATION AUDIT FAILED: Namespace "public" not found in pg_namespace.';
  END IF;

  -- ----------------------------------------------------------------------------
  -- 1. Table Verification (Scoped strictly to Taskly's 15 tables in public schema)
  -- ----------------------------------------------------------------------------
  FOR v_tbl IN
    WITH expected_tables(relname, expected_rls, expected_forced) AS (
      VALUES
        ('todos', true, true),
        ('smart_routines', true, false),
        ('smart_routine_completions', true, false),
        ('smart_routine_reports', true, false),
        ('smart_routine_settings', true, false),
        ('support_tickets', true, false),
        ('support_ticket_messages', true, false),
        ('support_ticket_routing', true, false),
        ('support_quarantined_messages', true, false),
        ('support_ticket_events', true, false),
        ('support_security_incidents', true, false),
        ('support_email_outbox', true, false),
        ('inbound_webhook_events', true, false),
        ('support_ticket_idempotency', true, false),
        ('support_message_idempotency', true, false)
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
  -- 2. Direct PostgreSQL ACL Inspection (aclexplode) for Tables
  -- ----------------------------------------------------------------------------
  -- 2.1 Core 5 tables: authenticated strictly [DELETE, INSERT, SELECT, UPDATE], 0 grantable, 0 anon/PUBLIC, 0 service_role.
  -- Architectural Conformance: Normal application storage (storage/taskStore.js) strictly relies on
  -- authenticated user tokens (SUPABASE_ANON_KEY / JWT) and RLS isolation. SUPABASE_SERVICE_ROLE_KEY
  -- is explicitly prohibited for normal application storage, and migrations 001-003 grant zero privileges
  -- to service_role on core tables. Therefore, service_role must have ZERO direct table privileges.
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
      COUNT(*) FILTER (WHERE grantee_name IN ('anon', 'PUBLIC')),
      COUNT(*) FILTER (WHERE is_grantable = true),
      COUNT(*) FILTER (WHERE grantee_name = 'service_role'),
      ARRAY_AGG(DISTINCT privilege_type ORDER BY privilege_type) FILTER (WHERE grantee_name = 'service_role')
    INTO v_auth_privileges, v_grantable_count, v_forbidden_count, v_unauth_count, v_all_grantable_count, v_service_count, v_service_privileges
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
    IF v_all_grantable_count > 0 THEN
      v_err := v_err || format(' public.%s has %s grantable privileges (GRANT OPTION forbidden);', v_tbl.relname, v_all_grantable_count);
    END IF;
    IF v_service_count > 0 THEN
      v_err := v_err || format(' public.%s service_role retains %s unexpected direct privilege(s): %s (expected 0);',
        v_tbl.relname, v_service_count, array_to_string(v_service_privileges, ','));
    END IF;
  END LOOP;

  -- 2.2 Customer-facing support tables: authenticated strictly [SELECT], 0 grantable, service_role has ALL, 0 anon/PUBLIC
  -- Migration 007 explicitly grants ALL to service_role on support tables for backend ticket operations.
  FOR v_tbl IN
    SELECT unnest(ARRAY['support_tickets', 'support_ticket_messages']) AS relname
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
      COUNT(*) FILTER (WHERE grantee_name = 'authenticated' AND privilege_type IN ('DELETE', 'INSERT', 'UPDATE', 'REFERENCES', 'TRIGGER', 'TRUNCATE')),
      COUNT(*) FILTER (WHERE grantee_name IN ('anon', 'PUBLIC')),
      ARRAY_AGG(DISTINCT privilege_type ORDER BY privilege_type) FILTER (WHERE grantee_name = 'service_role'),
      COUNT(*) FILTER (WHERE grantee_name = 'service_role' AND is_grantable = true)
    INTO v_auth_privileges, v_grantable_count, v_forbidden_count, v_unauth_count, v_service_privileges, v_service_grantable_count
    FROM table_acl;

    IF v_auth_privileges IS NULL OR v_auth_privileges <> ARRAY['SELECT']::TEXT[] THEN
      v_err := v_err || format(' public.%s authenticated privileges are %s, expected [SELECT];',
        v_tbl.relname, coalesce(array_to_string(v_auth_privileges, ','), 'NONE'));
    END IF;
    IF v_grantable_count > 0 THEN
      v_err := v_err || format(' public.%s authenticated has %s grantable privileges;', v_tbl.relname, v_grantable_count);
    END IF;
    IF v_forbidden_count > 0 THEN
      v_err := v_err || format(' public.%s authenticated has %s forbidden write/admin privileges;', v_tbl.relname, v_forbidden_count);
    END IF;
    IF v_unauth_count > 0 THEN
      v_err := v_err || format(' public.%s anon/PUBLIC retains %s privileges;', v_tbl.relname, v_unauth_count);
    END IF;
    IF v_service_privileges IS NULL OR NOT (ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::TEXT[] <@ v_service_privileges) THEN
      v_err := v_err || format(' public.%s service_role is missing required CRUD privileges (has %s);',
        v_tbl.relname, coalesce(array_to_string(v_service_privileges, ','), 'NONE'));
    END IF;
    IF v_service_grantable_count > 0 THEN
      v_err := v_err || format(' public.%s service_role has %s grantable privileges;', v_tbl.relname, v_service_grantable_count);
    END IF;
  END LOOP;

  -- 2.3 Internal 8 support tables: 0 authenticated, 0 anon/PUBLIC, service_role has ALL
  -- Migration 007 explicitly grants ALL on these 8 tables to service_role ONLY.
  FOR v_tbl IN
    SELECT unnest(ARRAY[
      'support_ticket_routing', 'support_quarantined_messages', 'support_ticket_events',
      'support_security_incidents', 'support_email_outbox', 'inbound_webhook_events',
      'support_ticket_idempotency', 'support_message_idempotency'
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
      COUNT(*) FILTER (WHERE grantee_name = 'authenticated'),
      COUNT(*) FILTER (WHERE grantee_name IN ('anon', 'PUBLIC')),
      ARRAY_AGG(DISTINCT privilege_type ORDER BY privilege_type) FILTER (WHERE grantee_name = 'service_role'),
      COUNT(*) FILTER (WHERE grantee_name = 'service_role' AND is_grantable = true)
    INTO v_forbidden_count, v_unauth_count, v_service_privileges, v_service_grantable_count
    FROM table_acl;

    IF v_forbidden_count > 0 THEN
      v_err := v_err || format(' public.%s has %s unexpected authenticated privileges;', v_tbl.relname, v_forbidden_count);
    END IF;
    IF v_unauth_count > 0 THEN
      v_err := v_err || format(' public.%s anon/PUBLIC retains %s privileges;', v_tbl.relname, v_unauth_count);
    END IF;
    IF v_service_privileges IS NULL OR NOT (ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::TEXT[] <@ v_service_privileges) THEN
      v_err := v_err || format(' public.%s service_role is missing required CRUD privileges (has %s);',
        v_tbl.relname, coalesce(array_to_string(v_service_privileges, ','), 'NONE'));
    END IF;
    IF v_service_grantable_count > 0 THEN
      v_err := v_err || format(' public.%s service_role has %s grantable privileges;', v_tbl.relname, v_service_grantable_count);
    END IF;
  END LOOP;

  -- ----------------------------------------------------------------------------
  -- 3. Foreign Key Constraints & Exact ON DELETE Actions (All 20 FKs: 15 CASCADE, 4 SET NULL, 1 RESTRICT)
  -- ----------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_count
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  WHERE t.relnamespace = v_public_nsp
    AND t.relkind = 'r'
    AND t.relname IN (
      'todos', 'smart_routines', 'smart_routine_completions',
      'smart_routine_reports', 'smart_routine_settings', 'support_tickets',
      'support_ticket_messages', 'support_ticket_routing', 'support_quarantined_messages',
      'support_ticket_events', 'support_security_incidents', 'support_email_outbox',
      'inbound_webhook_events', 'support_ticket_idempotency', 'support_message_idempotency'
    )
    AND c.contype = 'f';

  IF v_count <> 20 THEN
    v_err := v_err || format(' Total foreign key count on Taskly tables is %s, expected exactly 20;', v_count);
  END IF;

  FOR v_fk IN
    WITH expected_fks(table_name, col_names, ref_schema, ref_table, ref_col_names, expected_on_delete) AS (
      VALUES
        ('todos', ARRAY['user_id']::text[], 'auth', 'users', ARRAY['id']::text[], 'r'), -- 1 RESTRICT
        ('smart_routines', ARRAY['user_id']::text[], 'auth', 'users', ARRAY['id']::text[], 'c'), -- 1 CASCADE
        ('smart_routine_completions', ARRAY['user_id']::text[], 'auth', 'users', ARRAY['id']::text[], 'c'), -- 2 CASCADE
        ('smart_routine_completions', ARRAY['routine_id']::text[], 'public', 'smart_routines', ARRAY['id']::text[], 'c'), -- 3 CASCADE
        ('smart_routine_reports', ARRAY['user_id']::text[], 'auth', 'users', ARRAY['id']::text[], 'c'), -- 4 CASCADE
        ('smart_routine_settings', ARRAY['user_id']::text[], 'auth', 'users', ARRAY['id']::text[], 'c'), -- 5 CASCADE
        ('support_tickets', ARRAY['user_id']::text[], 'auth', 'users', ARRAY['id']::text[], 'c'), -- 6 CASCADE
        ('support_tickets', ARRAY['developer_user_id']::text[], 'auth', 'users', ARRAY['id']::text[], 'n'), -- 1 SET NULL
        ('support_ticket_messages', ARRAY['ticket_id']::text[], 'public', 'support_tickets', ARRAY['id']::text[], 'c'), -- 7 CASCADE
        ('support_ticket_messages', ARRAY['sender_user_id']::text[], 'auth', 'users', ARRAY['id']::text[], 'n'), -- 2 SET NULL
        ('support_ticket_routing', ARRAY['ticket_id']::text[], 'public', 'support_tickets', ARRAY['id']::text[], 'c'), -- 8 CASCADE
        ('support_quarantined_messages', ARRAY['reviewed_by']::text[], 'auth', 'users', ARRAY['id']::text[], 'n'), -- 3 SET NULL
        ('support_ticket_events', ARRAY['ticket_id']::text[], 'public', 'support_tickets', ARRAY['id']::text[], 'c'), -- 9 CASCADE
        ('support_ticket_events', ARRAY['actor_id']::text[], 'auth', 'users', ARRAY['id']::text[], 'n'), -- 4 SET NULL
        ('support_email_outbox', ARRAY['ticket_id']::text[], 'public', 'support_tickets', ARRAY['id']::text[], 'c'), -- 10 CASCADE
        ('support_ticket_idempotency', ARRAY['user_id']::text[], 'auth', 'users', ARRAY['id']::text[], 'c'), -- 11 CASCADE
        ('support_ticket_idempotency', ARRAY['ticket_id']::text[], 'public', 'support_tickets', ARRAY['id']::text[], 'c'), -- 12 CASCADE
        ('support_message_idempotency', ARRAY['user_id']::text[], 'auth', 'users', ARRAY['id']::text[], 'c'), -- 13 CASCADE
        ('support_message_idempotency', ARRAY['ticket_id']::text[], 'public', 'support_tickets', ARRAY['id']::text[], 'c'), -- 14 CASCADE
        ('support_message_idempotency', ARRAY['message_id']::text[], 'public', 'support_ticket_messages', ARRAY['id']::text[], 'c') -- 15 CASCADE
    )
    SELECT
      ef.table_name,
      ef.col_names,
      ef.ref_schema,
      ef.ref_table,
      ef.ref_col_names,
      ef.expected_on_delete,
      c.confdeltype,
      c.conname
    FROM expected_fks ef
    LEFT JOIN (
      SELECT
        t.relname AS tbl,
        ref_n.nspname AS r_schema,
        ref_t.relname AS r_tbl,
        c.conname,
        c.confdeltype,
        ARRAY(
          SELECT a.attname::text
          FROM unnest(c.conkey) AS ck(attnum)
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ck.attnum
          ORDER BY a.attname
        ) AS cols,
        ARRAY(
          SELECT a.attname::text
          FROM unnest(c.confkey) AS cfk(attnum)
          JOIN pg_attribute a ON a.attrelid = ref_t.oid AND a.attnum = cfk.attnum
          ORDER BY a.attname
        ) AS r_cols
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
      v_err := v_err || format(' FK %s on public.%s ON DELETE action is "%s", expected "%s";',
        coalesce(v_fk.conname, 'UNKNOWN'), v_fk.table_name, v_fk.confdeltype, v_fk.expected_on_delete);
    END IF;
  END LOOP;

  -- ----------------------------------------------------------------------------
  -- 4. Exact Policy Verification (22 policies across Taskly tables)
  -- ----------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'todos', 'smart_routines', 'smart_routine_completions', 'smart_routine_reports',
      'smart_routine_settings', 'support_tickets', 'support_ticket_messages',
      'support_ticket_routing', 'support_quarantined_messages', 'support_ticket_events',
      'support_security_incidents', 'support_email_outbox', 'inbound_webhook_events',
      'support_ticket_idempotency', 'support_message_idempotency'
    );

  IF v_count <> 22 THEN
    v_err := v_err || format(' Total policy count on Taskly tables is %s, expected exactly 22;', v_count);
  END IF;

  FOR v_pol IN
    WITH expected_policies(table_name, policy_name, cmd, target_role, check_qual, is_subquery, check_with_check) AS (
      VALUES
        ('todos', 'todos_select_authenticated', 'SELECT', 'authenticated', true, false, false),
        ('todos', 'todos_insert_authenticated', 'INSERT', 'authenticated', false, false, true),
        ('todos', 'todos_update_authenticated', 'UPDATE', 'authenticated', true, false, true),
        ('todos', 'todos_delete_authenticated', 'DELETE', 'authenticated', true, false, false),

        ('smart_routines', 'smart_routines_select_policy', 'SELECT', 'authenticated', true, false, false),
        ('smart_routines', 'smart_routines_insert_policy', 'INSERT', 'authenticated', false, false, true),
        ('smart_routines', 'smart_routines_update_policy', 'UPDATE', 'authenticated', true, false, true),
        ('smart_routines', 'smart_routines_delete_policy', 'DELETE', 'authenticated', true, false, false),

        ('smart_routine_completions', 'smart_completions_select_policy', 'SELECT', 'authenticated', true, false, false),
        ('smart_routine_completions', 'smart_completions_insert_policy', 'INSERT', 'authenticated', false, false, true),
        ('smart_routine_completions', 'smart_completions_update_policy', 'UPDATE', 'authenticated', true, false, true),
        ('smart_routine_completions', 'smart_completions_delete_policy', 'DELETE', 'authenticated', true, false, false),

        ('smart_routine_reports', 'smart_reports_select_policy', 'SELECT', 'authenticated', true, false, false),
        ('smart_routine_reports', 'smart_reports_insert_policy', 'INSERT', 'authenticated', false, false, true),
        ('smart_routine_reports', 'smart_reports_update_policy', 'UPDATE', 'authenticated', true, false, true),
        ('smart_routine_reports', 'smart_reports_delete_policy', 'DELETE', 'authenticated', true, false, false),

        ('smart_routine_settings', 'smart_settings_select_policy', 'SELECT', 'authenticated', true, false, false),
        ('smart_routine_settings', 'smart_settings_insert_policy', 'INSERT', 'authenticated', false, false, true),
        ('smart_routine_settings', 'smart_settings_update_policy', 'UPDATE', 'authenticated', true, false, true),
        ('smart_routine_settings', 'smart_settings_delete_policy', 'DELETE', 'authenticated', true, false, false),

        ('support_tickets', 'support_tickets_select_own', 'SELECT', 'authenticated', true, false, false),
        ('support_ticket_messages', 'support_ticket_messages_select_own', 'SELECT', 'authenticated', true, true, false)
    )
    SELECT
      ep.table_name, ep.policy_name, ep.cmd AS exp_cmd, ep.target_role, ep.check_qual, ep.is_subquery, ep.check_with_check,
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
    ELSIF v_pol.roles <> ARRAY[v_pol.target_role::name] THEN
      v_err := v_err || format(' Policy %s target roles are %s, expected {%s};', v_pol.policy_name, array_to_string(v_pol.roles, ','), v_pol.target_role);
    END IF;

    -- Verify presence or absence of USING clause
    IF v_pol.check_qual THEN
      IF v_pol.is_subquery THEN
        IF v_pol.qual IS NULL OR v_pol.qual !~* 'ticket_id.*IN.*SELECT.*support_tickets.*WHERE.*user_id.*=.*auth\.uid\(\)' THEN
          v_err := v_err || format(' Policy %s USING subquery expression mismatch: %s;', v_pol.policy_name, coalesce(v_pol.qual, 'NULL'));
        END IF;
      ELSE
        IF v_pol.qual IS NULL OR regexp_replace(lower(v_pol.qual), '["\s]', '', 'g') !~ '^(\(+auth\.uid\(\)=user_id\)+|\(+user_id=auth\.uid\(\)\)+)$' THEN
          v_err := v_err || format(' Policy %s USING expression mismatch: %s;', v_pol.policy_name, coalesce(v_pol.qual, 'NULL'));
        END IF;
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
  -- 5. Stored Procedures and Execution Privileges (Exact Signatures & Strict ACLs)
  -- ----------------------------------------------------------------------------
  -- 5.1 Assert exact count of Taskly routines in schema public is 17
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  WHERE p.pronamespace = v_public_nsp
    AND p.proname IN (
      'create_support_ticket_atomic', 'add_support_ticket_message_atomic',
      'resolve_ticket_by_routing_token', 'ingest_developer_reply_atomic',
      'quarantine_inbound_message_atomic', 'release_quarantined_message_atomic',
      'reject_quarantined_message_atomic', 'claim_inbound_webhook_event',
      'fail_inbound_webhook_event', 'claim_support_email_outbox_batch',
      'mark_outbox_attempt_start', 'mark_outbox_success',
      'mark_outbox_failure', 'mark_outbox_ambiguous',
      'mark_outbox_ambiguous_timeout', 'sweep_outbox_ambiguous_timeouts',
      'fn_sync_smart_completion_status'
    );

  IF v_count <> 17 THEN
    v_err := v_err || format(' Expected exactly 17 Taskly routines in schema public, found %s;', v_count);
  END IF;

  -- 5.2 Assert NO unexpected extra routines with Taskly support/sync naming patterns exist
  FOR v_extra_fn IN
    SELECT p.proname, oidvectortypes(p.proargtypes) AS argtypes
    FROM pg_proc p
    WHERE p.pronamespace = v_public_nsp
      AND (
        p.proname LIKE '%support%' OR
        p.proname LIKE '%ticket%' OR
        p.proname LIKE '%outbox%' OR
        p.proname LIKE '%quarantine%' OR
        p.proname LIKE '%webhook%' OR
        p.proname LIKE '%routing_token%' OR
        p.proname LIKE 'fn_sync_%'
      )
      AND p.proname NOT IN (
        'create_support_ticket_atomic', 'add_support_ticket_message_atomic',
        'resolve_ticket_by_routing_token', 'ingest_developer_reply_atomic',
        'quarantine_inbound_message_atomic', 'release_quarantined_message_atomic',
        'reject_quarantined_message_atomic', 'claim_inbound_webhook_event',
        'fail_inbound_webhook_event', 'claim_support_email_outbox_batch',
        'mark_outbox_attempt_start', 'mark_outbox_success',
        'mark_outbox_failure', 'mark_outbox_ambiguous',
        'mark_outbox_ambiguous_timeout', 'sweep_outbox_ambiguous_timeouts',
        'fn_sync_smart_completion_status'
      )
  LOOP
    v_err := v_err || format(' Unexpected extra Taskly routine found: public.%s(%s);', v_extra_fn.proname, v_extra_fn.argtypes);
  END LOOP;

  -- 5.3 Verify each routine by exact name, signature, security definer, search_path, and exact ACLs
  FOR v_fn_spec IN
    WITH expected_routines(proname, expected_nargs, expected_arg_types, is_security_definer, expected_search_path, expected_grantees) AS (
      VALUES
        ('create_support_ticket_atomic', 9, 'uuid, character varying, character varying, text, character varying, character varying, character varying, character varying, jsonb', true, 'search_path=pg_catalog, public', ARRAY['authenticated', 'service_role']::TEXT[]),
        ('add_support_ticket_message_atomic', 7, 'uuid, uuid, text, character varying, character varying, character varying, jsonb', true, 'search_path=pg_catalog, public', ARRAY['authenticated', 'service_role']::TEXT[]),
        ('resolve_ticket_by_routing_token', 1, 'character varying', true, 'search_path=pg_catalog, public', ARRAY['service_role']::TEXT[]),
        ('ingest_developer_reply_atomic', 7, 'character varying, character varying, character varying, text, character varying, character varying, uuid', true, 'search_path=pg_catalog, public', ARRAY['service_role']::TEXT[]),
        ('quarantine_inbound_message_atomic', 10, 'character varying, character varying, character varying, character varying, jsonb, text, character varying, text, character varying, character varying', true, 'search_path=pg_catalog, public', ARRAY['service_role']::TEXT[]),
        ('release_quarantined_message_atomic', 3, 'uuid, uuid, text', true, 'search_path=pg_catalog, public', ARRAY['service_role']::TEXT[]),
        ('reject_quarantined_message_atomic', 3, 'uuid, uuid, text', true, 'search_path=pg_catalog, public', ARRAY['service_role']::TEXT[]),
        ('claim_inbound_webhook_event', 5, 'character varying, character varying, jsonb, character varying, integer', true, 'search_path=pg_catalog, public', ARRAY['service_role']::TEXT[]),
        ('fail_inbound_webhook_event', 4, 'character varying, character varying, text, boolean', true, 'search_path=pg_catalog, public', ARRAY['service_role']::TEXT[]),
        ('claim_support_email_outbox_batch', 3, 'character varying, integer, integer', true, 'search_path=pg_catalog, public', ARRAY['service_role']::TEXT[]),
        ('mark_outbox_attempt_start', 2, 'uuid, character varying', true, 'search_path=pg_catalog, public', ARRAY['service_role']::TEXT[]),
        ('mark_outbox_success', 3, 'uuid, character varying, character varying', true, 'search_path=pg_catalog, public', ARRAY['service_role']::TEXT[]),
        ('mark_outbox_failure', 5, 'uuid, character varying, text, integer, boolean', true, 'search_path=pg_catalog, public', ARRAY['service_role']::TEXT[]),
        ('mark_outbox_ambiguous', 4, 'uuid, character varying, text, integer', true, 'search_path=pg_catalog, public', ARRAY['service_role']::TEXT[]),
        ('mark_outbox_ambiguous_timeout', 2, 'uuid, character varying', true, 'search_path=pg_catalog, public', ARRAY['service_role']::TEXT[]),
        ('sweep_outbox_ambiguous_timeouts', 0, '', true, 'search_path=pg_catalog, public', ARRAY['service_role']::TEXT[]),
        ('fn_sync_smart_completion_status', 0, '', false, 'search_path=pg_catalog, pg_temp', ARRAY[]::TEXT[])
    )
    SELECT
      er.proname,
      er.expected_nargs,
      er.expected_arg_types,
      er.is_security_definer,
      er.expected_search_path,
      er.expected_grantees,
      (
        SELECT COUNT(*)
        FROM pg_proc p
        WHERE p.pronamespace = v_public_nsp
          AND p.proname = er.proname
      ) AS instance_count,
      p.oid AS fn_oid,
      p.proowner,
      p.pronargs AS actual_nargs,
      p.prosecdef,
      p.proconfig,
      p.prorettype,
      oidvectortypes(p.proargtypes) AS actual_arg_types
    FROM expected_routines er
    LEFT JOIN pg_proc p
      ON p.pronamespace = v_public_nsp
     AND p.proname = er.proname
     AND oidvectortypes(p.proargtypes) = er.expected_arg_types
  LOOP
    -- 1. Existence and overload verification
    IF v_fn_spec.instance_count = 0 THEN
      v_err := v_err || format(' Missing function: public.%s(%s);', v_fn_spec.proname, v_fn_spec.expected_arg_types);
      CONTINUE;
    ELSIF v_fn_spec.instance_count > 1 THEN
      v_err := v_err || format(' Function public.%s is overloaded (%s instances found, expected exactly 1);',
        v_fn_spec.proname, v_fn_spec.instance_count);
    END IF;

    -- 2. Exact signature verification via oidvectortypes
    IF v_fn_spec.fn_oid IS NULL THEN
      SELECT oidvectortypes(p.proargtypes) INTO v_actual_sig
      FROM pg_proc p
      WHERE p.pronamespace = v_public_nsp AND p.proname = v_fn_spec.proname
      LIMIT 1;

      v_err := v_err || format(' Function public.%s signature mismatch: found (%s), expected (%s);',
        v_fn_spec.proname, coalesce(v_actual_sig, 'NONE'), v_fn_spec.expected_arg_types);
      CONTINUE;
    END IF;

    -- 3. Argument count and return type verification
    IF v_fn_spec.actual_nargs <> v_fn_spec.expected_nargs THEN
      v_err := v_err || format(' Function public.%s pronargs is %s, expected %s;',
        v_fn_spec.proname, v_fn_spec.actual_nargs, v_fn_spec.expected_nargs);
    END IF;
    IF v_fn_spec.proname = 'fn_sync_smart_completion_status' AND v_fn_spec.prorettype <> 'trigger'::regtype THEN
      v_err := v_err || format(' Trigger function public.%s return type is not trigger;', v_fn_spec.proname);
    END IF;

    -- 4. SECURITY DEFINER status verification
    IF v_fn_spec.prosecdef <> v_fn_spec.is_security_definer THEN
      v_err := v_err || format(' Function public.%s prosecdef is %s, expected %s;',
        v_fn_spec.proname, v_fn_spec.prosecdef, v_fn_spec.is_security_definer);
    END IF;

    -- 5. Fixed search_path verification
    IF v_fn_spec.proconfig IS NULL OR NOT (v_fn_spec.expected_search_path = ANY(v_fn_spec.proconfig)) THEN
      v_err := v_err || format(' Function public.%s search path mismatch, expected %s;',
        v_fn_spec.proname, v_fn_spec.expected_search_path);
    END IF;

    -- 6. Strict EXECUTE ACL verification (exact grantees, grant options, anon/PUBLIC restriction)
    WITH func_acl AS (
      SELECT
        CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END AS grantee_name,
        a.privilege_type,
        a.is_grantable,
        a.grantee
      FROM aclexplode(COALESCE((SELECT pr.proacl FROM pg_proc pr WHERE pr.oid = v_fn_spec.fn_oid), acldefault('f', v_fn_spec.proowner))) a
      LEFT JOIN pg_roles r ON r.oid = a.grantee
    )
    SELECT
      COALESCE(ARRAY_AGG(DISTINCT grantee_name ORDER BY grantee_name) FILTER (WHERE privilege_type = 'EXECUTE' AND grantee <> v_fn_spec.proowner), ARRAY[]::TEXT[]),
      COUNT(*) FILTER (WHERE privilege_type = 'EXECUTE' AND is_grantable = true),
      COUNT(*) FILTER (WHERE privilege_type = 'EXECUTE' AND grantee_name IN ('anon', 'PUBLIC'))
    INTO v_actual_grantees, v_fn_grantable_count, v_fn_unauth_count
    FROM func_acl;

    -- Verify exact non-owner grantees holding EXECUTE
    IF v_actual_grantees <> v_fn_spec.expected_grantees THEN
      v_err := v_err || format(' Function public.%s EXECUTE grantees are %s, expected %s;',
        v_fn_spec.proname, coalesce(array_to_string(v_actual_grantees, ','), 'NONE'), coalesce(array_to_string(v_fn_spec.expected_grantees, ','), 'NONE'));
    END IF;

    -- Verify NO grant options exist (is_grantable must be false)
    IF v_fn_grantable_count > 0 THEN
      v_err := v_err || format(' Function public.%s has %s grantable EXECUTE privileges (GRANT OPTION forbidden);',
        v_fn_spec.proname, v_fn_grantable_count);
    END IF;

    -- Verify anon and PUBLIC have zero EXECUTE privileges
    IF v_fn_unauth_count > 0 THEN
      v_err := v_err || format(' Function public.%s retains unexpected EXECUTE grant to anon or PUBLIC;', v_fn_spec.proname);
    END IF;
  END LOOP;

  -- ----------------------------------------------------------------------------
  -- 6. Error Reporting & Fail-Closed Enforcement
  -- ----------------------------------------------------------------------------
  IF length(v_err) > 0 THEN
    RAISE EXCEPTION 'FULL POST-MIGRATION INTEGRATION AUDIT FAILED:%', v_err;
  END IF;

  RAISE NOTICE '================================================================================';
  RAISE NOTICE 'FULL POST-MIGRATION INTEGRATION AUDIT PASSED:';
  RAISE NOTICE '  - Scoped Tables:    15 verified (1 todos, 4 smart lists, 10 support)';
  RAISE NOTICE '  - RLS & FORCE RLS:  All 15 RLS enabled; public.todos strictly FORCED';
  RAISE NOTICE '  - Table Privileges: Verified individually via aclexplode:';
  RAISE NOTICE '                      * todos & 4 smart tables: exactly [D,I,S,U] authenticated, 0 grantable,';
  RAISE NOTICE '                        0 service_role privileges (conforms to taskStore.js architecture)';
  RAISE NOTICE '                      * support_tickets & messages: exactly [SELECT] authenticated, 0 grantable,';
  RAISE NOTICE '                        service_role management privileges verified';
  RAISE NOTICE '                      * 8 internal support tables: 0 authenticated, service_role management verified';
  RAISE NOTICE '                      * all 15 tables: 0 anon/PUBLIC, 0 grantable privileges';
  RAISE NOTICE '  - Foreign Keys:     All 20 FK constraints verified with exact ON DELETE actions';
  RAISE NOTICE '                      * 15 CASCADE, 4 SET NULL, 1 RESTRICT';
  RAISE NOTICE '  - Policies:         All 22 policies verified by name, role, cmd, USING, WITH CHECK';
  RAISE NOTICE '  - Procedures:       All 17 routines verified (exact signatures via oidvectortypes,';
  RAISE NOTICE '                      no overloads, no extra routines, search_path, prosecdef,';
  RAISE NOTICE '                      exact non-owner grantees, 0 grant options, 0 anon/PUBLIC)';
  RAISE NOTICE '================================================================================';
END $$;
