-- ==============================================================================
-- Taskly - Production Historical Task Import (Full-Fidelity & Idempotent)
-- File: scripts/002_import_historical_tasks.sql
-- ==============================================================================
-- Purpose:
--   Imports the two approved historical tasks from data/todos.json into public.todos
--   and assigns them to the verified primary user account:
--   UUID: 8fdf606c-4746-49ef-bbde-e38d85ed5797
--
-- Safety Guarantees:
--   1. Transactional: Runs in a single atomic transaction (BEGIN ... COMMIT).
--   2. Primary User Validation: Verifies target UUID exists in auth.users.
--   3. Ownership Mismatch Protection: Detects if either task ID exists under a
--      different user and aborts immediately; NEVER silently reassigns ownership.
--   4. Idempotent: Skips insertion if the task already exists under the primary user;
--      NEVER overwrites or duplicates existing records.
--   5. Full-Fidelity: Preserves 100% of original fields:
--      description, time, priority, category, reminder, createdAt, and updatedAt.
--
-- Instructions:
--   1. Execute in Supabase SQL Editor AFTER scripts/001_multi_user_isolation.sql.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- Step 1: Pre-Import Verification, Ownership Conflict & Metadata Discrepancy Checks
-- ------------------------------------------------------------------------------
-- Compares every field of BOTH existing tasks against the source records:
--   - id, user_id, title, completed, due_date, time, description, priority, category, reminder, created_at, updated_at
-- Rules:
--   1. If an existing task belongs to another user: Abort entire transaction.
--   2. If an existing task belongs to the primary user but ANY field differs:
--      Abort entire transaction (never silently skip or overwrite conflicting data).
--   3. If an existing task matches 100% of fields: Preserved without duplication.
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_primary_uid UUID := '8fdf606c-4746-49ef-bbde-e38d85ed5797'::UUID;
  v_rec1 RECORD;
  v_rec2 RECORD;
BEGIN
  -- 1. Verify primary user exists in auth.users
  IF NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = v_primary_uid
  ) THEN
    RAISE EXCEPTION 
      'IMPORT ABORTED: Primary user UUID % does not exist in auth.users. '
      'Cannot import historical tasks to a non-existent account.', 
      v_primary_uid;
  END IF;

  -- 2. Inspect existing state of Task 1 ("gvfu67t" - ID: 95255954-1c20-4ce5-9756-20213f323739)
  SELECT * INTO v_rec1 
  FROM public.todos 
  WHERE id = '95255954-1c20-4ce5-9756-20213f323739';

  IF v_rec1.id IS NOT NULL THEN
    -- Check ownership conflict
    IF v_rec1.user_id <> v_primary_uid THEN
      RAISE EXCEPTION 
        'IMPORT ABORTED: Task 1 (ID: 95255954-1c20-4ce5-9756-20213f323739) already exists in public.todos '
        'but belongs to a DIFFERENT user (%). Refusing to reassign ownership.', 
        v_rec1.user_id;
    END IF;

    -- Strict field-by-field equality check across all 12 columns
    IF v_rec1.id IS DISTINCT FROM '95255954-1c20-4ce5-9756-20213f323739' OR
       v_rec1.user_id IS DISTINCT FROM v_primary_uid OR
       v_rec1.title IS DISTINCT FROM 'gvfu67t' OR
       v_rec1.completed IS DISTINCT FROM false OR
       v_rec1.due_date IS DISTINCT FROM '2026-11-02' OR
       v_rec1.time IS DISTINCT FROM '6:00 PM' OR
       v_rec1.description IS DISTINCT FROM 'hiii' OR
       v_rec1.priority IS DISTINCT FROM 'High' OR
       v_rec1.category IS DISTINCT FROM 'Project' OR
       v_rec1.reminder IS DISTINCT FROM true OR
       v_rec1.created_at IS DISTINCT FROM '2026-11-02T10:12:35.039Z'::TIMESTAMPTZ OR
       v_rec1.updated_at IS NOT NULL THEN
      RAISE EXCEPTION 
        'IMPORT ABORTED: Task 1 (ID: 95255954-1c20-4ce5-9756-20213f323739) exists for primary user but contains conflicting metadata. '
        'Silently skipping or overwriting conflicting data is prohibited.';
    END IF;

    RAISE NOTICE 'Task 1 already exists for primary user with exact matching metadata. Safe to preserve.';
  END IF;

  -- 3. Inspect existing state of Task 2 ("Build ColdGuard UI" - ID: e2f1837a-4c29-4f76-bc34-90a18734e123)
  SELECT * INTO v_rec2 
  FROM public.todos 
  WHERE id = 'e2f1837a-4c29-4f76-bc34-90a18734e123';

  IF v_rec2.id IS NOT NULL THEN
    -- Check ownership conflict
    IF v_rec2.user_id <> v_primary_uid THEN
      RAISE EXCEPTION 
        'IMPORT ABORTED: Task 2 (ID: e2f1837a-4c29-4f76-bc34-90a18734e123) already exists in public.todos '
        'but belongs to a DIFFERENT user (%). Refusing to reassign ownership.', 
        v_rec2.user_id;
    END IF;

    -- Strict field-by-field equality check across all 12 columns
    IF v_rec2.id IS DISTINCT FROM 'e2f1837a-4c29-4f76-bc34-90a18734e123' OR
       v_rec2.user_id IS DISTINCT FROM v_primary_uid OR
       v_rec2.title IS DISTINCT FROM 'Build ColdGuard UI' OR
       v_rec2.completed IS DISTINCT FROM false OR
       v_rec2.due_date IS DISTINCT FROM '2026-11-03' OR
       v_rec2.time IS DISTINCT FROM '6:00 PM' OR
       v_rec2.description IS DISTINCT FROM 'Complete dashboard and connect with FastAPI backend' OR
       v_rec2.priority IS DISTINCT FROM 'High' OR
       v_rec2.category IS DISTINCT FROM 'Project' OR
       v_rec2.reminder IS DISTINCT FROM true OR
       v_rec2.created_at IS DISTINCT FROM '2026-11-02T06:30:00.000Z'::TIMESTAMPTZ OR
       v_rec2.updated_at IS DISTINCT FROM '2026-11-02T09:19:19.766Z'::TIMESTAMPTZ THEN
      RAISE EXCEPTION 
        'IMPORT ABORTED: Task 2 (ID: e2f1837a-4c29-4f76-bc34-90a18734e123) exists for primary user but contains conflicting metadata. '
        'Silently skipping or overwriting conflicting data is prohibited.';
    END IF;

    RAISE NOTICE 'Task 2 already exists for primary user with exact matching metadata. Safe to preserve.';
  END IF;

  RAISE NOTICE 'Pre-import check passed: Primary user verified, no ownership conflicts, and no conflicting metadata detected.';
END $$;

-- ------------------------------------------------------------------------------
-- Step 2: Full-Fidelity Idempotent Import — Task 1 ("gvfu67t")
-- ------------------------------------------------------------------------------
INSERT INTO public.todos (
  id,
  user_id,
  title,
  completed,
  due_date,
  time,
  description,
  priority,
  category,
  reminder,
  created_at,
  updated_at
)
SELECT
  '95255954-1c20-4ce5-9756-20213f323739',
  '8fdf606c-4746-49ef-bbde-e38d85ed5797'::UUID,
  'gvfu67t',
  false,
  '2026-11-02',
  '6:00 PM',
  'hiii',
  'High',
  'Project',
  true,
  '2026-11-02T10:12:35.039Z'::TIMESTAMPTZ,
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.todos WHERE id = '95255954-1c20-4ce5-9756-20213f323739'
);

-- ------------------------------------------------------------------------------
-- Step 3: Full-Fidelity Idempotent Import — Task 2 ("Build ColdGuard UI")
-- ------------------------------------------------------------------------------
INSERT INTO public.todos (
  id,
  user_id,
  title,
  completed,
  due_date,
  time,
  description,
  priority,
  category,
  reminder,
  created_at,
  updated_at
)
SELECT
  'e2f1837a-4c29-4f76-bc34-90a18734e123',
  '8fdf606c-4746-49ef-bbde-e38d85ed5797'::UUID,
  'Build ColdGuard UI',
  false,
  '2026-11-03',
  '6:00 PM',
  'Complete dashboard and connect with FastAPI backend',
  'High',
  'Project',
  true,
  '2026-11-02T06:30:00.000Z'::TIMESTAMPTZ,
  '2026-11-02T09:19:19.766Z'::TIMESTAMPTZ
WHERE NOT EXISTS (
  SELECT 1 FROM public.todos WHERE id = 'e2f1837a-4c29-4f76-bc34-90a18734e123'
);

-- ------------------------------------------------------------------------------
-- Step 4: Post-Import Integrity Assertions (All 12 Fields Verified)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_primary_uid UUID := '8fdf606c-4746-49ef-bbde-e38d85ed5797'::UUID;
  v_rec1 RECORD;
  v_rec2 RECORD;
BEGIN
  -- Verify Task 1 (All 12 fields)
  SELECT * INTO v_rec1 FROM public.todos WHERE id = '95255954-1c20-4ce5-9756-20213f323739';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POST-IMPORT ASSERTION FAILED: Task 1 was not imported.';
  END IF;
  IF v_rec1.id IS DISTINCT FROM '95255954-1c20-4ce5-9756-20213f323739' OR
     v_rec1.user_id IS DISTINCT FROM v_primary_uid OR
     v_rec1.title IS DISTINCT FROM 'gvfu67t' OR
     v_rec1.completed IS DISTINCT FROM false OR
     v_rec1.due_date IS DISTINCT FROM '2026-11-02' OR
     v_rec1.time IS DISTINCT FROM '6:00 PM' OR
     v_rec1.description IS DISTINCT FROM 'hiii' OR
     v_rec1.priority IS DISTINCT FROM 'High' OR
     v_rec1.category IS DISTINCT FROM 'Project' OR
     v_rec1.reminder IS DISTINCT FROM true OR
     v_rec1.created_at IS DISTINCT FROM '2026-11-02T10:12:35.039Z'::TIMESTAMPTZ OR
     v_rec1.updated_at IS NOT NULL THEN
    RAISE EXCEPTION 'POST-IMPORT ASSERTION FAILED: Task 1 field integrity assertion failed.';
  END IF;

  -- Verify Task 2 (All 12 fields)
  SELECT * INTO v_rec2 FROM public.todos WHERE id = 'e2f1837a-4c29-4f76-bc34-90a18734e123';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POST-IMPORT ASSERTION FAILED: Task 2 was not imported.';
  END IF;
  IF v_rec2.id IS DISTINCT FROM 'e2f1837a-4c29-4f76-bc34-90a18734e123' OR
     v_rec2.user_id IS DISTINCT FROM v_primary_uid OR
     v_rec2.title IS DISTINCT FROM 'Build ColdGuard UI' OR
     v_rec2.completed IS DISTINCT FROM false OR
     v_rec2.due_date IS DISTINCT FROM '2026-11-03' OR
     v_rec2.time IS DISTINCT FROM '6:00 PM' OR
     v_rec2.description IS DISTINCT FROM 'Complete dashboard and connect with FastAPI backend' OR
     v_rec2.priority IS DISTINCT FROM 'High' OR
     v_rec2.category IS DISTINCT FROM 'Project' OR
     v_rec2.reminder IS DISTINCT FROM true OR
     v_rec2.created_at IS DISTINCT FROM '2026-11-02T06:30:00.000Z'::TIMESTAMPTZ OR
     v_rec2.updated_at IS DISTINCT FROM '2026-11-02T09:19:19.766Z'::TIMESTAMPTZ THEN
    RAISE EXCEPTION 'POST-IMPORT ASSERTION FAILED: Task 2 field integrity assertion failed.';
  END IF;

  RAISE NOTICE '=======================================================';
  RAISE NOTICE 'SUCCESS: Both historical tasks verified and imported!';
  RAISE NOTICE 'Primary User: 8fdf606c-4746-49ef-bbde-e38d85ed5797';
  RAISE NOTICE 'Task 1:       gvfu67t (All 12 fields verified)';
  RAISE NOTICE 'Task 2:       Build ColdGuard UI (All 12 fields verified)';
  RAISE NOTICE '=======================================================';
END $$;

COMMIT;

