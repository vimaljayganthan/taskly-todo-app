// ==============================================================================
// Taskly v2.0.0 Build 11 - Migration 003 Trigger & Backfill Verification Suite
// File: tests/trigger_logic_and_migration_003.test.js
// ==============================================================================

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

/**
 * JavaScript reference implementation of public.fn_sync_smart_completion_status()
 * Replicates the exact PL/pgSQL trigger logic:
 */
function simulateTrigger(op, oldRow, newRow) {
  const row = { ...newRow };

  if (op === 'INSERT') {
    if (row.status === 'completed') {
      row.completed = true;
    } else if (row.status === 'postponed' || row.status === 'cancelled') {
      row.completed = false;
    } else if (row.completed === true && (!row.status || row.status === 'pending')) {
      row.status = 'completed';
    } else {
      row.completed = false;
    }
  } else if (op === 'UPDATE') {
    if (row.status !== oldRow.status) {
      row.completed = (row.status === 'completed');
    } else if (row.completed !== oldRow.completed) {
      if (row.completed === true) {
        row.status = 'completed';
      } else if (row.status === 'completed') {
        row.status = 'pending';
      }
    } else {
      if (row.status === 'completed' && row.completed === false) {
        row.completed = true;
      } else if (['pending', 'postponed', 'cancelled'].includes(row.status) && row.completed === true) {
        row.completed = false;
      }
    }
    row.updated_at = new Date().toISOString();
  }

  return row;
}

/**
 * Simulates report backfill logic from Step 2.3 of scripts/003_habit_streaks_schema.sql
 */
function simulateReportBackfill(report) {
  const r = { ...report };
  if (r.eligible_count === 0 && r.total_routines > 0 && r.cancelled_count === 0) {
    r.eligible_count = r.total_routines;
    r.is_streak_qualified = (r.total_routines > 0 && r.completed_count > 0 && r.completion_rate >= 80);
  }
  return r;
}

describe('Migration 003 Trigger & Backfill Verification', () => {

  describe('1. Legacy Build 10 Client Compatibility', () => {
    test('1.1 Legacy INSERT with completed=true automatically sets status=completed', () => {
      const inserted = simulateTrigger('INSERT', null, {
        user_id: 'user-1',
        routine_id: 'r-1',
        date: '2026-11-08',
        completed: true,
        status: 'pending' // Default from column
      });
      assert.strictEqual(inserted.status, 'completed');
      assert.strictEqual(inserted.completed, true);
    });

    test('1.2 Legacy INSERT with completed=false preserves status=pending', () => {
      const inserted = simulateTrigger('INSERT', null, {
        user_id: 'user-1',
        routine_id: 'r-1',
        date: '2026-11-08',
        completed: false,
        status: 'pending'
      });
      assert.strictEqual(inserted.status, 'pending');
      assert.strictEqual(inserted.completed, false);
    });

    test('1.3 Legacy UPDATE toggling completed=true sets status=completed', () => {
      const oldRow = { status: 'pending', completed: false };
      const updated = simulateTrigger('UPDATE', oldRow, { status: 'pending', completed: true });
      assert.strictEqual(updated.status, 'completed');
      assert.strictEqual(updated.completed, true);
    });

    test('1.4 Legacy UPDATE unchecking completed=false sets status=pending', () => {
      const oldRow = { status: 'completed', completed: true };
      const updated = simulateTrigger('UPDATE', oldRow, { status: 'completed', completed: false });
      assert.strictEqual(updated.status, 'pending');
      assert.strictEqual(updated.completed, false);
    });
  });

  describe('2. Modern Build 11 Client 4-State Operations', () => {
    test('2.1 Modern INSERT with status=postponed forces completed=false', () => {
      const inserted = simulateTrigger('INSERT', null, {
        user_id: 'user-1',
        routine_id: 'r-1',
        date: '2026-11-08',
        status: 'postponed',
        postponed_to: '2026-11-09'
      });
      assert.strictEqual(inserted.status, 'postponed');
      assert.strictEqual(inserted.completed, false);
    });

    test('2.2 Modern INSERT with status=cancelled forces completed=false', () => {
      const inserted = simulateTrigger('INSERT', null, {
        user_id: 'user-1',
        routine_id: 'r-1',
        date: '2026-11-08',
        status: 'cancelled',
        cancellation_reason: 'Sick'
      });
      assert.strictEqual(inserted.status, 'cancelled');
      assert.strictEqual(inserted.completed, false);
    });

    test('2.3 Modern UPDATE to postponed forces completed=false even if previously completed', () => {
      const oldRow = { status: 'completed', completed: true };
      const updated = simulateTrigger('UPDATE', oldRow, {
        status: 'postponed',
        postponed_to: '2026-11-09',
        completed: true // Client erroneously still had completed=true
      });
      assert.strictEqual(updated.status, 'postponed');
      assert.strictEqual(updated.completed, false, 'Postponed must force completed to false');
    });

    test('2.4 Modern UPDATE to cancelled forces completed=false even if previously completed', () => {
      const oldRow = { status: 'completed', completed: true };
      const updated = simulateTrigger('UPDATE', oldRow, {
        status: 'cancelled',
        completed: true
      });
      assert.strictEqual(updated.status, 'cancelled');
      assert.strictEqual(updated.completed, false, 'Cancelled must force completed to false');
    });
  });

  describe('3. Conflicting Completed and Status Payloads', () => {
    test('3.1 Conflicting status=postponed, completed=true gives precedence to status', () => {
      const result = simulateTrigger('INSERT', null, { status: 'postponed', completed: true });
      assert.strictEqual(result.status, 'postponed');
      assert.strictEqual(result.completed, false);
    });

    test('3.2 Conflicting status=completed, completed=false gives precedence to status', () => {
      const result = simulateTrigger('INSERT', null, { status: 'completed', completed: false });
      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(result.completed, true);
    });
  });

  describe('4. UPSERT Simulation', () => {
    test('4.1 UPSERT insert branch applies INSERT rules', () => {
      const res = simulateTrigger('INSERT', null, { status: 'completed', completed: false });
      assert.strictEqual(res.status, 'completed');
      assert.strictEqual(res.completed, true);
    });

    test('4.2 UPSERT conflict-update branch applies UPDATE rules', () => {
      const oldRow = { status: 'pending', completed: false };
      const res = simulateTrigger('UPDATE', oldRow, { status: 'cancelled', completed: false });
      assert.strictEqual(res.status, 'cancelled');
      assert.strictEqual(res.completed, false);
    });
  });

  describe('5. Historical Report Backfill Idempotency', () => {
    test('5.1 Unmigrated Migration 002 report (eligible_count=0, cancelled_count=0) is backfilled', () => {
      const legacyReport = {
        total_routines: 5,
        completed_count: 4,
        completion_rate: 80,
        eligible_count: 0,
        cancelled_count: 0,
        is_streak_qualified: false
      };
      const backfilled = simulateReportBackfill(legacyReport);
      assert.strictEqual(backfilled.eligible_count, 5);
      assert.strictEqual(backfilled.is_streak_qualified, true);
    });

    test('5.2 Report with 0 completions never qualifies for streak', () => {
      const emptyCompletionsReport = {
        total_routines: 3,
        completed_count: 0,
        completion_rate: 0,
        eligible_count: 0,
        cancelled_count: 0,
        is_streak_qualified: false
      };
      const backfilled = simulateReportBackfill(emptyCompletionsReport);
      assert.strictEqual(backfilled.eligible_count, 3);
      assert.strictEqual(backfilled.is_streak_qualified, false);
    });

    test('5.3 Build 11 report where all routines were cancelled (eligible_count=0, cancelled_count=3) is NOT overwritten', () => {
      const cancelledBuild11Report = {
        total_routines: 3,
        completed_count: 0,
        completion_rate: 0,
        eligible_count: 0,
        cancelled_count: 3,
        is_streak_qualified: false
      };
      const result = simulateReportBackfill(cancelledBuild11Report);
      assert.strictEqual(result.eligible_count, 0, 'Must remain 0 because all 3 were cancelled');
      assert.strictEqual(result.is_streak_qualified, false);
    });

    test('5.4 Re-running backfill on already migrated report produces identical result (Idempotency)', () => {
      const migratedReport = {
        total_routines: 5,
        completed_count: 5,
        completion_rate: 100,
        eligible_count: 5,
        cancelled_count: 0,
        is_streak_qualified: true
      };
      const secondRun = simulateReportBackfill(migratedReport);
      assert.deepStrictEqual(secondRun, migratedReport);
    });
  });
});

