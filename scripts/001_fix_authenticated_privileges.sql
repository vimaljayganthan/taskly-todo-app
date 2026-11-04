-- ==============================================================================
-- Taskly - Corrective Script: Tighten Authenticated Privileges on public.todos
-- File: scripts/001_fix_authenticated_privileges.sql
-- ==============================================================================
-- Context:
--   The production migration (001_multi_user_isolation.sql) executed successfully.
--   However, post-migration validation detected that the 'authenticated' role
--   retained default Supabase table privileges (REFERENCES, TRIGGER, TRUNCATE)
--   in addition to the intended CRUD privileges (SELECT, INSERT, UPDATE, DELETE).
--
-- Safety Guarantees:
--   1. Runs inside a single atomic transaction (BEGIN ... COMMIT).
--   2. Revokes ONLY REFERENCES, TRIGGER, and TRUNCATE from 'authenticated'.
--   3. Preserves SELECT, INSERT, UPDATE, and DELETE.
--   4. Does NOT alter table schema, user_id, columns, data, constraints, or RLS policies.
--   5. Performs strict automated verification asserting exactly the 4 CRUD privileges.
--
-- Instructions:
--   1. Open Supabase Dashboard -> SQL Editor -> "+ New query".
--   2. Paste this entire script and click "Run".
--   3. Re-run scripts/001_post_migration_check.sql; all assertions will now pass.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- Step 1: Revoke Excess Table Privileges from 'authenticated'
-- ------------------------------------------------------------------------------
REVOKE REFERENCES, TRIGGER, TRUNCATE
  ON TABLE public.todos
  FROM authenticated;

-- ------------------------------------------------------------------------------
-- Step 2: Ensure Required CRUD Privileges Remain Granted
-- ------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.todos
  TO authenticated;

-- ------------------------------------------------------------------------------
-- Step 3: Automated Assertion (Fails Closed If Any Unexpected Privilege Remains)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_auth_privileges TEXT[];
  v_grantable_count INTEGER;
BEGIN
  -- Assert exact array of privileges granted to 'authenticated'
  SELECT ARRAY_AGG(DISTINCT privilege_type ORDER BY privilege_type)
  INTO v_auth_privileges
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'todos'
    AND grantee = 'authenticated';

  IF v_auth_privileges IS NULL OR v_auth_privileges <> ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::TEXT[] THEN
    RAISE EXCEPTION
      'PRIVILEGE CORRECTION FAILED: authenticated role privileges on public.todos are % (expected exactly [DELETE, INSERT, SELECT, UPDATE])',
      v_auth_privileges;
  END IF;

  -- Assert zero grantable permissions (with GRANT OPTION)
  SELECT COUNT(*) INTO v_grantable_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'todos'
    AND grantee = 'authenticated'
    AND is_grantable = 'YES';

  IF v_grantable_count > 0 THEN
    RAISE EXCEPTION 'PRIVILEGE CORRECTION FAILED: authenticated role has % grantable privilege(s); expected 0', v_grantable_count;
  END IF;

  RAISE NOTICE '=======================================================';
  RAISE NOTICE 'SUCCESS: authenticated role privileges locked down!';
  RAISE NOTICE 'Table:      public.todos';
  RAISE NOTICE 'Revoked:    REFERENCES, TRIGGER, TRUNCATE';
  RAISE NOTICE 'Preserved:  DELETE, INSERT, SELECT, UPDATE';
  RAISE NOTICE 'Privileges: exactly [DELETE, INSERT, SELECT, UPDATE]';
  RAISE NOTICE '=======================================================';
END $$;

COMMIT;

-- ------------------------------------------------------------------------------
-- Step 4: Verification Query (Displays active privileges in Results tab)
-- ------------------------------------------------------------------------------
SELECT
  grantee,
  privilege_type,
  is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'todos'
  AND grantee = 'authenticated'
ORDER BY privilege_type;
