/**
 * Taskly v2.0.0 Build 11 - Smart Lists Carry-Forward, Next-Day Routine Management,
 * Habit Streak Reset & Update Notifications Automated Test Suite
 *
 * Verifies:
 * PART 1: Daily Routine Summary — Carry-Forward Decision ('yes' vs 'no')
 * PART 2: Next-Day Routine Management & Occurrence Isolation
 * PART 3: Habit Streak Counters Breakdown & Undo Cancellation
 * PART 4: Streak Reset Operation & Historical/Todo Analytics Preservation
 * PART 5: App Update Notification & Announcement Guards
 */

process.env.NODE_ENV = 'development';
const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('events');

const app = require('../server');
const SmartListStore = require('../storage/smartListStore');
const HabitStreakService = require('../services/habitStreakService');
const { setStorage, FileStorageAdapter } = require('../storage/taskStore');

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');
const STYLES_CSS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), 'utf8');
const APP_JS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'app.js'), 'utf8');
const MIGRATION_004 = fs.readFileSync(path.join(ROOT_DIR, 'scripts', '004_streak_reset_and_carry_forward.sql'), 'utf8');

const USER_ALICE = 'usr-alice-carry-test';
const USER_BOB = 'usr-bob-carry-test';

// In-memory HTTP dispatcher for Express endpoints
function mockRequest(options) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = (options.method || 'GET').toUpperCase();
    req.url = options.url || '/';
    req.headers = Object.assign({
      'content-type': 'application/json',
      'authorization': `Bearer mock-user:${options.userId || USER_ALICE}:test@taskly.app`
    }, options.headers || {});
    if (options.noAuth) {
      delete req.headers.authorization;
    }
    req.body = options.body;

    const res = new EventEmitter();
    res.statusCode = 200;
    res._headers = {};
    res.setHeader = (k, v) => { res._headers[k.toLowerCase()] = v; };
    res.getHeader = (k) => res._headers[k.toLowerCase()];
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => {
      res.body = data;
      resolve({ statusCode: res.statusCode, headers: res._headers, body: data });
    };
    res.send = (data) => {
      res.body = data;
      resolve({ statusCode: res.statusCode, headers: res._headers, body: data });
    };
    res.end = () => {
      resolve({ statusCode: res.statusCode, headers: res._headers, body: res.body });
    };

    try {
      app.handle(req, res, (err) => {
        if (err) reject(err);
        else resolve({ statusCode: 404, headers: {}, body: { error: 'Not Found' } });
      });
    } catch (e) {
      reject(e);
    }
  });
}

describe('Taskly v2.0.0 Build 11 — Carry-Forward, Next-Day & Streak Reset Verification', () => {

  beforeEach(async () => {
    SmartListStore.__resetForTests();
    const testDataDir = path.join(ROOT_DIR, 'data', 'test-data-carry');
    if (!fs.existsSync(testDataDir)) fs.mkdirSync(testDataDir, { recursive: true });
    setStorage(new FileStorageAdapter(path.join(testDataDir, 'todos.json')));
  });

  after(() => {
    const testDataDir = path.join(ROOT_DIR, 'data', 'test-data-carry');
    try {
      if (fs.existsSync(testDataDir)) {
        fs.rmSync(testDataDir, { recursive: true, force: true });
      }
    } catch (e) {}
  });

  // ==========================================================================
  // PART 1: Carry-Forward Decision
  // ==========================================================================
  describe('PART 1: Carry-Forward Decision Backend & Storage', () => {
    test('1.1 "Yes, carry forward" carries incomplete routines to next day as pending', async () => {
      const today = '2026-11-10';
      const tomorrow = '2026-11-11';

      const r1 = await SmartListStore.addRoutine(USER_ALICE, { title: 'Drink Water' });
      const r2 = await SmartListStore.addRoutine(USER_ALICE, { title: 'Read Book' });
      const r3 = await SmartListStore.addRoutine(USER_ALICE, { title: 'Exercise' });

      // r1 completed, r2 pending, r3 postponed
      await SmartListStore.setRoutineStatus(USER_ALICE, { routineId: r1.id, date: today, status: 'completed' });

      const carryRes = await SmartListStore.carryForward(USER_ALICE, { date: today, decision: 'yes' });
      assert.strictEqual(carryRes.success, true);
      assert.strictEqual(carryRes.decision, 'yes');
      assert.strictEqual(carryRes.nextDay, tomorrow);
      assert.strictEqual(carryRes.carriedCount, 2); // r2 and r3

      // Original occurrences must be marked postponed to tomorrow
      const compsToday = await SmartListStore.getCompletions(USER_ALICE, today);
      const c1Today = compsToday.find(c => c.routineId === r1.id);
      const c2Today = compsToday.find(c => c.routineId === r2.id);
      const c3Today = compsToday.find(c => c.routineId === r3.id);

      assert.strictEqual(c1Today.status, 'completed');
      assert.strictEqual(c2Today.status, 'postponed');
      assert.strictEqual(c2Today.postponedTo, tomorrow);
      assert.strictEqual(c3Today.status, 'postponed');
      assert.strictEqual(c3Today.postponedTo, tomorrow);

      // Tomorrow occurrences must be pending and carriedForward: true
      const compsTom = await SmartListStore.getCompletions(USER_ALICE, tomorrow);
      const c2Tom = compsTom.find(c => c.routineId === r2.id);
      const c3Tom = compsTom.find(c => c.routineId === r3.id);

      assert.ok(c2Tom, 'r2 must exist on tomorrow');
      assert.strictEqual(c2Tom.status, 'pending');
      assert.strictEqual(c2Tom.carriedForward, true);
      assert.strictEqual(c2Tom.originalDate, today);

      assert.ok(c3Tom, 'r3 must exist on tomorrow');
      assert.strictEqual(c3Tom.status, 'pending');
      assert.strictEqual(c3Tom.carriedForward, true);
      assert.strictEqual(c3Tom.originalDate, today);
    });

    test('1.2 "No, finish today\'s list" preserves incomplete status and does not create next-day occurrences', async () => {
      const today = '2026-11-10';
      const tomorrow = '2026-11-11';

      const r1 = await SmartListStore.addRoutine(USER_ALICE, { title: 'Evening Walk' });
      const carryRes = await SmartListStore.carryForward(USER_ALICE, { date: today, decision: 'no' });

      assert.strictEqual(carryRes.success, true);
      assert.strictEqual(carryRes.decision, 'no');
      assert.strictEqual(carryRes.carriedCount, 0);

      // Tomorrow should have no completions created
      const compsTom = await SmartListStore.getCompletions(USER_ALICE, tomorrow);
      assert.strictEqual(compsTom.length, 0);

      // Original report persists decision
      const report = await SmartListStore.getReport(USER_ALICE, today);
      assert.strictEqual(report.carryForwardDecision, 'no');
    });

    test('1.3 Repeated carry-forward taps prevent duplicate next-day occurrences', async () => {
      const today = '2026-11-10';
      const tomorrow = '2026-11-11';

      const r1 = await SmartListStore.addRoutine(USER_ALICE, { title: 'Meditation' });

      // First carry-forward
      await SmartListStore.carryForward(USER_ALICE, { date: today, decision: 'yes' });
      // Second carry-forward (user double-tapped or reopened)
      await SmartListStore.carryForward(USER_ALICE, { date: today, decision: 'yes' });

      const compsTom = await SmartListStore.getCompletions(USER_ALICE, tomorrow);
      const occurrences = compsTom.filter(c => c.routineId === r1.id);
      assert.strictEqual(occurrences.length, 1, 'Never duplicate next-day completion records');
    });

    test('1.4 API POST /api/smart-lists/carry-forward handles validation & returns report', async () => {
      const today = '2026-11-10';
      await SmartListStore.addRoutine(USER_ALICE, { title: 'Journaling' });

      const resMissing = await mockRequest({
        method: 'POST',
        url: '/api/smart-lists/carry-forward',
        body: { date: today }
      });
      assert.strictEqual(resMissing.statusCode, 400);

      const resSuccess = await mockRequest({
        method: 'POST',
        url: '/api/smart-lists/carry-forward',
        body: { date: today, decision: 'yes' }
      });
      assert.strictEqual(resSuccess.statusCode, 200);
      assert.strictEqual(resSuccess.body.success, true);
      assert.ok(resSuccess.body.report);
      assert.strictEqual(resSuccess.body.report.carryForwardDecision, 'yes');
    });
  });

  // ==========================================================================
  // PART 2: Next-Day Routine Management
  // ==========================================================================
  describe('PART 2: Next-Day Routine Management', () => {
    test('2.1 getNextDayRoutines distinguishes carried-forward vs scheduled routines', async () => {
      const today = '2026-11-10';
      const tomorrow = '2026-11-11';

      const r1 = await SmartListStore.addRoutine(USER_ALICE, { title: 'Routine One' });
      const r2 = await SmartListStore.addRoutine(USER_ALICE, { title: 'Routine Two' });

      // r2 completed today, r1 left incomplete
      await SmartListStore.setRoutineStatus(USER_ALICE, { routineId: r2.id, date: today, status: 'completed' });

      // Carry incomplete routines (r1) from today
      await SmartListStore.carryForward(USER_ALICE, { date: today, decision: 'yes' });

      // Query tomorrow
      const nextDay = await SmartListStore.getNextDayRoutines(USER_ALICE, { date: tomorrow });
      assert.strictEqual(nextDay.date, tomorrow);
      assert.strictEqual(nextDay.totalCount, 2);

      const item1 = nextDay.routines.find(r => r.routineId === r1.id);
      const item2 = nextDay.routines.find(r => r.routineId === r2.id);

      assert.strictEqual(item1.carriedForward, true);
      assert.strictEqual(item1.source, 'carried_forward');
      assert.strictEqual(item1.originalDate, today);

      assert.strictEqual(item2.carriedForward, false);
      assert.strictEqual(item2.source, 'scheduled');
    });

    test('2.2 assignRoutineToDate creates new routine directly for tomorrow', async () => {
      const tomorrow = '2026-11-11';
      const assignRes = await SmartListStore.assignRoutineToDate(USER_ALICE, {
        title: 'Call Dentist',
        date: tomorrow
      });

      assert.ok(assignRes.routine);
      assert.strictEqual(assignRes.routine.title, 'Call Dentist');
      assert.strictEqual(assignRes.occurrence.date, tomorrow);
      assert.strictEqual(assignRes.occurrence.status, 'pending');

      const nextDay = await SmartListStore.getNextDayRoutines(USER_ALICE, { date: tomorrow });
      const found = nextDay.routines.find(r => r.title === 'Call Dentist');
      assert.ok(found);
      assert.strictEqual(found.status, 'pending');
    });

    test('2.3 removeOccurrenceFromDate removes occurrence without deleting recurring definition', async () => {
      const tomorrow = '2026-11-11';
      const r = await SmartListStore.addRoutine(USER_ALICE, { title: 'Daily Vitamin' });

      // Remove from tomorrow only
      const remRes = await SmartListStore.removeOccurrenceFromDate(USER_ALICE, {
        routineId: r.id,
        date: tomorrow
      });
      assert.strictEqual(remRes.success, true);

      // Tomorrow list must no longer show it
      const nextDay = await SmartListStore.getNextDayRoutines(USER_ALICE, { date: tomorrow });
      const foundInTom = nextDay.routines.find(item => item.routineId === r.id);
      assert.strictEqual(foundInTom, undefined, 'Occurrence must be omitted from tomorrow');

      // Recurring routine definition in routines store must remain intact!
      const allRoutines = await SmartListStore.getRoutines(USER_ALICE);
      const defFound = allRoutines.find(item => item.id === r.id);
      assert.ok(defFound, 'Recurring routine definition must NOT be deleted');
      assert.strictEqual(defFound.deletedAt, null);
    });

    test('2.4 API endpoints for next-day routines: GET, POST assign, DELETE occurrence', async () => {
      const tomorrow = '2026-11-11';

      // 1. Assign via API
      const postRes = await mockRequest({
        method: 'POST',
        url: '/api/smart-lists/next-day/assign',
        body: { title: 'Pay Electricity Bill', date: tomorrow }
      });
      assert.strictEqual(postRes.statusCode, 200);
      const routineId = postRes.body.routine.id;

      // 2. Query via API
      const getRes = await mockRequest({
        method: 'GET',
        url: `/api/smart-lists/next-day?date=${tomorrow}`
      });
      assert.strictEqual(getRes.statusCode, 200);
      assert.strictEqual(getRes.body.totalCount, 1);
      assert.strictEqual(getRes.body.routines[0].title, 'Pay Electricity Bill');

      // 3. Delete occurrence via API
      const delRes = await mockRequest({
        method: 'DELETE',
        url: `/api/smart-lists/next-day/occurrences/${routineId}?date=${tomorrow}`
      });
      assert.strictEqual(delRes.statusCode, 200);
      assert.strictEqual(delRes.body.success, true);

      // 4. Query again: occurrence removed
      const getAfter = await mockRequest({
        method: 'GET',
        url: `/api/smart-lists/next-day?date=${tomorrow}`
      });
      assert.strictEqual(getAfter.body.totalCount, 0);
    });
  });

  // ==========================================================================
  // PART 3: Habit Streak Counters & Undo Cancellation
  // ==========================================================================
  describe('PART 3: Habit Streak Counters & Undo Cancellation', () => {
    test('3.1 Undo Cancellation restores cancelled routine to pending and recalculates denominator', async () => {
      const today = '2026-11-10';
      const r1 = await SmartListStore.addRoutine(USER_ALICE, { title: 'Routine A' });
      const r2 = await SmartListStore.addRoutine(USER_ALICE, { title: 'Routine B' });

      // Complete r1, cancel r2
      await SmartListStore.setRoutineStatus(USER_ALICE, { routineId: r1.id, date: today, status: 'completed' });
      await SmartListStore.cancelRoutine(USER_ALICE, r2.id, today, 'Weather was bad');

      // Check stats via HabitStreakService: 1 completed, 1 cancelled. Eligible = 1, rate = 100%
      let routines = await SmartListStore.getRoutines(USER_ALICE);
      let completions = await SmartListStore.getCompletions(USER_ALICE, today);
      let stats = HabitStreakService.calculateDayStatistics({ routines, completions, date: today });
      assert.strictEqual(stats.completedCount, 1);
      assert.strictEqual(stats.cancelledCount, 1);
      assert.strictEqual(stats.eligibleCount, 1);
      assert.strictEqual(stats.completionRate, 100);

      // Undo cancellation
      const undoRes = await SmartListStore.undoCancelRoutine(USER_ALICE, r2.id, today);
      assert.strictEqual(undoRes.success, true);
      assert.strictEqual(undoRes.record.status, 'pending');
      assert.strictEqual(undoRes.record.cancellationReason, null);

      // Re-check stats: 1 completed, 1 pending, 0 cancelled. Eligible = 2, rate = 50%
      routines = await SmartListStore.getRoutines(USER_ALICE);
      completions = await SmartListStore.getCompletions(USER_ALICE, today);
      stats = HabitStreakService.calculateDayStatistics({ routines, completions, date: today });
      assert.strictEqual(stats.completedCount, 1);
      assert.strictEqual(stats.pendingCount, 1);
      assert.strictEqual(stats.cancelledCount, 0);
      assert.strictEqual(stats.eligibleCount, 2);
      assert.strictEqual(stats.completionRate, 50);
      assert.strictEqual(stats.isQualified, false);
    });

    test('3.2 API POST /api/smart-lists/routines/:id/undo-cancel restores routine', async () => {
      const today = '2026-11-10';
      const r = await SmartListStore.addRoutine(USER_ALICE, { title: 'Morning Stretch' });
      await SmartListStore.cancelRoutine(USER_ALICE, r.id, today, 'Sore muscle');

      const res = await mockRequest({
        method: 'POST',
        url: `/api/smart-lists/routines/${r.id}/undo-cancel`,
        body: { date: today }
      });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.record.status, 'pending');
    });
  });

  // ==========================================================================
  // PART 4: Reset Habit Streak Operation
  // ==========================================================================
  describe('PART 4: Reset Habit Streak Operation', () => {
    test('4.1 Resetting streak zeroes current streak, longest streak, and consistency', async () => {
      const r = await SmartListStore.addRoutine(USER_ALICE, { title: 'Study Code' });

      // Create 5 qualified consecutive days with timestamps prior to reset
      const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
      for (const d of days) {
        await SmartListStore.setRoutineStatus(USER_ALICE, {
          routineId: r.id,
          date: d,
          status: 'completed',
          updatedAt: '2026-11-05T10:00:00.000Z',
          completedAt: '2026-11-05T10:00:00.000Z'
        });
      }

      // Check streaks before reset: 5 days
      let routines = await SmartListStore.getRoutines(USER_ALICE);
      let allCompletions = await SmartListStore.getAllCompletions(USER_ALICE);
      let streaksBefore = HabitStreakService.calculateStreaks({ routines, completions: allCompletions, refDate: '2026-11-05' });
      assert.strictEqual(streaksBefore.currentStreak, 5);
      assert.strictEqual(streaksBefore.longestStreak, 5);

      // Perform Streak Reset at 20:00:00 on 2026-11-05
      const resetTime = '2026-11-05T20:00:00.000Z';
      const resetRes = await SmartListStore.resetStreak(USER_ALICE, { resetAt: resetTime });
      assert.strictEqual(resetRes.success, true);
      assert.strictEqual(resetRes.resetAt, resetTime);

      // Streaks must now be 0!
      routines = await SmartListStore.getRoutines(USER_ALICE);
      allCompletions = await SmartListStore.getAllCompletions(USER_ALICE);
      let streaksAfter = HabitStreakService.calculateStreaks({ routines, completions: allCompletions, refDate: '2026-11-05', resetAt: resetTime });
      assert.strictEqual(streaksAfter.currentStreak, 0);
      assert.strictEqual(streaksAfter.longestStreak, 0);

      // Consistency must be 0%
      let consistency = HabitStreakService.calculateConsistency({ routines, completions: allCompletions, date: '2026-11-05', resetAt: resetTime });
      assert.strictEqual(consistency.weekly.percentage, 0);
      assert.strictEqual(consistency.monthly.percentage, 0);

      // Subsequent day completes routine -> builds new streak baseline of 1 day!
      await SmartListStore.setRoutineStatus(USER_ALICE, {
        routineId: r.id,
        date: '2026-11-06',
        status: 'completed',
        updatedAt: '2026-11-06T10:00:00.000Z',
        completedAt: '2026-11-06T10:00:00.000Z'
      });
      allCompletions = await SmartListStore.getAllCompletions(USER_ALICE);
      let streaksNew = HabitStreakService.calculateStreaks({ routines, completions: allCompletions, refDate: '2026-11-06', resetAt: resetTime });
      assert.strictEqual(streaksNew.currentStreak, 1);
      assert.strictEqual(streaksNew.longestStreak, 1);
    });

    test('4.2 Streak reset strictly preserves routine definitions and historical daily reports', async () => {
      const r = await SmartListStore.addRoutine(USER_ALICE, { title: 'Floss Teeth' });
      await SmartListStore.setRoutineStatus(USER_ALICE, { routineId: r.id, date: '2026-11-04', status: 'completed' });
      const reportBefore = await SmartListStore.saveReport(USER_ALICE, {
        date: '2026-11-04',
        totalRoutines: 1,
        completedCount: 1,
        completionRate: 100,
        status: 'completed',
        completedRoutines: ['Floss Teeth']
      });

      // Reset streak
      await SmartListStore.resetStreak(USER_ALICE, { resetAt: '2026-11-05T10:00:00.000Z' });

      // Routine definition MUST still exist
      const routines = await SmartListStore.getRoutines(USER_ALICE);
      assert.strictEqual(routines.length, 1);
      assert.strictEqual(routines[0].title, 'Floss Teeth');

      // Historical report MUST still exist and be identical
      const reportAfter = await SmartListStore.getReport(USER_ALICE, '2026-11-04');
      assert.ok(reportAfter);
      assert.strictEqual(reportAfter.completedCount, reportBefore.completedCount);
      assert.strictEqual(reportAfter.date, '2026-11-04');
    });

    test('4.3 Streak reset does NOT affect tasks/todos productivity analytics', async () => {
      const resetTime = new Date().toISOString();
      const res = await mockRequest({
        method: 'POST',
        url: '/api/smart-lists/streaks/reset',
        body: { resetAt: resetTime }
      });
      assert.strictEqual(res.statusCode, 200);

      const analyticsRes = await mockRequest({
        method: 'GET',
        url: '/api/analytics/productivity'
      });
      assert.strictEqual(analyticsRes.statusCode, 200);
      assert.ok(analyticsRes.body.taskMetrics, 'Task analytics must remain active and unaffected');
      assert.strictEqual(analyticsRes.body.routineMetrics.currentStreak, 0);
      assert.strictEqual(analyticsRes.body.routineMetrics.longestStreak, 0);
    });
  });

  // ==========================================================================
  // PART 5: App Update Announcements & Dismissal Persistence
  // ==========================================================================
  describe('PART 5: In-App Update System & Notification Validation', () => {
    test('5.1 index.html contains all required UI components for Build 11', () => {
      assert.ok(INDEX_HTML.includes('id="btn-reset-habit-streak"'), 'Missing reset habit streak button');
      assert.ok(INDEX_HTML.includes('id="smart-next-day-section"'), 'Missing tomorrow routines section');
      assert.ok(INDEX_HTML.includes('id="smart-tomorrow-routines-list"'), 'Missing tomorrow routines list');
      assert.ok(INDEX_HTML.includes('id="btn-add-tomorrow-routine"'), 'Missing add tomorrow routine button');
      assert.ok(INDEX_HTML.includes('id="modal-smart-reset-streak-confirm"'), 'Missing reset streak modal');
      assert.ok(INDEX_HTML.includes('id="modal-smart-remove-tomorrow-confirm"'), 'Missing remove tomorrow modal');
      assert.ok(INDEX_HTML.includes('id="summary-metric-postponed"'), 'Missing summary postponed metric');
      assert.ok(INDEX_HTML.includes('id="summary-metric-cancelled"'), 'Missing summary cancelled metric');
      assert.ok(INDEX_HTML.includes('id="btn-summary-view-tomorrow"'), 'Missing view tomorrow button in summary');
    });

    test('5.2 styles.css provides required next-day, streak reset & 4-theme styling', () => {
      assert.ok(STYLES_CSS.includes('.btn-reset-streak'), 'Missing .btn-reset-streak CSS');
      assert.ok(STYLES_CSS.includes('.smart-next-day-section'), 'Missing .smart-next-day-section CSS');
      assert.ok(STYLES_CSS.includes('.next-day-routine-card'), 'Missing .next-day-routine-card CSS');
      assert.ok(STYLES_CSS.includes('.routine-origin-badge'), 'Missing .routine-origin-badge CSS');
      assert.ok(STYLES_CSS.includes('.btn-routine-undo-cancel'), 'Missing .btn-routine-undo-cancel CSS');
      assert.ok(STYLES_CSS.includes('.btn-carry-view-tomorrow'), 'Missing .btn-carry-view-tomorrow CSS');
      assert.ok(STYLES_CSS.includes('#modal-smart-reset-streak-confirm'), 'Missing streak reset modal CSS');
      assert.ok(STYLES_CSS.includes('#modal-smart-remove-tomorrow-confirm'), 'Missing remove tomorrow modal CSS');
    });

    test('5.3 Database migration proposal 004 defines streak_reset_at and rollback script', () => {
      assert.ok(MIGRATION_004.includes('streak_reset_at'), 'Migration must add streak_reset_at');
      assert.ok(MIGRATION_004.includes('original_date'), 'Migration must add original_date');
      assert.ok(MIGRATION_004.includes('ROLLBACK'), 'Migration must include safe rollback instructions');
    });

    test('5.4 Update notification prevents duplicate popups & respects dismissed versionCode', () => {
      assert.ok(APP_JS.includes('taskly_dismissed_update_announcement'), 'Must track dismissed announcement in localStorage');
      assert.ok(APP_JS.includes('taskly_last_notified_update_code'), 'Must track last notified versionCode');
      assert.ok(APP_JS.includes('checkPermissions'), 'Must check permissions gracefully before scheduling');
    });
  });
});
