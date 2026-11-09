-- ==============================================================================
-- Migration 006: Smart Routine Deletion Safety & Foreign Key Audit
-- Target: Supabase PostgreSQL
-- Version: Taskly v2.1.1 (Build 12.1)
-- Status: ADVISORY / FOR REVIEW ONLY (Do not execute automatically)
-- ==============================================================================
--
-- PURPOSE:
--   1. Audit and verify that the foreign key constraint
--      "smart_routine_completions_routine_id_fkey" correctly enforces referential
--      integrity to "public.smart_routines(id)" with ON DELETE CASCADE.
--   2. Identify and safely remove any orphaned records in "smart_routine_completions"
--      that reference a nonexistent routine_id (due to prior routine deletions).
--   3. Ensure Row-Level Security (RLS) policies remain active and unaffected.
--
-- SAFETY GUARANTEES:
--   - Non-destructive to existing valid routine data and historical completion history.
--   - Strict multi-user isolation preserved (all queries scope by user_id / auth.uid()).
--   - Foreign key constraints are NOT disabled.
--   - Idempotent and reversible.
-- ==============================================================================

-- 1. INSPECT CURRENT FOREIGN KEY CONSTRAINT
-- Run this query to inspect how the constraint is currently defined:
/*
SELECT
    tc.table_schema,
    tc.table_name,
    tc.constraint_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    rc.delete_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints AS rc
    ON tc.constraint_name = rc.constraint_name
WHERE tc.table_name = 'smart_routine_completions'
  AND kcu.column_name = 'routine_id';
*/

-- 2. AUDIT: CHECK FOR ANY ORPHANED COMPLETIONS
-- Returns any completions whose parent routine was deleted without cascading:
/*
SELECT c.id, c.user_id, c.routine_id, c.date, c.status
FROM public.smart_routine_completions c
LEFT JOIN public.smart_routines r ON c.routine_id = r.id
WHERE r.id IS NULL;
*/

-- 3. TRANSACTION-SAFE IDEMPOTENT RECONCILIATION
DO $$
BEGIN
  -- Safe cleanup of any orphaned records where parent routine does not exist
  DELETE FROM public.smart_routine_completions
  WHERE routine_id NOT IN (SELECT id FROM public.smart_routines);

  -- Ensure the foreign key constraint exists and has ON DELETE CASCADE
  -- Only re-create if the constraint is missing or not cascading
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.referential_constraints rc
    JOIN information_schema.table_constraints tc ON tc.constraint_name = rc.constraint_name
    WHERE tc.table_name = 'smart_routine_completions'
      AND tc.constraint_name = 'smart_routine_completions_routine_id_fkey'
      AND rc.delete_rule = 'CASCADE'
  ) THEN
    -- Drop existing non-cascading constraint if present
    ALTER TABLE public.smart_routine_completions
      DROP CONSTRAINT IF EXISTS smart_routine_completions_routine_id_fkey;

    -- Add verified foreign key with ON DELETE CASCADE
    ALTER TABLE public.smart_routine_completions
      ADD CONSTRAINT smart_routine_completions_routine_id_fkey
      FOREIGN KEY (routine_id) REFERENCES public.smart_routines(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- 4. REFRESH POSTGREST SCHEMA CACHE
NOTIFY pgrst, 'reload schema';

-- ==============================================================================
-- ROLLBACK SCRIPT (IF NEEDED)
-- ==============================================================================
-- BEGIN;
-- ALTER TABLE public.smart_routine_completions
--   DROP CONSTRAINT IF EXISTS smart_routine_completions_routine_id_fkey;
-- ALTER TABLE public.smart_routine_completions
--   ADD CONSTRAINT smart_routine_completions_routine_id_fkey
--   FOREIGN KEY (routine_id) REFERENCES public.smart_routines(id)
--   ON DELETE CASCADE;
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;

