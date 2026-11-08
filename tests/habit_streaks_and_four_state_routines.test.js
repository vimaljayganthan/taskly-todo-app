/**
 * Taskly v2.0.0 Build 11 - Phase 2 Backend Automated Test Suite
 *
 * Verifies:
 * 1. 4-State Routine Model ('completed', 'pending', 'postponed', 'cancelled')
 * 2. Valid and invalid status transitions & validation rules
 * 3. Atomic postponement & duplicate occurrence prevention
 * 4. Cancellation semantics & reason preservation
 * 5. Habit Streaks 80% boundary calculations
 * 6. Cancelled routines exclusion from eligible denominator
 * 7. Postponed routines incomplete on original date
 * 8. Zero eligible routines edge cases
 * 9. Date & timezone calendar string boundaries
 * 10. Historical report immutability
 * 11. Multi-user tenant isolation
 * 12. Full REST API endpoints contract (in-memory mockRequest, zero external dependencies)
 */

process.env.NODE_ENV = 'development';
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const app = require('../server');
const SmartListStore = require('../storage/smartListStore');
const HabitStreakService = require('../services/habitStreakService');

const USER_ALICE = 'usr-test-alice-uuid';
const USER_BOB = 'usr-test-bob-uuid';

// In-memory HTTP dispatcher for Express endpoints without external dependencies
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

    let resBody = '';
    res.json = (data) => {
      resBody = data;
      res.emit('finish');
      resolve({ status: res.statusCode, headers: res._headers, body: data });
    };
    res.send = (data) => {
      resBody = data;
      res.emit('finish');
      resolve({ status: res.statusCode, headers: res._headers, body: data });
    };
    res.end = (data) => {
      if (data) resBody = data;
      res.emit('finish');
      resolve({ status: res.statusCode, headers: res._headers, body: resBody });
    };

    app.handle(req, res, (err) => {
      if (err) reject(err);
    });
  });
}

describe('Taskly v2.0.0 Build 11 - Phase 2: Habit Streaks & 4-State Routines Suite', () => {

  beforeEach(() => {
    SmartListStore.__resetForTests();
  });

  // ============================================================================
  // PART 1: HABIT STREAK SERVICE & CALCULATION ENGINE
  // ============================================================================

  describe('Part 1: Habit Streak Service & Transition Rules', () => {

    test('1. Validates all 4 routine statuses and rejects invalid statuses', () => {
      const validStatuses = ['completed', 'pending', 'postponed', 'cancelled'];
      validStatuses.forEach(st => {
        const res = HabitStreakService.validateStatusTransition('pending', st, {
          date: '2026-11-08',
          postponedTo: '2026-11-09',
          cancellationReason: 'Doctor appointment'
        });
        assert.strictEqual(res.normalizedStatus, st);
      });

      const invalid = ['done', 'finished', 'skipped', 'in_progress', '', null, undefined];
      invalid.forEach(bad => {
        assert.throws(() => {
          HabitStreakService.validateStatusTransition('pending', bad, { date: '2026-11-08' });
        }, /Invalid status|must be a non-empty string/);
      });
    });

    test('2. Postponement requires a valid future date after original date', () => {
      // Missing postponedTo
      assert.throws(() => {
        HabitStreakService.validateStatusTransition('pending', 'postponed', {
          date: '2026-11-08',
          postponedTo: null
        });
      }, /Target date "postponedTo"/);

      // Same-day postponement is rejected
      assert.throws(() => {
        HabitStreakService.validateStatusTransition('pending', 'postponed', {
          date: '2026-11-08',
          postponedTo: '2026-11-08'
        });
      }, /must be strictly after/);

      // Past date postponement is rejected
      assert.throws(() => {
        HabitStreakService.validateStatusTransition('pending', 'postponed', {
          date: '2026-11-08',
          postponedTo: '2026-11-07'
        });
      }, /must be strictly after/);

      // Valid future date succeeds
      const valid = HabitStreakService.validateStatusTransition('pending', 'postponed', {
        date: '2026-11-08',
        postponedTo: '2026-11-09'
      });
      assert.strictEqual(valid.normalizedStatus, 'postponed');
      assert.strictEqual(valid.postponedTo, '2026-11-09');
    });

    test('3. Cancellation validates reason length (max 100 characters)', () => {
      const valid = HabitStreakService.validateStatusTransition('pending', 'cancelled', {
        date: '2026-11-08',
        cancellationReason: 'Rest day after marathon'
      });
      assert.strictEqual(valid.normalizedStatus, 'cancelled');
      assert.strictEqual(valid.cancellationReason, 'Rest day after marathon');

      const tooLong = 'x'.repeat(101);
      assert.throws(() => {
        HabitStreakService.validateStatusTransition('pending', 'cancelled', {
          date: '2026-11-08',
          cancellationReason: tooLong
        });
      }, /must not exceed 100 characters/);
    });

    test('4. 80% boundary calculations: 75% fails, 80% qualifies', () => {
      const routines = [
        { id: 'r1', title: 'R1' },
        { id: 'r2', title: 'R2' },
        { id: 'r3', title: 'R3' },
        { id: 'r4', title: 'R4' }
      ];

      // 3 of 4 completed = 75% -> does NOT qualify (< 80%)
      const comps75 = [
        { routineId: 'r1', date: '2026-11-08', status: 'completed' },
        { routineId: 'r2', date: '2026-11-08', status: 'completed' },
        { routineId: 'r3', date: '2026-11-08', status: 'completed' },
        { routineId: 'r4', date: '2026-11-08', status: 'pending' }
      ];
      const stats75 = HabitStreakService.calculateDayStatistics({ routines, completions: comps75, date: '2026-11-08' });
      assert.strictEqual(stats75.completionRate, 75);
      assert.strictEqual(stats75.isQualified, false);

      // 4 of 5 completed = 80% -> QUALIFIES
      const routines5 = [...routines, { id: 'r5', title: 'R5' }];
      const comps80 = [
        ...comps75,
        { routineId: 'r5', date: '2026-11-08', status: 'completed' }
      ];
      const stats80 = HabitStreakService.calculateDayStatistics({ routines: routines5, completions: comps80, date: '2026-11-08' });
      assert.strictEqual(stats80.completionRate, 80);
      assert.strictEqual(stats80.isQualified, true);
    });

    test('5. Cancelled routines are excluded from the eligible denominator', () => {
      const routines = [
        { id: 'r1', title: 'Drink water' },
        { id: 'r2', title: 'Read 20 pages' },
        { id: 'r3', title: 'Gym workout' },
        { id: 'r4', title: 'Meditate' },
        { id: 'r5', title: 'Code 1 hour' }
      ];

      // 5 total routines: Gym is cancelled (e.g. sore muscles).
      // Eligible = 5 - 1 = 4.
      // User completes 3 of 4 = 75% -> does NOT qualify.
      const comps1 = [
        { routineId: 'r1', date: '2026-11-08', status: 'completed' },
        { routineId: 'r2', date: '2026-11-08', status: 'completed' },
        { routineId: 'r3', date: '2026-11-08', status: 'cancelled', cancellationReason: 'Rest day' },
        { routineId: 'r4', date: '2026-11-08', status: 'completed' },
        { routineId: 'r5', date: '2026-11-08', status: 'pending' }
      ];
      const stats1 = HabitStreakService.calculateDayStatistics({ routines, completions: comps1, date: '2026-11-08' });
      assert.strictEqual(stats1.totalCount, 5);
      assert.strictEqual(stats1.cancelledCount, 1);
      assert.strictEqual(stats1.eligibleCount, 4);
      assert.strictEqual(stats1.completedCount, 3);
      assert.strictEqual(stats1.completionRate, 75);
      assert.strictEqual(stats1.isQualified, false);

      // Now user completes the 4th eligible routine: 4 of 4 = 100% -> QUALIFIES!
      comps1[4].status = 'completed';
      const stats2 = HabitStreakService.calculateDayStatistics({ routines, completions: comps1, date: '2026-11-08' });
      assert.strictEqual(stats2.eligibleCount, 4);
      assert.strictEqual(stats2.completedCount, 4);
      assert.strictEqual(stats2.completionRate, 100);
      assert.strictEqual(stats2.isQualified, true);
    });

    test('6. Postponed routines remain incomplete on their original date', () => {
      const routines = [
        { id: 'r1', title: 'R1' },
        { id: 'r2', title: 'R2' },
        { id: 'r3', title: 'R3' },
        { id: 'r4', title: 'R4' },
        { id: 'r5', title: 'R5' }
      ];

      // R5 is postponed to tomorrow.
      // Total = 5, Cancelled = 0 -> Eligible = 5.
      // 4 completed, 1 postponed -> 4 / 5 = 80% -> QUALIFIES!
      const comps = [
        { routineId: 'r1', date: '2026-11-08', status: 'completed' },
        { routineId: 'r2', date: '2026-11-08', status: 'completed' },
        { routineId: 'r3', date: '2026-11-08', status: 'completed' },
        { routineId: 'r4', date: '2026-11-08', status: 'completed' },
        { routineId: 'r5', date: '2026-11-08', status: 'postponed', postponedTo: '2026-11-09' }
      ];
      const stats = HabitStreakService.calculateDayStatistics({ routines, completions: comps, date: '2026-11-08' });
      assert.strictEqual(stats.eligibleCount, 5);
      assert.strictEqual(stats.postponedCount, 1);
      assert.strictEqual(stats.completedCount, 4);
      assert.strictEqual(stats.completionRate, 80);
      assert.strictEqual(stats.isQualified, true);

      // If only 3 completed and 2 postponed: 3 / 5 = 60% -> does NOT qualify.
      comps[3].status = 'postponed';
      comps[3].postponedTo = '2026-11-09';
      const statsFail = HabitStreakService.calculateDayStatistics({ routines, completions: comps, date: '2026-11-08' });
      assert.strictEqual(statsFail.completionRate, 60);
      assert.strictEqual(statsFail.isQualified, false);
    });

    test('7. Zero eligible routines do not qualify for a streak', () => {
      const routines = [
        { id: 'r1', title: 'R1' },
        { id: 'r2', title: 'R2' }
      ];

      // Both routines cancelled on sick day
      const comps = [
        { routineId: 'r1', date: '2026-11-08', status: 'cancelled', cancellationReason: 'Sick' },
        { routineId: 'r2', date: '2026-11-08', status: 'cancelled', cancellationReason: 'Sick' }
      ];
      const stats = HabitStreakService.calculateDayStatistics({ routines, completions: comps, date: '2026-11-08' });
      assert.strictEqual(stats.totalCount, 2);
      assert.strictEqual(stats.cancelledCount, 2);
      assert.strictEqual(stats.eligibleCount, 0);
      assert.strictEqual(stats.completionRate, 0);
      assert.strictEqual(stats.isQualified, false);
    });

    test('8. Date arithmetic helper avoids timezone offset drift', () => {
      const d1 = '2026-11-08';
      assert.strictEqual(HabitStreakService.addDays(d1, 1), '2026-11-09');
      assert.strictEqual(HabitStreakService.addDays(d1, -1), '2026-11-07');
      assert.strictEqual(HabitStreakService.addDays(d1, 30), '2026-12-08');
      assert.strictEqual(HabitStreakService.diffDays('2026-11-09', '2026-11-08'), 1);
      assert.strictEqual(HabitStreakService.diffDays('2026-11-08', '2026-11-09'), -1);
    });

    test('9. Current and Longest Streak calculations across historical dates', () => {
      const routines = [{ id: 'r1', title: 'Routine 1' }];

      // 4 consecutive qualified days: 2026-11-04 to 2026-11-07
      // Today (2026-11-08) is already qualified
      const completions = [
        { routineId: 'r1', date: '2026-11-04', status: 'completed' },
        { routineId: 'r1', date: '2026-11-05', status: 'completed' },
        { routineId: 'r1', date: '2026-11-06', status: 'completed' },
        { routineId: 'r1', date: '2026-11-07', status: 'completed' },
        { routineId: 'r1', date: '2026-11-08', status: 'completed' }
      ];

      const streaks = HabitStreakService.calculateStreaks({
        routines,
        completions,
        refDate: '2026-11-08'
      });

      assert.strictEqual(streaks.currentStreak, 5);
      assert.strictEqual(streaks.longestStreak, 5);
      assert.strictEqual(streaks.todayQualified, true);

      // If today is NOT yet completed, but yesterday was qualified, current streak is preserved as 4
      const completionsPendingToday = completions.filter(c => c.date !== '2026-11-08');
      completionsPendingToday.push({ routineId: 'r1', date: '2026-11-08', status: 'pending' });

      const streaksPending = HabitStreakService.calculateStreaks({
        routines,
        completions: completionsPendingToday,
        refDate: '2026-11-08'
      });

      assert.strictEqual(streaksPending.currentStreak, 4);
      assert.strictEqual(streaksPending.longestStreak, 4);
      assert.strictEqual(streaksPending.todayQualified, false);
      assert.strictEqual(streaksPending.yesterdayQualified, true);

      // Past historical gap: Best streak was 10 days earlier in October, current streak is 2
      const gapCompletions = [
        // 10-day streak in Oct
        ...Array.from({ length: 10 }).map((_, i) => ({
          routineId: 'r1',
          date: `2026-10-${String(i + 1).padStart(2, '0')}`,
          status: 'completed'
        })),
        // Gap in between
        { routineId: 'r1', date: '2026-11-07', status: 'completed' },
        { routineId: 'r1', date: '2026-11-08', status: 'completed' }
      ];

      const gapStreaks = HabitStreakService.calculateStreaks({
        routines,
        completions: gapCompletions,
        refDate: '2026-11-08'
      });

      assert.strictEqual(gapStreaks.currentStreak, 2);
      assert.strictEqual(gapStreaks.longestStreak, 10);
    });

  });

  // ============================================================================
  // PART 2: SMART LIST STORE ATOMIC OPERATIONS & REVIEWS
  // ============================================================================

  describe('Part 2: SmartListStore Persistence & 4-State Integrity', () => {

    test('1. Setting status creates occurrence and syncs completed boolean without conflict', async () => {
      const routine = await SmartListStore.addRoutine(USER_ALICE, { title: 'Meditate 10 mins' });

      const { record } = await SmartListStore.setRoutineStatus(USER_ALICE, {
        routineId: routine.id,
        date: '2026-11-08',
        status: 'completed'
      });

      assert.strictEqual(record.status, 'completed');
      assert.strictEqual(record.completed, true);
      assert.ok(record.completedAt);

      // Transition to pending
      const { record: pendingRecord } = await SmartListStore.setRoutineStatus(USER_ALICE, {
        routineId: routine.id,
        date: '2026-11-08',
        status: 'pending'
      });

      assert.strictEqual(pendingRecord.status, 'pending');
      assert.strictEqual(pendingRecord.completed, false);
      assert.strictEqual(pendingRecord.completedAt, null);
    });

    test('2. Atomic Postponement: updates origin to postponed and creates next occurrence on target date', async () => {
      const routine = await SmartListStore.addRoutine(USER_ALICE, { title: 'Clean Desktop' });

      const result = await SmartListStore.postponeRoutine(USER_ALICE, routine.id, '2026-11-08', '2026-11-09');

      assert.strictEqual(result.record.status, 'postponed');
      assert.strictEqual(result.record.date, '2026-11-08');
      assert.strictEqual(result.record.postponedTo, '2026-11-09');
      assert.strictEqual(result.record.completed, false);

      // Verify target date occurrence was created
      assert.ok(result.targetRecord, 'Target occurrence created');
      assert.strictEqual(result.targetRecord.date, '2026-11-09');
      assert.strictEqual(result.targetRecord.status, 'pending');
      assert.strictEqual(result.targetRecord.carriedForward, true);

      // Verify queries for both dates
      const compsToday = await SmartListStore.getCompletions(USER_ALICE, '2026-11-08');
      assert.strictEqual(compsToday.length, 1);
      assert.strictEqual(compsToday[0].status, 'postponed');

      const compsTomorrow = await SmartListStore.getCompletions(USER_ALICE, '2026-11-09');
      assert.strictEqual(compsTomorrow.length, 1);
      assert.strictEqual(compsTomorrow[0].status, 'pending');
      assert.strictEqual(compsTomorrow[0].carriedForward, true);
    });

    test('3. Postponing does not duplicate occurrence if target date record already exists', async () => {
      const routine = await SmartListStore.addRoutine(USER_ALICE, { title: 'Duplication Guard Routine' });

      // First postponement to 2026-11-09
      await SmartListStore.postponeRoutine(USER_ALICE, routine.id, '2026-11-08', '2026-11-09');

      // Re-postponing from another date or updating
      await SmartListStore.postponeRoutine(USER_ALICE, routine.id, '2026-11-08', '2026-11-09');

      const occurrences = await SmartListStore.getRoutineOccurrences(USER_ALICE, routine.id);
      assert.strictEqual(occurrences.length, 2); // strictly 1 on 2026-11-08 and 1 on 2026-11-09
    });

    test('4. Cancellation preserves reason and date without creating future occurrences', async () => {
      const routine = await SmartListStore.addRoutine(USER_ALICE, { title: 'Evening Walk' });

      const cancelled = await SmartListStore.cancelRoutine(
        USER_ALICE,
        routine.id,
        '2026-11-08',
        'Heavy thunderstorm'
      );

      assert.strictEqual(cancelled.status, 'cancelled');
      assert.strictEqual(cancelled.cancellationReason, 'Heavy thunderstorm');
      assert.strictEqual(cancelled.date, '2026-11-08');

      // No future occurrence was scheduled
      const futureComps = await SmartListStore.getCompletions(USER_ALICE, '2026-11-09');
      assert.strictEqual(futureComps.length, 0);
    });

    test('5. Historical Report Immutability: status updates do not overwrite previously finalized reports', async () => {
      const r1 = await SmartListStore.addRoutine(USER_ALICE, { title: 'Routine Snapshot 1' });
      await SmartListStore.setRoutineStatus(USER_ALICE, { routineId: r1.id, date: '2026-11-05', status: 'completed' });

      // Generate and save historical report
      const report = await SmartListStore.saveReport(USER_ALICE, {
        date: '2026-11-05',
        completedRoutines: ['Routine Snapshot 1'],
        incompleteRoutines: [],
        totalRoutines: 1,
        status: 'Fully Completed'
      });

      assert.strictEqual(report.completionRate, 100);
      assert.strictEqual(report.isStreakQualified, true);

      // Now change status in the completion store for that past date
      await SmartListStore.setRoutineStatus(USER_ALICE, { routineId: r1.id, date: '2026-11-05', status: 'cancelled' });

      // Report in storage remains untouched and immutable
      const storedReport = await SmartListStore.getReport(USER_ALICE, '2026-11-05');
      assert.strictEqual(storedReport.completionRate, 100);
      assert.strictEqual(storedReport.completedCount, 1);
      assert.strictEqual(storedReport.status, 'Fully Completed');
    });

    test('6. Multi-user tenant isolation: User A cannot view or mutate User B routines', async () => {
      const routineAlice = await SmartListStore.addRoutine(USER_ALICE, { title: 'Alice Private Routine' });
      const routineBob = await SmartListStore.addRoutine(USER_BOB, { title: 'Bob Private Routine' });

      // Bob cannot set status on Alice's routine
      await assert.rejects(async () => {
        await SmartListStore.setRoutineStatus(USER_BOB, {
          routineId: routineAlice.id,
          date: '2026-11-08',
          status: 'completed'
        });
      }, /Routine not found or access denied/);

      // Queries are strictly tenant-isolated
      const aliceRoutines = await SmartListStore.getRoutines(USER_ALICE);
      assert.strictEqual(aliceRoutines.length, 1);
      assert.strictEqual(aliceRoutines[0].title, 'Alice Private Routine');

      const bobRoutines = await SmartListStore.getRoutines(USER_BOB);
      assert.strictEqual(bobRoutines.length, 1);
      assert.strictEqual(bobRoutines[0].title, 'Bob Private Routine');
    });

  });

  // ============================================================================
  // PART 3: BACKEND REST API ENDPOINTS CONTRACT
  // ============================================================================

  describe('Part 3: REST API Endpoints Contract', () => {

    test('1. Unauthenticated request to /api/smart-lists/* is rejected with 401', async () => {
      const res = await mockRequest({
        url: '/api/smart-lists/streaks',
        method: 'GET',
        noAuth: true
      });
      assert.strictEqual(res.status, 401);
      assert.match(res.body.error, /Unauthorized: Missing or invalid Bearer token/i);
    });

    test('2. PATCH /api/smart-lists/completions/status updates authoritative status', async () => {
      const routine = await SmartListStore.addRoutine(USER_ALICE, { title: 'API Status Test' });

      const res = await mockRequest({
        url: '/api/smart-lists/completions/status',
        method: 'PATCH',
        userId: USER_ALICE,
        body: {
          routineId: routine.id,
          date: '2026-11-08',
          status: 'completed'
        }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.record.status, 'completed');
      assert.strictEqual(res.body.record.completed, true);
    });

    test('3. POST /api/smart-lists/routines/:id/postpone validates dates and schedules occurrence', async () => {
      const routine = await SmartListStore.addRoutine(USER_ALICE, { title: 'API Postpone Test' });

      // Invalid date (past)
      const badRes = await mockRequest({
        url: `/api/smart-lists/routines/${routine.id}/postpone`,
        method: 'POST',
        userId: USER_ALICE,
        body: { date: '2026-11-08', postponedTo: '2026-11-07' }
      });

      assert.strictEqual(badRes.status, 400);
      assert.match(badRes.body.error, /must be strictly after/i);

      // Valid postponement
      const goodRes = await mockRequest({
        url: `/api/smart-lists/routines/${routine.id}/postpone`,
        method: 'POST',
        userId: USER_ALICE,
        body: { date: '2026-11-08', postponedTo: '2026-11-10' }
      });

      assert.strictEqual(goodRes.status, 200);
      assert.strictEqual(goodRes.body.success, true);
      assert.strictEqual(goodRes.body.record.status, 'postponed');
      assert.strictEqual(goodRes.body.targetRecord.status, 'pending');
      assert.strictEqual(goodRes.body.targetRecord.date, '2026-11-10');
    });

    test('4. POST /api/smart-lists/routines/:id/cancel cancels routine with reason', async () => {
      const routine = await SmartListStore.addRoutine(USER_ALICE, { title: 'API Cancel Test' });

      const res = await mockRequest({
        url: `/api/smart-lists/routines/${routine.id}/cancel`,
        method: 'POST',
        userId: USER_ALICE,
        body: { date: '2026-11-08', cancellationReason: 'Snowstorm' }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.record.status, 'cancelled');
      assert.strictEqual(res.body.record.cancellationReason, 'Snowstorm');
    });

    test('5. GET /api/smart-lists/statistics/daily returns 80% habit metrics', async () => {
      const r1 = await SmartListStore.addRoutine(USER_ALICE, { title: 'Daily Stat R1' });
      const r2 = await SmartListStore.addRoutine(USER_ALICE, { title: 'Daily Stat R2' });

      await SmartListStore.setRoutineStatus(USER_ALICE, { routineId: r1.id, date: '2026-11-08', status: 'completed' });
      await SmartListStore.setRoutineStatus(USER_ALICE, { routineId: r2.id, date: '2026-11-08', status: 'completed' });

      const res = await mockRequest({
        url: '/api/smart-lists/statistics/daily?date=2026-11-08',
        method: 'GET',
        userId: USER_ALICE
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.totalCount, 2);
      assert.strictEqual(res.body.eligibleCount, 2);
      assert.strictEqual(res.body.completedCount, 2);
      assert.strictEqual(res.body.completionRate, 100);
      assert.strictEqual(res.body.isQualified, true);
    });

    test('6. GET /api/smart-lists/streaks returns current and longest streaks', async () => {
      const r = await SmartListStore.addRoutine(USER_ALICE, { title: 'Streak API Routine' });
      await SmartListStore.setRoutineStatus(USER_ALICE, { routineId: r.id, date: '2026-11-07', status: 'completed' });
      await SmartListStore.setRoutineStatus(USER_ALICE, { routineId: r.id, date: '2026-11-08', status: 'completed' });

      const res = await mockRequest({
        url: '/api/smart-lists/streaks?refDate=2026-11-08',
        method: 'GET',
        userId: USER_ALICE
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.currentStreak, 2);
      assert.strictEqual(res.body.longestStreak, 2);
      assert.strictEqual(res.body.todayQualified, true);
    });

    test('7. GET /api/smart-lists/statistics/consistency returns weekly and monthly consistency', async () => {
      const r = await SmartListStore.addRoutine(USER_ALICE, { title: 'Consistency API Routine' });
      await SmartListStore.setRoutineStatus(USER_ALICE, { routineId: r.id, date: '2026-11-08', status: 'completed' });

      const res = await mockRequest({
        url: '/api/smart-lists/statistics/consistency?date=2026-11-08',
        method: 'GET',
        userId: USER_ALICE
      });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.week);
      assert.ok(res.body.month);
      assert.strictEqual(typeof res.body.week.consistencyPercent, 'number');
      assert.strictEqual(typeof res.body.month.consistencyPercent, 'number');
    });

    test('8. GET /api/smart-lists/performance returns historical day-by-day performance', async () => {
      const r = await SmartListStore.addRoutine(USER_ALICE, { title: 'Performance API Routine' });
      await SmartListStore.setRoutineStatus(USER_ALICE, { routineId: r.id, date: '2026-11-08', status: 'completed' });

      const res = await mockRequest({
        url: '/api/smart-lists/performance?startDate=2026-11-01&endDate=2026-11-08',
        method: 'GET',
        userId: USER_ALICE
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.totalDays, 8);
      assert.strictEqual(res.body.days.length, 8);
      assert.strictEqual(res.body.routines.length, 1);
      assert.strictEqual(res.body.routines[0].completedCount, 1);
    });

  });

});
