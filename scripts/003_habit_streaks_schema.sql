-- ==============================================================================
-- Taskly - Production Database Migration: Habit Streaks & 4-State Routines
-- File: scripts/003_habit_streaks_schema.sql
-- ==============================================================================
-- Target: Supabase PostgreSQL (PostgreSQL 14+)
-- Feature: Taskly v2.0.0 Build 11 - Habit Streaks & Routine Consistency Engine
--
-- Notice:
--   DO NOT EXECUTE WITHOUT EXPLICIT SEPARATE USER AUTHORIZATION.
--   This script is safe, idempotent, and transaction-wrapped.
--
-- Prerequisites:
--   Requires scripts/002_smart_lists_schema.sql to be applied first.
--   Step 0 performs exhaustive preflight validation of:
--     1. All 4 prerequisite tables exist with RLS enabled.
--     2. Exact primary keys ('id' on routines, completions, reports; 'user_id' on settings).
--     3. Exact foreign keys (referencing auth.users(id) and smart_routines(id)).
--     4. Exact unique constraints on completions and reports.
--     5. Exact prerequisite columns, data types, and nullability.
--     6. All 16 Row Level Security policies using a typed VALUES specification table,
--        verifying exact role {authenticated}, PERMISSIVE mode, and semantic
--        ownership expressions without brittle string matching.
--     7. Target column validation to prevent silent type collisions.
--     8. Function & trigger collision safety preventing overwriting or overloading.
--
-- Architectural Improvements:
--   1. Authoritative 4-State Routine Model:
--      'completed', 'pending', 'postponed', 'cancelled'
--   2. Postponed target date tracking using PostgreSQL DATE.
--   3. Cancellation reason auditing (max 100 characters).
--   4. Daily habit streak qualification flag and separate routine counters.
--   5. Streak target percentage in user routine settings.
--   6. Strict backward compatibility and idempotent data backfilling.
--   7. Bi-directional trigger ensuring legacy clients (completed BOOLEAN)
--      and v2.0 clients (status VARCHAR) stay in sync without drift.
--
-- Security:
--   Preserves strict Row Level Security (RLS) enforcing auth.uid() = user_id.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- Step 0: Exhaustive Pre-Migration Prerequisites & Integrity Verification
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_missing TEXT := '';
  v_policy_errors TEXT := '';
  r RECORD;
  v_funcdef TEXT;
BEGIN
  -- 0.1 Verify all four Migration 002 tables exist
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'smart_routines') THEN
    v_missing := v_missing || ' table: public.smart_routines;';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'smart_routine_completions') THEN
    v_missing := v_missing || ' table: public.smart_routine_completions;';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'smart_routine_reports') THEN
    v_missing := v_missing || ' table: public.smart_routine_reports;';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'smart_routine_settings') THEN
    v_missing := v_missing || ' table: public.smart_routine_settings;';
  END IF;

  IF length(v_missing) > 0 THEN
    RAISE EXCEPTION 'Pre-migration check failed! Core Migration 002 tables are missing:% Please execute scripts/002_smart_lists_schema.sql first.', v_missing;
  END IF;

  -- 0.2 Verify Primary Keys specifically cover column 'id'
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public' AND t.relname = 'smart_routines' AND c.contype = 'p'
      AND ARRAY(SELECT a.attname FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k) = ARRAY['id']::name[]
  ) THEN v_missing := v_missing || ' PK on smart_routines(id);'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public' AND t.relname = 'smart_routine_completions' AND c.contype = 'p'
      AND ARRAY(SELECT a.attname FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k) = ARRAY['id']::name[]
  ) THEN v_missing := v_missing || ' PK on smart_routine_completions(id);'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public' AND t.relname = 'smart_routine_reports' AND c.contype = 'p'
      AND ARRAY(SELECT a.attname FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k) = ARRAY['id']::name[]
  ) THEN v_missing := v_missing || ' PK on smart_routine_reports(id);'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public' AND t.relname = 'smart_routine_settings' AND c.contype = 'p'
      AND ARRAY(SELECT a.attname FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k) = ARRAY['user_id']::name[]
  ) THEN v_missing := v_missing || ' PK on smart_routine_settings(user_id);'; END IF;

  -- 0.3 Verify Foreign Keys and specific referenced columns
  -- smart_routines.user_id -> auth.users(id)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_class ref_t ON c.confrelid = ref_t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    JOIN pg_namespace ref_n ON ref_t.relnamespace = ref_n.oid
    WHERE n.nspname = 'public' AND t.relname = 'smart_routines' AND c.contype = 'f'
      AND ref_n.nspname = 'auth' AND ref_t.relname = 'users'
      AND ARRAY(SELECT a.attname FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k) = ARRAY['user_id']::name[]
      AND ARRAY(SELECT a.attname FROM unnest(c.confkey) k JOIN pg_attribute a ON a.attrelid = ref_t.oid AND a.attnum = k) = ARRAY['id']::name[]
  ) THEN v_missing := v_missing || ' FK smart_routines.user_id -> auth.users(id);'; END IF;

  -- smart_routine_completions.user_id -> auth.users(id)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_class ref_t ON c.confrelid = ref_t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    JOIN pg_namespace ref_n ON ref_t.relnamespace = ref_n.oid
    WHERE n.nspname = 'public' AND t.relname = 'smart_routine_completions' AND c.contype = 'f'
      AND ref_n.nspname = 'auth' AND ref_t.relname = 'users'
      AND ARRAY(SELECT a.attname FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k) = ARRAY['user_id']::name[]
      AND ARRAY(SELECT a.attname FROM unnest(c.confkey) k JOIN pg_attribute a ON a.attrelid = ref_t.oid AND a.attnum = k) = ARRAY['id']::name[]
  ) THEN v_missing := v_missing || ' FK smart_routine_completions.user_id -> auth.users(id);'; END IF;

  -- smart_routine_completions.routine_id -> public.smart_routines(id)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_class ref_t ON c.confrelid = ref_t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    JOIN pg_namespace ref_n ON ref_t.relnamespace = ref_n.oid
    WHERE n.nspname = 'public' AND t.relname = 'smart_routine_completions' AND c.contype = 'f'
      AND ref_n.nspname = 'public' AND ref_t.relname = 'smart_routines'
      AND ARRAY(SELECT a.attname FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k) = ARRAY['routine_id']::name[]
      AND ARRAY(SELECT a.attname FROM unnest(c.confkey) k JOIN pg_attribute a ON a.attrelid = ref_t.oid AND a.attnum = k) = ARRAY['id']::name[]
  ) THEN v_missing := v_missing || ' FK smart_routine_completions.routine_id -> smart_routines(id);'; END IF;

  -- 0.4 Verify Unique Constraints cover exact column tuples
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public' AND t.relname = 'smart_routine_completions' AND c.contype = 'u'
      AND ARRAY(
        SELECT a.attname FROM unnest(c.conkey) k
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k
        ORDER BY a.attname
      ) = ARRAY['date', 'routine_id', 'user_id']::name[]
  ) THEN v_missing := v_missing || ' UNIQUE smart_routine_completions(user_id, routine_id, date);'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public' AND t.relname = 'smart_routine_reports' AND c.contype = 'u'
      AND ARRAY(
        SELECT a.attname FROM unnest(c.conkey) k
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k
        ORDER BY a.attname
      ) = ARRAY['date', 'user_id']::name[]
  ) THEN v_missing := v_missing || ' UNIQUE smart_routine_reports(user_id, date);'; END IF;


  -- 0.5 Verify Prerequisite Columns, Types, and Nullability
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'smart_routine_completions'
      AND column_name = 'date' AND data_type = 'character varying' AND is_nullable = 'NO'
  ) THEN v_missing := v_missing || ' smart_routine_completions.date (VARCHAR NOT NULL);'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'smart_routine_completions'
      AND column_name = 'completed' AND data_type = 'boolean' AND is_nullable = 'NO'
  ) THEN v_missing := v_missing || ' smart_routine_completions.completed (BOOLEAN NOT NULL);'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'smart_routine_reports'
      AND column_name = 'total_routines' AND data_type = 'integer' AND is_nullable = 'NO'
  ) THEN v_missing := v_missing || ' smart_routine_reports.total_routines (INTEGER NOT NULL);'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'smart_routine_reports'
      AND column_name = 'completion_rate' AND data_type = 'integer' AND is_nullable = 'NO'
  ) THEN v_missing := v_missing || ' smart_routine_reports.completion_rate (INTEGER NOT NULL);'; END IF;

  IF length(v_missing) > 0 THEN
    RAISE EXCEPTION 'Pre-migration check failed! Schema prerequisites missing:%', v_missing;
  END IF;

  -- 0.6 Verify all 16 Row Level Security Policies using typed VALUES and semantic expression normalization
  WITH expected_policies(table_name, policy_name, command_type, is_permissive, target_role, check_qual, check_with_check) AS (
    VALUES
      ('smart_routines', 'smart_routines_select_policy', 'SELECT', 'PERMISSIVE', 'authenticated', true, false),
      ('smart_routines', 'smart_routines_insert_policy', 'INSERT', 'PERMISSIVE', 'authenticated', false, true),
      ('smart_routines', 'smart_routines_update_policy', 'UPDATE', 'PERMISSIVE', 'authenticated', true, true),
      ('smart_routines', 'smart_routines_delete_policy', 'DELETE', 'PERMISSIVE', 'authenticated', true, false),

      ('smart_routine_completions', 'smart_completions_select_policy', 'SELECT', 'PERMISSIVE', 'authenticated', true, false),
      ('smart_routine_completions', 'smart_completions_insert_policy', 'INSERT', 'PERMISSIVE', 'authenticated', false, true),
      ('smart_routine_completions', 'smart_completions_update_policy', 'UPDATE', 'PERMISSIVE', 'authenticated', true, true),
      ('smart_routine_completions', 'smart_completions_delete_policy', 'DELETE', 'PERMISSIVE', 'authenticated', true, false),

      ('smart_routine_reports', 'smart_reports_select_policy', 'SELECT', 'PERMISSIVE', 'authenticated', true, false),
      ('smart_routine_reports', 'smart_reports_insert_policy', 'INSERT', 'PERMISSIVE', 'authenticated', false, true),
      ('smart_routine_reports', 'smart_reports_update_policy', 'UPDATE', 'PERMISSIVE', 'authenticated', true, true),
      ('smart_routine_reports', 'smart_reports_delete_policy', 'DELETE', 'PERMISSIVE', 'authenticated', true, false),

      ('smart_routine_settings', 'smart_settings_select_policy', 'SELECT', 'PERMISSIVE', 'authenticated', true, false),
      ('smart_routine_settings', 'smart_settings_insert_policy', 'INSERT', 'PERMISSIVE', 'authenticated', false, true),
      ('smart_routine_settings', 'smart_settings_update_policy', 'UPDATE', 'PERMISSIVE', 'authenticated', true, true),
      ('smart_routine_settings', 'smart_settings_delete_policy', 'DELETE', 'PERMISSIVE', 'authenticated', true, false)
  ),
  policy_audit AS (
    SELECT 
      ep.table_name,
      ep.policy_name,
      CASE
        WHEN p.policyname IS NULL THEN 'MISSING'
        WHEN p.cmd != ep.command_type THEN 'CMD_MISMATCH'
        WHEN p.permissive != ep.is_permissive THEN 'PERMISSIVE_MISMATCH'
        WHEN p.roles != ARRAY[ep.target_role::name] THEN 'ROLE_MISMATCH'
        WHEN ep.check_qual AND (
          p.qual IS NULL OR NOT (
            regexp_replace(lower(p.qual), '["\s]', '', 'g') IN (
              'auth.uid()=user_id', '(auth.uid()=user_id)', '((auth.uid()=user_id))', '(((auth.uid()=user_id)))',
              'user_id=auth.uid()', '(user_id=auth.uid())', '((user_id=auth.uid()))', '(((user_id=auth.uid())))'
            )
            OR regexp_replace(lower(p.qual), '["\s]', '', 'g') ~ '^(\(+auth\.uid\(\)=user_id\)+|\(+user_id=auth\.uid\(\)\)+)$'
          )
        ) THEN 'QUAL_UNSAFE'
        WHEN ep.check_with_check AND (
          p.with_check IS NULL OR NOT (
            regexp_replace(lower(p.with_check), '["\s]', '', 'g') IN (
              'auth.uid()=user_id', '(auth.uid()=user_id)', '((auth.uid()=user_id))', '(((auth.uid()=user_id)))',
              'user_id=auth.uid()', '(user_id=auth.uid())', '((user_id=auth.uid()))', '(((user_id=auth.uid())))'
            )
            OR regexp_replace(lower(p.with_check), '["\s]', '', 'g') ~ '^(\(+auth\.uid\(\)=user_id\)+|\(+user_id=auth\.uid\(\)\)+)$'
          )
        ) THEN 'WITH_CHECK_UNSAFE'
        ELSE 'OK'
      END AS status
    FROM expected_policies ep
    LEFT JOIN pg_policies p 
      ON p.schemaname = 'public' 
     AND p.tablename = ep.table_name 
     AND p.policyname = ep.policy_name
  )
  SELECT string_agg(table_name || '.' || policy_name || ': ' || status, '; ')
  INTO v_policy_errors
  FROM policy_audit
  WHERE status != 'OK';

  IF v_policy_errors IS NOT NULL THEN
    RAISE EXCEPTION 'Pre-migration check failed! RLS policy audit failed: %', v_policy_errors;
  END IF;

  -- 0.7 Validate existing definitions of target columns if already present (prevent silent type collisions)
  -- smart_routine_completions
  FOR r IN
    SELECT column_name, data_type, udt_name, character_maximum_length, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'smart_routine_completions'
      AND column_name IN ('status', 'postponed_to', 'cancellation_reason', 'updated_at')
  LOOP
    IF r.column_name = 'status' AND (r.data_type != 'character varying' OR r.character_maximum_length < 20 OR r.is_nullable != 'NO' OR r.column_default NOT LIKE '%pending%') THEN
      RAISE EXCEPTION 'Pre-migration check failed: Column smart_routine_completions.status exists with incompatible definition (type=%, max=%, nullable=%, default=%)',
        r.data_type, r.character_maximum_length, r.is_nullable, r.column_default;
    END IF;
    IF r.column_name = 'postponed_to' AND (r.data_type != 'date' OR r.is_nullable != 'YES') THEN
      RAISE EXCEPTION 'Pre-migration check failed: Column smart_routine_completions.postponed_to exists with incompatible definition (expected DATE nullable, got %)',
        r.data_type;
    END IF;
    IF r.column_name = 'cancellation_reason' AND (r.data_type != 'character varying' OR r.character_maximum_length < 100 OR r.is_nullable != 'YES') THEN
      RAISE EXCEPTION 'Pre-migration check failed: Column smart_routine_completions.cancellation_reason exists with incompatible definition (expected max length 100, got %)',
        r.character_maximum_length;
    END IF;
    IF r.column_name = 'updated_at' AND (r.udt_name != 'timestamptz' OR r.is_nullable != 'YES') THEN
      RAISE EXCEPTION 'Pre-migration check failed: Column smart_routine_completions.updated_at exists with incompatible definition (expected TIMESTAMPTZ, got %)',
        r.udt_name;
    END IF;
  END LOOP;

  -- smart_routine_reports target columns validation
  FOR r IN
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'smart_routine_reports'
      AND column_name IN ('eligible_count', 'postponed_count', 'cancelled_count', 'postponed_routines', 'cancelled_routines', 'is_streak_qualified')
  LOOP
    IF r.column_name IN ('eligible_count', 'postponed_count', 'cancelled_count') AND (r.data_type != 'integer' OR r.is_nullable != 'NO' OR r.column_default NOT LIKE '%0%') THEN
      RAISE EXCEPTION 'Pre-migration check failed: Column smart_routine_reports.% exists with incompatible definition (expected INTEGER NOT NULL DEFAULT 0)',
        r.column_name;
    END IF;
    IF r.column_name IN ('postponed_routines', 'cancelled_routines') AND (r.data_type != 'jsonb' OR r.is_nullable != 'NO' OR r.column_default NOT LIKE '%[]%') THEN
      RAISE EXCEPTION 'Pre-migration check failed: Column smart_routine_reports.% exists with incompatible definition (expected JSONB NOT NULL DEFAULT ''[]'')',
        r.column_name;
    END IF;
    IF r.column_name = 'is_streak_qualified' AND (r.data_type != 'boolean' OR r.is_nullable != 'NO' OR r.column_default NOT LIKE '%false%') THEN
      RAISE EXCEPTION 'Pre-migration check failed: Column smart_routine_reports.is_streak_qualified exists with incompatible definition (expected BOOLEAN NOT NULL DEFAULT false, got %)',
        r.data_type;
    END IF;
  END LOOP;

  -- smart_routine_settings target columns validation
  FOR r IN
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'smart_routine_settings'
      AND column_name = 'streak_threshold'
  LOOP
    IF r.column_name = 'streak_threshold' AND (r.data_type != 'integer' OR r.is_nullable != 'NO' OR r.column_default NOT LIKE '%80%') THEN
      RAISE EXCEPTION 'Pre-migration check failed: Column smart_routine_settings.streak_threshold exists with incompatible definition (expected INTEGER NOT NULL DEFAULT 80, got %)',
        r.data_type;
    END IF;
  END LOOP;

  -- 0.8 Function & Trigger Collision Protection
  -- Check for overloaded functions
  IF (
    SELECT count(*) 
    FROM pg_proc p 
    JOIN pg_namespace n ON p.pronamespace = n.oid 
    WHERE n.nspname = 'public' AND p.proname = 'fn_sync_smart_completion_status'
  ) > 1 THEN
    RAISE EXCEPTION 'Collision detected: Multiple overloaded functions named public.fn_sync_smart_completion_status exist.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'fn_sync_smart_completion_status'
  ) THEN
    -- Check argument count: must be 0
    IF (SELECT p.pronargs FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'fn_sync_smart_completion_status') != 0 THEN
      RAISE EXCEPTION 'Collision detected: public.fn_sync_smart_completion_status already exists with arguments.';
    END IF;

    -- Check return type: must be trigger
    IF (SELECT p.prorettype FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'fn_sync_smart_completion_status') != 'trigger'::regtype THEN
      RAISE EXCEPTION 'Collision detected: public.fn_sync_smart_completion_status already exists with a non-trigger return type.';
    END IF;

    -- Inspect function definition to verify it matches the complete intended implementation
    SELECT regexp_replace(lower(regexp_replace(p.prosrc, '--[^\n]*', '', 'g')), '\s+', '', 'g')
    INTO v_funcdef
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'fn_sync_smart_completion_status';

    IF v_funcdef IS DISTINCT FROM 'beginiftg_op=''insert''thenifnew.status=''completed''thennew.completed:=true;elsifnew.statusin(''postponed'',''cancelled'')thennew.completed:=false;elsifnew.completed=trueand(new.statusisnullornew.status=''pending'')thennew.status:=''completed'';elsenew.completed:=false;endif;elsiftg_op=''update''thenifnew.statusisdistinctfromold.statusthennew.completed:=(new.status=''completed'');elsifnew.completedisdistinctfromold.completedthenifnew.completed=truethennew.status:=''completed'';elsifnew.status=''completed''thennew.status:=''pending'';endif;elseifnew.status=''completed''andnew.completed=falsethennew.completed:=true;elsifnew.statusin(''pending'',''postponed'',''cancelled'')andnew.completed=truethennew.completed:=false;endif;endif;endif;iftg_op=''update''thennew.updated_at:=now();endif;returnnew;end;' THEN
      RAISE EXCEPTION 'Collision detected: public.fn_sync_smart_completion_status already exists with a different or modified definition. Aborting migration for manual inspection.';
    END IF;
  END IF;

  -- Trigger collision check
  FOR r IN
    SELECT 
      cl.relname AS table_name,
      tr.tgenabled,
      pg_get_triggerdef(tr.oid, true) AS def,
      p.proname AS func_name
    FROM pg_trigger tr
    JOIN pg_class cl ON tr.tgrelid = cl.oid
    JOIN pg_namespace n ON cl.relnamespace = n.oid
    JOIN pg_proc p ON tr.tgfoid = p.oid
    WHERE n.nspname = 'public' AND tr.tgname = 'trg_sync_smart_completion_status'
  LOOP
    IF r.table_name != 'smart_routine_completions' THEN
      RAISE EXCEPTION 'Collision detected: Trigger trg_sync_smart_completion_status is attached to unexpected table % (expected smart_routine_completions).', r.table_name;
    END IF;
    IF r.tgenabled != 'O' THEN
      RAISE EXCEPTION 'Trigger error: Existing trigger trg_sync_smart_completion_status is disabled (tgenabled=%).', r.tgenabled;
    END IF;
    IF r.func_name != 'fn_sync_smart_completion_status' THEN
      RAISE EXCEPTION 'Trigger error: Existing trigger trg_sync_smart_completion_status executes unexpected function %.', r.func_name;
    END IF;
    IF r.def !~* 'BEFORE INSERT OR UPDATE' OR r.def !~* 'FOR EACH ROW' THEN
      RAISE EXCEPTION 'Trigger error: Existing trigger trg_sync_smart_completion_status has incompatible timing/scope: %', r.def;
    END IF;
  END LOOP;
END $$;


-- ------------------------------------------------------------------------------
-- Step 1: Extend smart_routine_completions Table
-- ------------------------------------------------------------------------------

-- 1.1 Add authoritative status column (default: 'pending')
ALTER TABLE public.smart_routine_completions
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending';

-- 1.2 Add PostgreSQL DATE for postponed scheduling
ALTER TABLE public.smart_routine_completions
  ADD COLUMN IF NOT EXISTS postponed_to DATE DEFAULT NULL;

-- 1.3 Add cancellation reason
ALTER TABLE public.smart_routine_completions
  ADD COLUMN IF NOT EXISTS cancellation_reason VARCHAR(100) DEFAULT NULL;

-- 1.4 Add updated_at timestamp
ALTER TABLE public.smart_routine_completions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NULL;

-- 1.5 Add table-scoped CHECK constraint for authoritative status values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'smart_routine_completions'
      AND c.conname = 'chk_smart_completions_status'
  ) THEN
    ALTER TABLE public.smart_routine_completions
      ADD CONSTRAINT chk_smart_completions_status 
      CHECK (status IN ('completed', 'pending', 'postponed', 'cancelled'));
  END IF;
END $$;

-- 1.6 Performance index for user date and status lookups
CREATE INDEX IF NOT EXISTS idx_smart_completions_user_date_status
  ON public.smart_routine_completions (user_id, date, status);

-- 1.7 Backwards Compatibility Backfill:
-- Synchronize existing boolean completed records into authoritative status
UPDATE public.smart_routine_completions
SET status = 'completed'
WHERE completed = true AND status != 'completed';

UPDATE public.smart_routine_completions
SET status = 'pending'
WHERE (status IS NULL OR status NOT IN ('completed', 'pending', 'postponed', 'cancelled')) AND completed = false;

-- 1.8 Bi-directional compatibility trigger:
-- Keeps legacy clients (sending completed: true/false) and modern clients (sending status)
-- in complete synchronization automatically.
CREATE OR REPLACE FUNCTION public.fn_sync_smart_completion_status()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- If status was explicitly set to completed, ensure completed boolean is true
    IF NEW.status = 'completed' THEN
      NEW.completed := true;
    -- If status was set to a non-completed state, completed must be false
    ELSIF NEW.status IN ('postponed', 'cancelled') THEN
      NEW.completed := false;
    -- If status is 'pending' (default) but completed is true, legacy client inserted completion
    ELSIF NEW.completed = true AND (NEW.status IS NULL OR NEW.status = 'pending') THEN
      NEW.status := 'completed';
    ELSE
      NEW.completed := false;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- 1. If status was explicitly changed, status is authoritative
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.completed := (NEW.status = 'completed');
    -- 2. If status was unchanged, but completed changed (legacy client update)
    ELSIF NEW.completed IS DISTINCT FROM OLD.completed THEN
      IF NEW.completed = true THEN
        NEW.status := 'completed';
      ELSIF NEW.status = 'completed' THEN
        NEW.status := 'pending';
      END IF;
    -- 3. If neither changed, enforce consistency
    ELSE
      IF NEW.status = 'completed' AND NEW.completed = false THEN
        NEW.completed := true;
      ELSIF NEW.status IN ('pending', 'postponed', 'cancelled') AND NEW.completed = true THEN
        NEW.completed := false;
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tr
    JOIN pg_class cl ON tr.tgrelid = cl.oid
    JOIN pg_namespace n ON cl.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND cl.relname = 'smart_routine_completions'
      AND tr.tgname = 'trg_sync_smart_completion_status'
  ) THEN
    CREATE TRIGGER trg_sync_smart_completion_status
      BEFORE INSERT OR UPDATE ON public.smart_routine_completions
      FOR EACH ROW
      EXECUTE FUNCTION public.fn_sync_smart_completion_status();
  END IF;
END $$;


-- ------------------------------------------------------------------------------
-- Step 2: Extend smart_routine_reports Table
-- ------------------------------------------------------------------------------

-- 2.1 Add separate counters for habit streak statistics.
ALTER TABLE public.smart_routine_reports
  ADD COLUMN IF NOT EXISTS eligible_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS postponed_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS postponed_routines JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cancelled_routines JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_streak_qualified BOOLEAN NOT NULL DEFAULT false;

-- 2.2 Performance index for streak queries
CREATE INDEX IF NOT EXISTS idx_smart_reports_user_streak
  ON public.smart_routine_reports (user_id, is_streak_qualified, date DESC);

-- 2.3 Idempotent Backfill for Historical Reports:
-- In Migration 002, cancellation/postponement did not exist; thus all routines were eligible.
-- Target only unmigrated reports where:
--   - total_routines > 0
--   - cancelled_count = 0 (prevents overwriting legitimate Build 11 reports where all routines were cancelled)
--   - eligible_count = 0 (ensures idempotency on repeated execution)
UPDATE public.smart_routine_reports
SET eligible_count = total_routines,
    is_streak_qualified = (total_routines > 0 AND completed_count > 0 AND completion_rate >= 80)
WHERE eligible_count = 0
  AND total_routines > 0
  AND cancelled_count = 0;


-- ------------------------------------------------------------------------------
-- Step 3: Extend smart_routine_settings Table
-- ------------------------------------------------------------------------------

-- 3.1 Add streak target threshold (default: 80%)
ALTER TABLE public.smart_routine_settings
  ADD COLUMN IF NOT EXISTS streak_threshold INTEGER NOT NULL DEFAULT 80;

-- 3.2 Add table-scoped CHECK constraint on threshold range (1 - 100)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'smart_routine_settings'
      AND c.conname = 'chk_smart_settings_streak_threshold'
  ) THEN
    ALTER TABLE public.smart_routine_settings
      ADD CONSTRAINT chk_smart_settings_streak_threshold
      CHECK (streak_threshold >= 1 AND streak_threshold <= 100);
  END IF;
END $$;

COMMIT;


-- ==============================================================================
-- ROLLBACK SCRIPTS (Reference only — do not execute without explicit authorization)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- OPTION A: Non-Destructive Rollback (Safe — preserves user data)
-- ------------------------------------------------------------------------------
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_sync_smart_completion_status ON public.smart_routine_completions;
-- DROP FUNCTION IF EXISTS public.fn_sync_smart_completion_status();
-- ALTER TABLE public.smart_routine_settings DROP CONSTRAINT IF EXISTS chk_smart_settings_streak_threshold;
-- ALTER TABLE public.smart_routine_completions DROP CONSTRAINT IF EXISTS chk_smart_completions_status;
-- DROP INDEX IF EXISTS public.idx_smart_reports_user_streak;
-- DROP INDEX IF EXISTS public.idx_smart_completions_user_date_status;
-- COMMIT;

-- ------------------------------------------------------------------------------
-- OPTION B: Destructive Rollback (Permanent Data Loss Hazard)
-- ------------------------------------------------------------------------------
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_sync_smart_completion_status ON public.smart_routine_completions;
-- DROP FUNCTION IF EXISTS public.fn_sync_smart_completion_status();
-- ALTER TABLE public.smart_routine_settings DROP CONSTRAINT IF EXISTS chk_smart_settings_streak_threshold;
-- ALTER TABLE public.smart_routine_settings DROP COLUMN IF EXISTS streak_threshold;
-- DROP INDEX IF EXISTS public.idx_smart_reports_user_streak;
-- ALTER TABLE public.smart_routine_reports DROP COLUMN IF EXISTS is_streak_qualified;
-- ALTER TABLE public.smart_routine_reports DROP COLUMN IF EXISTS cancelled_routines;
-- ALTER TABLE public.smart_routine_reports DROP COLUMN IF EXISTS postponed_routines;
-- ALTER TABLE public.smart_routine_reports DROP COLUMN IF EXISTS cancelled_count;
-- ALTER TABLE public.smart_routine_reports DROP COLUMN IF EXISTS postponed_count;
-- ALTER TABLE public.smart_routine_reports DROP COLUMN IF EXISTS eligible_count;
-- DROP INDEX IF EXISTS public.idx_smart_completions_user_date_status;
-- ALTER TABLE public.smart_routine_completions DROP CONSTRAINT IF EXISTS chk_smart_completions_status;
-- ALTER TABLE public.smart_routine_completions DROP COLUMN IF EXISTS updated_at;
-- ALTER TABLE public.smart_routine_completions DROP COLUMN IF EXISTS cancellation_reason;
-- ALTER TABLE public.smart_routine_completions DROP COLUMN IF EXISTS postponed_to;
-- ALTER TABLE public.smart_routine_completions DROP COLUMN IF EXISTS status;
-- COMMIT;
