-- ==============================================================================
-- Taskly - Production Database Migration: Smart Routine Title Override
-- File: scripts/005_smart_routine_title_override.sql
-- ==============================================================================
-- Target: Supabase PostgreSQL (PostgreSQL 14+)
-- Feature: Taskly v2.1.0 - Date-Specific Routine Title Override Persistence
--
-- Notice:
--   DO NOT EXECUTE WITHOUT EXPLICIT SEPARATE USER AUTHORIZATION.
--   This script is safe, idempotent, non-destructive, and transaction-wrapped.
--
-- Prerequisites:
--   Requires scripts/002_smart_lists_schema.sql, scripts/003_habit_streaks_schema.sql,
--   and scripts/004_streak_reset_and_carry_forward.sql.
--   Pre-migration checks verify that table public.smart_routine_completions exists.
--
-- Architectural Purpose:
--   Enables date-specific routine occurrences (such as Tomorrow's Routines) to
--   have independent title overrides without mutating the underlying master routine
--   in public.smart_routines or affecting other days' occurrences.
--
-- Security:
--   Preserves strict Row Level Security (RLS) on public.smart_routine_completions:
--   Existing permissive policies (smart_completions_select_policy,
--   smart_completions_insert_policy, smart_completions_update_policy,
--   smart_completions_delete_policy) enforce auth.uid() = user_id.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- Step 1: Pre-Migration Prerequisites Validation
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_missing_items TEXT := '';
BEGIN
  -- 1.1 Verify prerequisite table exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = 'public' AND tablename = 'smart_routine_completions'
  ) THEN
    v_missing_items := v_missing_items || ' table: public.smart_routine_completions;';
  END IF;

  -- 1.2 Verify prerequisite unique constraint exists
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'smart_routine_completions'
      AND c.contype = 'u'
  ) THEN
    v_missing_items := v_missing_items || ' UNIQUE constraint on smart_routine_completions(user_id, routine_id, date);';
  END IF;

  IF v_missing_items <> '' THEN
    RAISE EXCEPTION 'Pre-migration check failed: Missing prerequisites:%', v_missing_items;
  END IF;

  RAISE NOTICE 'Pre-migration checks PASSED: public.smart_routine_completions is ready for title_override extension.';
END $$;


-- ------------------------------------------------------------------------------
-- Step 2: Extend smart_routine_completions with title_override
-- ------------------------------------------------------------------------------
-- Adds nullable TEXT column title_override. Existing records retain NULL,
-- preserving all historical completion and streak data with zero data mutation.
ALTER TABLE public.smart_routine_completions
  ADD COLUMN IF NOT EXISTS title_override TEXT DEFAULT NULL;


-- ------------------------------------------------------------------------------
-- Step 3: Verify Row Level Security (RLS) is Active
-- ------------------------------------------------------------------------------
-- Confirms that RLS remains enforced on smart_routine_completions
ALTER TABLE public.smart_routine_completions ENABLE ROW LEVEL SECURITY;


-- ------------------------------------------------------------------------------
-- Step 4: PostgREST Schema Cache Refresh
-- ------------------------------------------------------------------------------
-- Notifies the PostgREST daemon to immediately reload its schema cache.
-- This ensures PostgREST recognizes the title_override column without restart delay.
NOTIFY pgrst, 'reload schema';


-- ------------------------------------------------------------------------------
-- Step 5: Post-Migration Validation
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_col_type TEXT;
  v_is_nullable TEXT;
BEGIN
  SELECT data_type, is_nullable
  INTO v_col_type, v_is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'smart_routine_completions'
    AND column_name = 'title_override';

  IF v_col_type IS NULL THEN
    RAISE EXCEPTION 'Post-migration check failed: column title_override was not created on public.smart_routine_completions.';
  END IF;

  IF v_is_nullable <> 'YES' THEN
    RAISE EXCEPTION 'Post-migration check failed: column title_override must be nullable (got is_nullable=%).', v_is_nullable;
  END IF;

  RAISE NOTICE 'Post-migration verification PASSED: public.smart_routine_completions.title_override (%, nullable=%) successfully configured.',
    v_col_type, v_is_nullable;
END $$;

COMMIT;


-- ==============================================================================
-- ROLLBACK SCRIPTS (Reference only — do not execute without explicit authorization)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- OPTION A: Non-Destructive Rollback (Safe)
-- Clears all title_override values but retains the column definition to avoid
-- breaking active clients while rolling back data.
-- ------------------------------------------------------------------------------
-- BEGIN;
-- UPDATE public.smart_routine_completions SET title_override = NULL WHERE title_override IS NOT NULL;
-- COMMIT;

-- ------------------------------------------------------------------------------
-- OPTION B: Destructive Rollback (Column Removal)
-- Completely drops the title_override column from public.smart_routine_completions.
-- WARNING: All date-specific routine title overrides will be permanently deleted.
-- ------------------------------------------------------------------------------
-- BEGIN;
-- ALTER TABLE public.smart_routine_completions DROP COLUMN IF EXISTS title_override;
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;

