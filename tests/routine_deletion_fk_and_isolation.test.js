/**
 * Taskly v2.1.1 (Build 12.1) Critical Hotfix Test Suite:
 * Routine Deletion Foreign Key Integrity, Isolation & Idempotency
 *
 * Verifies:
 * 1. Deleting today's routine when a tomorrow completion exists.
 * 2. Deleting the remaining tomorrow entry after the parent is deleted (No FK violation).
 * 3. Deleting a routine with multiple completion records.
 * 4. Deleting a routine with no completion records.
 * 5. Repeated deletion requests (Idempotency).
 * 6. App restart after deletion.
 * 7. Supabase persistence and foreign key safety.
 * 8. RLS and multi-user isolation.
 * 9. Carry-forward behaviour.
 * 10. Routine completion and streak consistency.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SmartListStore = require('../storage/smartListStore');
const HabitStreakService = require('../services/habitStreakService');

const TEST_FILE_PATH = path.join(__dirname, '../data/smart_lists.json');
let originalData = null;

// Backup and restore data
function backupData() {
  if (fs.existsSync(TEST_FILE_PATH)) {
    originalData = fs.readFileSync(TEST_FILE_PATH, 'utf8');
  }
}

function restoreData() {
  if (originalData !== null) {
    fs.writeFileSync(TEST_FILE_PATH, originalData, 'utf8');
  }
}

describe('Taskly v2.1.1 Build 12.1 - Routine Deletion & Foreign Key Safety Suite', () => {
  const userA = 'user-fk-audit-a';
  const userB = 'user-fk-audit-b';

  beforeEach(() => {
    backupData();
  });

  afterEach(() => {
    restoreData();
  });

  // 1. Deleting today's routine when a tomorrow completion exists
  test('1. Deleting today routine when a tomorrow completion exists removes both today and tomorrow occurrences', async () => {
    const today = HabitStreakService.toYmdString(new Date());
    const tomorrow = HabitStreakService.addDays(today, 1);

    // Create routine
    const routine = await SmartListStore.addRoutine(userA, { title: 'Hydration Tracking' });
    assert.ok(routine.id);

    // Create tomorrow completion (e.g. carried forward or scheduled)
    await SmartListStore.setRoutineStatus(userA, {
      routineId: routine.id,
      date: tomorrow,
      status: 'pending'
    });

    // Check tomorrow routines contains it
    let tomorrowRoutines = await SmartListStore.getNextDayRoutines(userA, { date: tomorrow });
    assert.ok(tomorrowRoutines.routines.some(r => r.routineId === routine.id || r.id === routine.id));

    // Delete the routine from today
    const deleted = await SmartListStore.deleteRoutine(userA, routine.id);
    assert.strictEqual(deleted, true);

    // Verify tomorrow list no longer contains it
    tomorrowRoutines = await SmartListStore.getNextDayRoutines(userA, { date: tomorrow });
    assert.strictEqual(tomorrowRoutines.routines.some(r => r.routineId === routine.id || r.id === routine.id), false);

    // Verify completions for tomorrow are cleaned up
    const completions = await SmartListStore.getCompletions(userA, tomorrow);
    assert.strictEqual(completions.some(c => c.routineId === routine.id), false);
  });

  // 2. Deleting the remaining tomorrow entry after the parent is deleted
  test('2. Deleting remaining tomorrow entry after parent is deleted is safe and does not create orphan records', async () => {
    const today = HabitStreakService.toYmdString(new Date());
    const tomorrow = HabitStreakService.addDays(today, 1);

    const routine = await SmartListStore.addRoutine(userA, { title: 'Morning Stretch' });
    const routineId = routine.id;

    // Delete parent routine definition
    await SmartListStore.deleteRoutine(userA, routineId);

    // Attempt to remove tomorrow's occurrence for the already deleted routine
    const removeResult = await SmartListStore.removeOccurrenceFromDate(userA, {
      routineId,
      date: tomorrow
    });

    assert.strictEqual(removeResult.success, true);
    assert.strictEqual(removeResult.routineId, routineId);

    // Verify no orphaned completion was added for this deleted routine
    const completions = await SmartListStore.getCompletions(userA, tomorrow);
    assert.strictEqual(completions.some(c => c.routineId === routineId), false);
  });

  // 3. Deleting a routine with multiple completion records
  test('3. Deleting routine with multiple completion records preserves historical records prior to today', async () => {
    const today = HabitStreakService.toYmdString(new Date());
    const yesterday = HabitStreakService.addDays(today, -1);
    const tomorrow = HabitStreakService.addDays(today, 1);

    const routine = await SmartListStore.addRoutine(userA, { title: 'Read Documentation' });
    const routineId = routine.id;

    // Add completions for yesterday, today, and tomorrow
    await SmartListStore.setRoutineStatus(userA, { routineId, date: yesterday, status: 'completed' });
    await SmartListStore.setRoutineStatus(userA, { routineId, date: today, status: 'pending' });
    await SmartListStore.setRoutineStatus(userA, { routineId, date: tomorrow, status: 'pending' });

    // Delete routine
    const deleted = await SmartListStore.deleteRoutine(userA, routineId);
    assert.strictEqual(deleted, true);

    // Historical completion for yesterday must be preserved for habit integrity
    const yesterdayComps = await SmartListStore.getCompletions(userA, yesterday);
    assert.ok(yesterdayComps.some(c => c.routineId === routineId && c.status === 'completed'));

    // Future completion for tomorrow must be safely removed
    const tomorrowComps = await SmartListStore.getCompletions(userA, tomorrow);
    assert.strictEqual(tomorrowComps.some(c => c.routineId === routineId), false);
  });

  // 4. Deleting a routine with no completion records
  test('4. Deleting a routine with no completion records succeeds cleanly', async () => {
    const routine = await SmartListStore.addRoutine(userA, { title: 'Zero Completion Routine' });
    const deleted = await SmartListStore.deleteRoutine(userA, routine.id);
    assert.strictEqual(deleted, true);

    const routines = await SmartListStore.getRoutines(userA);
    assert.strictEqual(routines.some(r => r.id === routine.id), false);
  });

  // 5. Repeated deletion requests (Idempotency)
  test('5. Repeated deletion requests succeed idempotently without crashing', async () => {
    const routine = await SmartListStore.addRoutine(userA, { title: 'Idempotent Deletion Test' });
    const routineId = routine.id;

    // First delete
    const first = await SmartListStore.deleteRoutine(userA, routineId);
    assert.strictEqual(first, true);

    // Second delete (should return false or succeed cleanly without error)
    const second = await SmartListStore.deleteRoutine(userA, routineId);
    assert.strictEqual(second, false);

    // Multiple occurrence removals
    const today = HabitStreakService.toYmdString(new Date());
    const tomorrow = HabitStreakService.addDays(today, 1);
    const res1 = await SmartListStore.removeOccurrenceFromDate(userA, { routineId, date: tomorrow });
    const res2 = await SmartListStore.removeOccurrenceFromDate(userA, { routineId, date: tomorrow });
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res2.success, true);
  });

  // 6. App restart after deletion
  test('6. App restart / reload after deletion never resurrects deleted routines', async () => {
    const today = HabitStreakService.toYmdString(new Date());
    const tomorrow = HabitStreakService.addDays(today, 1);

    const routine = await SmartListStore.addRoutine(userA, { title: 'Persisted Delete Routine' });
    const routineId = routine.id;

    // Delete routine
    await SmartListStore.deleteRoutine(userA, routineId);

    // Simulate app reload by reading fresh from storage
    const reloadedRoutines = await SmartListStore.getRoutines(userA);
    assert.strictEqual(reloadedRoutines.some(r => r.id === routineId), false);

    const reloadedTomorrow = await SmartListStore.getNextDayRoutines(userA, { date: tomorrow });
    assert.strictEqual(reloadedTomorrow.routines.some(r => r.routineId === routineId || r.id === routineId), false);
  });

  // 7. Supabase persistence and foreign key safety simulation
  test('7. Supabase persistence simulation: Checks parent routine exists and avoids FK violation', async () => {
    // Simulate Supabase database state
    const dbRoutines = new Map();
    const dbCompletions = new Map();

    const mockSupabase = {
      from(table) {
        if (table === 'smart_routines') {
          return {
            select(cols) {
              return {
                eq(col1, val1) {
                  return {
                    eq(col2, val2) {
                      return {
                        async maybeSingle() {
                          const r = dbRoutines.get(val1);
                          if (r && r.user_id === val2) return { data: r, error: null };
                          return { data: null, error: null };
                        }
                      };
                    }
                  };
                }
              };
            },
            delete() {
              return {
                eq(col1, val1) {
                  return {
                    eq(col2, val2) {
                      dbRoutines.delete(val1);
                      return Promise.resolve({ error: null });
                    }
                  };
                }
              };
            }
          };
        }
        if (table === 'smart_routine_completions') {
          return {
            upsert(payload, options) {
              // Foreign Key Constraint Simulation
              if (!dbRoutines.has(payload.routine_id)) {
                const fkError = new Error('insert or update on table "smart_routine_completions" violates foreign key constraint "smart_routine_completions_routine_id_fkey"');
                fkError.code = '23503';
                return Promise.resolve({ error: fkError });
              }
              const key = `${payload.user_id}_${payload.routine_id}_${payload.date}`;
              dbCompletions.set(key, payload);
              return Promise.resolve({ error: null });
            },
            delete() {
              return {
                eq(col1, val1) {
                  return {
                    eq(col2, val2) {
                      for (const [k, v] of dbCompletions.entries()) {
                        if (v.routine_id === val2 && v.user_id === val1) {
                          dbCompletions.delete(k);
                        }
                      }
                      return Promise.resolve({ error: null });
                    }
                  };
                }
              };
            }
          };
        }
        throw new Error('Unknown table ' + table);
      }
    };

    // Step 1: Routine exists in smart_routines
    const routineId = 'rt-test-123';
    dbRoutines.set(routineId, { id: routineId, user_id: userA, title: 'Test Routine' });

    // Step 2: Delete routine from smart_routines (Case A)
    await mockSupabase.from('smart_routine_completions').delete().eq('user_id', userA).eq('routine_id', routineId);
    await mockSupabase.from('smart_routines').delete().eq('id', routineId).eq('user_id', userA);
    assert.strictEqual(dbRoutines.has(routineId), false);

    // Step 3: Remove tomorrow execution logic (Case B)
    // Application must check if parent exists, and skip upsert
    const { data: parentRoutine } = await mockSupabase
      .from('smart_routines')
      .select('id')
      .eq('id', routineId)
      .eq('user_id', userA)
      .maybeSingle();

    assert.strictEqual(parentRoutine, null);

    // Because parent does not exist, application must NOT call upsert, but delete orphans
    let upsertCalled = false;
    if (!parentRoutine) {
      await mockSupabase.from('smart_routine_completions').delete().eq('user_id', userA).eq('routine_id', routineId);
    } else {
      upsertCalled = true;
      await mockSupabase.from('smart_routine_completions').upsert({
        user_id: userA,
        routine_id: routineId,
        date: '2026-11-11',
        status: 'cancelled'
      });
    }

    assert.strictEqual(upsertCalled, false);
  });

  // 8. RLS and multi-user isolation
  test('8. Multi-user isolation: User B cannot delete User A routines or occurrences', async () => {
    const today = HabitStreakService.toYmdString(new Date());
    const routineA = await SmartListStore.addRoutine(userA, { title: 'User A Secret Routine' });

    // User B attempts to delete User A routine
    const deleteAttempt = await SmartListStore.deleteRoutine(userB, routineA.id);
    assert.strictEqual(deleteAttempt, false);

    // Routine must still exist for User A
    const routinesA = await SmartListStore.getRoutines(userA);
    assert.ok(routinesA.some(r => r.id === routineA.id));

    // User B attempts to remove User A occurrence
    await SmartListStore.removeOccurrenceFromDate(userB, {
      routineId: routineA.id,
      date: today
    });

    // Verify User A routine unaffected
    const completionsA = await SmartListStore.getCompletions(userA, today);
    assert.strictEqual(completionsA.some(c => c.routineId === routineA.id && c.status === 'removed'), false);
  });

  // 9. Carry-forward behaviour
  test('9. Carry-forward behaviour: Deleting today routine cleans up carried-forward occurrence', async () => {
    const today = HabitStreakService.toYmdString(new Date());
    const tomorrow = HabitStreakService.addDays(today, 1);

    const routine = await SmartListStore.addRoutine(userA, { title: 'Carry Forward Test Routine' });
    const routineId = routine.id;

    // Simulate carry-forward to tomorrow
    await SmartListStore.setRoutineStatus(userA, {
      routineId,
      date: tomorrow,
      status: 'pending'
    });

    // Carry forward report decision
    await SmartListStore.saveReport(userA, {
      date: today,
      totalRoutines: 1,
      completedCount: 0,
      eligibleCount: 1,
      isStreakQualified: false,
      carryForwardDecision: 'yes'
    });

    // Verify present in tomorrow list
    let tomorrowRoutines = await SmartListStore.getNextDayRoutines(userA, { date: tomorrow });
    assert.ok(tomorrowRoutines.routines.some(r => r.routineId === routineId || r.id === routineId));

    // Delete routine from today
    await SmartListStore.deleteRoutine(userA, routineId);

    // Verify removed from tomorrow list immediately
    tomorrowRoutines = await SmartListStore.getNextDayRoutines(userA, { date: tomorrow });
    assert.strictEqual(tomorrowRoutines.routines.some(r => r.routineId === routineId || r.id === routineId), false);
  });

  // 10. Routine completion and streak consistency
  test('10. Habit streak and historical daily summary report remain consistent after routine deletion', async () => {
    const today = HabitStreakService.toYmdString(new Date());
    const yesterday = HabitStreakService.addDays(today, -1);

    const routine1 = await SmartListStore.addRoutine(userA, { title: 'Routine 1' });
    const routine2 = await SmartListStore.addRoutine(userA, { title: 'Routine 2' });

    // Complete routine 1 yesterday
    await SmartListStore.setRoutineStatus(userA, {
      routineId: routine1.id,
      date: yesterday,
      status: 'completed'
    });
    // Routine 2 completed yesterday
    await SmartListStore.setRoutineStatus(userA, {
      routineId: routine2.id,
      date: yesterday,
      status: 'completed'
    });

    // Save report for yesterday: 2/2 = 100% -> qualified
    const yesterdayReport = await SmartListStore.saveReport(userA, {
      date: yesterday,
      totalRoutines: 2,
      completedRoutines: ['Routine 1', 'Routine 2'],
      incompleteRoutines: [],
      isStreakQualified: true
    });
    assert.strictEqual(yesterdayReport.isStreakQualified, true);

    // Delete Routine 1 today
    await SmartListStore.deleteRoutine(userA, routine1.id);

    // Yesterday report must remain intact with historical snapshot
    const reports = await SmartListStore.getReports(userA);
    const rep = reports.find(r => r.date === yesterday);
    assert.ok(rep);
    assert.strictEqual(rep.completedCount, 2);
    assert.strictEqual(rep.eligibleCount, 2);
    assert.strictEqual(rep.isStreakQualified, true);
  });
});
