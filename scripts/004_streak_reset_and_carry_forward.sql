-- ==============================================================================
-- Taskly - Production Database Migration Proposal: Streak Reset & Carry-Forward
-- File: scripts/004_streak_reset_and_carry_forward.sql
-- ==============================================================================
-- Target: Supabase PostgreSQL (PostgreSQL 14+)
-- Feature: Taskly v2.0.0 Build 11 - Streak Baseline Reset & Carry-Forward Enhancements
--
-- Notice:
--   DO NOT EXECUTE WITHOUT EXPLICIT SEPARATE USER AUTHORIZATION.
--   This script is safe, idempotent, and transaction-wrapped.
--
-- Prerequisites:
--   Requires scripts/002_smart_lists_schema.sql and scripts/003_habit_streaks_schema.sql.
--   Pre-migration checks verify that Migration 003 has already been applied in production.
--
-- Architectural Improvements:
--   1. Strict Prerequisite & Calendar Date Validation:
--      - Confirms presence of tables, Migration 003 columns, and unique constraints.
--      - Aborts immediately if Migration 003 was not applied to the target database.
--      - Validates every existing 'date' in smart_routine_completions as a valid calendar date.
--   2. smart_routine_settings:
--      - Add 'streak_reset_at' TIMESTAMPTZ to record user-initiated streak resets.
--   3. smart_routine_completions:
--      - Add 'original_date' DATE to track origin date of carried-forward routines.
--      - Add table-scoped constraint verifying original_date <= date::DATE.
--   4. Optimized Partial Index:
--      - Index (user_id, original_date) WHERE original_date IS NOT NULL for fast lookups.
--   5. Rollback Scripts:
--      - Non-destructive (drops index and constraint, retains data).
--      - Destructive (drops columns with explicit data loss warning).
--
-- Security:
--   Preserves strict Row Level Security (RLS) enforcing auth.uid() = user_id.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- Step 1: Pre-Migration Prerequisites & Calendar Date Validation
-- ------------------------------------------------------------------------------
-- Aborts immediately if the remote database is missing Migration 002/003 schema
-- or if any existing record contains invalid calendar dates.
DO $$
DECLARE
  r RECORD;
  v_test DATE;
  v_missing_items TEXT := '';
BEGIN
  -- 1.1 Verify all prerequisite tables exist
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'smart_routines') THEN
    v_missing_items := v_missing_items || ' table: public.smart_routines;';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'smart_routine_completions') THEN
    v_missing_items := v_missing_items || ' table: public.smart_routine_completions;';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'smart_routine_settings') THEN
    v_missing_items := v_missing_items || ' table: public.smart_routine_settings;';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'smart_routine_reports') THEN
    v_missing_items := v_missing_items || ' table: public.smart_routine_reports;';
  END IF;

  IF length(v_missing_items) > 0 THEN
    RAISE EXCEPTION 'Pre-migration check failed! Core tables missing:% Please run scripts/002_smart_lists_schema.sql first.', v_missing_items;
  END IF;

  -- 1.2 Verify Migration 003 prerequisite columns exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'smart_routine_completions' AND column_name = 'status'
  ) THEN
    v_missing_items := v_missing_items || ' column: smart_routine_completions.status;';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'smart_routine_completions' AND column_name = 'postponed_to'
  ) THEN
    v_missing_items := v_missing_items || ' column: smart_routine_completions.postponed_to;';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'smart_routine_completions' AND column_name = 'cancellation_reason'
  ) THEN
    v_missing_items := v_missing_items || ' column: smart_routine_completions.cancellation_reason;';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'smart_routine_settings' AND column_name = 'streak_threshold'
  ) THEN
    v_missing_items := v_missing_items || ' column: smart_routine_settings.streak_threshold;';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'smart_routine_reports' AND column_name = 'is_streak_qualified'
  ) THEN
    v_missing_items := v_missing_items || ' column: smart_routine_reports.is_streak_qualified;';
  END IF;

  IF length(v_missing_items) > 0 THEN
    RAISE EXCEPTION 'Pre-migration check failed! The target database has NOT received Migration 003 (Habit Streaks schema). Missing prerequisite columns:% Please apply scripts/003_habit_streaks_schema.sql before applying Migration 004.', v_missing_items;
  END IF;

  -- 1.3 Verify expected data types of prerequisite columns
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'smart_routine_completions' 
      AND column_name = 'postponed_to' AND data_type = 'date'
  ) THEN
    RAISE EXCEPTION 'Pre-migration check failed: smart_routine_completions.postponed_to exists but is not of data type DATE.';
  END IF;

  -- 1.4 Verify prerequisite unique constraint on smart_routine_completions(user_id, routine_id, date)
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'smart_routine_completions'
      AND c.contype = 'u'
      AND ARRAY(
        SELECT a.attname
        FROM unnest(c.conkey) k
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k
        ORDER BY a.attname
      ) = ARRAY['date', 'routine_id', 'user_id']::name[]
  ) THEN
    RAISE EXCEPTION 'Pre-migration check failed: Expected unique constraint uq_smart_completions_user_routine_date on public.smart_routine_completions(user_id, routine_id, date) is missing.';
  END IF;

  -- 1.5 Validate calendar dates for all existing completions
  FOR r IN 
    SELECT id, user_id, routine_id, date 
    FROM public.smart_routine_completions 
    WHERE date IS NOT NULL
  LOOP
    -- Verify YYYY-MM-DD pattern
    IF r.date !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'Pre-migration check failed: Non-ISO date format "%" on record id=%, user_id=%, routine_id=%',
        r.date, r.id, r.user_id, r.routine_id;
    END IF;

    -- Verify calendar validity (catches invalid day-of-month, leap year errors, invalid month)
    BEGIN
      v_test := r.date::DATE;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Pre-migration check failed: Invalid calendar date "%" on record id=%, user_id=%, routine_id=% (PostgreSQL Error: %)',
        r.date, r.id, r.user_id, r.routine_id, SQLERRM;
    END;
  END LOOP;
END $$;


-- ------------------------------------------------------------------------------
-- Step 2: Extend smart_routine_settings Table
-- ------------------------------------------------------------------------------
-- Add streak_reset_at to track when a user resets their habit streak baseline.
ALTER TABLE public.smart_routine_settings
  ADD COLUMN IF NOT EXISTS streak_reset_at TIMESTAMPTZ DEFAULT NULL;


-- ------------------------------------------------------------------------------
-- Step 3: Extend smart_routine_completions Table
-- ------------------------------------------------------------------------------
-- Add original_date (DATE) to track origin date of carried-forward routines.
ALTER TABLE public.smart_routine_completions
  ADD COLUMN IF NOT EXISTS original_date DATE DEFAULT NULL;

-- Add table-scoped CHECK constraint ensuring chronological consistency.
-- Scoped explicitly to schema 'public' and table 'smart_routine_completions'.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'smart_routine_completions'
      AND c.conname = 'chk_smart_completions_orig_date_valid'
  ) THEN
    ALTER TABLE public.smart_routine_completions
      ADD CONSTRAINT chk_smart_completions_orig_date_valid
      CHECK (original_date IS NULL OR original_date <= date::DATE);
  END IF;
END $$;


-- ------------------------------------------------------------------------------
-- Step 4: Optimized Partial Index for Carry-Forward Queries
-- ------------------------------------------------------------------------------
-- Indexes carried-forward routines without indexing uncarried routine rows.
CREATE INDEX IF NOT EXISTS idx_smart_completions_user_original_date
  ON public.smart_routine_completions (user_id, original_date)
  WHERE original_date IS NOT NULL;

COMMIT;


-- ==============================================================================
-- ROLLBACK SCRIPTS (Reference only — do not execute without explicit authorization)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- OPTION A: Non-Destructive Rollback (Recommended / Safe)
-- Drops the new index and table constraint, but retains data columns and all
-- existing user streak_reset_at and original_date values. Zero data loss.
-- ------------------------------------------------------------------------------
-- BEGIN;
-- DROP INDEX IF EXISTS public.idx_smart_completions_user_original_date;
-- ALTER TABLE public.smart_routine_completions 
--   DROP CONSTRAINT IF EXISTS chk_smart_completions_orig_date_valid;
-- COMMIT;

-- ------------------------------------------------------------------------------
-- OPTION B: Destructive Rollback (Permanent Data Loss Hazard)
-- Drops index, constraint, and permanently removes original_date and streak_reset_at.
-- WARNING: All recorded streak reset timestamps and carry-forward origin audits
-- across all users will be irreversibly erased from the database!
-- ------------------------------------------------------------------------------
-- BEGIN;
-- DROP INDEX IF EXISTS public.idx_smart_completions_user_original_date;
-- ALTER TABLE public.smart_routine_completions 
--   DROP CONSTRAINT IF EXISTS chk_smart_completions_orig_date_valid;
-- ALTER TABLE public.smart_routine_completions 
--   DROP COLUMN IF EXISTS original_date;
-- ALTER TABLE public.smart_routine_settings 
--   DROP COLUMN IF EXISTS streak_reset_at;
-- COMMIT;
