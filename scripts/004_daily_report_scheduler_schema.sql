-- ==============================================================================
-- Taskly Database Migration 004: Daily Routine Summary History & Timezone Schema
-- File: scripts/004_daily_report_scheduler_schema.sql
-- ==============================================================================
-- Target Database: Customer Production Supabase (liucmamlownxfshnaxtc)
-- STRICT NOTICE: DO NOT EXECUTE AGAINST DISCONTINUED DEVELOPER / STAGING SUPABASE.
--
-- Features:
-- 1. Adds 'timezone' column to smart_routine_settings (defaults to 'UTC').
-- 2. Ensures helper columns exist on smart_routine_reports (status_badge, closing_statement).
-- 3. Pre-constraint deduplication on smart_routine_reports before adding unique constraint.
-- 4. Idempotent uniqueness constraint enforcement on smart_routine_reports (user_id, date).
-- 5. Row Level Security (RLS) enforcement ensuring customer data isolation.
-- 6. Self-verifying transaction with automated assertions.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- Step 1: Add timezone column to smart_routine_settings
-- ------------------------------------------------------------------------------
ALTER TABLE public.smart_routine_settings
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) NOT NULL DEFAULT 'UTC';

-- ------------------------------------------------------------------------------
-- Step 2: Ensure non-breaking optional columns exist on smart_routine_reports
-- ------------------------------------------------------------------------------
ALTER TABLE public.smart_routine_reports
  ADD COLUMN IF NOT EXISTS status_badge VARCHAR(50) DEFAULT 'Not Started';

ALTER TABLE public.smart_routine_reports
  ADD COLUMN IF NOT EXISTS closing_statement TEXT DEFAULT NULL;

-- ------------------------------------------------------------------------------
-- Step 3: Pre-constraint deduplication on smart_routine_reports
-- ------------------------------------------------------------------------------
-- Remove older duplicates for any (user_id, date) pair so adding unique constraint succeeds
DELETE FROM public.smart_routine_reports a
USING public.smart_routine_reports b
WHERE a.user_id = b.user_id
  AND a.date = b.date
  AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.id < b.id));

-- ------------------------------------------------------------------------------
-- Step 4: Add unique constraint on smart_routine_reports (user_id, date)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'uq_smart_reports_user_date' 
      AND conrelid = 'public.smart_routine_reports'::regclass
  ) THEN
    ALTER TABLE public.smart_routine_reports
      ADD CONSTRAINT uq_smart_reports_user_date UNIQUE (user_id, date);
    RAISE NOTICE 'Added unique constraint uq_smart_reports_user_date on smart_routine_reports(user_id, date).';
  ELSE
    RAISE NOTICE 'Unique constraint uq_smart_reports_user_date already exists.';
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- Step 5: Verify & Enforce Row Level Security (RLS)
-- ------------------------------------------------------------------------------
ALTER TABLE public.smart_routine_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_routine_reports ENABLE ROW LEVEL SECURITY;

-- Ensure RLS policies for smart_routine_reports
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

-- Ensure RLS policies for smart_routine_settings
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
-- Step 6: Automated Post-Migration Verification Assertions
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  has_timezone_col BOOLEAN;
  has_unique_constraint BOOLEAN;
  settings_rls_enabled BOOLEAN;
  reports_rls_enabled BOOLEAN;
BEGIN
  -- 1. Check timezone column
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'smart_routine_settings' 
      AND column_name = 'timezone'
  ) INTO has_timezone_col;

  IF NOT has_timezone_col THEN
    RAISE EXCEPTION 'Verification Failed: column smart_routine_settings.timezone was not created.';
  END IF;

  -- 2. Check unique constraint
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'uq_smart_reports_user_date' 
      AND conrelid = 'public.smart_routine_reports'::regclass
  ) INTO has_unique_constraint;

  IF NOT has_unique_constraint THEN
    RAISE EXCEPTION 'Verification Failed: constraint uq_smart_reports_user_date was not created.';
  END IF;

  -- 3. Check RLS status
  SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'smart_routine_settings' INTO settings_rls_enabled;
  SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'smart_routine_reports' INTO reports_rls_enabled;

  IF NOT settings_rls_enabled OR NOT reports_rls_enabled THEN
    RAISE EXCEPTION 'Verification Failed: Row Level Security is not active on routine tables.';
  END IF;

  RAISE NOTICE 'SUCCESS: Migration 004 verified successfully. All constraints, columns, and RLS policies are active.';
END $$;

COMMIT;
