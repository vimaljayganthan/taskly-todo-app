/**
 * Taskly v1.9.0 Build 10 - Smart Lists Automated Test Suite
 *
 * Comprehensive automated verification for the Smart Lists feature:
 * Part 1: Schema, Assets, Gradle, HTML & CSS Static Integrity
 * Part 2: SmartListStore Persistence & Backend API Contract
 * Part 3: Routine CRUD, Validation & Local Storage Synchronization
 * Part 4: Daily Checklist Completion, Date Isolation & Progress Rate
 * Part 5: Daily Productivity Report, Metrics & Carry-Forward Decision
 * Part 6: Historical Reports & Immutable Snapshot Preservation
 * Part 7: Native Android 10 PM Notification Scheduling & Silent Mode
 * Part 8: Navigation, Profile Screen Placement & Multi-Theme Styling
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');
const STYLES_CSS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), 'utf8');
const APP_JS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'app.js'), 'utf8');
const SERVER_JS = fs.readFileSync(path.join(ROOT_DIR, 'server.js'), 'utf8');
const SCHEMA_SQL = fs.readFileSync(path.join(ROOT_DIR, 'scripts', '002_smart_lists_schema.sql'), 'utf8');
const BUILD_GRADLE = fs.readFileSync(path.join(ROOT_DIR, 'android', 'app', 'build.gradle'), 'utf8');

// Mock localStorage for node environment
const mockStorage = new Map();
global.localStorage = {
  getItem: (k) => (mockStorage.has(k) ? mockStorage.get(k) : null),
  setItem: (k, v) => mockStorage.set(k, String(v)),
  removeItem: (k) => mockStorage.delete(k),
  clear: () => mockStorage.clear()
};

// Mock DOM elements
function createMockElement(id = '', tag = 'div') {
  const classList = new Set();
  const children = [];
  let _innerHTML = '';
  return {
    id,
    tagName: tag.toUpperCase(),
    value: '',
    checked: false,
    textContent: '',
    get innerHTML() { return _innerHTML; },
    set innerHTML(val) {
      _innerHTML = String(val);
      if (val === '') children.length = 0;
    },
    get deepText() {
      let str = this.textContent || '';
      if (children.length > 0) {
        str += ' ' + children.map(c => (c.deepText !== undefined ? c.deepText : (c.textContent || ''))).join(' ');
      }
      return str;
    },
    children,
    get options() { return children; },
    style: {},
    classList: {
      add: (...c) => c.forEach(cls => classList.add(cls)),
      remove: (...c) => c.forEach(cls => classList.delete(cls)),
      contains: (cls) => classList.has(cls),
      toggle: (cls) => {
        if (classList.has(cls)) classList.delete(cls);
        else classList.add(cls);
      }
    },
    appendChild(child) {
      children.push(child);
      return child;
    },
    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx !== -1) children.splice(idx, 1);
      return child;
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    focus() {}
  };
}

const domCache = new Map();
function getMockElement(id) {
  if (!domCache.has(id)) {
    domCache.set(id, createMockElement(id));
  }
  return domCache.get(id);
}

global.document = {
  documentElement: createMockElement('html'),
  body: createMockElement('body'),
  getElementById(id) { return getMockElement(id); },
  querySelectorAll() { return []; },
  querySelector() { return null; },
  createElement(tag) { return createMockElement('', tag); },
  addEventListener() {}
};

global.window = {
  location: { hash: '', origin: 'http://localhost:3000', pathname: '/' },
  history: { replaceState() {}, pushState() {} },
  addEventListener() {},
  removeEventListener() {}
};

const SmartListStore = require('../storage/smartListStore');
const app = require('../public/app');

// =============================================================================
// PART 1: SCHEMA, ASSETS, GRADLE, HTML & CSS STATIC INTEGRITY
// =============================================================================
describe('Part 1: Static Architecture and Gradle Configuration', () => {

  test('1. android/app/build.gradle is configured for v2.1.1 Build 12.1', () => {
    assert.match(BUILD_GRADLE, /versionCode\s+(?:10|11|12|121)/);
    assert.match(BUILD_GRADLE, /versionName\s+["'](?:1\.9\.0|2\.0\.0|2\.1\.0|2\.1\.1)["']/);
    assert.match(BUILD_GRADLE, /applicationId\s+["']com\.taskly\.app["']/);
  });

  test('2. scripts/002_smart_lists_schema.sql defines all required tables with RLS', () => {
    assert.match(SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS public\.smart_routines/);
    assert.match(SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS public\.smart_routine_completions/);
    assert.match(SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS public\.smart_routine_reports/);
    assert.match(SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS public\.smart_routine_settings/);
    assert.match(SCHEMA_SQL, /ENABLE ROW LEVEL SECURITY/);
    assert.match(SCHEMA_SQL, /auth\.uid\(\)\s*=\s*user_id/);
    assert.match(SCHEMA_SQL, /ON DELETE CASCADE/);
  });

  test('3. public/index.html includes #menu-smart-lists positioned directly above Logout', () => {
    assert.ok(INDEX_HTML.includes('id="menu-smart-lists"'), 'Menu item exists');
    const menuIdx = INDEX_HTML.indexOf('id="menu-smart-lists"');
    const logoutIdx = INDEX_HTML.indexOf('class="profile-logout-wrap"');
    assert.ok(menuIdx !== -1, '#menu-smart-lists found');
    assert.ok(logoutIdx !== -1, '.profile-logout-wrap found');
    assert.ok(menuIdx < logoutIdx, '#menu-smart-lists must be positioned above Logout');
  });

  test('4. public/index.html includes tab-smart-lists and all 4 modals', () => {
    assert.ok(INDEX_HTML.includes('id="tab-smart-lists"'), '#tab-smart-lists screen exists');
    assert.ok(INDEX_HTML.includes('id="smart-routines-list"'), '#smart-routines-list exists');
    assert.ok(INDEX_HTML.includes('id="modal-smart-summary"'), '#modal-smart-summary exists');
    assert.ok(INDEX_HTML.includes('id="modal-smart-history"'), '#modal-smart-history exists');
    assert.ok(INDEX_HTML.includes('id="modal-smart-settings"'), '#modal-smart-settings exists');
    assert.ok(INDEX_HTML.includes('id="modal-smart-delete-confirm"'), '#modal-smart-delete-confirm exists');
  });

  test('5. public/styles.css provides styling for all 4 themes (Light, Dark, Pet, Pastel)', () => {
    assert.ok(STYLES_CSS.includes('.menu-icon-smart-lists'), '.menu-icon-smart-lists styled');
    assert.ok(STYLES_CSS.includes('#tab-smart-lists'), '#tab-smart-lists styled');
    assert.ok(STYLES_CSS.includes('.smart-routine-card'), '.smart-routine-card styled');
    assert.ok(STYLES_CSS.includes('[data-theme="dark"]'), 'Dark theme styles present');
    assert.ok(STYLES_CSS.includes('[data-theme="pet"]'), 'Pet theme styles present');
    assert.ok(STYLES_CSS.includes('[data-theme="pastel"]'), 'Pastel theme styles present');
  });
});

// =============================================================================
// PART 2: SMARTLISTSTORE PERSISTENCE & BACKEND API CONTRACT
// =============================================================================
describe('Part 2: SmartListStore Persistence and Storage Functions', () => {
  const testUser = 'user-test-uuid-smart-1';

  beforeEach(() => {
    mockStorage.clear();
  });

  test('1. SmartListStore routine CRUD operations', async () => {
    const r1 = await SmartListStore.addRoutine(testUser, { title: 'Drink 2L Water', orderIndex: 0 });
    assert.ok(r1.id);
    assert.strictEqual(r1.title, 'Drink 2L Water');
    assert.strictEqual(r1.userId, testUser);

    const list = await SmartListStore.getRoutines(testUser);
    assert.ok(list.some(r => r.id === r1.id));

    const updated = await SmartListStore.updateRoutine(testUser, r1.id, { title: 'Drink 3L Water' });
    assert.strictEqual(updated.title, 'Drink 3L Water');

    const deleted = await SmartListStore.deleteRoutine(testUser, r1.id);
    assert.strictEqual(deleted, true);

    const afterList = await SmartListStore.getRoutines(testUser);
    assert.ok(!afterList.some(r => r.id === r1.id));
  });

  test('2. SmartListStore completions tracking for specific dates', async () => {
    const r = await SmartListStore.addRoutine(testUser, { title: 'Morning Jog' });
    const today = '2026-11-08';
    const tomorrow = '2026-11-09';

    await SmartListStore.setCompletion(testUser, { routineId: r.id, date: today, completed: true });
    const todayCompletions = await SmartListStore.getCompletions(testUser, today);
    const todayRecord = todayCompletions.find(c => c.routineId === r.id);
    assert.strictEqual(todayRecord?.completed, true);

    // Tomorrow should remain uncompleted
    const tomorrowCompletions = await SmartListStore.getCompletions(testUser, tomorrow);
    const tomorrowRecord = tomorrowCompletions.find(c => c.routineId === r.id);
    assert.strictEqual(tomorrowRecord, undefined);
  });

  test('3. SmartListStore reports persistence and deletion', async () => {
    const reportData = {
      date: '2026-11-08',
      totalRoutines: 3,
      completedRoutines: 2,
      incompleteRoutines: 1,
      completionRate: 67,
      statusBadge: 'Good Progress',
      routinesSnapshot: [
        { id: '1', title: 'Task 1', completed: true },
        { id: '2', title: 'Task 2', completed: true },
        { id: '3', title: 'Task 3', completed: false }
      ],
      carryForwardDecision: 'pending'
    };

    const saved = await SmartListStore.saveReport(testUser, reportData);
    assert.ok(saved.id);
    assert.strictEqual(saved.date, '2026-11-08');

    const reports = await SmartListStore.getReports(testUser);
    assert.ok(reports.some(rep => rep.id === saved.id));

    const delRes = await SmartListStore.deleteReport(testUser, saved.id);
    assert.strictEqual(delRes, true);
  });

  test('4. SmartListStore settings configuration', async () => {
    const settings = await SmartListStore.saveSettings(testUser, {
      dailySummaryEnabled: true,
      dailySummaryTime: '21:30'
    });
    assert.strictEqual(settings.dailySummaryTime, '21:30');

    const retrieved = await SmartListStore.getSettings(testUser);
    assert.strictEqual(retrieved.dailySummaryTime, '21:30');
    assert.strictEqual(retrieved.dailySummaryEnabled, true);
  });
});

// =============================================================================
// PART 3: ROUTINE CRUD, VALIDATION & LOCAL STORAGE SYNCHRONIZATION
// =============================================================================
describe('Part 3: Frontend Routine CRUD & Validation Logic', () => {
  const manager = app.SmartListsManager;

  beforeEach(() => {
    mockStorage.clear();
    manager.clearLocalState();
    manager.state.routines = [];
    manager.state.completions = {};
    manager.state.reports = [];
  });

  test('1. Empty or whitespace routine name is rejected with null', async () => {
    const res = await manager.addRoutine('   ');
    assert.strictEqual(res, null);
  });

  test('2. Duplicate routine name (case-insensitive) is rejected with null', async () => {
    await manager.addRoutine('Read 10 Pages');
    const dup = await manager.addRoutine('read 10 pages');
    assert.strictEqual(dup, null);
  });

  test('3. Valid routine is added and immediately persisted in localStorage', async () => {
    const created = await manager.addRoutine('Meditation');
    assert.ok(created.id);
    assert.strictEqual(created.title, 'Meditation');
    assert.strictEqual(manager.state.routines.length, 1);

    const storedRaw = mockStorage.get(manager.STORAGE_KEY_ROUTINES);
    assert.ok(storedRaw);
    const parsed = JSON.parse(storedRaw);
    assert.strictEqual(parsed[0].title, 'Meditation');
  });

  test('4. Routine title can be edited and trimmed', async () => {
    const created = await manager.addRoutine('Jog 1km');
    const updated = await manager.updateRoutine(created.id, 'Jog 2km');
    assert.strictEqual(updated.title, 'Jog 2km');
    assert.strictEqual(manager.state.routines[0].title, 'Jog 2km');
  });

  test('5. Routine can be deleted without leaving orphaned completions in memory', async () => {
    const r1 = await manager.addRoutine('Routine To Delete');
    manager.state.completions[`${r1.id}_2026-11-08`] = { completed: true };

    const deleted = await manager.deleteRoutine(r1.id);
    assert.strictEqual(deleted, true);
    assert.strictEqual(manager.state.routines.length, 0);
    assert.strictEqual(manager.state.completions[`${r1.id}_2026-11-08`], undefined);
  });
});

// =============================================================================
// PART 4: DAILY CHECKLIST COMPLETION, DATE ISOLATION & PROGRESS RATE
// =============================================================================
describe('Part 4: Daily Checklist Completion & Date Isolation', () => {
  const manager = app.SmartListsManager;

  beforeEach(() => {
    mockStorage.clear();
    manager.clearLocalState();
    manager.state.activeDate = '2026-11-08';
  });

  test('1. Checkbox toggle updates completion state instantly for activeDate', async () => {
    const r = await manager.addRoutine('Daily Pushups');
    assert.strictEqual(manager.isRoutineCompleted(r.id, '2026-11-08'), false);

    await manager.toggleCompletion(r.id, '2026-11-08');
    assert.strictEqual(manager.isRoutineCompleted(r.id, '2026-11-08'), true);

    await manager.toggleCompletion(r.id, '2026-11-08');
    assert.strictEqual(manager.isRoutineCompleted(r.id, '2026-11-08'), false);
  });

  test('2. Completion is isolated by date; new day starts unchecked', async () => {
    const r = await manager.addRoutine('Journaling');
    await manager.toggleCompletion(r.id, '2026-11-08');
    assert.strictEqual(manager.isRoutineCompleted(r.id, '2026-11-08'), true);

    // Tomorrow (2026-11-09) must remain unchecked
    assert.strictEqual(manager.isRoutineCompleted(r.id, '2026-11-09'), false);
  });

  test('3. Daily progress calculation is mathematically exact', async () => {
    const r1 = await manager.addRoutine('R1');
    const r2 = await manager.addRoutine('R2');
    const r3 = await manager.addRoutine('R3');
    const r4 = await manager.addRoutine('R4');

    await manager.toggleCompletion(r1.id, '2026-11-08');
    await manager.toggleCompletion(r2.id, '2026-11-08');

    const progress = manager.calculateDayProgress('2026-11-08');
    assert.strictEqual(progress.total, 4);
    assert.strictEqual(progress.completed, 2);
    assert.strictEqual(progress.incomplete, 2);
    assert.strictEqual(progress.rate, 50); // 2/4 = 50%
  });
});

// =============================================================================
// PART 5: DAILY PRODUCTIVITY REPORT, METRICS & CARRY-FORWARD DECISION
// =============================================================================
describe('Part 5: Daily Productivity Report & Carry-Forward Decision', () => {
  const manager = app.SmartListsManager;

  beforeEach(() => {
    mockStorage.clear();
    manager.clearLocalState();
    manager.state.activeDate = '2026-11-08';
  });

  test('1. Daily report computes exact totals, rates, and classification badges', async () => {
    const r1 = await manager.addRoutine('R1');
    const r2 = await manager.addRoutine('R2');
    const r3 = await manager.addRoutine('R3');

    await manager.toggleCompletion(r1.id, '2026-11-08');
    await manager.toggleCompletion(r2.id, '2026-11-08');

    const report = await manager.generateDailyReport('2026-11-08');
    assert.strictEqual(report.totalRoutines, 3);
    assert.strictEqual(report.completedCount, 2);
    assert.strictEqual(report.incompleteCount, 1);
    assert.strictEqual(report.completionRate, 67); // Math.round(2/3 * 100) = 67%
    assert.strictEqual(report.statusBadge, 'Good Progress');
    assert.strictEqual(report.carryForwardDecision, 'pending');
    assert.strictEqual(report.completedList.length, 2);
    assert.strictEqual(report.incompleteList.length, 1);
  });

  test('2. 100% completion rate yields "Exceptional" badge', async () => {
    const r1 = await manager.addRoutine('Task Alpha');
    await manager.toggleCompletion(r1.id, '2026-11-08');

    const report = await manager.generateDailyReport('2026-11-08');
    assert.strictEqual(report.completionRate, 100);
    assert.strictEqual(report.statusBadge, 'Exceptional');
  });

  test('3. Carry Forward YES copies incomplete routines to next day with carried forward marker', async () => {
    const r1 = await manager.addRoutine('Task Complete');
    const r2 = await manager.addRoutine('Task Incomplete');

    await manager.toggleCompletion(r1.id, '2026-11-08');

    await manager.generateDailyReport('2026-11-08');
    const updated = await manager.setCarryForwardDecision('2026-11-08', 'yes');

    assert.strictEqual(updated.carryForwardDecision, 'yes');
    const nextDay = manager.getNextDayYmd('2026-11-08');
    assert.strictEqual(nextDay, '2026-11-09');

    // The incomplete routine should now be marked carried forward on 2026-11-09
    const comp = manager.state.completions[`${r2.id}_2026-11-09`];
    assert.ok(comp, 'Completion entry for next day exists');
    assert.strictEqual(comp.carriedForward, true);
    assert.strictEqual(comp.completed, false);
  });

  test('4. Carry Forward NO keeps incomplete routines on current day only', async () => {
    const r1 = await manager.addRoutine('Incomplete Item');
    await manager.generateDailyReport('2026-11-08');
    const updated = await manager.setCarryForwardDecision('2026-11-08', 'no');

    assert.strictEqual(updated.carryForwardDecision, 'no');
    const nextDay = manager.getNextDayYmd('2026-11-08');
    const comp = manager.state.completions[`${r1.id}_${nextDay}`];
    assert.strictEqual(comp?.carriedForward, undefined);
  });

  test('5. Carry Forward decision can be reset to pending', async () => {
    await manager.addRoutine('Incomplete Item 2');
    await manager.generateDailyReport('2026-11-08');
    await manager.setCarryForwardDecision('2026-11-08', 'yes');
    const resetReport = await manager.resetCarryForwardDecision('2026-11-08');
    assert.strictEqual(resetReport.carryForwardDecision, 'pending');
  });
});

// =============================================================================
// PART 6: HISTORICAL REPORTS & IMMUTABLE SNAPSHOT PRESERVATION
// =============================================================================
describe('Part 6: Historical Reports & Snapshot Immutability', () => {
  const manager = app.SmartListsManager;

  beforeEach(() => {
    mockStorage.clear();
    manager.clearLocalState();
  });

  test('1. Deleting an active routine does not corrupt historical report snapshots', async () => {
    const r = await manager.addRoutine('Historic Routine');
    await manager.toggleCompletion(r.id, '2026-11-05');

    const report = await manager.generateDailyReport('2026-11-05');
    assert.strictEqual(report.routinesSnapshot.length, 1);
    assert.strictEqual(report.routinesSnapshot[0].title, 'Historic Routine');

    // Now delete the active routine
    await manager.deleteRoutine(r.id);
    assert.strictEqual(manager.state.routines.length, 0);

    // Historic report snapshot must remain intact with the routine title preserved
    const pastReport = manager.state.reports.find(rp => rp.date === '2026-11-05');
    assert.ok(pastReport);
    assert.strictEqual(pastReport.routinesSnapshot[0].title, 'Historic Routine');
    assert.strictEqual(pastReport.totalRoutines, 1);
    assert.strictEqual(pastReport.completedCount, 1);
  });

  test('2. Deleting a report from history removes only the report without touching routines', async () => {
    const r = await manager.addRoutine('Active Routine Forever');
    const rep = await manager.generateDailyReport('2026-11-07');

    assert.strictEqual(manager.state.reports.length, 1);
    const delRes = await manager.deleteReport(rep.id);
    assert.strictEqual(delRes, true);
    assert.strictEqual(manager.state.reports.length, 0);

    // Active routine still exists!
    assert.strictEqual(manager.state.routines.length, 1);
    assert.strictEqual(manager.state.routines[0].title, 'Active Routine Forever');
  });
});

// =============================================================================
// PART 7: NATIVE ANDROID 10 PM NOTIFICATION SCHEDULING & SILENT MODE
// =============================================================================
describe('Part 7: Native Android 10 PM Notification Scheduling', () => {
  const manager = app.SmartListsManager;
  let scheduledMock = [];
  let cancelledMock = [];
  const origGetPlugin = app.TasklyNotifications.getPlugin;

  beforeEach(() => {
    mockStorage.clear();
    manager.clearLocalState();
    scheduledMock = [];
    cancelledMock = [];

    app.TasklyNotifications.getPlugin = () => ({
      async schedule({ notifications }) {
        scheduledMock.push(...notifications);
        return { notifications };
      },
      async cancel({ notifications }) {
        cancelledMock.push(...notifications);
        return { notifications };
      }
    });
  });

  afterEach(() => {
    app.TasklyNotifications.getPlugin = origGetPlugin;
  });

  test('1. Schedules 22:00 (10 PM) daily reminder with ID 990001 when enabled', async () => {
    await app.TasklyNotifications.setMasterEnabled(true);
    await app.TasklyNotifications.setSoundEnabled(true);
    manager.state.settings = { dailySummaryEnabled: true, dailySummaryTime: '22:00' };

    await manager.scheduleDailySummaryReminder();

    assert.ok(scheduledMock.length >= 1, 'Scheduled notification');
    const notif = scheduledMock.find(n => n.id === manager.NOTIFICATION_ID);
    assert.ok(notif, 'ID 990001 scheduled');
    assert.strictEqual(notif.schedule.on.hour, 22);
    assert.strictEqual(notif.schedule.on.minute, 0);
    assert.strictEqual(notif.schedule.repeats, true);
    assert.strictEqual(notif.extra.type, 'smart_lists_summary');
  });

  test('2. Cancels summary reminder if master notifications switch is OFF', async () => {
    await app.TasklyNotifications.setMasterEnabled(false);
    manager.state.settings = { dailySummaryEnabled: true, dailySummaryTime: '22:00' };

    await manager.scheduleDailySummaryReminder();

    assert.ok(cancelledMock.some(c => c.id === manager.NOTIFICATION_ID));
  });

  test('3. Uses silent channel when notification sound is disabled', async () => {
    await app.TasklyNotifications.setMasterEnabled(true);
    await app.TasklyNotifications.setSoundEnabled(false);
    manager.state.settings = { dailySummaryEnabled: true, dailySummaryTime: '22:00' };

    await manager.scheduleDailySummaryReminder();

    const notif = scheduledMock.find(n => n.id === manager.NOTIFICATION_ID);
    assert.ok(notif);
    assert.strictEqual(notif.channelId, 'taskly-sound-silent');
    assert.strictEqual(notif.sound, undefined);
  });
});

// =============================================================================
// PART 8: NAVIGATION, PROFILE SCREEN PLACEMENT & THEME INTEGRITY
// =============================================================================
describe('Part 8: UI Navigation, Profile Flow and Theme Integrity', () => {

  beforeEach(() => {
    app.state.userToken = 'valid-token';
    app.state.user.id = 'valid-user-id';
    app.state.user.isEmailVerified = true;
    app.state.user.onboarded = true;
  });

  test('1. showMainFlow accepts "smart-lists" as valid main tab without throwing', () => {
    assert.doesNotThrow(() => {
      app.showMainFlow('smart-lists', false);
    });
    assert.strictEqual(app.state.flow, 'main');
    assert.strictEqual(app.state.activeTab, 'smart-lists');
  });

  test('2. Returning from smart-lists to profile preserves application state', () => {
    app.showMainFlow('smart-lists', false);
    assert.strictEqual(app.state.activeTab, 'smart-lists');

    // User taps Back from Smart Lists -> routes back to profile
    app.showMainFlow('profile', false);
    assert.strictEqual(app.state.activeTab, 'profile');
  });

  test('3. All 4 themes (light, dark, pet, pastel) define specific smart lists header styling', () => {
    assert.ok(STYLES_CSS.includes('[data-theme="light"] .menu-icon-smart-lists'));
    assert.ok(STYLES_CSS.includes('[data-theme="dark"] .menu-icon-smart-lists'));
    assert.ok(STYLES_CSS.includes('[data-theme="pet"] .menu-icon-smart-lists'));
    assert.ok(STYLES_CSS.includes('[data-theme="pastel"] .menu-icon-smart-lists'));
  });
});

// =============================================================================
// PART 9: BUILD 10 UI REFINEMENTS & DAILY SUMMARY BUG FIX VERIFICATION
// =============================================================================
describe('Part 9: Build 10 UI Refinements & Daily Summary Bug Fix Suite', () => {
  const manager = app.SmartListsManager;

  beforeEach(() => {
    mockStorage.clear();
    manager.clearLocalState();
    manager.state.routines = [];
    manager.state.completions = {};
    manager.state.reports = [];
    manager.state.activeDate = '2026-11-08';
    domCache.clear();
  });

  test('1. Header has NO "Profile" text and safe-area top inset padding is applied', () => {
    // 1. Back button has no Profile text
    const backBtnMatch = INDEX_HTML.match(/id=["']btn-back-from-smart-lists["'][^>]*>([\s\S]*?)<\/button>/);
    assert.ok(backBtnMatch, 'Back button element exists');
    assert.ok(!backBtnMatch[1].includes('Profile'), 'Back button must not contain the word "Profile"');

    // 2. CSS enforces safe-area inset top + 24px
    assert.ok(STYLES_CSS.includes('padding: calc(env(safe-area-inset-top, 0px) + 24px)'), 'Safe-area top spacing applied');
    assert.ok(STYLES_CSS.includes('.btn-back-smart'), '.btn-back-smart class styled');
  });

  test('2. Header Summary and Settings buttons have golden yellow & grey styles across themes', () => {
    // Summary button (golden yellow)
    assert.ok(STYLES_CSS.includes('#btn-open-smart-summary'));
    assert.ok(STYLES_CSS.includes('#FEF08A')); // light yellow background
    assert.ok(STYLES_CSS.includes('[data-theme="dark"] #btn-open-smart-summary'));
    assert.ok(STYLES_CSS.includes('[data-theme="pet"] #btn-open-smart-summary'));
    assert.ok(STYLES_CSS.includes('[data-theme="pastel"] #btn-open-smart-summary'));

    // Settings button (muted neutral grey)
    assert.ok(STYLES_CSS.includes('#btn-open-smart-settings'));
    assert.ok(STYLES_CSS.includes('#F1F5F9')); // neutral grey
    assert.ok(STYLES_CSS.includes('[data-theme="dark"] #btn-open-smart-settings'));
    assert.ok(STYLES_CSS.includes('[data-theme="pet"] #btn-open-smart-settings'));
    assert.ok(STYLES_CSS.includes('[data-theme="pastel"] #btn-open-smart-settings'));
  });

  test('3. CRITICAL BUG VERIFICATION: 3 routines (2 completed, 1 incomplete) renders exact titles, not empty notice', async () => {
    const r1 = await manager.addRoutine('Morning Walk');
    const r2 = await manager.addRoutine('Drink 2L Water');
    const r3 = await manager.addRoutine('Read 20 pages');

    await manager.toggleCompletion(r1.id, '2026-11-08');
    await manager.toggleCompletion(r2.id, '2026-11-08');
    // r3 left incomplete

    const report = await manager.generateDailyReport('2026-11-08');

    // Mathematical data integrity
    assert.strictEqual(report.totalRoutines, 3, 'Total routines is 3');
    assert.strictEqual(report.completedCount, 2, 'Completed count is 2');
    assert.strictEqual(report.incompleteCount, 1, 'Incomplete count is 1');
    assert.strictEqual(report.completionRate, 67, 'Completion rate is 67%');

    // Arrays must contain actual titles, not numbers or empty
    assert.ok(Array.isArray(report.completedRoutines), 'completedRoutines is an Array');
    assert.strictEqual(report.completedRoutines.length, 2, 'completedRoutines length is 2');
    assert.deepStrictEqual(report.completedRoutines, ['Morning Walk', 'Drink 2L Water']);

    assert.ok(Array.isArray(report.incompleteRoutines), 'incompleteRoutines is an Array');
    assert.strictEqual(report.incompleteRoutines.length, 1, 'incompleteRoutines length is 1');
    assert.deepStrictEqual(report.incompleteRoutines, ['Read 20 pages']);

    // Render in modal
    await manager.openSummaryModal('2026-11-08');

    const totalEl = getMockElement('summary-metric-total');
    const compEl = getMockElement('summary-metric-completed');
    const incompEl = getMockElement('summary-metric-incomplete');
    const rateEl = getMockElement('summary-metric-rate');

    assert.strictEqual(totalEl.textContent, '3');
    assert.strictEqual(compEl.textContent, '2');
    assert.strictEqual(incompEl.textContent, '1');
    assert.strictEqual(rateEl.textContent, '67%');

    const compList = getMockElement('smart-summary-completed-list');
    const incompList = getMockElement('smart-summary-incomplete-list');

    // Completed list MUST have 2 items and MUST NOT have empty notice
    assert.strictEqual(compList.children.length, 2, 'Completed list renders exactly 2 items');
    assert.ok(compList.children.some(c => c.innerHTML.includes('Morning Walk')));
    assert.ok(compList.children.some(c => c.innerHTML.includes('Drink 2L Water')));
    assert.ok(!compList.children.some(c => c.textContent.includes('No routines completed')), 'Never show empty notice when count > 0');

    // Incomplete list MUST have 1 item and MUST NOT say all completed
    assert.strictEqual(incompList.children.length, 1, 'Incomplete list renders exactly 1 item');
    assert.ok(incompList.children.some(c => c.innerHTML.includes('Read 20 pages')));
    assert.ok(!incompList.children.some(c => c.textContent.includes('All routines completed')), 'Never show all completed when incomplete > 0');
  });

  test('4. EDGE CASE 1: 0 completed out of 3 displays proper empty notice in Completed list', async () => {
    await manager.addRoutine('Task A');
    await manager.addRoutine('Task B');
    await manager.addRoutine('Task C');

    await manager.openSummaryModal('2026-11-08');

    const compList = getMockElement('smart-summary-completed-list');
    const incompList = getMockElement('smart-summary-incomplete-list');

    assert.strictEqual(compList.children.length, 1);
    assert.ok(compList.children[0].textContent.includes('No routines were completed on this date.'));

    assert.strictEqual(incompList.children.length, 3);
    assert.ok(incompList.children.some(c => c.innerHTML.includes('Task A')));
    assert.ok(incompList.children.some(c => c.innerHTML.includes('Task B')));
    assert.ok(incompList.children.some(c => c.innerHTML.includes('Task C')));
  });

  test('5. EDGE CASE 2: 3 completed out of 3 displays all-completed notice in Incomplete list', async () => {
    const r1 = await manager.addRoutine('Task 1');
    const r2 = await manager.addRoutine('Task 2');
    const r3 = await manager.addRoutine('Task 3');

    await manager.toggleCompletion(r1.id, '2026-11-08');
    await manager.toggleCompletion(r2.id, '2026-11-08');
    await manager.toggleCompletion(r3.id, '2026-11-08');

    await manager.openSummaryModal('2026-11-08');

    const compList = getMockElement('smart-summary-completed-list');
    const incompList = getMockElement('smart-summary-incomplete-list');

    assert.strictEqual(compList.children.length, 3);
    assert.strictEqual(incompList.children.length, 1);
    assert.ok(incompList.children[0].textContent.includes('All routines were completed successfully.'));
  });

  test('6. EDGE CASE 3: 0 routines scheduled displays proper empty notices', async () => {
    await manager.openSummaryModal('2026-11-08');

    const compList = getMockElement('smart-summary-completed-list');
    const incompList = getMockElement('smart-summary-incomplete-list');

    assert.strictEqual(compList.children.length, 1);
    assert.ok(compList.children[0].textContent.includes('No routines were completed on this date.'));

    assert.strictEqual(incompList.children.length, 1);
    assert.ok(incompList.children[0].textContent.includes('No routines were scheduled on this date.'));
  });

  test('7. Normalization self-heals malformed legacy reports', () => {
    const malformedLegacy = {
      date: '2026-11-01',
      totalRoutines: 3,
      completedRoutines: 2, // number!
      incompleteRoutines: 1, // number!
      routinesSnapshot: [
        { id: 'r1', title: 'Legacy Walk', completed: true },
        { id: 'r2', title: 'Legacy Yoga', completed: true },
        { id: 'r3', title: 'Legacy Reading', completed: false }
      ]
    };

    const normalized = manager.normalizeReport(malformedLegacy);
    assert.ok(Array.isArray(normalized.completedRoutines), 'completedRoutines normalized to array');
    assert.deepStrictEqual(normalized.completedRoutines, ['Legacy Walk', 'Legacy Yoga']);
    assert.ok(Array.isArray(normalized.incompleteRoutines), 'incompleteRoutines normalized to array');
    assert.deepStrictEqual(normalized.incompleteRoutines, ['Legacy Reading']);
    assert.strictEqual(normalized.completedCount, 2);
    assert.strictEqual(normalized.incompleteCount, 1);
    assert.strictEqual(normalized.completionRate, 67);
  });

  test('8. Printed paper document styling exists with crisp white sheet across all themes', () => {
    assert.ok(STYLES_CSS.includes('.smart-paper-document'));
    assert.ok(STYLES_CSS.includes('background: #FFFFFF !important'));
    assert.ok(STYLES_CSS.includes('color: #0F172A !important'));
    assert.ok(STYLES_CSS.includes('.paper-header'));
    assert.ok(STYLES_CSS.includes('.paper-stats-section'));
    assert.ok(STYLES_CSS.includes('.paper-stat-box'));
    assert.ok(STYLES_CSS.includes('.paper-list-item'));
    assert.ok(STYLES_CSS.includes('.paper-carry-box'));
  });
});

// =============================================================================
// PART 10: BUILD 10 VERSION HISTORY & WHAT'S NEW INTEGRATION SUITE
// =============================================================================
describe('Part 10: Build 10 Current Version History & What\'s New Integration Suite', () => {
  const updateMgr = app.TasklyUpdateManager;
  const PROD_MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'releases', 'version-manifest.json'), 'utf8'));
  const PUBLIC_MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'public', 'version-manifest.json'), 'utf8'));

  beforeEach(() => {
    mockStorage.clear();
    domCache.clear();
    updateMgr.state.manifest = null;
    updateMgr.state.latestVersionCode = null;
    updateMgr.state.latestVersionName = null;
    updateMgr.setCachedManifest(PROD_MANIFEST);
    updateMgr.state.installedVersionName = '2.1.1';
    updateMgr.state.installedVersionCode = 121;
    updateMgr.state.activeWhatsNewVersionCode = null;
    updateMgr.state.updateStatus = 'idle';
  });

  test('1. Production manifests releases/version-manifest.json and public/version-manifest.json are published to v2.1.1 Build 12.1', () => {
    assert.strictEqual(PROD_MANIFEST.latestVersion, '2.1.1');
    assert.strictEqual(PROD_MANIFEST.versionCode, 121);
    assert.strictEqual(PUBLIC_MANIFEST.latestVersion, '2.1.1');
    assert.strictEqual(PUBLIC_MANIFEST.versionCode, 121);
    assert.deepStrictEqual(PROD_MANIFEST, PUBLIC_MANIFEST);
  });

  test('2. android/app/build.gradle configures versionName 2.1.1 and versionCode 121', () => {
    assert.ok(/versionCode\s+121\b/.test(BUILD_GRADLE), 'build.gradle defines versionCode 121');
    assert.ok(/versionName\s+["']2\.1\.1["']/.test(BUILD_GRADLE), 'build.gradle defines versionName "2.1.1"');
  });

  test('3. Decoupling: getApprovedReleaseHistory() strictly returns approved releases from manifest (11 releases, top is v2.1.1)', () => {
    const approved = updateMgr.getApprovedReleaseHistory();
    assert.strictEqual(approved.length, 11);
    assert.strictEqual(approved[0].versionCode, 121);
    assert.strictEqual(approved[0].versionName, '2.1.1');
  });

  test('4. Decoupling: getLatestApprovedRelease() strictly returns v2.1.1 Build 12.1', () => {
    const latestApproved = updateMgr.getLatestApprovedRelease();
    assert.strictEqual(latestApproved.versionCode, 121);
    assert.strictEqual(latestApproved.versionName, '2.1.1');
    assert.ok(latestApproved.title.includes('Taskly v2.1.1 (Build 12.1)'));
  });

  test('5. getReleaseHistory() returns all 11 releases without duplicates when installed is Build 12.1', () => {
    updateMgr.state.installedVersionCode = 121;
    updateMgr.state.installedVersionName = '2.1.1';
    const history = updateMgr.getReleaseHistory();
    assert.strictEqual(history.length, 11, 'History contains 11 official releases');
    assert.strictEqual(history[0].versionCode, 121);
    assert.strictEqual(history[0].versionName, '2.1.1');
    assert.strictEqual(history[1].versionCode, 12);
    assert.strictEqual(history[1].versionName, '2.1.0');
  });

  test('6. localInstalledRelease contains complete Smart Lists metadata and feature highlights', () => {
    const rel = (updateMgr.localInstalledRelease && updateMgr.localInstalledRelease.versionCode === 10)
      ? updateMgr.localInstalledRelease
      : updateMgr.build10Release;
    assert.ok(rel, 'Smart Lists release exists');
    assert.strictEqual(rel.version, '1.9.0');
    assert.strictEqual(rel.versionName, '1.9.0');
    assert.strictEqual(rel.versionCode, 10);
    assert.strictEqual(rel.title, 'Smart Lists – Daily Routine Management');
    assert.ok(rel.summary.includes('Introduced Smart Lists, a dedicated space for managing daily routines'));

    const requiredHighlights = [
      'Simple daily routine creation, editing, and deletion',
      'Individual routine completion checkboxes',
      'Date-specific completion tracking',
      'Daily productivity summary reports',
      'Configurable daily summary reminder, defaulting to 10:00 PM',
      'Carry-forward options for incomplete routines',
      'Historical daily reports',
      'Four-theme support',
      'Persistent routine data and account synchronization'
    ];
    requiredHighlights.forEach((highlight) => {
      assert.ok(rel.features.includes(highlight), `Missing feature highlight: ${highlight}`);
    });

    assert.ok(Array.isArray(rel.improvements) && rel.improvements.length > 0);
    assert.ok(Array.isArray(rel.performance) && rel.performance.length > 0);
    assert.ok(Array.isArray(rel.fixes) && rel.fixes.length > 0);
    assert.ok(Array.isArray(rel.security) && rel.security.length > 0);
  });

  test('7. renderUI() displays v2.1.1 (Build 12.1) as Installed and v2.1.1 (Build 12.1) as Latest Approved', () => {
    const valInstalled = getMockElement('val-installed-version');
    const valLatest = getMockElement('val-latest-version');
    const whatsNewSub = getMockElement('whats-new-banner-subtitle');

    updateMgr.renderUI();

    assert.strictEqual(valInstalled.textContent, 'v2.1.1 (Build 12.1)', 'Installed version is v2.1.1 (Build 12.1)');
    assert.strictEqual(valLatest.textContent, 'v2.1.1 (Build 12.1)', 'Latest approved is v2.1.1 (Build 12.1)');
    assert.ok(whatsNewSub.textContent.includes('v2.1.1'));
  });

  test('8. Release History rendering labels Build 12.1 as "🌟 Latest & Installed" and lists all 11 releases', () => {
    updateMgr.state.historyExpanded = true;
    const historyList = getMockElement('version-history-list');

    updateMgr.renderUI();

    assert.strictEqual(historyList.children.length, 11, 'History renders 11 items');
    const itemBuild121 = historyList.children[0];
    const itemBuild12 = historyList.children[1];

    // Build 12.1 checks
    assert.ok(itemBuild121.classList.contains('history-item-latest'));
    assert.ok(itemBuild121.deepText.includes('v2.1.1 (Build 12.1)'));
    assert.ok(itemBuild121.deepText.includes('🌟 Latest & Installed'));

    // Build 12 checks
    assert.ok(!itemBuild12.classList.contains('history-item-latest'));
    assert.ok(!itemBuild12.classList.contains('history-item-current-installed'));
    assert.ok(itemBuild12.deepText.includes('v2.1.0 (Build 12)'));
  });

  test('9. openWhatsNew() defaults to v2.1.1 Build 12.1 and renders release notes', () => {
    updateMgr.openWhatsNew();
    assert.strictEqual(updateMgr.state.activeWhatsNewVersionCode, 121);

    const heroPill = getMockElement('whats-new-hero-version-pill');
    const heroTitle = getMockElement('whats-new-hero-title');
    const heroSummary = getMockElement('whats-new-hero-summary');
    const diffText = getMockElement('whats-new-diff-text');

    assert.strictEqual(heroPill.textContent, 'Version 2.1.1 (Build 12.1)');
    assert.ok(heroTitle.textContent.includes('Routine Deletion') || heroTitle.textContent.includes('Foreign Key'));
    assert.ok(heroSummary.textContent.includes('routine deletion') || heroSummary.textContent.includes('foreign key'));
    assert.ok(diffText.innerHTML.includes('You are running <strong>v2.1.1 (Build 12.1)</strong>'));
  });

  test('10. populateWhatsNewVersionSelect() labels Build 12.1 as "Latest & Installed" and lists all 11 releases', () => {
    const select = getMockElement('select-whats-new-version');
    updateMgr.populateWhatsNewVersionSelect();

    assert.strictEqual(select.children.length, 11, 'Select has 11 options');
    assert.strictEqual(select.children[0].value, '121');
    assert.ok(select.children[0].textContent.includes('v2.1.1 (Build 12.1) — Latest & Installed'));
    assert.strictEqual(select.children[1].value, '12');
    assert.ok(select.children[1].textContent.includes('v2.1.0 (Build 12)'));
  });

  test('11. What\'s New navigation: user can switch from latest build to Build 9 and view v1.8.0 notes', () => {
    updateMgr.openWhatsNew();
    assert.strictEqual(updateMgr.state.activeWhatsNewVersionCode, 121);

    // Switch to Build 9
    updateMgr.renderWhatsNew(9);
    assert.strictEqual(updateMgr.state.activeWhatsNewVersionCode, 9);

    const heroPill = getMockElement('whats-new-hero-version-pill');
    const heroTitle = getMockElement('whats-new-hero-title');
    const diffText = getMockElement('whats-new-diff-text');

    assert.strictEqual(heroPill.textContent, 'Version 1.8.0 (Build 9)');
    assert.strictEqual(heroTitle.textContent, 'Custom Category Persistence & Data Consistency');
    assert.ok(diffText.innerHTML.includes('Historical Release:</strong> Showing notes for <strong>v1.8.0 (Build 9)</strong>'));
  });

  test('12. Backward compatibility: when installed is v1.8.0 Build 9 and simulated manifest is v1.8.0, getApprovedReleaseHistory() contains 7 releases', () => {
    const v180Manifest = {
      latestVersion: '1.8.0',
      versionCode: 9,
      history: PROD_MANIFEST.history.filter(h => h.versionCode <= 9)
    };
    updateMgr.state.manifest = null;
    updateMgr.state.latestVersionCode = 9;
    updateMgr.state.latestVersionName = '1.8.0';
    updateMgr.setCachedManifest(v180Manifest);
    updateMgr.state.installedVersionCode = 9;
    updateMgr.state.installedVersionName = '1.8.0';

    const history = updateMgr.getApprovedReleaseHistory();
    assert.strictEqual(history.length, 7, 'Contains 7 releases for v1.8.0 baseline');
    assert.strictEqual(history[0].versionCode, 9);
    assert.strictEqual(history[0].versionName, '1.8.0');
  });

  test('13. Future-proofing: when simulated manifest includes future Build 12.2 (code 122), no duplicate Build 122 entries appear', () => {
    const futureManifest = {
      latestVersion: '2.2.0',
      versionCode: 122,
      history: [
        { version: '2.2.0', versionName: '2.2.0', versionCode: 122, title: 'Future Release' },
        ...PROD_MANIFEST.history
      ]
    };
    updateMgr.setCachedManifest(futureManifest);

    const history = updateMgr.getReleaseHistory();
    const futureEntries = history.filter(r => parseInt(r.versionCode, 10) === 122);
    assert.strictEqual(futureEntries.length, 1, 'Exactly one future entry exists (no duplicate)');
    assert.strictEqual(history.length, 12);
  });

  test('14. Update check safety: isUpdateAvailable(121, 121) returns false and app reports up to date', () => {
    const hasUpdate = updateMgr.isUpdateAvailable(121, 121);
    assert.strictEqual(hasUpdate, false, 'No update available since installed 121 == remote 121');

    updateMgr.state.installedVersionCode = 121;
    updateMgr.state.latestVersionCode = 121;
    updateMgr.setCachedManifest(PROD_MANIFEST);

    // Mock fetch for local update check
    global.fetch = async () => ({
      ok: true,
      json: async () => PROD_MANIFEST
    });

    return updateMgr.checkForUpdates(false).then(() => {
      assert.strictEqual(updateMgr.state.updateStatus, 'up_to_date');
      const statusText = getMockElement('version-status-text');
      assert.strictEqual(statusText.textContent, "You're up to date");
      const btnUpdate = getMockElement('btn-update-now');
      assert.strictEqual(btnUpdate.style.display, 'none');
    });
  });

  test('15. public/styles.css includes .badge-current-installed and .history-item-current-installed across themes', () => {
    assert.ok(STYLES_CSS.includes('.badge-current-installed'), 'CSS contains .badge-current-installed');
    assert.ok(STYLES_CSS.includes('.history-item-current-installed'), 'CSS contains .history-item-current-installed');
    assert.ok(STYLES_CSS.includes('[data-theme="dark"] .badge-current-installed'), 'Dark theme style exists');
    assert.ok(STYLES_CSS.includes('[data-theme="pet"] .badge-current-installed'), 'Pet theme style exists');
    assert.ok(STYLES_CSS.includes('[data-theme="pastel"] .badge-current-installed'), 'Pastel theme style exists');
  });
});

// =============================================================================
// PART 11: FINAL SMART LISTS UI CORRECTIONS & DATA CONSISTENCY SUITE
// =============================================================================
describe('Part 11: Final Smart Lists UI Corrections & Data Consistency Suite', () => {
  const manager = app.SmartListsManager;
  const origFetch = global.fetch;

  beforeEach(() => {
    mockStorage.clear();
    domCache.clear();
    manager.clearLocalState();
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ id: 'mock_' + Math.random().toString(36).slice(2) })
    });
  });

  afterEach(() => {
    global.fetch = origFetch;
  });

  test('1. Layout: .paper-stats-grid uses 2 columns on mobile and 4 columns on min-width 480px to avoid horizontal overflow', () => {
    assert.ok(STYLES_CSS.includes('.paper-stats-grid'), 'CSS defines .paper-stats-grid');
    assert.ok(STYLES_CSS.includes('grid-template-columns: repeat(2, 1fr)'), 'CSS uses 2 columns by default for mobile');
    assert.ok(STYLES_CSS.includes('@media (min-width: 480px)'), 'CSS includes media query for larger screens');
    assert.ok(STYLES_CSS.includes('grid-template-columns: repeat(4, 1fr)'), 'CSS expands to 4 columns on tablets/desktops');
    assert.ok(STYLES_CSS.includes('.modal-card-smart-summary'), 'CSS contains .modal-card-smart-summary');
    assert.ok(STYLES_CSS.includes('.smart-summary-scroll-body'), 'CSS contains .smart-summary-scroll-body');
  });

  test('2. Button styling: .btn-modal-secondary is styled with soft background, Taskly blue text, and 4-theme support', () => {
    assert.ok(STYLES_CSS.includes('.btn-modal-secondary'), 'CSS defines .btn-modal-secondary');
    assert.ok(STYLES_CSS.includes('#E0F2FE'), 'Light theme uses soft blue #E0F2FE');
    assert.ok(STYLES_CSS.includes('#0369A1'), 'Light theme uses Taskly blue #0369A1');
    assert.ok(STYLES_CSS.includes('[data-theme="dark"] .btn-modal-secondary'), 'Dark theme style exists');
    assert.ok(STYLES_CSS.includes('[data-theme="pet"] .btn-modal-secondary'), 'Pet theme style exists');
    assert.ok(STYLES_CSS.includes('[data-theme="pastel"] .btn-modal-secondary'), 'Pastel theme style exists');
  });

  test('3. Profile screen: .profile-menu-smart-lists is highlighted in yellow/golden across all 4 themes', () => {
    assert.ok(STYLES_CSS.includes('.profile-menu-smart-lists'), 'CSS defines .profile-menu-smart-lists');
    assert.ok(STYLES_CSS.includes('#FEF3C7'), 'Light/day theme uses soft golden #FEF3C7');
    assert.ok(STYLES_CSS.includes('#D97706'), 'Golden accent icon uses #D97706');
    assert.ok(STYLES_CSS.includes('[data-theme="dark"] .profile-menu-smart-lists'), 'Dark theme style exists');
    assert.ok(STYLES_CSS.includes('[data-theme="pet"] .profile-menu-smart-lists'), 'Pet theme style exists');
    assert.ok(STYLES_CSS.includes('[data-theme="pastel"] .profile-menu-smart-lists'), 'Pastel theme style exists');
  });

  test('4. Data consistency: Exact user scenario (2 completed: "Drink water", "Eat food", 1 incomplete: "Do homework")', () => {
    const rawReport = {
      date: '2026-11-08',
      totalRoutines: 3,
      completedCount: 2,
      incompleteCount: 1,
      completionRate: 67,
      completedRoutines: ['Drink water', 'Eat food'],
      incompleteRoutines: ['Do homework']
    };

    const normalized = manager.normalizeReport(rawReport);
    assert.strictEqual(normalized.totalRoutines, 3, 'Total routines is 3');
    assert.strictEqual(normalized.completedCount, 2, 'Completed count is 2');
    assert.strictEqual(normalized.incompleteCount, 1, 'Incomplete count is 1');
    assert.strictEqual(normalized.completionRate, 67, 'Completion rate is 67%');
    assert.deepStrictEqual(normalized.completedRoutines, ['Drink water', 'Eat food']);
    assert.deepStrictEqual(normalized.incompleteRoutines, ['Do homework']);

    // Render into mock DOM
    manager.renderSummaryModal(normalized);

    const totalEl = getMockElement('summary-metric-total');
    const compEl = getMockElement('summary-metric-completed');
    const incompEl = getMockElement('summary-metric-incomplete');
    const rateEl = getMockElement('summary-metric-rate');
    const compCountEl = getMockElement('summary-completed-count');
    const incompCountEl = getMockElement('summary-incomplete-count');
    const compList = getMockElement('smart-summary-completed-list');
    const incompList = getMockElement('smart-summary-incomplete-list');

    // Metrics must match exactly
    assert.strictEqual(totalEl.textContent, '3');
    assert.strictEqual(compEl.textContent, '2');
    assert.strictEqual(incompEl.textContent, '1');
    assert.strictEqual(rateEl.textContent, '67%');

    // Section 1: Completed list must render exactly 2 completed routines
    assert.strictEqual(compCountEl.textContent, '2');
    assert.strictEqual(compList.children.length, 2);
    assert.ok(compList.children[0].innerHTML.includes('Drink water'));
    assert.ok(compList.children[0].innerHTML.includes('✓'));
    assert.ok(compList.children[1].innerHTML.includes('Eat food'));
    assert.ok(compList.children[1].innerHTML.includes('✓'));

    // Section 2: Incomplete list must render exactly 1 incomplete routine
    assert.strictEqual(incompCountEl.textContent, '1');
    assert.strictEqual(incompList.children.length, 1);
    assert.ok(incompList.children[0].innerHTML.includes('Do homework'));
    assert.ok(incompList.children[0].innerHTML.includes('○'));

    // Invariant check: Incomplete list NEVER contains completed items
    const incompAllHtml = incompList.children.map(c => c.innerHTML).join(' ');
    assert.ok(!incompAllHtml.includes('Drink water'));
    assert.ok(!incompAllHtml.includes('Eat food'));
  });

  test('5. Robust normalization: parses stringified JSON arrays and snake_case fields correctly', () => {
    const rawSupabaseReport = {
      date: '2026-11-08',
      total_routines: 3,
      completed_count: 2,
      incomplete_count: 1,
      completion_rate: 67,
      completed_routines: JSON.stringify(['Drink water', 'Eat food']),
      incomplete_routines: JSON.stringify(['Do homework'])
    };

    const normalized = manager.normalizeReport(rawSupabaseReport);
    assert.strictEqual(normalized.totalRoutines, 3);
    assert.strictEqual(normalized.completedCount, 2);
    assert.strictEqual(normalized.incompleteCount, 1);
    assert.strictEqual(normalized.completionRate, 67);
    assert.deepStrictEqual(normalized.completedRoutines, ['Drink water', 'Eat food']);
    assert.deepStrictEqual(normalized.incompleteRoutines, ['Do homework']);
  });

  test('6. Reopening summary modal yields identical immutable snapshot without divergent state', () => {
    const report = {
      date: '2026-11-08',
      totalRoutines: 2,
      completedCount: 2,
      incompleteCount: 0,
      completionRate: 100,
      completedRoutines: ['Morning Run', 'Meditation'],
      incompleteRoutines: []
    };

    // First render
    manager.renderSummaryModal(report);
    const compListFirst = getMockElement('smart-summary-completed-list').innerHTML;
    const rateFirst = getMockElement('summary-metric-rate').textContent;

    // Second render
    manager.renderSummaryModal(report);
    const compListSecond = getMockElement('smart-summary-completed-list').innerHTML;
    const rateSecond = getMockElement('summary-metric-rate').textContent;

    assert.strictEqual(compListFirst, compListSecond);
    assert.strictEqual(rateFirst, rateSecond);
    assert.strictEqual(rateSecond, '100%');
  });

  test('7. History deletion data safety: deleting a report snapshot preserves routines and completions', async () => {
    const r1 = await manager.addRoutine('Preserved Routine 1');
    const r2 = await manager.addRoutine('Preserved Routine 2');
    manager.state.completions[`${r1.id}_2026-11-08`] = { completed: true, carriedForward: false };
    manager.state.completions[`${r2.id}_2026-11-08`] = { completed: false, carriedForward: false };

    const rep = await manager.generateDailyReport('2026-11-08');
    assert.strictEqual(manager.state.reports.length, 1);

    // Delete historical report
    const delRes = await manager.deleteReport(rep.id);
    assert.strictEqual(delRes, true);
    assert.strictEqual(manager.state.reports.length, 0);

    // Routines and completions remain intact
    assert.strictEqual(manager.state.routines.length, 2);
    assert.strictEqual(manager.state.routines[0].title, 'Preserved Routine 1');
    assert.strictEqual(manager.getCompletion(r1.id, '2026-11-08').completed, true);
    assert.strictEqual(manager.getCompletion(r2.id, '2026-11-08').completed, false);
  });
});

// =============================================================================
// PART 12: FINAL UI POLISH: SMART LISTS PROFILE BADGE & DELETE CONFIRMATION
// =============================================================================
describe('Part 12: Final UI Polish: Profile Badge & Delete Confirmation Modal', () => {
  const manager = app.SmartListsManager;
  const FRESH_STYLES = fs.readFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), 'utf8');
  const FRESH_INDEX = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');

  beforeEach(() => {
    mockStorage.clear();
    domCache.clear();
    manager.clearLocalState();
  });

  test('1. Profile "Routines" badge: styled as compact golden pill with 999px radius and no selection highlight', () => {
    assert.ok(FRESH_STYLES.includes('#profile-smart-lists-badge'), 'CSS styles #profile-smart-lists-badge');
    assert.ok(FRESH_STYLES.includes('border-radius: 999px !important'), 'Badge has fully rounded 999px pill border-radius');
    assert.ok(FRESH_STYLES.includes('padding: 4px 10px !important'), 'Badge has comfortable compact padding');
    assert.ok(FRESH_STYLES.includes('user-select: none !important'), 'Browser selection highlight disabled via user-select: none');
    assert.ok(FRESH_STYLES.includes('-webkit-user-select: none !important'), 'WebKit user-select disabled');
    assert.ok(FRESH_STYLES.includes('font-weight: 600 !important'), 'Badge font weight is 600');
  });

  test('2. Profile "Routines" badge: supports all 4 themes with dedicated golden palettes', () => {
    // Light & Day Mode
    assert.ok(FRESH_STYLES.includes('[data-theme="light"] #profile-smart-lists-badge'), 'Light theme badge style exists');
    assert.ok(FRESH_STYLES.includes('#FEF3C7'), 'Light theme uses soft golden background #FEF3C7');
    assert.ok(FRESH_STYLES.includes('#92400E'), 'Light theme uses dark amber text #92400E');
    assert.ok(FRESH_STYLES.includes('#FCD34D'), 'Light theme uses subtle golden border #FCD34D');

    // Dark Mode
    assert.ok(FRESH_STYLES.includes('[data-theme="dark"] #profile-smart-lists-badge'), 'Dark theme badge style exists');

    // Pet Mode
    assert.ok(FRESH_STYLES.includes('[data-theme="pet"] #profile-smart-lists-badge'), 'Pet theme badge style exists');

    // Pastel Light Mode
    assert.ok(FRESH_STYLES.includes('[data-theme="pastel"] #profile-smart-lists-badge'), 'Pastel theme badge style exists');
  });

  test('3. Confirmation Modal: Delete button is styled as a red destructive button (44px min-height, 12px radius, white text)', () => {
    assert.ok(FRESH_STYLES.includes('.btn-danger-compact'), 'CSS defines .btn-danger-compact');
    assert.ok(FRESH_STYLES.includes('background: #DC2626 !important'), 'Delete button uses clear red #DC2626');
    assert.ok(FRESH_STYLES.includes('color: #FFFFFF !important'), 'Delete button has white text');
    assert.ok(FRESH_STYLES.includes('border-radius: 12px !important'), 'Delete button has 12px rounded corners');
    assert.ok(FRESH_STYLES.includes('min-height: 44px !important'), 'Delete button has 44px minimum height');
    assert.ok(FRESH_STYLES.includes('font-weight: 600 !important'), 'Delete button font-weight is 600');
    assert.ok(FRESH_STYLES.includes('background: #B91C1C !important'), 'Hover/active state uses #B91C1C');
  });

  test('4. Confirmation Modal: Cancel button matches Delete button height and corner radius with neutral styling', () => {
    assert.ok(FRESH_STYLES.includes('.modal-card-confirm .btn-modal-cancel'), 'CSS defines confirmation cancel button');
    assert.ok(FRESH_STYLES.includes('min-height: 44px !important'), 'Cancel button matches 44px height');
    assert.ok(FRESH_STYLES.includes('border-radius: 12px !important'), 'Cancel button matches 12px border radius');
    assert.ok(FRESH_STYLES.includes('background: #F3F4F6 !important'), 'Neutral soft background #F3F4F6');
    assert.ok(FRESH_STYLES.includes('color: #374151 !important'), 'Readable dark-grey text #374151');
  });

  test('5. Confirmation Modal: #btn-proceed-smart-delete contains trash SVG icon and "Delete" text in HTML', () => {
    assert.ok(FRESH_INDEX.includes('id="btn-proceed-smart-delete"'), 'HTML has #btn-proceed-smart-delete');
    assert.ok(FRESH_INDEX.includes('polyline points="3 6 5 6 21 6"'), 'HTML contains trash SVG icon inside delete button');
    assert.ok(FRESH_INDEX.includes('<span>Delete</span>'), 'HTML contains Delete span label');
  });

  test('6. Confirmation Modal: Delete and Cancel buttons support all 4 themes', () => {
    assert.ok(FRESH_STYLES.includes('[data-theme="dark"] .btn-danger-compact'), 'Dark theme delete button');
    assert.ok(FRESH_STYLES.includes('[data-theme="dark"] .modal-card-confirm .btn-modal-cancel'), 'Dark theme cancel button');

    assert.ok(FRESH_STYLES.includes('[data-theme="pet"] .btn-danger-compact'), 'Pet theme delete button');
    assert.ok(FRESH_STYLES.includes('[data-theme="pet"] .modal-card-confirm .btn-modal-cancel'), 'Pet theme cancel button');

    assert.ok(FRESH_STYLES.includes('[data-theme="pastel"] .btn-danger-compact'), 'Pastel theme delete button');
    assert.ok(FRESH_STYLES.includes('[data-theme="pastel"] .modal-card-confirm .btn-modal-cancel'), 'Pastel theme cancel button');
  });

  test('7. Functional integrity: openDeleteConfirm and executePendingDelete work for routines and reports', async () => {
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ id: 'mock_del_' + Math.random().toString(36).slice(2) })
    });

    try {
      const routine = await manager.addRoutine('To Be Deleted');
      assert.strictEqual(manager.state.routines.length, 1);

      // Open confirm for routine
      manager.openDeleteConfirm('routine', routine.id, routine.title);
      assert.strictEqual(manager.state.pendingDeleteType, 'routine');
      assert.strictEqual(manager.state.pendingDeleteId, routine.id);
      const msgEl = getMockElement('smart-delete-confirm-message');
      assert.ok(msgEl.textContent.includes('To Be Deleted'));
      assert.ok(msgEl.textContent.includes('Past historical reports will be preserved'));

      // Execute delete
      await manager.executePendingDelete();
      assert.strictEqual(manager.state.routines.length, 0);
      assert.strictEqual(manager.state.pendingDeleteType, null);
    } finally {
      global.fetch = origFetch;
    }
  });
});
