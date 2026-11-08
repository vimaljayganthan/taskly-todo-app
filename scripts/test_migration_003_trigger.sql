-- ==============================================================================
-- Taskly - Migration 003 Trigger Verification Test (Isolated Transaction)
-- File: scripts/test_migration_003_trigger.sql
-- ==============================================================================
-- Purpose:
--   Tests the exact fn_sync_smart_completion_status trigger across all client
--   generations and operations in an isolated temporary table.
--
-- Safety:
--   Fully wrapped in BEGIN ... ROLLBACK. Does not touch or modify persistent data.
-- ==============================================================================

BEGIN;

-- 1. Create isolated temporary table mimicking public.smart_routine_completions
CREATE TEMP TABLE _test_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  routine_id UUID NOT NULL,
  date VARCHAR(10) NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  carried_forward BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  postponed_to DATE DEFAULT NULL,
  cancellation_reason VARCHAR(100) DEFAULT NULL,
  updated_at TIMESTAMPTZ DEFAULT NULL,
  CONSTRAINT uq_test_completions UNIQUE (user_id, routine_id, date)
);

-- 2. Define the exact trigger function
CREATE OR REPLACE FUNCTION public.fn_sync_smart_completion_status()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'completed' THEN
      NEW.completed := true;
    ELSIF NEW.status IN ('postponed', 'cancelled') THEN
      NEW.completed := false;
    ELSIF NEW.completed = true AND (NEW.status IS NULL OR NEW.status = 'pending') THEN
      NEW.status := 'completed';
    ELSE
      NEW.completed := false;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.completed := (NEW.status = 'completed');
    ELSIF NEW.completed IS DISTINCT FROM OLD.completed THEN
      IF NEW.completed = true THEN
        NEW.status := 'completed';
      ELSIF NEW.status = 'completed' THEN
        NEW.status := 'pending';
      END IF;
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

-- 3. Attach trigger to temporary table
CREATE TRIGGER trg_test_sync_status
  BEFORE INSERT OR UPDATE ON _test_completions
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_smart_completion_status();

-- 4. Execute test cases
DO $$
DECLARE
  v_rec RECORD;
BEGIN
  -- Test 1: Legacy Build 10 INSERT (completed=true, status not provided)
  INSERT INTO _test_completions (user_id, routine_id, date, completed)
  VALUES ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-11-08', true);

  SELECT status, completed INTO v_rec FROM _test_completions WHERE routine_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  IF v_rec.status != 'completed' OR v_rec.completed != true THEN
    RAISE EXCEPTION 'Test 1 FAILED: Expected (completed, true), got (%, %)', v_rec.status, v_rec.completed;
  END IF;

  -- Test 2: Legacy Build 10 UPDATE (uncheck routine)
  UPDATE _test_completions SET completed = false WHERE routine_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  SELECT status, completed INTO v_rec FROM _test_completions WHERE routine_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  IF v_rec.status != 'pending' OR v_rec.completed != false THEN
    RAISE EXCEPTION 'Test 2 FAILED: Expected (pending, false), got (%, %)', v_rec.status, v_rec.completed;
  END IF;

  -- Test 3: Modern Build 11 INSERT (status=postponed)
  INSERT INTO _test_completions (user_id, routine_id, date, status, postponed_to)
  VALUES ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-11-08', 'postponed', '2026-11-09');
  SELECT status, completed INTO v_rec FROM _test_completions WHERE routine_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  IF v_rec.status != 'postponed' OR v_rec.completed != false THEN
    RAISE EXCEPTION 'Test 3 FAILED: Expected (postponed, false), got (%, %)', v_rec.status, v_rec.completed;
  END IF;

  -- Test 4: Conflicting payload (status=postponed, completed=true) -> status authoritative
  UPDATE _test_completions SET status = 'postponed', completed = true WHERE routine_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  SELECT status, completed INTO v_rec FROM _test_completions WHERE routine_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  IF v_rec.status != 'postponed' OR v_rec.completed != false THEN
    RAISE EXCEPTION 'Test 4 FAILED: Expected status precedence (postponed, false), got (%, %)', v_rec.status, v_rec.completed;
  END IF;

  -- Test 5: UPSERT conflict update branch
  INSERT INTO _test_completions (user_id, routine_id, date, status, cancellation_reason)
  VALUES ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-11-08', 'cancelled', 'Not feeling well')
  ON CONFLICT (user_id, routine_id, date) DO UPDATE 
  SET status = EXCLUDED.status, cancellation_reason = EXCLUDED.cancellation_reason;

  SELECT status, completed, cancellation_reason INTO v_rec FROM _test_completions WHERE routine_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  IF v_rec.status != 'cancelled' OR v_rec.completed != false OR v_rec.cancellation_reason != 'Not feeling well' THEN
    RAISE EXCEPTION 'Test 5 FAILED: Expected upsert to yield (cancelled, false), got (%, %)', v_rec.status, v_rec.completed;
  END IF;

  RAISE NOTICE 'ALL 5 TRIGGER DATABASE TESTS PASSED SUCCESSFULLY.';
END $$;

ROLLBACK;

