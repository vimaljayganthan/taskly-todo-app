/**
 * Taskly Customer App — Smart Lists & Daily Routines Screen Rendering Test Suite
 *
 * Verifies:
 * Scenario 1: User has one saved routine ("Hii" reference from Screenshot 2)
 * Scenario 2: User has multiple saved routines
 * Scenario 3: User has no routines (genuine empty state)
 * Scenario 4: User has current-day routines and tomorrow's routines
 * Scenario 5: User completes a routine
 * Scenario 6: User edits a routine
 * Scenario 7: User deletes a routine
 * Scenario 8: App closed and reopened with existing routines (no empty state flash)
 * Scenario 9: Routine data loads slowly (loading state, no premature empty state)
 * Scenario 10: User switches between screens and returns to Smart Lists (refresh & sync)
 * Scenario 11: Data consistency across streak card counters, pill badges, and summary
 * Scenario 12: HTML & CSS markup integrity for loading, error, and empty states
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');
const STYLES_CSS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), 'utf8');

// Mock localStorage
const mockStorage = new Map();
global.localStorage = {
  getItem: (k) => (mockStorage.has(k) ? mockStorage.get(k) : null),
  setItem: (k, v) => mockStorage.set(k, String(v)),
  removeItem: (k) => mockStorage.delete(k),
  clear: () => mockStorage.clear()
};

// Mock DOM
function createMockElement(id = '', tag = 'div') {
  const classList = new Set();
  const children = [];
  const attributes = new Map();
  let _innerHTML = '';
  return {
    id,
    tagName: tag.toUpperCase(),
    value: '',
    min: '',
    checked: false,
    disabled: false,
    textContent: '',
    style: {},
    get innerHTML() { return _innerHTML; },
    set innerHTML(val) {
      _innerHTML = String(val);
      if (val === '') children.length = 0;
    },
    get className() { return Array.from(classList).join(' '); },
    set className(val) {
      classList.clear();
      if (val) val.split(/\s+/).filter(Boolean).forEach(c => classList.add(c));
    },
    classList: {
      add: (...cls) => cls.forEach(c => classList.add(c)),
      remove: (...cls) => cls.forEach(c => classList.delete(c)),
      contains: (c) => classList.has(c),
      toggle: (c) => (classList.has(c) ? classList.delete(c) : classList.add(c))
    },
    setAttribute: (k, v) => attributes.set(k, String(v)),
    getAttribute: (k) => attributes.get(k) || null,
    hasAttribute: (k) => attributes.has(k),
    appendChild(child) {
      children.push(child);
      return child;
    },
    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx !== -1) children.splice(idx, 1);
      return child;
    },
    get children() { return children; },
    addEventListener: () => {},
    removeEventListener: () => {},
    focus: () => {}
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
  removeEventListener() {},
  localStorage: global.localStorage,
  document: global.document,
  alert: () => {}
};

const app = require('../public/app');
const SmartListsManager = app.SmartListsManager;

describe('Taskly — Smart Lists / Daily Routines Screen Rendering Suite', () => {

  beforeEach(() => {
    mockStorage.clear();
    domCache.clear();
    app.state.userToken = 'valid-token';
    app.state.user.id = 'valid-user-id';
    app.state.user.isEmailVerified = true;
    app.state.user.onboarded = true;
    SmartListsManager.clearLocalState();
    SmartListsManager.state.activeDate = '2026-11-17';
    SmartListsManager.state.isLoadingRoutines = false;
    SmartListsManager.state.loadError = null;
    SmartListsManager.state.hasInitialLoadAttempted = true;
  });

  // ==============================================================================
  // Scenario 1: User has one saved routine ("Hii" Reference from Screenshot 2)
  // ==============================================================================
  test('Scenario 1: User has one saved routine ("Hii") - matches Screenshot 2 expected layout', async () => {
    SmartListsManager.state.routines = [
      { id: 'routine-hii-1', title: 'Hii', orderIndex: 0, createdAt: '2026-11-17T10:00:00Z' }
    ];

    SmartListsManager.renderRoutines();

    const listEl = document.getElementById('smart-routines-list');
    const emptyState = document.getElementById('smart-empty-state');
    const progressText = document.getElementById('smart-progress-text');
    const chipComp = document.getElementById('chip-count-completed');
    const chipPend = document.getElementById('chip-count-pending');
    const footerSub = document.getElementById('footer-summary-sub');

    // List must render exactly 1 routine card
    assert.strictEqual(listEl.children.length, 1, 'Routines list must have 1 child card');
    const card = listEl.children[0];
    assert.strictEqual(card.getAttribute('data-routine-id'), 'routine-hii-1');
    assert.ok(card.className.includes('status-pending'), 'Routine card must have status-pending class');

    // Title must be "Hii"
    const titleSpan = card.children[0].children[1].children[0];
    assert.strictEqual(titleSpan.textContent, 'Hii');

    // Empty state must NOT be visible
    assert.strictEqual(emptyState.style.display, 'none', 'Empty state must be hidden');

    // Progress pill must show 0 / 1 completed • 0%
    assert.strictEqual(progressText.textContent, '0 / 1 completed • 0%');

    // Footer summary must show 0 of 1 routines completed today (0%)
    assert.strictEqual(footerSub.textContent, '0 of 1 routines completed today (0%)');

    // Streak card chips must show 0 Done and 1 Pending
    assert.strictEqual(chipComp.textContent, '✓ 0 Done');
    assert.strictEqual(chipPend.textContent, '○ 1 Pending');

    // Tomorrow's routines list must display the scheduled routine
    await SmartListsManager.fetchTomorrowRoutines('2026-11-17');
    const tomBadge = document.getElementById('smart-tomorrow-count-badge');
    assert.strictEqual(tomBadge.textContent, '1 routine');
    const tomList = document.getElementById('smart-tomorrow-routines-list');
    assert.strictEqual(tomList.children.length, 1);
  });

  // ==============================================================================
  // Scenario 2: User has multiple saved routines
  // ==============================================================================
  test('Scenario 2: User has multiple saved routines - renders all and computes accurate stats', () => {
    SmartListsManager.state.routines = [
      { id: 'r1', title: 'Morning meditation' },
      { id: 'r2', title: 'Drink 3L water' },
      { id: 'r3', title: 'Read 20 pages' }
    ];
    SmartListsManager.state.completions['r1_2026-11-17'] = { status: 'completed', completed: true };

    SmartListsManager.renderRoutines();

    const listEl = document.getElementById('smart-routines-list');
    const emptyState = document.getElementById('smart-empty-state');
    const progressText = document.getElementById('smart-progress-text');
    const chipComp = document.getElementById('chip-count-completed');
    const chipPend = document.getElementById('chip-count-pending');

    assert.strictEqual(listEl.children.length, 3, 'All 3 routines rendered');
    assert.strictEqual(emptyState.style.display, 'none', 'Empty state hidden');
    assert.strictEqual(progressText.textContent, '1 / 3 completed • 33%');
    assert.strictEqual(chipComp.textContent, '✓ 1 Done');
    assert.strictEqual(chipPend.textContent, '○ 2 Pending');
  });

  // ==============================================================================
  // Scenario 3: User has no routines (genuine empty state)
  // ==============================================================================
  test('Scenario 3: User has no routines - genuine empty state is displayed', () => {
    SmartListsManager.state.routines = [];
    SmartListsManager.state.isLoadingRoutines = false;

    SmartListsManager.renderRoutines();

    const listEl = document.getElementById('smart-routines-list');
    const emptyState = document.getElementById('smart-empty-state');
    const progressText = document.getElementById('smart-progress-text');
    const chipComp = document.getElementById('chip-count-completed');
    const chipPend = document.getElementById('chip-count-pending');

    assert.strictEqual(listEl.children.length, 0);
    assert.strictEqual(emptyState.style.display, 'flex', 'Empty state visible when zero routines');
    assert.strictEqual(progressText.textContent, '0 / 0 completed');
    assert.strictEqual(chipComp.textContent, '✓ 0 Done');
    assert.strictEqual(chipPend.textContent, '○ 0 Pending');
  });

  // ==============================================================================
  // Scenario 4: Current-day routines and tomorrow routines separation
  // ==============================================================================
  test('Scenario 4: Current-day and tomorrow routines are displayed separately', async () => {
    SmartListsManager.state.routines = [
      { id: 'r-today', title: 'Today Habit' },
      { id: 'r-tomorrow', title: 'Tomorrow Only Habit', startDate: '2026-11-18', endDate: '2026-11-18', recurrence: 'once' }
    ];

    SmartListsManager.renderRoutines();
    await SmartListsManager.fetchTomorrowRoutines('2026-11-17');

    const todayList = document.getElementById('smart-routines-list');
    const tomList = document.getElementById('smart-tomorrow-routines-list');

    // Today list contains only Today Habit
    assert.strictEqual(todayList.children.length, 1);
    assert.strictEqual(todayList.children[0].getAttribute('data-routine-id'), 'r-today');

    // Tomorrow list contains both Today Habit (daily recurrence) and Tomorrow Only Habit
    assert.strictEqual(tomList.children.length, 2);
  });

  // ==============================================================================
  // Scenario 5: User completes a routine
  // ==============================================================================
  test('Scenario 5: Completing a routine updates completion status and counters', async () => {
    SmartListsManager.state.routines = [
      { id: 'r-hii', title: 'Hii' }
    ];

    SmartListsManager.renderRoutines();
    assert.strictEqual(document.getElementById('chip-count-pending').textContent, '○ 1 Pending');
    assert.strictEqual(document.getElementById('chip-count-completed').textContent, '✓ 0 Done');

    // Toggle completion
    await SmartListsManager.toggleCompletion('r-hii', '2026-11-17');
    SmartListsManager.renderRoutines();

    assert.strictEqual(document.getElementById('chip-count-pending').textContent, '○ 0 Pending');
    assert.strictEqual(document.getElementById('chip-count-completed').textContent, '✓ 1 Done');
    assert.strictEqual(document.getElementById('smart-progress-text').textContent, '1 / 1 completed • 100%');
    assert.strictEqual(document.getElementById('footer-summary-sub').textContent, '1 of 1 routines completed today (100%)');
  });

  // ==============================================================================
  // Scenario 6: User edits a routine
  // ==============================================================================
  test('Scenario 6: Editing a routine updates the title and keeps state consistent', async () => {
    SmartListsManager.state.routines = [
      { id: 'r-edit', title: 'Old Title' }
    ];

    SmartListsManager.renderRoutines();
    assert.strictEqual(SmartListsManager.state.routines[0].title, 'Old Title');

    await SmartListsManager.updateRoutine('r-edit', 'Updated Habit Title');
    assert.strictEqual(SmartListsManager.state.routines[0].title, 'Updated Habit Title');

    const listEl = document.getElementById('smart-routines-list');
    assert.strictEqual(listEl.children.length, 1);
    const titleSpan = listEl.children[0].children[0].children[1].children[0];
    assert.strictEqual(titleSpan.textContent, 'Updated Habit Title');
  });

  // ==============================================================================
  // Scenario 7: User deletes a routine
  // ==============================================================================
  test('Scenario 7: Deleting a routine updates the list and shows empty state only if none left', async () => {
    SmartListsManager.state.routines = [
      { id: 'r-del', title: 'To Delete' }
    ];

    SmartListsManager.renderRoutines();
    assert.strictEqual(document.getElementById('smart-empty-state').style.display, 'none');

    await SmartListsManager.deleteRoutine('r-del');
    SmartListsManager.renderRoutines();

    assert.strictEqual(SmartListsManager.state.routines.length, 0);
    assert.strictEqual(document.getElementById('smart-empty-state').style.display, 'flex');
    assert.strictEqual(document.getElementById('chip-count-pending').textContent, '○ 0 Pending');
    assert.strictEqual(document.getElementById('chip-count-completed').textContent, '✓ 0 Done');
  });

  // ==============================================================================
  // Scenario 8: App closed and reopened with existing routines
  // ==============================================================================
  test('Scenario 8: App closed and reopened with existing routines loads from storage immediately without empty flash', async () => {
    // Cold start with clear in-memory state
    SmartListsManager.clearLocalState();
    assert.strictEqual(SmartListsManager.state.routines.length, 0);

    // Simulate saved routines already existing in persistent storage on device restart
    mockStorage.set('taskly_smart_routines', JSON.stringify([
      { id: 'persisted-1', title: 'Hii', orderIndex: 0 }
    ]));

    // Call openScreen
    await SmartListsManager.openScreen();

    // Must have loaded from storage immediately
    assert.strictEqual(SmartListsManager.state.routines.length, 1);
    assert.strictEqual(SmartListsManager.state.routines[0].title, 'Hii');
    assert.strictEqual(document.getElementById('smart-empty-state').style.display, 'none');
    assert.strictEqual(document.getElementById('smart-routines-list').children.length, 1);
    assert.strictEqual(document.getElementById('chip-count-pending').textContent, '○ 1 Pending');
  });

  // ==============================================================================
  // Scenario 9: Routine data loads slowly (Loading state, no premature empty state)
  // ==============================================================================
  test('Scenario 9: Slow loading displays loading state, NEVER prematurely triggers empty state', () => {
    SmartListsManager.state.routines = [];
    SmartListsManager.state.isLoadingRoutines = true;
    SmartListsManager.state.hasInitialLoadAttempted = false;

    SmartListsManager.renderRoutines();

    const emptyState = document.getElementById('smart-empty-state');
    const loadingState = document.getElementById('smart-loading-state');
    const listEl = document.getElementById('smart-routines-list');

    // While loading, empty state must NOT appear!
    assert.strictEqual(emptyState.style.display, 'none', 'Empty state must not appear while loading');
    assert.strictEqual(loadingState.style.display, 'flex', 'Loading state must be visible');
    assert.strictEqual(listEl.children.length, 0);

    // When data arrives:
    SmartListsManager.state.isLoadingRoutines = false;
    SmartListsManager.state.hasInitialLoadAttempted = true;
    SmartListsManager.state.routines = [{ id: 'slow-r', title: 'Hii' }];

    SmartListsManager.renderRoutines();

    assert.strictEqual(loadingState.style.display, 'none', 'Loading state hidden after data arrives');
    assert.strictEqual(emptyState.style.display, 'none', 'Empty state remains hidden');
    assert.strictEqual(listEl.children.length, 1, 'Routine rendered');
  });

  // ==============================================================================
  // Scenario 10: User switches between screens and returns to Smart Lists
  // ==============================================================================
  test('Scenario 10: Switching tabs calls onTabActivated and updates date display, streaks, counters and routines', () => {
    SmartListsManager.state.routines = [{ id: 'tab-r', title: 'Hii' }];
    SmartListsManager.state.activeDate = '2026-11-17';

    SmartListsManager.onTabActivated();

    assert.strictEqual(document.getElementById('smart-empty-state').style.display, 'none');
    assert.strictEqual(document.getElementById('smart-routines-list').children.length, 1);
    assert.strictEqual(document.getElementById('chip-count-pending').textContent, '○ 1 Pending');
    assert.strictEqual(document.getElementById('chip-count-completed').textContent, '✓ 0 Done');
    assert.strictEqual(document.getElementById('smart-progress-text').textContent, '0 / 1 completed • 0%');
  });

  // ==============================================================================
  // Scenario 11: Data consistency across streak card counters and daily summary
  // ==============================================================================
  test('Scenario 11: Counters and completion rate are 100% mathematically consistent', () => {
    SmartListsManager.state.routines = [
      { id: 'c1', title: 'R1' },
      { id: 'c2', title: 'R2' }
    ];
    SmartListsManager.state.completions['c1_2026-11-17'] = { status: 'completed', completed: true };

    SmartListsManager.renderRoutines();

    assert.strictEqual(SmartListsManager.state.dailyStats.totalCount, 2);
    assert.strictEqual(SmartListsManager.state.dailyStats.completedCount, 1);
    assert.strictEqual(SmartListsManager.state.dailyStats.pendingCount, 1);
    assert.strictEqual(SmartListsManager.state.dailyStats.completionRate, 50);

    assert.strictEqual(document.getElementById('chip-count-completed').textContent, '✓ 1 Done');
    assert.strictEqual(document.getElementById('chip-count-pending').textContent, '○ 1 Pending');
    assert.strictEqual(document.getElementById('smart-progress-text').textContent, '1 / 2 completed • 50%');
    assert.strictEqual(document.getElementById('footer-summary-sub').textContent, '1 of 2 routines completed today (50%)');
  });

  // ==============================================================================
  // Scenario 12: HTML & CSS Markup Integrity
  // ==============================================================================
  test('Scenario 12: HTML & CSS define smart-loading-state, smart-error-state, and retry button', () => {
    assert.ok(INDEX_HTML.includes('id="smart-loading-state"'), 'index.html contains smart-loading-state');
    assert.ok(INDEX_HTML.includes('id="smart-error-state"'), 'index.html contains smart-error-state');
    assert.ok(INDEX_HTML.includes('id="btn-smart-retry-load"'), 'index.html contains btn-smart-retry-load');

    assert.ok(STYLES_CSS.includes('.smart-loading-state'), 'styles.css defines .smart-loading-state');
    assert.ok(STYLES_CSS.includes('.smart-loading-spinner'), 'styles.css defines .smart-loading-spinner');
    assert.ok(STYLES_CSS.includes('.smart-error-state'), 'styles.css defines .smart-error-state');
    assert.ok(STYLES_CSS.includes('.btn-smart-retry'), 'styles.css defines .btn-smart-retry');
  });

});
