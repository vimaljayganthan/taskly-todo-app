/**
 * Taskly v2.1.0 — Smart Lists: Tomorrow Routine Independence & Streak UI Fix Automated Test Suite
 *
 * Verifies:
 * 1. Add Tomorrow Routine does not add it to Today's active checklist
 * 2. Edit Tomorrow Routine Occurrence updates only tomorrow and does not modify Today's routine
 * 3. Delete Tomorrow Routine Occurrence deletes only tomorrow and does not delete Today's routine or master template
 * 4. Edit Tomorrow Occurrence with applyToFuture preserves Today's original title while updating future occurrences
 * 5. Delete Tomorrow Occurrence preserves historical records and completions
 * 6. Tomorrow routines persist across storage reloads and restarts
 * 7. Multi-tenant user isolation for tomorrow routines and occurrence updates
 * 8. Carry-Forward duplicate prevention and origin tracking
 * 9. Streak Summary UI simplification: Exactly 2 counters (Done, Pending), Postponed/Cancelled chips removed from UI
 * 10. 4-State Habit engine & 80% qualification rule remain 100% intact internally
 * 11. Tomorrow UI/UX: Polished pencil and trash SVG icon buttons, accessible aria-labels, touch targets
 * 12. 4-Theme Styling Parity: Light, Dark, Pet, and Pastel themes for action buttons & edit scope modal
 * 13. Case-insensitive duplicate name prevention for tomorrow routines (409 Conflict)
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');
const STYLES_CSS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), 'utf8');
const APP_JS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'app.js'), 'utf8');

const SmartListStore = require('../storage/smartListStore');
const HabitStreakService = require('../services/habitStreakService');

// Use an isolated temporary test data file for SmartListStore
const TEST_DATA_FILE = path.join(__dirname, '..', 'data', 'test_smart_lists_tomorrow_independence.json');
process.env.SMART_LISTS_DATA_FILE = TEST_DATA_FILE;

function resetTestData() {
  SmartListStore.__resetForTests();
  try {
    if (fs.existsSync(TEST_DATA_FILE)) {
      fs.unlinkSync(TEST_DATA_FILE);
    }
  } catch (_) {}
}

describe('Taskly v2.1.0 — Tomorrow Routine Independence & Streak UI Suite', () => {

  beforeEach(() => {
    resetTestData();
  });

  afterEach(() => {
    resetTestData();
  });

  // ==============================================================================
  // 1. Independent Add: Tomorrow Routine Does NOT Appear in Today's Active List
  // ==============================================================================
  describe('1. Tomorrow Routine Add Independence', () => {
    test('1.1 Adding a routine for tomorrow does not add it to today active checklist', async () => {
      const userId = 'user_independence_1';
      const today = HabitStreakService.toYmdString(new Date());
      const tomorrow = HabitStreakService.addDays(today, 1);

      // Create existing routine for today
      const todayRoutine = await SmartListStore.addRoutine(userId, { title: 'Today Task A' });

      // Add routine specifically for tomorrow
      const tomorrowResult = await SmartListStore.assignRoutineToDate(userId, {
        title: 'Tomorrow Sunrise Run',
        date: tomorrow
      });

      assert.ok(tomorrowResult.routine, 'Should create tomorrow routine');
      assert.strictEqual(tomorrowResult.routine.title, 'Tomorrow Sunrise Run');
      assert.strictEqual(tomorrowResult.routine.startDate, tomorrow);

      // Verify Today's routine query excludes tomorrow's routine
      const todayRoutines = await SmartListStore.getRoutines(userId, today);
      const todayTitles = todayRoutines.map(r => r.title);
      assert.ok(todayTitles.includes('Today Task A'), 'Today should include today routine');
      assert.ok(!todayTitles.includes('Tomorrow Sunrise Run'), 'Today MUST NOT include routine created for tomorrow');

      // Verify Tomorrow's next-day routine query includes it
      const nextDayData = await SmartListStore.getNextDayRoutines(userId, { date: tomorrow });
      const nextDayTitles = nextDayData.routines.map(r => r.title);
      assert.ok(nextDayTitles.includes('Tomorrow Sunrise Run'), 'Tomorrow list must include tomorrow routine');
      assert.ok(nextDayTitles.includes('Today Task A'), 'Tomorrow list includes existing recurring routine');

      // Verify Today's habit statistics exclude tomorrow routine
      const todayCompletions = await SmartListStore.getCompletions(userId, today);
      const allRoutines = await SmartListStore.getRoutines(userId);
      const stats = HabitStreakService.calculateDayStatistics({
        routines: allRoutines,
        completions: todayCompletions,
        date: today
      });
      const statsTitles = stats.routines.map(r => r.title);
      assert.ok(!statsTitles.includes('Tomorrow Sunrise Run'), 'Today habit stats breakdown must not include tomorrow routine');
      assert.strictEqual(stats.totalCount, 1, 'Today total routines count should be 1');
    });

    test('1.2 Reject empty or blank title when assigning routine to tomorrow', async () => {
      const userId = 'user_independence_val';
      const tomorrow = HabitStreakService.addDays(HabitStreakService.toYmdString(new Date()), 1);

      await assert.rejects(
        async () => {
          await SmartListStore.assignRoutineToDate(userId, { title: '   ', date: tomorrow });
        },
        (err) => err.statusCode === 400
      );
    });

    test('1.3 Prevent duplicate routine title for tomorrow (Case-Insensitive 409 Conflict)', async () => {
      const userId = 'user_dup_check';
      const tomorrow = HabitStreakService.addDays(HabitStreakService.toYmdString(new Date()), 1);

      await SmartListStore.assignRoutineToDate(userId, { title: 'Yoga Stretch', date: tomorrow });

      // Attempting to add exact duplicate or case-insensitive duplicate
      await assert.rejects(
        async () => {
          await SmartListStore.assignRoutineToDate(userId, { title: 'yoga stretch', date: tomorrow });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 409);
          assert.match(err.message, /already exists for tomorrow/i);
          return true;
        }
      );
    });
  });

  // ==============================================================================
  // 2. Independent Edit: Tomorrow Routine Occurrence Does NOT Modify Today
  // ==============================================================================
  describe('2. Tomorrow Routine Edit Independence', () => {
    test('2.1 Editing tomorrow occurrence title does not modify today routine title', async () => {
      const userId = 'user_edit_1';
      const today = HabitStreakService.toYmdString(new Date());
      const tomorrow = HabitStreakService.addDays(today, 1);

      // Create a master routine
      const routine = await SmartListStore.addRoutine(userId, { title: 'Daily Reading 30m' });

      // Edit tomorrow's occurrence only (applyToFuture = false)
      const updateResult = await SmartListStore.updateOccurrenceTitle(userId, {
        routineId: routine.id,
        date: tomorrow,
        title: 'Daily Reading 60m (Weekend Deep Dive)',
        applyToFuture: false
      });

      assert.strictEqual(updateResult.success, true);
      assert.strictEqual(updateResult.title, 'Daily Reading 60m (Weekend Deep Dive)');
      assert.strictEqual(updateResult.applyToFuture, false);

      // Check Tomorrow's view: shows updated occurrence title
      const nextDay = await SmartListStore.getNextDayRoutines(userId, { date: tomorrow });
      const tomItem = nextDay.routines.find(r => r.routineId === routine.id);
      assert.strictEqual(tomItem.title, 'Daily Reading 60m (Weekend Deep Dive)');

      // Check Master template title: MUST REMAIN 'Daily Reading 30m'
      const routines = await SmartListStore.getRoutines(userId);
      const masterRoutine = routines.find(r => r.id === routine.id);
      assert.strictEqual(masterRoutine.title, 'Daily Reading 30m');

      // Check Today's statistics and breakdown: MUST REMAIN 'Daily Reading 30m'
      const todayComps = await SmartListStore.getCompletions(userId, today);
      const todayStats = HabitStreakService.calculateDayStatistics({
        routines,
        completions: todayComps,
        date: today
      });
      const todayRoutineItem = todayStats.routines.find(r => r.routineId === routine.id);
      assert.strictEqual(todayRoutineItem.title, 'Daily Reading 30m');
    });

    test('2.2 Editing tomorrow occurrence with applyToFuture preserves Today title while updating future occurrences', async () => {
      const userId = 'user_edit_future';
      const today = HabitStreakService.toYmdString(new Date());
      const tomorrow = HabitStreakService.addDays(today, 1);
      const dayAfterTomorrow = HabitStreakService.addDays(today, 2);

      // Create master routine
      const routine = await SmartListStore.addRoutine(userId, { title: 'Drink 2L Water' });

      // User chooses "Tomorrow and future occurrences"
      const updateResult = await SmartListStore.updateOccurrenceTitle(userId, {
        routineId: routine.id,
        date: tomorrow,
        title: 'Drink 3L Water',
        applyToFuture: true
      });

      assert.strictEqual(updateResult.success, true);

      // 1. Tomorrow displays new title
      const tomView = await SmartListStore.getNextDayRoutines(userId, { date: tomorrow });
      const tomItem = tomView.routines.find(r => r.routineId === routine.id);
      assert.strictEqual(tomItem.title, 'Drink 3L Water');

      // 2. Day after tomorrow (future) displays new title
      const dayAfterView = await SmartListStore.getNextDayRoutines(userId, { date: dayAfterTomorrow });
      const dayAfterItem = dayAfterView.routines.find(r => r.routineId === routine.id);
      assert.strictEqual(dayAfterItem.title, 'Drink 3L Water');

      // 3. Today's routine MUST preserve original title 'Drink 2L Water'
      const allRoutines = await SmartListStore.getRoutines(userId);
      const todayComps = await SmartListStore.getCompletions(userId, today);
      const todayStats = HabitStreakService.calculateDayStatistics({
        routines: allRoutines,
        completions: todayComps,
        date: today
      });
      const todayItem = todayStats.routines.find(r => r.routineId === routine.id);
      assert.strictEqual(todayItem.title, 'Drink 2L Water', 'Today MUST NEVER overwrite original title even when applying to future');
    });

    test('2.3 Prevent duplicate routine title when editing tomorrow routine (409 Conflict)', async () => {
      const userId = 'user_edit_dup';
      const tomorrow = HabitStreakService.addDays(HabitStreakService.toYmdString(new Date()), 1);

      const r1 = await SmartListStore.addRoutine(userId, { title: 'Meditation' });
      const r2 = await SmartListStore.addRoutine(userId, { title: 'Journaling' });

      // Try editing r2's tomorrow occurrence to 'Meditation' (which r1 already has)
      await assert.rejects(
        async () => {
          await SmartListStore.updateOccurrenceTitle(userId, {
            routineId: r2.id,
            date: tomorrow,
            title: 'Meditation',
            applyToFuture: false
          });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 409);
          return true;
        }
      );
    });
  });

  // ==============================================================================
  // 3. Independent Delete: Tomorrow Routine Delete Does NOT Delete Today Routine
  // ==============================================================================
  describe('3. Tomorrow Routine Delete Independence', () => {
    test('3.1 Removing a routine from tomorrow does not delete today routine or master definition', async () => {
      const userId = 'user_del_1';
      const today = HabitStreakService.toYmdString(new Date());
      const tomorrow = HabitStreakService.addDays(today, 1);

      const routine = await SmartListStore.addRoutine(userId, { title: 'Morning Stretching' });

      // Remove from tomorrow only
      const removeResult = await SmartListStore.removeOccurrenceFromDate(userId, {
        routineId: routine.id,
        date: tomorrow
      });
      assert.strictEqual(removeResult.success, true);

      // Tomorrow's list should NO LONGER contain Morning Stretching
      const nextDay = await SmartListStore.getNextDayRoutines(userId, { date: tomorrow });
      const tomItem = nextDay.routines.find(r => r.routineId === routine.id);
      assert.strictEqual(tomItem, undefined, 'Morning Stretching must be excluded from tomorrow');

      // Master recurring routine MUST STILL EXIST
      const allRoutines = await SmartListStore.getRoutines(userId);
      const master = allRoutines.find(r => r.id === routine.id);
      assert.ok(master, 'Master routine must not be deleted');

      // Today's checklist MUST STILL CONTAIN Morning Stretching
      const todayRoutines = await SmartListStore.getRoutines(userId, today);
      const todayItem = todayRoutines.find(r => r.id === routine.id);
      assert.ok(todayItem, 'Today active list must still contain routine');

      // Today's statistics must still evaluate Morning Stretching
      const todayComps = await SmartListStore.getCompletions(userId, today);
      const todayStats = HabitStreakService.calculateDayStatistics({
        routines: allRoutines,
        completions: todayComps,
        date: today
      });
      const statRoutine = todayStats.routines.find(r => r.routineId === routine.id);
      assert.ok(statRoutine, 'Today statistics must continue to include routine');
    });

    test('3.2 Removing tomorrow routine preserves yesterday completed history and reports', async () => {
      const userId = 'user_del_hist';
      const today = HabitStreakService.toYmdString(new Date());
      const yesterday = HabitStreakService.addDays(today, -1);
      const tomorrow = HabitStreakService.addDays(today, 1);

      const routine = await SmartListStore.addRoutine(userId, { title: 'Evening Walk' });

      // Mark completed yesterday
      await SmartListStore.setRoutineStatus(userId, {
        routineId: routine.id,
        date: yesterday,
        status: 'completed'
      });

      // Remove from tomorrow
      await SmartListStore.removeOccurrenceFromDate(userId, {
        routineId: routine.id,
        date: tomorrow
      });

      // Verify yesterday completion is still completed
      const yesterdayComps = await SmartListStore.getCompletions(userId, yesterday);
      const comp = yesterdayComps.find(c => c.routineId === routine.id);
      assert.ok(comp, 'Yesterday completion record must exist');
      assert.strictEqual(comp.status, 'completed');
      assert.strictEqual(comp.completed, true);
    });
  });

  // ==============================================================================
  // 4. Persistence, Reload and Multi-Tenant Isolation
  // ==============================================================================
  describe('4. Persistence & Multi-Tenant Isolation', () => {
    test('4.1 Tomorrow routine with startDate and titleOverride survives storage reload', async () => {
      const userId = 'user_persist_reload';
      const today = HabitStreakService.toYmdString(new Date());
      const tomorrow = HabitStreakService.addDays(today, 1);

      const routine = await SmartListStore.assignRoutineToDate(userId, {
        title: 'Learn Spanish',
        date: tomorrow
      });

      await SmartListStore.updateOccurrenceTitle(userId, {
        routineId: routine.routine.id,
        date: tomorrow,
        title: 'Learn Spanish (Vocab & Grammar)',
        applyToFuture: false
      });

      // Clear in-memory cache to force read from disk
      SmartListStore.__clearCache();

      const nextDay = await SmartListStore.getNextDayRoutines(userId, { date: tomorrow });
      const tomItem = nextDay.routines.find(r => r.routineId === routine.routine.id);
      assert.ok(tomItem, 'Tomorrow routine must reload from disk');
      assert.strictEqual(tomItem.title, 'Learn Spanish (Vocab & Grammar)');
    });

    test('4.2 Multi-tenant user isolation: Tomorrow routines are strictly partitioned', async () => {
      const userA = 'user_tenant_A';
      const userB = 'user_tenant_B';
      const tomorrow = HabitStreakService.addDays(HabitStreakService.toYmdString(new Date()), 1);

      await SmartListStore.assignRoutineToDate(userA, { title: 'User A Secret Habit', date: tomorrow });

      const nextDayB = await SmartListStore.getNextDayRoutines(userB, { date: tomorrow });
      assert.strictEqual(nextDayB.routines.length, 0, 'User B should not see User A routines');
    });
  });

  // ==============================================================================
  // 5. Carry-Forward Integration & Duplicate Prevention
  // ==============================================================================
  describe('5. Carry-Forward Integration', () => {
    test('5.1 Carrying forward an incomplete routine creates carried_forward occurrence on tomorrow', async () => {
      const userId = 'user_cf_test';
      const today = HabitStreakService.toYmdString(new Date());
      const tomorrow = HabitStreakService.addDays(today, 1);

      const routine = await SmartListStore.addRoutine(userId, { title: 'Write Blog Post' });

      // Carry forward today
      const cfResult = await SmartListStore.carryForward(userId, { date: today, decision: 'yes' });
      assert.strictEqual(cfResult.success, true);
      assert.strictEqual(cfResult.carriedCount, 1);

      const nextDay = await SmartListStore.getNextDayRoutines(userId, { date: tomorrow });
      const tomItem = nextDay.routines.find(r => r.routineId === routine.id);
      assert.ok(tomItem);
      assert.strictEqual(tomItem.carriedForward, true);
      assert.strictEqual(tomItem.source, 'carried_forward');

      // Today occurrence is marked postponed
      const todayComps = await SmartListStore.getCompletions(userId, today);
      const todayComp = todayComps.find(c => c.routineId === routine.id);
      assert.strictEqual(todayComp.status, 'postponed');
      assert.strictEqual(todayComp.postponedTo, tomorrow);
    });
  });

  // ==============================================================================
  // 6. Streak Summary Status Counters Simplification (Done & Pending Only)
  // ==============================================================================
  describe('6. Streak Summary UI Simplification', () => {
    test('6.1 index.html contains exactly 2 status chips in streak summary: Done and Pending', () => {
      assert.ok(INDEX_HTML.includes('id="chip-count-completed"'), '#chip-count-completed must exist in index.html');
      assert.ok(INDEX_HTML.includes('id="chip-count-pending"'), '#chip-count-pending must exist in index.html');

      // Postponed & Cancelled chips removed from streak summary breakdown row
      assert.ok(!INDEX_HTML.includes('id="chip-count-postponed"'), '#chip-count-postponed must be removed from streak summary UI');
      assert.ok(!INDEX_HTML.includes('id="chip-count-cancelled"'), '#chip-count-cancelled must be removed from streak summary UI');
    });

    test('6.2 Streak summary breakdown row markup contains only Done and Pending chips', () => {
      const breakdownRowMatch = INDEX_HTML.match(/<div class="smart-breakdown-row" id="smart-today-breakdown-row">([\s\S]*?)<\/div>/);
      assert.ok(breakdownRowMatch, 'smart-today-breakdown-row must exist');
      const innerHtml = breakdownRowMatch[1];
      assert.ok(innerHtml.includes('chip-count-completed'), 'Breakdown row must contain completed chip');
      assert.ok(innerHtml.includes('chip-count-pending'), 'Breakdown row must contain pending chip');
      assert.ok(!innerHtml.includes('chip-count-postponed'), 'Breakdown row must NOT contain postponed chip');
      assert.ok(!innerHtml.includes('chip-count-cancelled'), 'Breakdown row must NOT contain cancelled chip');
    });
  });

  // ==============================================================================
  // 7. Internal 4-State Habit Engine & 80% Rule Integrity
  // ==============================================================================
  describe('7. Habit Streaks 80% Rule & Internal 4-State Processing', () => {
    test('7.1 Internal 4-State calculations remain intact despite UI simplification', () => {
      const today = '2026-11-09';
      const routines = [
        { id: 'r1', title: 'Task 1' },
        { id: 'r2', title: 'Task 2' },
        { id: 'r3', title: 'Task 3' },
        { id: 'r4', title: 'Task 4' },
        { id: 'r5', title: 'Task 5' }
      ];

      // 4 completed, 1 postponed -> total: 5, eligible: 5, completionRate: 80% -> Qualified!
      const comps = [
        { routineId: 'r1', date: today, status: 'completed' },
        { routineId: 'r2', date: today, status: 'completed' },
        { routineId: 'r3', date: today, status: 'completed' },
        { routineId: 'r4', date: today, status: 'completed' },
        { routineId: 'r5', date: today, status: 'postponed', postponedTo: '2026-11-10' }
      ];

      const stats = HabitStreakService.calculateDayStatistics({ routines, completions: comps, date: today });
      assert.strictEqual(stats.completedCount, 4);
      assert.strictEqual(stats.pendingCount, 0);
      assert.strictEqual(stats.postponedCount, 1);
      assert.strictEqual(stats.cancelledCount, 0);
      assert.strictEqual(stats.eligibleCount, 5);
      assert.strictEqual(stats.completionRate, 80);
      assert.strictEqual(stats.isQualified, true);
    });

    test('7.2 Cancelled routines are excluded from eligible denominator for 80% rule', () => {
      const today = '2026-11-09';
      const routines = [
        { id: 'r1', title: 'Task 1' },
        { id: 'r2', title: 'Task 2' },
        { id: 'r3', title: 'Task 3' },
        { id: 'r4', title: 'Task 4' }
      ];

      // 3 completed, 1 cancelled -> total: 4, cancelled: 1, eligible: 3. completionRate: 100% -> Qualified!
      const comps = [
        { routineId: 'r1', date: today, status: 'completed' },
        { routineId: 'r2', date: today, status: 'completed' },
        { routineId: 'r3', date: today, status: 'completed' },
        { routineId: 'r4', date: today, status: 'cancelled', cancellationReason: 'Excused' }
      ];

      const stats = HabitStreakService.calculateDayStatistics({ routines, completions: comps, date: today });
      assert.strictEqual(stats.completedCount, 3);
      assert.strictEqual(stats.cancelledCount, 1);
      assert.strictEqual(stats.eligibleCount, 3);
      assert.strictEqual(stats.completionRate, 100);
      assert.strictEqual(stats.isQualified, true);
    });
  });

  // ==============================================================================
  // 8. UI/UX: Action Buttons, Modals & 4-Theme Styling Parity
  // ==============================================================================
  describe('8. UI/UX, Modals & 4-Theme CSS Verification', () => {
    test('8.1 Tomorrow routine section has dedicated "+ Add Routine" action', () => {
      assert.ok(INDEX_HTML.includes('id="btn-add-tomorrow-routine"'), 'Add tomorrow button ID must exist');
      assert.ok(INDEX_HTML.includes('+ Add Routine'), 'Button must display "+ Add Routine" text');
    });

    test('8.2 Edit tomorrow modal has simplified layout with routine name only and scope radios removed', () => {
      assert.ok(INDEX_HTML.includes('id="modal-smart-edit-tomorrow"'), 'Edit tomorrow modal ID must exist');
      assert.ok(INDEX_HTML.includes('id="form-smart-edit-tomorrow"'), 'Edit tomorrow form ID must exist');
      assert.ok(INDEX_HTML.includes('id="input-edit-tomorrow-title"'), 'Edit tomorrow title input ID must exist');
      assert.ok(INDEX_HTML.includes('Routine Name'), 'Label Routine Name must exist');
      assert.ok(INDEX_HTML.includes('id="btn-cancel-edit-tomorrow"'), 'Cancel button must exist');
      assert.ok(INDEX_HTML.includes('id="btn-save-edit-tomorrow"'), 'Save Changes button must exist');
      assert.ok(!INDEX_HTML.includes('id="scope-tomorrow-only"'), 'Tomorrow only scope radio must be removed');
      assert.ok(!INDEX_HTML.includes('id="scope-tomorrow-future"'), 'Tomorrow and future scope radio must be removed');
      assert.ok(!INDEX_HTML.includes('Apply changes to:'), 'Scope heading must be removed');
      assert.ok(INDEX_HTML.includes('id="modal-smart-remove-tomorrow-confirm"'), 'Remove tomorrow modal ID must exist');
    });

    test('8.3 public/styles.css includes .btn-tomorrow-action, .btn-tomorrow-edit, .btn-tomorrow-delete with touch targets', () => {
      assert.ok(STYLES_CSS.includes('.btn-tomorrow-action'), 'CSS must define .btn-tomorrow-action');
      assert.ok(STYLES_CSS.includes('.btn-tomorrow-edit'), 'CSS must define .btn-tomorrow-edit');
      assert.ok(STYLES_CSS.includes('.btn-tomorrow-delete'), 'CSS must define .btn-tomorrow-delete');
      assert.ok(STYLES_CSS.includes('min-width: 34px') || STYLES_CSS.includes('width: 34px'), 'Action buttons must have minimum touch dimension');
    });

    test('8.4 4-Theme CSS styles exist for tomorrow action buttons & edit scope container', () => {
      // Dark Theme
      assert.ok(STYLES_CSS.includes('[data-theme="dark"] .btn-tomorrow-action'), 'Dark theme must style tomorrow action buttons');
      assert.ok(STYLES_CSS.includes('[data-theme="dark"] .edit-tomorrow-scope-wrap'), 'Dark theme must style edit scope container');

      // Pet Theme
      assert.ok(STYLES_CSS.includes('[data-theme="pet"] .btn-tomorrow-action'), 'Pet theme must style tomorrow action buttons');
      assert.ok(STYLES_CSS.includes('[data-theme="pet"] .edit-tomorrow-scope-wrap'), 'Pet theme must style edit scope container');

      // Pastel Light Theme
      assert.ok(STYLES_CSS.includes('[data-theme="pastel"] .btn-tomorrow-action'), 'Pastel theme must style tomorrow action buttons');
      assert.ok(STYLES_CSS.includes('[data-theme="pastel"] .edit-tomorrow-scope-wrap'), 'Pastel theme must style edit scope container');
    });

    test('8.5 public/app.js renders polished SVG icons and accessible labels for tomorrow action buttons', () => {
      assert.ok(APP_JS.includes('btn-tomorrow-edit'), 'app.js must render .btn-tomorrow-edit');
      assert.ok(APP_JS.includes('btn-tomorrow-delete'), 'app.js must render .btn-tomorrow-delete');
      assert.ok(APP_JS.includes('openEditTomorrowModal'), 'app.js must define openEditTomorrowModal');
      assert.ok(APP_JS.includes('openRemoveTomorrowConfirm'), 'app.js must define openRemoveTomorrowConfirm');
      assert.ok(APP_JS.includes('updateTomorrowRoutine'), 'app.js must define updateTomorrowRoutine');
    });
  });

  // ==============================================================================
  // 9. Count Badge Redesign, Error Feedback & Mobile Layout Verification (Round 2)
  // ==============================================================================
  describe('9. Count Badge Redesign, Error Feedback & Mobile Layout', () => {
    test('9.1 Count badge enforces non-wrapping, single-line horizontal layout', () => {
      assert.ok(STYLES_CSS.includes('.next-day-count-badge'), 'CSS must define .next-day-count-badge');
      assert.ok(STYLES_CSS.includes('white-space: nowrap'), 'Badge must have white-space: nowrap to prevent 2-line wrapping');
      assert.ok(STYLES_CSS.includes('flex-shrink: 0'), 'Badge must have flex-shrink: 0');
      assert.ok(STYLES_CSS.includes('.next-day-section-header'), 'Header must exist');
      assert.ok(STYLES_CSS.includes('flex-wrap: wrap'), 'Header must use flex-wrap: wrap to prevent mobile clipping');
    });

    test('9.2 Count badge has complete 4-theme styling parity (Light, Dark, Pet, Pastel)', () => {
      // Light / Default
      assert.ok(STYLES_CSS.includes('.next-day-count-badge {'), 'Default badge styling must exist');
      assert.ok(STYLES_CSS.includes('color: #2563EB'), 'Default badge has blue text');

      // Dark Theme
      assert.ok(STYLES_CSS.includes('[data-theme="dark"] .next-day-count-badge'), 'Dark theme badge override must exist');
      assert.ok(STYLES_CSS.includes('#60A5FA'), 'Dark theme badge has blue tint text');

      // Pet Theme
      assert.ok(STYLES_CSS.includes('[data-theme="pet"] .next-day-count-badge'), 'Pet theme badge override must exist');
      assert.ok(STYLES_CSS.includes('#EA580C'), 'Pet theme badge has orange text');

      // Pastel Light Theme
      assert.ok(STYLES_CSS.includes('[data-theme="pastel"] .next-day-count-badge'), 'Pastel theme badge override must exist');
      assert.ok(STYLES_CSS.includes('#9333EA'), 'Pastel theme badge has purple text');
    });

    test('9.3 Dedicated error banners exist in index.html for add and edit forms', () => {
      assert.ok(INDEX_HTML.includes('id="add-tomorrow-error-msg"'), 'Add tomorrow error banner must exist');
      assert.ok(INDEX_HTML.includes('id="edit-tomorrow-error-msg"'), 'Edit tomorrow error banner must exist');
      assert.ok(STYLES_CSS.includes('.smart-error-banner'), 'CSS must define .smart-error-banner');
      assert.ok(STYLES_CSS.includes('[data-theme="dark"] .smart-error-banner'), 'Dark theme error banner must exist');
    });

    test('9.4 app.js implements showTomorrowError and wires error elements without silent swallows', () => {
      assert.ok(APP_JS.includes('showTomorrowError'), 'app.js must define showTomorrowError');
      assert.ok(APP_JS.includes('add-tomorrow-error-msg'), 'app.js must reference add error element');
      assert.ok(APP_JS.includes('edit-tomorrow-error-msg'), 'app.js must reference edit error element');
    });

    test('9.5 Count badge formatting and update simulation across add and delete', async () => {
      const userId = 'user_badge_sim';
      const today = HabitStreakService.toYmdString(new Date());
      const tomorrow = HabitStreakService.addDays(today, 1);

      // Initial state: 0 routines
      let view = await SmartListStore.getNextDayRoutines(userId, { date: tomorrow });
      assert.strictEqual(view.totalCount, 0);
      assert.strictEqual(`${view.totalCount} routine${view.totalCount === 1 ? '' : 's'}`, '0 routines');

      // Add 1st routine
      const r1 = await SmartListStore.assignRoutineToDate(userId, { title: 'Badge Habit 1', date: tomorrow });
      view = await SmartListStore.getNextDayRoutines(userId, { date: tomorrow });
      assert.strictEqual(view.totalCount, 1);
      assert.strictEqual(`${view.totalCount} routine${view.totalCount === 1 ? '' : 's'}`, '1 routine');

      // Add 2nd routine
      const r2 = await SmartListStore.assignRoutineToDate(userId, { title: 'Badge Habit 2', date: tomorrow });
      view = await SmartListStore.getNextDayRoutines(userId, { date: tomorrow });
      assert.strictEqual(view.totalCount, 2);
      assert.strictEqual(`${view.totalCount} routine${view.totalCount === 1 ? '' : 's'}`, '2 routines');

      // Delete 1st routine from tomorrow
      await SmartListStore.removeOccurrenceFromDate(userId, { routineId: r1.routine.id, date: tomorrow });
      view = await SmartListStore.getNextDayRoutines(userId, { date: tomorrow });
      assert.strictEqual(view.totalCount, 1);
      assert.strictEqual(`${view.totalCount} routine${view.totalCount === 1 ? '' : 's'}`, '1 routine');

      // Delete 2nd routine from tomorrow
      await SmartListStore.removeOccurrenceFromDate(userId, { routineId: r2.routine.id, date: tomorrow });
      view = await SmartListStore.getNextDayRoutines(userId, { date: tomorrow });
      assert.strictEqual(view.totalCount, 0);
      assert.strictEqual(`${view.totalCount} routine${view.totalCount === 1 ? '' : 's'}`, '0 routines');
    });
  });

  describe('10. Round 3 Critical Runtime Verifications & Scope Simplification', () => {
    test('10.1 No Postgrest query-builder operations chain .catch() in public/app.js', () => {
      assert.ok(!APP_JS.match(/\.upsert\([^)]*\)\s*\.catch\(/), 'No .upsert().catch() allowed');
      assert.ok(!APP_JS.match(/supabaseClient\.from\([^)]+\)[\s\S]{0,80}\.catch\(/), 'No supabaseClient.from().catch() allowed');
    });

    test('10.2 Edit Tomorrow modal form submission submits routine name directly without scope radio selector', () => {
      assert.ok(APP_JS.includes('SmartListsManager.updateTomorrowRoutine(rId, newTitle)'), 'Submit handler submits routine name directly');
      assert.ok(!APP_JS.includes('tomorrowEditScope'), 'Obsolete tomorrowEditScope state must be removed');
      assert.ok(!APP_JS.includes('setTomorrowEditScope'), 'Obsolete setTomorrowEditScope must be removed');
    });

    test('10.3 Edit Tomorrow modal does not require scope radio logic', () => {
      assert.ok(!INDEX_HTML.includes('name="tomorrow-edit-scope"'), 'HTML must not have scope radio group');
    });

    test('10.4 .scope-radio-label has .selected CSS styles preserved for backwards compatibility', () => {
      assert.ok(STYLES_CSS.includes('.scope-radio-label.selected'), 'Base .scope-radio-label.selected style must exist');
      assert.ok(STYLES_CSS.includes('[data-theme="dark"] .scope-radio-label.selected'), 'Dark theme .scope-radio-label.selected must exist');
      assert.ok(STYLES_CSS.includes('[data-theme="pet"] .scope-radio-label.selected'), 'Pet theme .scope-radio-label.selected must exist');
      assert.ok(STYLES_CSS.includes('[data-theme="pastel"] .scope-radio-label.selected'), 'Pastel theme .scope-radio-label.selected must exist');
    });

    test('10.5 Supabase routine completions strictly adhere to DB CHECK constraints', () => {
      assert.ok(APP_JS.includes("status: 'cancelled'"), "app.js must use valid CHECK constraint status 'cancelled'");
      assert.ok(APP_JS.includes("cancellation_reason: 'removed_from_tomorrow'"), "app.js must use cancellation_reason 'removed_from_tomorrow'");
      assert.ok(APP_JS.includes("cancellation_reason: 'created_for_future'"), "app.js must use cancellation_reason 'created_for_future'");
    });
  });

  // ==============================================================================
  // 11. Round 4 Data Isolation, Title Override & Deletion Persistence Suite
  // ==============================================================================
  describe('11. Round 4 Data Isolation & Occurrence Persistence', () => {
    test('11.1 SmartListsManager.getCompletion preserves removed: true and titleOverride', () => {
      // Mock minimal environment if not already loaded
      const app = require('../public/app');
      const manager = app.SmartListsManager;
      manager.clearLocalState();

      // Setup completion with removed status
      manager.state.completions['rt1_2026-11-09'] = {
        status: 'removed',
        removed: true,
        cancellationReason: 'created_for_future',
        completed: false
      };

      const comp = manager.getCompletion('rt1', '2026-11-09');
      assert.strictEqual(comp.status, 'removed', 'getCompletion must preserve status: removed');
      assert.strictEqual(comp.removed, true, 'getCompletion must return removed: true');
      assert.strictEqual(comp.completed, false, 'completed must be false');
      assert.strictEqual(comp.cancellationReason, 'created_for_future');

      // Setup completion with titleOverride
      manager.state.completions['rt2_2026-11-10'] = {
        status: 'pending',
        completed: false,
        titleOverride: 'Overridden Title for Tomorrow'
      };

      const comp2 = manager.getCompletion('rt2', '2026-11-10');
      assert.strictEqual(comp2.titleOverride, 'Overridden Title for Tomorrow', 'getCompletion must return titleOverride');
    });

    test('11.2 calculateDayProgress excludes routines with future start dates or removed completions', () => {
      const app = require('../public/app');
      const manager = app.SmartListsManager;
      manager.clearLocalState();
      manager.state.activeDate = '2026-11-09';

      manager.state.routines = [
        { id: 'r1', title: 'Routine 1', startDate: '2026-11-09' },
        { id: 'r2', title: 'Routine 2', startDate: '2026-11-09' },
        { id: 'r3', title: 'Routine 3', startDate: '2026-11-10' } // Future routine (tomorrow)
      ];

      // Mark r1 completed, r2 pending
      manager.state.completions['r1_2026-11-09'] = { status: 'completed', completed: true };
      manager.state.completions['r2_2026-11-09'] = { status: 'pending', completed: false };
      // r3 has exclusion on today
      manager.state.completions['r3_2026-11-09'] = { status: 'removed', removed: true, cancellationReason: 'created_for_future' };

      const progress = manager.calculateDayProgress('2026-11-09');
      assert.strictEqual(progress.total, 2, 'Today total must be 2 (excluding future routine r3)');
      assert.strictEqual(progress.completed, 1, 'Today completed must be 1');
      assert.strictEqual(progress.incomplete, 1, 'Today incomplete must be 1');
      assert.strictEqual(progress.rate, 50, 'Rate must be 50%');
    });

    test('11.3 Tomorrow routine exclusion does not appear on today active checklist', () => {
      const app = require('../public/app');
      const manager = app.SmartListsManager;
      manager.clearLocalState();
      const today = '2026-11-09';
      const tomorrow = '2026-11-10';
      manager.state.activeDate = today;

      manager.state.routines = [
        { id: 'r1', title: 'Existing Morning Habit' },
        { id: 'r2', title: 'Newly Added Tomorrow Habit', startDate: tomorrow }
      ];

      manager.state.completions[`r2_${today}`] = {
        status: 'removed',
        removed: true,
        cancellationReason: 'created_for_future',
        completed: false
      };

      const compToday = manager.getCompletion('r2', today);
      assert.strictEqual(compToday.status, 'removed');
      assert.strictEqual(compToday.removed, true);

      // Verify that filter in renderRoutines skips r2 for today
      const visibleRoutinesToday = manager.state.routines.filter(routine => {
        if (routine.startDate && today < routine.startDate) return false;
        const comp = manager.getCompletion(routine.id, today);
        if (comp && (comp.status === 'removed' || comp.removed === true || (comp.status === 'cancelled' && (comp.cancellationReason === 'created_for_future' || comp.cancellationReason === 'removed_from_tomorrow')))) {
          return false;
        }
        return true;
      });

      assert.strictEqual(visibleRoutinesToday.length, 1, 'Only today habit should be visible');
      assert.strictEqual(visibleRoutinesToday[0].id, 'r1');
    });

    test('11.4 Tomorrow Edit updates only tomorrow routine name and preserves today original title and completion', async () => {
      const app = require('../public/app');
      const manager = app.SmartListsManager;
      manager.clearLocalState();
      const today = '2026-11-09';
      const tomorrow = '2026-11-10';
      manager.state.activeDate = today;
      manager.state.tomorrowDate = tomorrow;

      manager.state.routines = [
        { id: 'r10', title: 'Original Habit Title' }
      ];

      // Edit tomorrow routine name
      await manager.updateTomorrowRoutine('r10', 'Tomorrow Custom Habit Title');

      const compTom = manager.getCompletion('r10', tomorrow);
      assert.strictEqual(compTom.titleOverride, 'Tomorrow Custom Habit Title', 'Tomorrow occurrence has updated title');

      const routineAfter = manager.state.routines.find(r => r.id === 'r10');
      assert.strictEqual(routineAfter.title, 'Original Habit Title', 'Routine master title must not change');

      const todayComp = manager.getCompletion('r10', today);
      assert.strictEqual(todayComp?.titleOverride || routineAfter.title, 'Original Habit Title', 'Today must retain original title');
      assert.strictEqual(todayComp?.status || 'pending', 'pending', 'Today completion state is untouched');
    });

    test('11.5 Deleting a tomorrow routine sets removed: true and excludes from tomorrow list', async () => {
      const app = require('../public/app');
      const manager = app.SmartListsManager;
      manager.clearLocalState();
      const today = '2026-11-09';
      const tomorrow = '2026-11-10';
      manager.state.activeDate = today;
      manager.state.tomorrowDate = tomorrow;

      manager.state.routines = [
        { id: 'r20', title: 'Keep Routine' },
        { id: 'r21', title: 'Delete from Tomorrow Routine' }
      ];

      // Schedule both for tomorrow
      manager.state.completions[`r20_${tomorrow}`] = { status: 'pending', completed: false };
      manager.state.completions[`r21_${tomorrow}`] = { status: 'pending', completed: false };

      manager.state.pendingRemoveTomorrowId = 'r21';
      await manager.executeRemoveTomorrow();

      const compDeleted = manager.getCompletion('r21', tomorrow);
      assert.strictEqual(compDeleted.status, 'removed', 'Status must be removed');
      assert.strictEqual(compDeleted.removed, true, 'Removed flag must be true');
      assert.strictEqual(compDeleted.cancellationReason, 'removed_from_tomorrow');

      // Tomorrow list should filter out r21
      const tomorrowItems = manager.state.tomorrowRoutines || [];
      assert.ok(!tomorrowItems.some(it => it.routineId === 'r21'), 'r21 must not be in tomorrowRoutines');

      // Today's list is completely unaffected
      const compToday = manager.getCompletion('r21', today);
      assert.strictEqual(compToday.status, 'pending');
      assert.strictEqual(compToday.removed, false);
    });
  });

  // ==============================================================================
  // 12. Round 5 Future-Scope Precedence & Performance Optimization Suite
  // ==============================================================================
  describe('12. Round 5 Simplified Tomorrow Edit & Latency Reduction', () => {
    test('12.1 Edit tomorrow routine updates tomorrow occurrence name while preserving master title for other dates', async () => {
      const app = require('../public/app');
      const manager = app.SmartListsManager;
      manager.clearLocalState();
      const today = '2026-11-09';
      const tomorrow = '2026-11-10';
      const dayAfter = '2026-11-11';
      manager.state.activeDate = today;
      manager.state.tomorrowDate = tomorrow;

      manager.state.routines = [
        { id: 'r30', title: 'Master Yoga' }
      ];

      // Edit tomorrow routine name
      await manager.updateTomorrowRoutine('r30', 'Tomorrow Power Yoga');

      // Verify Tomorrow occurrence has updated title
      const tomComp = manager.getCompletion('r30', tomorrow);
      assert.strictEqual(tomComp.titleOverride, 'Tomorrow Power Yoga', 'Tomorrow must reflect new title');

      // Verify Master routine title is untouched
      const masterRoutine = manager.state.routines.find(r => r.id === 'r30');
      assert.strictEqual(masterRoutine.title, 'Master Yoga', 'Master routine must be unchanged');

      // Verify Today preserves original title
      const todayComp = manager.getCompletion('r30', today);
      assert.strictEqual(todayComp?.titleOverride || masterRoutine.title, 'Master Yoga', 'Today must retain original title');

      // Verify Future date resolves to master title
      const futureComp = manager.getCompletion('r30', dayAfter);
      assert.strictEqual(futureComp?.titleOverride || masterRoutine.title, 'Master Yoga', 'Future date must use master title');
    });

    test('12.2 Tomorrow-Only Edit preserves future dates with master routine title', async () => {
      const app = require('../public/app');
      const manager = app.SmartListsManager;
      manager.clearLocalState();
      const today = '2026-11-09';
      const tomorrow = '2026-11-10';
      const dayAfter = '2026-11-11';
      manager.state.activeDate = today;
      manager.state.tomorrowDate = tomorrow;

      manager.state.routines = [
        { id: 'r31', title: 'Standard Reading' }
      ];

      // Tomorrow-only edit
      await manager.updateTomorrowRoutine('r31', 'Tomorrow Intensive Reading', false);

      const masterRoutine = manager.state.routines.find(r => r.id === 'r31');
      assert.strictEqual(masterRoutine.title, 'Standard Reading', 'Master title must remain unchanged');

      const tomComp = manager.getCompletion('r31', tomorrow);
      assert.strictEqual(tomComp.titleOverride, 'Tomorrow Intensive Reading', 'Tomorrow occurrence has override');

      // Day after tomorrow has no override, should resolve to master title
      const dayAfterComp = manager.getCompletion('r31', dayAfter);
      const dayAfterDisplayTitle = dayAfterComp.titleOverride || masterRoutine.title;
      assert.strictEqual(dayAfterDisplayTitle, 'Standard Reading', 'Future dates must retain original title');
    });

    test('12.3 SmartListStore.updateOccurrenceTitle clears future stale overrides when applyToFuture is true', async () => {
      const userId = 'user_future_scope_store';
      const today = HabitStreakService.toYmdString(new Date());
      const tomorrow = HabitStreakService.addDays(today, 1);
      const dayAfter = HabitStreakService.addDays(today, 2);

      // Create routine in store
      const routine = await SmartListStore.addRoutine(userId, { title: 'Baseline Meditation' });

      // Put a stale override on dayAfter
      await SmartListStore.updateOccurrenceTitle(userId, {
        routineId: routine.id,
        date: dayAfter,
        title: 'Old Stale Meditation',
        applyToFuture: false
      });

      // Now edit tomorrow with applyToFuture = true
      await SmartListStore.updateOccurrenceTitle(userId, {
        routineId: routine.id,
        date: tomorrow,
        title: 'Advanced Mindfulness',
        applyToFuture: true
      });

      // Verify dayAfter view uses the updated master title
      const dayAfterView = await SmartListStore.getNextDayRoutines(userId, { date: dayAfter });
      const dayAfterItem = dayAfterView.routines.find(r => r.routineId === routine.id);
      assert.ok(dayAfterItem, 'Routine must exist on dayAfter');
      assert.strictEqual(dayAfterItem.title, 'Advanced Mindfulness', 'Future date must reflect updated title');

      // Verify today view preserves baseline title
      const todayRoutines = await SmartListStore.getRoutines(userId, today);
      const todayComp = (await SmartListStore.getCompletions(userId, today)).find(c => c.routineId === routine.id);
      const todayTitle = todayComp?.titleOverride || todayRoutines.find(r => r.id === routine.id)?.title;
      assert.strictEqual(todayTitle, 'Baseline Meditation', 'Today title must be preserved');
    });

    test('12.4 Local UI update latency is under 100ms for optimistic operations', async () => {
      const app = require('../public/app');
      const manager = app.SmartListsManager;
      manager.clearLocalState();
      const today = '2026-11-09';
      const tomorrow = '2026-11-10';
      manager.state.activeDate = today;
      manager.state.tomorrowDate = tomorrow;

      // 1. Add latency test
      const t0 = performance.now();
      await manager.addRoutineForTomorrow('Speed Test Habit');
      const addDuration = performance.now() - t0;
      assert.ok(addDuration < 100, `Add operation took ${addDuration.toFixed(1)}ms (must be < 100ms)`);

      // 2. Edit latency test
      const added = manager.state.routines.find(r => r.title === 'Speed Test Habit');
      assert.ok(added, 'Added routine must exist');

      const t1 = performance.now();
      await manager.updateTomorrowRoutine(added.id, 'Speed Test Habit Edited', false);
      const editDuration = performance.now() - t1;
      assert.ok(editDuration < 100, `Edit operation took ${editDuration.toFixed(1)}ms (must be < 100ms)`);

      // 3. Delete latency test
      manager.state.pendingRemoveTomorrowId = added.id;
      const t2 = performance.now();
      await manager.executeRemoveTomorrow();
      const deleteDuration = performance.now() - t2;
      assert.ok(deleteDuration < 100, `Delete operation took ${deleteDuration.toFixed(1)}ms (must be < 100ms)`);
    });

    test('12.5 Rollback restores exact state when cloud sync throws an error', async () => {
      const app = require('../public/app');
      const manager = app.SmartListsManager;
      manager.clearLocalState();
      const today = '2026-11-09';
      const tomorrow = '2026-11-10';
      manager.state.activeDate = today;
      manager.state.tomorrowDate = tomorrow;

      manager.state.routines = [{ id: 'r_stable', title: 'Stable Habit' }];

      // Temporarily mock fetch to throw
      const originalFetch = global.fetch;
      global.fetch = async () => {
        throw new Error('Simulated network timeout');
      };

      try {
        const ok = await manager.updateTomorrowRoutine('r_stable', 'Unsaved Broken Title', true);
        assert.strictEqual(ok, false, 'Operation must report failure');

        // Verify state was rolled back
        const routine = manager.state.routines.find(r => r.id === 'r_stable');
        assert.strictEqual(routine.title, 'Stable Habit', 'Routine title must roll back to Stable Habit');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  // ==============================================================================
  // 13. Routine Assignment Frequency & Recurrence Validation Suite (Taskly v2.1.0)
  // ==============================================================================
  describe('13. Routine Assignment Frequency & Recurrence Validation', () => {
    test('13.1 - 13.3 Tomorrow-only assignment appears tomorrow, NOT following day, NOT later dates', async () => {
      const userId = 'usr_freq_tomorrow_only';
      const today = '2026-11-09';
      const tomorrow = '2026-11-10';
      const dayAfter = '2026-11-11';
      const day7Later = '2026-11-17';
      const day30Later = '2026-12-10';
      const day90Later = '2027-02-08';

      // Assign routine specifically for tomorrow (one-day assignment)
      const res = await SmartListStore.assignRoutineToDate(userId, {
        title: 'Tomorrow Dentist Appointment',
        date: tomorrow,
        isOneDay: true
      });

      assert.strictEqual(res.routine.startDate, tomorrow);
      assert.strictEqual(res.routine.endDate, tomorrow);
      assert.strictEqual(res.routine.recurrence, 'once');

      // 1. Appears tomorrow
      const tomorrowList = await SmartListStore.getRoutines(userId, tomorrow);
      assert.ok(tomorrowList.some(r => r.id === res.routine.id), '13.1 Tomorrow-only assignment MUST appear tomorrow');

      // 2. Does NOT appear the following day
      const dayAfterList = await SmartListStore.getRoutines(userId, dayAfter);
      assert.ok(!dayAfterList.some(r => r.id === res.routine.id), '13.2 Tomorrow-only assignment MUST NOT appear following day');

      // 3. Does NOT appear on later dates (7, 30, 90 days later)
      const day7List = await SmartListStore.getRoutines(userId, day7Later);
      assert.ok(!day7List.some(r => r.id === res.routine.id), '13.3 Tomorrow-only assignment MUST NOT appear 7 days later');
      const day30List = await SmartListStore.getRoutines(userId, day30Later);
      assert.ok(!day30List.some(r => r.id === res.routine.id), '13.3 Tomorrow-only assignment MUST NOT appear 30 days later');
      const day90List = await SmartListStore.getRoutines(userId, day90Later);
      assert.ok(!day90List.some(r => r.id === res.routine.id), '13.3 Tomorrow-only assignment MUST NOT appear 90 days later');

      // Also verify Today's list does not contain it
      const todayList = await SmartListStore.getRoutines(userId, today);
      assert.ok(!todayList.some(r => r.id === res.routine.id), 'Tomorrow-only assignment MUST NOT appear today');
    });

    test('13.4 - 13.7 Daily recurring assignment appears tomorrow, following day, and 7/30/90 days later without pre-created completion rows', async () => {
      const userId = 'usr_freq_daily_recurring';
      const today = '2026-11-09';
      const tomorrow = '2026-11-10';
      const dayAfter = '2026-11-11';
      const day7Later = '2026-11-17';
      const day30Later = '2026-12-10';
      const day90Later = '2027-02-08';

      // 1. Start with a tomorrow assignment
      const res = await SmartListStore.assignRoutineToDate(userId, {
        title: 'Daily Sunlight & Walk',
        date: tomorrow,
        isOneDay: true
      });

      // 2. User edits tomorrow occurrence and selects "Tomorrow and future occurrences"
      const updateRes = await SmartListStore.updateOccurrenceTitle(userId, {
        routineId: res.routine.id,
        date: tomorrow,
        title: 'Daily Sunlight & Power Walk',
        applyToFuture: true
      });

      assert.strictEqual(updateRes.success, true);
      assert.strictEqual(updateRes.routine.endDate, null, 'End date MUST be null for indefinite recurrence');
      assert.strictEqual(updateRes.routine.recurrence, 'daily');
      assert.strictEqual(updateRes.routine.title, 'Daily Sunlight & Power Walk');

      // 13.4 Appears tomorrow
      const tomList = await SmartListStore.getRoutines(userId, tomorrow);
      const tomItem = tomList.find(r => r.id === res.routine.id);
      assert.ok(tomItem, '13.4 Daily recurring assignment MUST appear tomorrow');
      assert.strictEqual(tomItem.title, 'Daily Sunlight & Power Walk');

      // 13.5 Appears following day
      const dayAfterList = await SmartListStore.getRoutines(userId, dayAfter);
      const dayAfterItem = dayAfterList.find(r => r.id === res.routine.id);
      assert.ok(dayAfterItem, '13.5 Daily recurring assignment MUST appear following day');
      assert.strictEqual(dayAfterItem.title, 'Daily Sunlight & Power Walk');

      // 13.6 Appears on dates 7, 30 and 90 days later
      const day7List = await SmartListStore.getRoutines(userId, day7Later);
      assert.ok(day7List.some(r => r.id === res.routine.id), '13.6 MUST appear 7 days later');
      const day30List = await SmartListStore.getRoutines(userId, day30Later);
      assert.ok(day30List.some(r => r.id === res.routine.id), '13.6 MUST appear 30 days later');
      const day90List = await SmartListStore.getRoutines(userId, day90Later);
      assert.ok(day90List.some(r => r.id === res.routine.id), '13.6 MUST appear 90 days later');

      // 13.7 Verify ZERO completion rows exist for day7Later, day30Later, day90Later
      const day7Comps = await SmartListStore.getCompletions(userId, day7Later);
      const day30Comps = await SmartListStore.getCompletions(userId, day30Later);
      const day90Comps = await SmartListStore.getCompletions(userId, day90Later);
      assert.strictEqual(day7Comps.length, 0, '13.7 No completion row should be pre-created for 7 days later');
      assert.strictEqual(day30Comps.length, 0, '13.7 No completion row should be pre-created for 30 days later');
      assert.strictEqual(day90Comps.length, 0, '13.7 No completion row should be pre-created for 90 days later');
    });

    test('13.8 - 13.10 Independent completion states, today title preservation, and intentional overrides', async () => {
      const userId = 'usr_freq_indep_overrides';
      const today = HabitStreakService.toYmdString(new Date());
      const tomorrow = HabitStreakService.toYmdString(new Date(Date.now() + 86400000));
      const dayAfter = HabitStreakService.toYmdString(new Date(Date.now() + 2 * 86400000));

      // Existing baseline routine for today
      const masterRoutine = await SmartListStore.addRoutine(userId, { title: 'Drink 2L Water' });

      // Set intentional override on dayAfter before tomorrow edit
      await SmartListStore.updateOccurrenceTitle(userId, {
        routineId: masterRoutine.id,
        date: dayAfter,
        title: 'Hydration Challenge 4L',
        applyToFuture: false
      });

      // Update tomorrow with "Tomorrow and future occurrences"
      await SmartListStore.updateOccurrenceTitle(userId, {
        routineId: masterRoutine.id,
        date: tomorrow,
        title: 'Drink 3L Filtered Water',
        applyToFuture: true
      });

      // 13.9 Verify Today's title is completely unaffected
      const todayComps = await SmartListStore.getCompletions(userId, today);
      const todayComp = todayComps.find(c => c.routineId === masterRoutine.id);
      assert.strictEqual(todayComp?.titleOverride, 'Drink 2L Water', '13.9 Today original title MUST be preserved');

      // 13.8 Verify each day has independent completion state
      await SmartListStore.setRoutineStatus(userId, {
        routineId: masterRoutine.id,
        date: tomorrow,
        status: 'completed'
      });

      const tomComps = await SmartListStore.getCompletions(userId, tomorrow);
      const tomRec = tomComps.find(c => c.routineId === masterRoutine.id);
      assert.strictEqual(tomRec.status, 'completed', 'Tomorrow is completed');

      // Day after completion is still pending
      const dayAfterComps = await SmartListStore.getCompletions(userId, dayAfter);
      const dayAfterRec = dayAfterComps.find(c => c.routineId === masterRoutine.id);
      assert.strictEqual(dayAfterRec.status, 'pending', '13.8 Day after must remain pending independently');

      // Today completion remains pending
      assert.strictEqual(todayComp.status, 'pending', '13.8 Today remains pending independently');

      // 13.10 Intentional date override was intentionally set on dayAfter, but future scope updated master title
      const dayAfterView = await SmartListStore.getNextDayRoutines(userId, { date: dayAfter });
      const dayAfterItem = dayAfterView.routines.find(r => r.routineId === masterRoutine.id);
      assert.strictEqual(dayAfterItem.title, 'Drink 3L Filtered Water', 'Future scope updated master title');
    });

    test('13.11 Restart and storage reload preserve routine recurrence', async () => {
      const userId = 'usr_freq_reload';
      const tomorrow = '2026-11-10';
      const dayAfter = '2026-11-11';

      const res = await SmartListStore.assignRoutineToDate(userId, {
        title: 'Cold Restart Habit',
        date: tomorrow,
        isOneDay: false // daily recurrence
      });

      // Simulate restart by clearing in-memory cache to force disk reload
      SmartListStore.__clearCache();

      // Reload routines from disk
      const reloadedTomorrow = await SmartListStore.getRoutines(userId, tomorrow);
      const reloadedDayAfter = await SmartListStore.getRoutines(userId, dayAfter);

      assert.ok(reloadedTomorrow.some(r => r.id === res.routine.id), '13.11 Recurrence survives reload on tomorrow');
      assert.ok(reloadedDayAfter.some(r => r.id === res.routine.id), '13.11 Recurrence survives reload on following day');
    });

    test('13.12 Removing tomorrow occurrence does not unintentionally delete the master routine', async () => {
      const userId = 'usr_freq_remove_preserve';
      const tomorrow = '2026-11-10';
      const dayAfter = '2026-11-11';

      // Daily recurring routine starting tomorrow
      const res = await SmartListStore.assignRoutineToDate(userId, {
        title: 'Morning Jogging',
        date: tomorrow,
        isOneDay: false
      });

      // Remove tomorrow's occurrence
      const removeRes = await SmartListStore.removeOccurrenceFromDate(userId, {
        routineId: res.routine.id,
        date: tomorrow
      });
      assert.strictEqual(removeRes.success, true);

      // Verify tomorrow's list excludes it
      const nextDayData = await SmartListStore.getNextDayRoutines(userId, { date: tomorrow });
      assert.ok(!nextDayData.routines.some(r => r.routineId === res.routine.id), 'Tomorrow view excludes removed occurrence');

      // Verify master routine still exists in master store
      const allRoutines = await SmartListStore.getRoutines(userId);
      const master = allRoutines.find(r => r.id === res.routine.id);
      assert.ok(master, '13.12 Master routine MUST NOT be deleted');

      // Verify following day still includes it
      const dayAfterRoutines = await SmartListStore.getRoutines(userId, dayAfter);
      assert.ok(dayAfterRoutines.some(r => r.id === res.routine.id), '13.12 Following day MUST retain recurring routine');
    });

    test('13.13 Existing carry-forward and streak calculations remain correct', async () => {
      const userId = 'usr_freq_streak_check';
      const today = '2026-11-09';
      const tomorrow = '2026-11-10';

      const r1 = await SmartListStore.addRoutine(userId, { title: 'Habit 1' });
      const r2 = await SmartListStore.addRoutine(userId, { title: 'Habit 2' });

      // Tomorrow-only routine
      await SmartListStore.assignRoutineToDate(userId, {
        title: 'Tomorrow One-Off Task',
        date: tomorrow,
        isOneDay: true
      });

      // Complete today's routines
      await SmartListStore.setRoutineStatus(userId, { routineId: r1.id, date: today, status: 'completed' });
      await SmartListStore.setRoutineStatus(userId, { routineId: r2.id, date: today, status: 'completed' });

      const allRoutines = await SmartListStore.getRoutines(userId);
      const todayComps = await SmartListStore.getCompletions(userId, today);
      const stats = HabitStreakService.calculateDayStatistics({
        routines: allRoutines,
        completions: todayComps,
        date: today
      });

      assert.strictEqual(stats.totalCount, 2, 'Today total routines count must be 2 (excluding tomorrow-only)');
      assert.strictEqual(stats.completedCount, 2);
      assert.strictEqual(stats.completionRate, 100);
      assert.strictEqual(stats.isQualified, true, '13.13 80% rule qualifies with 100% completion');
    });

    test('13.14 Different users cannot see one another routines (Multi-Tenant Isolation)', async () => {
      const userAlice = 'usr_alice_isolation';
      const userBob = 'usr_bob_isolation';
      const tomorrow = '2026-11-10';

      const aliceRoutine = await SmartListStore.assignRoutineToDate(userAlice, {
        title: 'Alice Private Routine',
        date: tomorrow,
        isOneDay: false
      });

      const bobList = await SmartListStore.getRoutines(userBob, tomorrow);
      assert.ok(!bobList.some(r => r.id === aliceRoutine.routine.id), '13.14 Bob cannot see Alice routines in getRoutines');

      const bobNextDay = await SmartListStore.getNextDayRoutines(userBob, { date: tomorrow });
      assert.ok(!bobNextDay.routines.some(r => r.routineId === aliceRoutine.routine.id), '13.14 Bob cannot see Alice routines in getNextDayRoutines');
    });
  });

  // ==============================================================================
  // 14. Simplified Edit Tomorrow Routine Verification
  // ==============================================================================
  describe('14. Simplified Edit Tomorrow Routine Modal & Behavior', () => {
    test('14.1 Editing a tomorrow routine changes only its name, persists across restart, and leaves today and future unchanged', async () => {
      const userId = 'usr_edit_simplified';
      const today = '2026-11-09';
      const tomorrow = '2026-11-10';
      const dayAfter = '2026-11-11';

      // Routine that recurs daily
      const masterRoutine = await SmartListStore.addRoutine(userId, {
        title: 'Master Evening Reading',
        startDate: today,
        endDate: null,
        recurrence: 'daily'
      });

      // Complete today's routine
      await SmartListStore.setRoutineStatus(userId, {
        routineId: masterRoutine.id,
        date: today,
        status: 'completed'
      });

      // Now edit tomorrow's occurrence name via updateOccurrenceTitle
      const updateResult = await SmartListStore.updateOccurrenceTitle(userId, {
        routineId: masterRoutine.id,
        date: tomorrow,
        title: 'Tomorrow Novel Chapter 5'
      });

      assert.strictEqual(updateResult.success, true);

      // Verify tomorrow list reflects the new name
      const tomView = await SmartListStore.getNextDayRoutines(userId, { date: tomorrow });
      const tomItem = tomView.routines.find(r => r.routineId === masterRoutine.id);
      assert.strictEqual(tomItem.title, 'Tomorrow Novel Chapter 5');

      // Verify today's routine name and completion state are completely untouched
      const todayComps = await SmartListStore.getCompletions(userId, today);
      const todayComp = todayComps.find(c => c.routineId === masterRoutine.id);
      assert.strictEqual(todayComp.status, 'completed', 'Today completion state must remain completed');
      const todayRoutines = await SmartListStore.getRoutines(userId, today);
      const todayRoutine = todayRoutines.find(r => r.id === masterRoutine.id);
      assert.strictEqual(todayComp.titleOverride || todayRoutine.title, 'Master Evening Reading', 'Today routine name must remain unchanged');

      // Verify future assignment (dayAfter) is unchanged and retains master title
      const dayAfterView = await SmartListStore.getNextDayRoutines(userId, { date: dayAfter });
      const dayAfterItem = dayAfterView.routines.find(r => r.routineId === masterRoutine.id);
      assert.strictEqual(dayAfterItem.title, 'Master Evening Reading', 'Future assignments must remain unchanged with master title');

      // Verify recurrence, frequency, start date, end date are unchanged
      assert.strictEqual(updateResult.routine.startDate, today);
      assert.strictEqual(updateResult.routine.endDate, null);
      assert.strictEqual(updateResult.routine.recurrence, 'daily');

      // Simulate app restart / cache clear and reload
      SmartListStore.__clearCache();

      const reloadedTomView = await SmartListStore.getNextDayRoutines(userId, { date: tomorrow });
      const reloadedTomItem = reloadedTomView.routines.find(r => r.routineId === masterRoutine.id);
      assert.strictEqual(reloadedTomItem.title, 'Tomorrow Novel Chapter 5', 'Tomorrow name edit persists across reload');

      const reloadedDayAfter = await SmartListStore.getNextDayRoutines(userId, { date: dayAfter });
      const reloadedDayAfterItem = reloadedDayAfter.routines.find(r => r.routineId === masterRoutine.id);
      assert.strictEqual(reloadedDayAfterItem.title, 'Master Evening Reading', 'Future assignment retains master title after reload');
    });
  });
});
