/**
 * Taskly v2.0.0 Build 11 - Phase 3: Habit Streaks UI & 4-State Routine Interactions Automated Test Suite
 *
 * Verifies:
 * Part 1: DOM Elements, Layout & Static Markup for Habit Streaks & Status Picker
 * Part 2: Multi-Theme CSS & Touch-Target (>= 44px) Verification
 * Part 3: SmartListsManager Normalized State, Completions & 80% Habit Engine
 * Part 4: 4-State Routine Transitions (Completed, Pending, Postponed, Cancelled)
 * Part 5: Status Picker Modal UI, Subform Toggling & Action Handlers
 * Part 6: Rescheduling / Postponement Forward Scheduling Integrity
 * Part 7: Offline Local Fallback (No Fabricated Data on Network Failure)
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');
const STYLES_CSS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), 'utf8');

// Mock localStorage for node environment
const mockStorage = new Map();
global.localStorage = {
  getItem: (k) => (mockStorage.has(k) ? mockStorage.get(k) : null),
  setItem: (k, v) => mockStorage.set(k, String(v)),
  removeItem: (k) => mockStorage.delete(k),
  clear: () => mockStorage.clear()
};

// Mock minimal DOM
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

describe('Taskly v2.0.0 Build 11 — Phase 3: Habit Streaks UI & Interactions Suite', () => {

  beforeEach(() => {
    mockStorage.clear();
    domCache.clear();
    SmartListsManager.clearLocalState();
    SmartListsManager.state.activeDate = '2026-11-08';
  });

  // ==============================================================================
  // Part 1: DOM Elements, Layout & Static Markup
  // ==============================================================================
  describe('Part 1: DOM Elements & Static Markup', () => {
    test('1. index.html contains #smart-habit-streak-card inside tab-smart-lists', () => {
      assert.ok(INDEX_HTML.includes('id="smart-habit-streak-card"'), 'Streak card ID must exist');
      assert.ok(INDEX_HTML.includes('id="tab-smart-lists"'), 'Tab smart lists must exist');
      const tabIdx = INDEX_HTML.indexOf('id="tab-smart-lists"');
      const cardIdx = INDEX_HTML.indexOf('id="smart-habit-streak-card"');
      assert.ok(cardIdx > tabIdx, 'Streak card must be placed within tab-smart-lists');
    });

    test('2. Streak card contains all required metrics elements and simplified chips (v2.1.0)', () => {
      const requiredIds = [
        'habit-current-streak-count',
        'habit-longest-streak-count',
        'habit-daily-rate',
        'habit-weekly-consistency',
        'habit-monthly-consistency',
        'chip-count-completed',
        'chip-count-pending'
      ];
      requiredIds.forEach(id => {
        assert.ok(INDEX_HTML.includes(`id="${id}"`), `Element #${id} must exist in index.html`);
      });
      // Postponed & cancelled chips removed from streak summary UI
      assert.ok(!INDEX_HTML.includes('id="chip-count-postponed"'), 'chip-count-postponed must be removed from streak summary');
      assert.ok(!INDEX_HTML.includes('id="chip-count-cancelled"'), 'chip-count-cancelled must be removed from streak summary');
    });

    test('3. index.html contains modal-smart-status-picker and all 4 status option buttons', () => {
      assert.ok(INDEX_HTML.includes('id="modal-smart-status-picker"'), 'Status picker modal ID must exist');
      assert.ok(INDEX_HTML.includes('id="opt-status-completed"'), 'Completed option button must exist');
      assert.ok(INDEX_HTML.includes('id="opt-status-pending"'), 'Pending option button must exist');
      assert.ok(INDEX_HTML.includes('id="opt-status-postponed"'), 'Postponed option button must exist');
      assert.ok(INDEX_HTML.includes('id="opt-status-cancelled"'), 'Cancelled option button must exist');
      assert.ok(INDEX_HTML.includes('id="status-subform-postpone"'), 'Postpone subform must exist');
      assert.ok(INDEX_HTML.includes('id="status-subform-cancel"'), 'Cancel subform must exist');
      assert.ok(INDEX_HTML.includes('id="btn-confirm-status-picker"'), 'Confirm button must exist');
      assert.ok(INDEX_HTML.includes('id="btn-cancel-status-picker"'), 'Cancel button must exist');
    });
  });

  // ==============================================================================
  // Part 2: Multi-Theme CSS & Touch-Target Verification
  // ==============================================================================
  describe('Part 2: Multi-Theme CSS & Touch Targets', () => {
    test('1. Touch targets for status buttons are >= 44px', () => {
      assert.ok(STYLES_CSS.includes('.btn-routine-status-pill'), 'btn-routine-status-pill class must be styled');
      assert.ok(STYLES_CSS.includes('min-height: 44px'), '44px min-height must be defined for status controls');
      assert.ok(STYLES_CSS.includes('.btn-status-option'), 'btn-status-option class must be styled');
    });

    test('2. All 4 themes (light, dark, pet, pastel) define status picker and streak card styles', () => {
      const themes = ['light', 'dark', 'pet', 'pastel'];
      themes.forEach(theme => {
        assert.ok(STYLES_CSS.includes(`[data-theme="${theme}"]`), `Theme ${theme} selector must exist in styles.css`);
      });
      assert.ok(STYLES_CSS.includes('.smart-habit-streak-card'), 'Streak card CSS class must exist');
      assert.ok(STYLES_CSS.includes('.modal-status-picker-card'), 'Modal status picker card class must exist');
    });
  });

  // ==============================================================================
  // Part 3: SmartListsManager Normalized State & 80% Habit Engine
  // ==============================================================================
  describe('Part 3: SmartListsManager State & 80% Habit Rule Engine', () => {
    test('1. getCompletion normalizes legacy boolean completed into 4-state model', () => {
      SmartListsManager.state.completions['r1_2026-11-08'] = { completed: true, carriedForward: false };
      SmartListsManager.state.completions['r2_2026-11-08'] = { completed: false, carriedForward: true };

      const comp1 = SmartListsManager.getCompletion('r1', '2026-11-08');
      assert.strictEqual(comp1.status, 'completed');
      assert.strictEqual(comp1.completed, true);

      const comp2 = SmartListsManager.getCompletion('r2', '2026-11-08');
      assert.strictEqual(comp2.status, 'pending');
      assert.strictEqual(comp2.completed, false);
      assert.strictEqual(comp2.carriedForward, true);

      const comp3 = SmartListsManager.getCompletion('r3', '2026-11-08');
      assert.strictEqual(comp3.status, 'pending');
      assert.strictEqual(comp3.completed, false);
    });

    test('2. computeLocalStreaksAndStats correctly applies the 80% rule with cancelled exclusion', () => {
      SmartListsManager.state.routines = [
        { id: 'r1', title: 'Routine 1' },
        { id: 'r2', title: 'Routine 2' },
        { id: 'r3', title: 'Routine 3' },
        { id: 'r4', title: 'Routine 4' },
        { id: 'r5', title: 'Routine 5' }
      ];

      // 4 completed, 1 cancelled:
      // Total = 5, Cancelled = 1, Eligible = 4. Completed = 4 -> 4/4 = 100% -> Qualifies!
      SmartListsManager.state.completions['r1_2026-11-08'] = { status: 'completed' };
      SmartListsManager.state.completions['r2_2026-11-08'] = { status: 'completed' };
      SmartListsManager.state.completions['r3_2026-11-08'] = { status: 'completed' };
      SmartListsManager.state.completions['r4_2026-11-08'] = { status: 'completed' };
      SmartListsManager.state.completions['r5_2026-11-08'] = { status: 'cancelled', cancellationReason: 'Rest day' };

      SmartListsManager.computeLocalStreaksAndStats('2026-11-08');

      assert.strictEqual(SmartListsManager.state.dailyStats.totalCount, 5);
      assert.strictEqual(SmartListsManager.state.dailyStats.cancelledCount, 1);
      assert.strictEqual(SmartListsManager.state.dailyStats.eligibleCount, 4);
      assert.strictEqual(SmartListsManager.state.dailyStats.completedCount, 4);
      assert.strictEqual(SmartListsManager.state.dailyStats.completionRate, 100);
      assert.strictEqual(SmartListsManager.state.dailyStats.isQualified, true);
      assert.strictEqual(SmartListsManager.state.streaks.currentStreak, 1);
    });

    test('3. Postponed routine is counted as incomplete on original date', () => {
      SmartListsManager.state.routines = [
        { id: 'r1', title: 'Routine 1' },
        { id: 'r2', title: 'Routine 2' }
      ];

      // 1 completed, 1 postponed:
      // Total = 2, Eligible = 2, Completed = 1 -> 50% (< 80%) -> Does NOT qualify
      SmartListsManager.state.completions['r1_2026-11-08'] = { status: 'completed' };
      SmartListsManager.state.completions['r2_2026-11-08'] = { status: 'postponed', postponedToDate: '2026-11-09' };

      SmartListsManager.computeLocalStreaksAndStats('2026-11-08');

      assert.strictEqual(SmartListsManager.state.dailyStats.postponedCount, 1);
      assert.strictEqual(SmartListsManager.state.dailyStats.eligibleCount, 2);
      assert.strictEqual(SmartListsManager.state.dailyStats.completionRate, 50);
      assert.strictEqual(SmartListsManager.state.dailyStats.isQualified, false);
    });

    test('4. Days with zero eligible routines do not qualify for a streak', () => {
      SmartListsManager.state.routines = [
        { id: 'r1', title: 'Routine 1' }
      ];

      // Only routine cancelled:
      // Eligible = 0 -> Does NOT qualify
      SmartListsManager.state.completions['r1_2026-11-08'] = { status: 'cancelled' };

      SmartListsManager.computeLocalStreaksAndStats('2026-11-08');

      assert.strictEqual(SmartListsManager.state.dailyStats.eligibleCount, 0);
      assert.strictEqual(SmartListsManager.state.dailyStats.completionRate, 0);
      assert.strictEqual(SmartListsManager.state.dailyStats.isQualified, false);
    });
  });

  // ==============================================================================
  // Part 4: 4-State Routine Transitions & Scheduling
  // ==============================================================================
  describe('Part 4: 4-State Routine Transitions & Scheduling', () => {
    test('1. setRoutineStatus updates local status to postponed and schedules future date', async () => {
      SmartListsManager.state.routines = [{ id: 'r1', title: 'Gym workout' }];

      const res = await SmartListsManager.setRoutineStatus('r1', '2026-11-08', 'postponed', {
        postponedToDate: '2026-11-09'
      });

      assert.strictEqual(res, true);

      // Verify original date is postponed
      const compOrig = SmartListsManager.getCompletion('r1', '2026-11-08');
      assert.strictEqual(compOrig.status, 'postponed');
      assert.strictEqual(compOrig.completed, false);
      assert.strictEqual(compOrig.postponedToDate, '2026-11-09');

      // Verify rescheduled date is initialized as pending and carriedForward
      const compNext = SmartListsManager.getCompletion('r1', '2026-11-09');
      assert.strictEqual(compNext.status, 'pending');
      assert.strictEqual(compNext.completed, false);
      assert.strictEqual(compNext.carriedForward, true);
    });

    test('2. setRoutineStatus updates local status to cancelled with reason', async () => {
      SmartListsManager.state.routines = [{ id: 'r1', title: 'Running' }];

      const res = await SmartListsManager.setRoutineStatus('r1', '2026-11-08', 'cancelled', {
        cancellationReason: 'Heavy rain'
      });

      assert.strictEqual(res, true);

      const comp = SmartListsManager.getCompletion('r1', '2026-11-08');
      assert.strictEqual(comp.status, 'cancelled');
      assert.strictEqual(comp.completed, false);
      assert.strictEqual(comp.cancellationReason, 'Heavy rain');
    });

    test('3. setRoutineStatus validates allowed statuses and rejects invalid status', async () => {
      const res = await SmartListsManager.setRoutineStatus('r1', '2026-11-08', 'unknown_status');
      assert.strictEqual(res, false);
    });
  });

  // ==============================================================================
  // Part 5: Status Picker Modal UI & Action Handlers
  // ==============================================================================
  describe('Part 5: Status Picker Modal UI & Action Handlers', () => {
    test('1. openStatusPicker pre-fills title, pre-selects current status and shows modal', () => {
      SmartListsManager.state.routines = [{ id: 'r10', title: 'Meditation' }];
      SmartListsManager.state.completions['r10_2026-11-08'] = { status: 'cancelled', cancellationReason: 'Travel' };

      SmartListsManager.openStatusPicker('r10', '2026-11-08');

      assert.strictEqual(SmartListsManager.state.pendingStatusRoutineId, 'r10');
      assert.strictEqual(SmartListsManager.state.pendingStatusDate, '2026-11-08');
      assert.strictEqual(SmartListsManager.state.pendingStatusSelection, 'cancelled');

      const titleEl = document.getElementById('status-picker-routine-title');
      assert.strictEqual(titleEl.textContent, 'Meditation');

      const modal = document.getElementById('modal-smart-status-picker');
      assert.ok(modal.classList.contains('active'), 'Modal must have active class');
    });

    test('2. updateStatusPickerUI toggles postpone and cancel subforms appropriately', () => {
      SmartListsManager.updateStatusPickerUI('postponed');
      assert.strictEqual(document.getElementById('status-subform-postpone').style.display, 'block');
      assert.strictEqual(document.getElementById('status-subform-cancel').style.display, 'none');

      SmartListsManager.updateStatusPickerUI('cancelled');
      assert.strictEqual(document.getElementById('status-subform-postpone').style.display, 'none');
      assert.strictEqual(document.getElementById('status-subform-cancel').style.display, 'block');

      SmartListsManager.updateStatusPickerUI('completed');
      assert.strictEqual(document.getElementById('status-subform-postpone').style.display, 'none');
      assert.strictEqual(document.getElementById('status-subform-cancel').style.display, 'none');
    });

    test('3. closeStatusPicker cleans up pending selection and closes modal', () => {
      SmartListsManager.state.pendingStatusRoutineId = 'r1';
      SmartListsManager.state.pendingStatusDate = '2026-11-08';
      SmartListsManager.state.pendingStatusSelection = 'completed';

      const modal = document.getElementById('modal-smart-status-picker');
      modal.classList.add('active');

      SmartListsManager.closeStatusPicker();

      assert.strictEqual(SmartListsManager.state.pendingStatusRoutineId, null);
      assert.strictEqual(SmartListsManager.state.pendingStatusDate, null);
      assert.strictEqual(SmartListsManager.state.pendingStatusSelection, null);
      assert.strictEqual(modal.classList.contains('active'), false);
    });
  });

  // ==============================================================================
  // Part 6: Routine Rendering & Touch Status Pill Button
  // ==============================================================================
  describe('Part 6: Routine Rendering & Touch Status Pill Button', () => {
    test('1. renderRoutines builds routine cards with touch status pills and badges', () => {
      SmartListsManager.state.routines = [
        { id: 'r1', title: 'Hydration' },
        { id: 'r2', title: 'Exercise' },
        { id: 'r3', title: 'Stretching' }
      ];
      SmartListsManager.state.completions['r1_2026-11-08'] = { status: 'completed' };
      SmartListsManager.state.completions['r2_2026-11-08'] = { status: 'postponed', postponedToDate: '2026-11-09' };
      SmartListsManager.state.completions['r3_2026-11-08'] = { status: 'cancelled', cancellationReason: 'Soreness' };

      SmartListsManager.renderRoutines();

      const listEl = document.getElementById('smart-routines-list');
      assert.strictEqual(listEl.children.length, 3, 'Should render 3 routine cards');

      // Card 1: Completed
      const card1 = listEl.children[0];
      assert.ok(card1.classList.contains('completed'), 'Card 1 must have completed class');
      assert.ok(card1.classList.contains('status-completed'), 'Card 1 must have status-completed class');

      // Card 2: Postponed
      const card2 = listEl.children[1];
      assert.ok(card2.classList.contains('status-postponed'), 'Card 2 must have status-postponed class');

      // Card 3: Cancelled
      const card3 = listEl.children[2];
      assert.ok(card3.classList.contains('status-cancelled'), 'Card 3 must have status-cancelled class');
    });

    test('2. Streak widget DOM values update properly after renderStreakWidget', () => {
      SmartListsManager.state.streaks = { currentStreak: 5, longestStreak: 12 };
      SmartListsManager.state.dailyStats = {
        completionRate: 85,
        completedCount: 4,
        pendingCount: 0,
        postponedCount: 1,
        cancelledCount: 1
      };
      SmartListsManager.state.consistency = {
        weekly: { percentage: 80, qualifyingDays: 4, totalDays: 5 },
        monthly: { percentage: 75, qualifyingDays: 6, totalDays: 8 }
      };

      SmartListsManager.renderStreakWidget();

      assert.strictEqual(document.getElementById('habit-current-streak-count').textContent, '5 Days');
      assert.strictEqual(document.getElementById('habit-longest-streak-count').textContent, '12 Days');
      assert.strictEqual(document.getElementById('habit-daily-rate').textContent, '85%');
      assert.strictEqual(document.getElementById('habit-weekly-consistency').textContent, '80%');
      assert.strictEqual(document.getElementById('habit-weekly-days').textContent, '4/5 days');
      assert.strictEqual(document.getElementById('habit-monthly-consistency').textContent, '75%');
      assert.strictEqual(document.getElementById('habit-monthly-days').textContent, '6/8 days');
      assert.strictEqual(document.getElementById('chip-count-completed').textContent, '✓ 4 Done');
      assert.strictEqual(document.getElementById('chip-count-pending').textContent, '○ 0 Pending');
      assert.strictEqual(document.getElementById('chip-count-postponed').textContent, '');
      assert.strictEqual(document.getElementById('chip-count-cancelled').textContent, '');
    });
  });

  // ==============================================================================
  // Part 7: Offline Local Fallback (No Fabricated Data on Failure)
  // ==============================================================================
  describe('Part 7: Offline Local Fallback & No Fabricated Data', () => {
    test('1. fetchStreaksAndStats falls back to computeLocalStreaksAndStats when fetch fails', async () => {
      SmartListsManager.state.routines = [
        { id: 'r1', title: 'Reading' },
        { id: 'r2', title: 'Journaling' }
      ];
      SmartListsManager.state.completions['r1_2026-11-08'] = { status: 'completed' };
      SmartListsManager.state.completions['r2_2026-11-08'] = { status: 'completed' };

      // In this environment, relative fetch throws ERR_INVALID_URL
      await SmartListsManager.fetchStreaksAndStats('2026-11-08');

      // The fallback must compute accurately from stored completions (not random or zeroed out)
      assert.strictEqual(SmartListsManager.state.dailyStats.completionRate, 100);
      assert.strictEqual(SmartListsManager.state.dailyStats.completedCount, 2);
      assert.strictEqual(SmartListsManager.state.dailyStats.isQualified, true);
      assert.strictEqual(SmartListsManager.state.streaks.currentStreak, 1);
    });
  });
});
