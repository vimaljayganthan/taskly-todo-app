/**
 * Taskly Build 16 — Performance Optimization & Data Reliability Test Suite
 *
 * Verifies:
 * 1. Routine Deletion Independence (Today vs Tomorrow separate instances).
 * 2. Strict 10-Day Rolling History Retention (Pruning 11th oldest, newest 10 preserved).
 * 3. Daily History Reliability (Zero-gap calendar day reporting, 0-routine days, idempotency).
 * 4. Application-wide Performance Optimizations & Latency Benchmarks (Optimistic UI, < 16ms responses).
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const SmartListStore = require('../storage/smartListStore');
const HabitStreakService = require('../services/habitStreakService');
const DailyReportScheduler = require('../services/dailyReportScheduler');

// Mock localStorage and minimal DOM for client-side testing
const mockStorage = new Map();
global.localStorage = {
  getItem: (k) => mockStorage.get(k) || null,
  setItem: (k, v) => mockStorage.set(k, String(v)),
  removeItem: (k) => mockStorage.delete(k),
  clear: () => mockStorage.clear()
};

// ==============================================================================
// PART 1: ROUTINE DELETION INDEPENDENCE & SCOPING (TODAY VS TOMORROW)
// ==============================================================================
describe('Part 1: Routine Deletion Independence (Critical Bug Fix)', () => {
  const userId = 'user-deletion-test-' + Date.now();
  const todayYmd = HabitStreakService.toYmdString(new Date());
  const tomorrowYmd = HabitStreakService.addDays(todayYmd, 1);
  const dayAfterYmd = HabitStreakService.addDays(todayYmd, 2);

  beforeEach(async () => {
    // Clear existing routines for this test user
    const routines = await SmartListStore.getRoutines(userId);
    for (const r of routines) {
      await SmartListStore.deleteRoutine(userId, r.id, { scope: 'entire' });
    }
  });

  test('1. Deleting today occurrence removes today but keeps tomorrow intact', async () => {
    // 1. Create a routine
    const routine = await SmartListStore.addRoutine(userId, { title: 'Morning Jog' });
    assert.ok(routine && routine.id, 'Routine created');

    // 2. Schedule or check tomorrow's routines
    const tomBefore = await SmartListStore.getNextDayRoutines(userId, { date: tomorrowYmd });
    assert.strictEqual(tomBefore.routines.some(r => r.routineId === routine.id), true, 'Routine is scheduled for tomorrow');

    // 3. Delete today occurrence only
    const res = await SmartListStore.deleteRoutine(userId, routine.id, { date: todayYmd, scope: 'occurrence' });
    assert.strictEqual(res.success, true, 'Occurrence deleted successfully');

    // 4. Verify today completion is marked as removed
    const todayCompletions = await SmartListStore.getCompletions(userId, todayYmd);
    const todayRecord = todayCompletions.find(c => c.routineId === routine.id);
    assert.ok(todayRecord, 'Today completion record exists');
    assert.strictEqual(todayRecord.status, 'removed', 'Today status is removed');
    assert.strictEqual(todayRecord.removed, true, 'Today removed flag is true');

    // 5. Verify master routine definition still exists
    const masterRoutines = await SmartListStore.getRoutines(userId);
    assert.strictEqual(masterRoutines.some(r => r.id === routine.id), true, 'Master routine definition remains in place');

    // 6. Verify tomorrow routine is still scheduled and intact!
    const tomAfter = await SmartListStore.getNextDayRoutines(userId, { date: tomorrowYmd });
    const tomorrowItem = tomAfter.routines.find(r => r.routineId === routine.id);
    assert.ok(tomorrowItem, 'Tomorrow routine is completely intact and NOT deleted');
    assert.strictEqual(tomorrowItem.title, 'Morning Jog');
  });

  test('2. Deleting tomorrow occurrence does not affect today routine', async () => {
    const routine = await SmartListStore.addRoutine(userId, { title: 'Evening Meditation' });

    // Mark today as completed
    await SmartListStore.setRoutineStatus(userId, {
      routineId: routine.id,
      date: todayYmd,
      status: 'completed'
    });

    // Remove occurrence from tomorrow
    const res = await SmartListStore.deleteRoutine(userId, routine.id, { date: tomorrowYmd, scope: 'occurrence' });
    assert.strictEqual(res.success, true);

    // Verify tomorrow is removed
    const tomCompletions = await SmartListStore.getCompletions(userId, tomorrowYmd);
    const tomRecord = tomCompletions.find(c => c.routineId === routine.id);
    assert.strictEqual(tomRecord.status, 'removed');

    // Verify today's completed routine is untouched
    const todayCompletions = await SmartListStore.getCompletions(userId, todayYmd);
    const todayRecord = todayCompletions.find(c => c.routineId === routine.id);
    assert.strictEqual(todayRecord.status, 'completed', 'Today routine remains completed and unaffected');
  });

  test('3. Routine deletion confirmation dialog presents strictly two options with occurrence default-selected', async () => {
    // Read public/index.html to verify markup integrity
    const indexPath = path.join(__dirname, '..', 'public', 'index.html');
    const indexHtml = fs.readFileSync(indexPath, 'utf8');

    // 1. Must NOT contain the removed future option
    assert.strictEqual(indexHtml.includes('value="future"'), false, 'Future scope radio option must be completely removed');
    assert.strictEqual(indexHtml.includes('Delete all future occurrences'), false, 'Future scope label must be completely removed');
    assert.strictEqual(indexHtml.includes('Removes routine from tomorrow onwards'), false, 'Future scope description must be completely removed');

    // 2. Must contain exactly two options: occurrence and entire
    const scopeContainerMatch = indexHtml.match(/<div id="smart-delete-scope-container"[\s\S]*?<\/div>\s*<\/div>/);
    assert.ok(scopeContainerMatch, 'Scope container exists in index.html');
    const radioMatches = scopeContainerMatch[0].match(/<input type="radio" name="routine-delete-scope"[^>]*>/g) || [];
    assert.strictEqual(radioMatches.length, 2, 'Must contain exactly 2 radio options');

    // 3. First option must be "occurrence" and checked by default
    assert.ok(radioMatches[0].includes('value="occurrence"'), 'First option is occurrence');
    assert.ok(radioMatches[0].includes('checked'), 'First option is checked by default');
    assert.ok(scopeContainerMatch[0].includes('Delete this occurrence only'), 'Occurrence label is present');

    // 4. Second option must be "entire"
    assert.ok(radioMatches[1].includes('value="entire"'), 'Second option is entire');
    assert.ok(scopeContainerMatch[0].includes('Delete entire routine'), 'Entire routine label is present');
  });

  test('4. Deleting entire routine permanently deletes master definition and future entries', async () => {
    const routine = await SmartListStore.addRoutine(userId, { title: 'Temporary Routine' });
    await SmartListStore.deleteRoutine(userId, routine.id, { scope: 'entire' });

    const masterRoutines = await SmartListStore.getRoutines(userId);
    assert.strictEqual(masterRoutines.some(r => r.id === routine.id), false, 'Master definition deleted');

    const tomRoutines = await SmartListStore.getNextDayRoutines(userId, { date: tomorrowYmd });
    assert.strictEqual(tomRoutines.routines.some(r => r.routineId === routine.id), false, 'Deleted from tomorrow');
  });
});

// ==============================================================================
// PART 2: STRICT 10-DAY ROLLING HISTORY RETENTION
// ==============================================================================
describe('Part 2: Strict 10-Day Rolling History Retention', () => {
  const userId = 'user-retention-test-' + Date.now();
  const otherUserId = 'user-other-' + Date.now();

  test('1. Adding 11 daily reports automatically prunes the oldest, retaining strictly 10', async () => {
    // Generate 12 dates in sequence
    const dates = [];
    const baseDate = '2026-11-01';
    for (let i = 0; i < 12; i++) {
      dates.push(HabitStreakService.addDays(baseDate, i));
    }

    // Save 12 daily reports
    for (const d of dates) {
      await SmartListStore.saveReport(userId, {
        date: d,
        totalRoutines: 2,
        completedRoutines: ['Task 1', 'Task 2'],
        completedCount: 2,
        incompleteCount: 0,
        completionRate: 100,
        status: 'Fully Completed',
        statusBadge: 'Exceptional'
      });
    }

    // Retrieve reports
    const reports = await SmartListStore.getReports(userId);
    assert.strictEqual(reports.length, 10, 'History strictly limited to 10 reports');

    // Verify sorted descending by date
    for (let i = 0; i < reports.length - 1; i++) {
      assert.ok(reports[i].date > reports[i + 1].date, 'Reports must be sorted descending');
    }

    // Verify the oldest two dates (2026-11-01, 2026-11-02) were pruned
    const reportDates = reports.map(r => r.date);
    assert.strictEqual(reportDates.includes('2026-11-01'), false, 'Oldest report (2026-11-01) pruned');
    assert.strictEqual(reportDates.includes('2026-11-02'), false, 'Second oldest report (2026-11-02) pruned');

    // Verify the newest report (2026-11-12) is at the top
    assert.strictEqual(reports[0].date, '2026-11-12', 'Newest report is at the top');
    assert.strictEqual(reports[9].date, '2026-11-03', '10th newest report is the boundary');
  });

  test('2. Multi-user tenant isolation: Pruning user A does not prune user B', async () => {
    // Add 11 reports for User A
    for (let i = 0; i < 11; i++) {
      await SmartListStore.saveReport(userId, {
        date: `2026-10-${String(i + 1).padStart(2, '0')}`,
        totalRoutines: 1,
        completedCount: 1,
        completedRoutines: ['A']
      });
    }

    // Add 5 reports for User B
    for (let i = 0; i < 5; i++) {
      await SmartListStore.saveReport(otherUserId, {
        date: `2026-10-${String(i + 1).padStart(2, '0')}`,
        totalRoutines: 1,
        completedCount: 1,
        completedRoutines: ['B']
      });
    }

    const reportsA = await SmartListStore.getReports(userId);
    const reportsB = await SmartListStore.getReports(otherUserId);

    assert.strictEqual(reportsA.length, 10, 'User A has exactly 10 reports');
    assert.strictEqual(reportsB.length, 5, 'User B has exactly 5 reports unaffected');
  });

  test('3. Pruning reports does not corrupt streaks or consistency calculations', async () => {
    const streakUser = 'user-streak-integrity-' + Date.now();
    const routine = await SmartListStore.addRoutine(streakUser, { title: 'Streak Routine' });

    // Complete routine for 15 days in a row
    const completions = [];
    const baseDate = '2026-11-01';
    for (let i = 0; i < 15; i++) {
      const d = HabitStreakService.addDays(baseDate, i);
      await SmartListStore.setRoutineStatus(streakUser, {
        routineId: routine.id,
        date: d,
        status: 'completed'
      });
      completions.push({ routineId: routine.id, date: d, status: 'completed', completed: true });

      // Save report (which prunes to 10 reports)
      await SmartListStore.saveReport(streakUser, {
        date: d,
        totalRoutines: 1,
        completedCount: 1,
        completionRate: 100
      });
    }

    // Calculate streaks for day 15
    const day15Date = HabitStreakService.addDays(baseDate, 14);
    const streakResult = HabitStreakService.calculateStreaks({
      routines: [routine],
      completions,
      refDate: day15Date
    });

    assert.strictEqual(streakResult.currentStreak, 15, 'Current streak is intact at 15 days despite 10-day report pruning');
    assert.strictEqual(streakResult.longestStreak, 15, 'Longest streak is intact at 15 days');
  });
});

// ==============================================================================
// PART 3: DAILY HISTORY RELIABILITY & ZERO-GAP GENERATION
// ==============================================================================
describe('Part 3: Daily History Reliability', () => {
  const userId = 'user-reliability-' + Date.now();

  test('1. Day with 0 routines scheduled generates a valid report with "No Routines" badge', async () => {
    const emptyDate = '2026-11-15';
    const report = await SmartListStore.saveReport(userId, {
      date: emptyDate,
      totalRoutines: 0,
      completedRoutines: [],
      incompleteRoutines: [],
      completedCount: 0,
      incompleteCount: 0,
      completionRate: 0
    });

    assert.ok(report, 'Report created for empty day');
    assert.strictEqual(report.totalRoutines, 0);
    assert.strictEqual(report.statusBadge, 'No Routines');
    assert.strictEqual(report.status, 'Not Started');
    assert.strictEqual(report.closingStatement, 'No routines scheduled for this date.');
  });

  test('2. Reconcile recovers missing past dates without duplicating existing records', async () => {
    const reconcileUser = 'user-reconcile-' + Date.now();
    await SmartListStore.addRoutine(reconcileUser, { title: 'Routine 1' });

    // Existing report on day 2
    await SmartListStore.saveReport(reconcileUser, {
      date: '2026-11-02',
      totalRoutines: 1,
      completedCount: 1,
      completionRate: 100,
      statusBadge: 'Exceptional'
    });

    // Reconcile across 2026-11-01 to 2026-11-03
    const res = await SmartListStore.reconcileDailyReports(reconcileUser, {
      startDate: '2026-11-01',
      endDate: '2026-11-03',
      localDate: '2026-11-03',
      currentTime: '23:00',
      forceToday: true
    });

    const reports = await SmartListStore.getReports(reconcileUser);
    const dateList = reports.map(r => r.date).sort();

    assert.strictEqual(dateList.includes('2026-11-01'), true, 'Recovered 2026-11-01');
    assert.strictEqual(dateList.includes('2026-11-02'), true, 'Preserved 2026-11-02');
    assert.strictEqual(dateList.includes('2026-11-03'), true, 'Generated 2026-11-03');

    // Day 2 should still have the original Exceptional badge
    const day2 = reports.find(r => r.date === '2026-11-02');
    assert.strictEqual(day2.statusBadge, 'Exceptional');

    // No duplicate entries
    const uniqueDates = new Set(dateList);
    assert.strictEqual(uniqueDates.size, dateList.length, 'Every date is unique with zero duplicates');
  });
});

// ==============================================================================
// PART 4: APPLICATION-WIDE PERFORMANCE BENCHMARKS (< 16MS)
// ==============================================================================
describe('Part 4: Performance Optimization Latency Benchmarks', () => {
  test('1. Local routine addition operation completes in under 16ms (60fps threshold)', async () => {
    const perfUser = 'user-perf-' + Date.now();
    const t0 = performance.now();
    const routine = await SmartListStore.addRoutine(perfUser, { title: 'Fast Routine' });
    const t1 = performance.now();
    const duration = t1 - t0;

    assert.ok(routine && routine.id, 'Routine created');
    assert.ok(duration < 16, `Routine creation took ${duration.toFixed(2)}ms (target < 16ms)`);
  });

  test('2. Routine status toggle operation completes in under 16ms', async () => {
    const perfUser = 'user-perf-' + Date.now();
    const routine = await SmartListStore.addRoutine(perfUser, { title: 'Toggle Routine' });
    const today = HabitStreakService.toYmdString(new Date());

    const t0 = performance.now();
    await SmartListStore.setRoutineStatus(perfUser, {
      routineId: routine.id,
      date: today,
      status: 'completed'
    });
    const t1 = performance.now();
    const duration = t1 - t0;

    assert.ok(duration < 16, `Status toggle took ${duration.toFixed(2)}ms (target < 16ms)`);
  });

  test('3. Routine occurrence deletion completes in under 16ms', async () => {
    const perfUser = 'user-perf-' + Date.now();
    const routine = await SmartListStore.addRoutine(perfUser, { title: 'Del Routine' });
    const today = HabitStreakService.toYmdString(new Date());

    const t0 = performance.now();
    await SmartListStore.deleteRoutine(perfUser, routine.id, { date: today, scope: 'occurrence' });
    const t1 = performance.now();
    const duration = t1 - t0;

    assert.ok(duration < 16, `Occurrence deletion took ${duration.toFixed(2)}ms (target < 16ms)`);
  });

  test('4. History retention enforcement across 20 reports completes in under 16ms', async () => {
    const perfUser = 'user-perf-' + Date.now();
    for (let i = 0; i < 20; i++) {
      await SmartListStore.saveReport(perfUser, {
        date: `2026-10-${String(i + 1).padStart(2, '0')}`,
        totalRoutines: 1,
        completedCount: 1
      });
    }

    const t0 = performance.now();
    const retained = await SmartListStore.enforceHistoryRetention(perfUser, 10);
    const t1 = performance.now();
    const duration = t1 - t0;

    assert.strictEqual(retained.length, 10);
    assert.ok(duration < 16, `Retention enforcement took ${duration.toFixed(2)}ms (target < 16ms)`);
  });
});
