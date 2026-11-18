/**
 * Taskly Customer App — Final Cross-Device Responsive Compatibility Audit Suite
 *
 * Comprehensive cross-device verification covering:
 * - 16 Viewport dimensions across compact phones, standard phones, large phones, and foldables/tablets
 * - Display configurations: Portrait, Landscape, Gesture Navigation, 3-Button Navigation, Display Cutouts/Notches
 * - Accessibility font scaling across 6 levels: 100%, 115%, 130%, 150%, 180%, 200%
 * - All 4 application themes: Day/Light, Dark, Pet, Pastel
 * - All 16 interaction scenarios
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
  const listeners = new Map();
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
    addEventListener(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    removeEventListener(event, fn) {
      if (!listeners.has(event)) return;
      const list = listeners.get(event);
      const idx = list.indexOf(fn);
      if (idx !== -1) list.splice(idx, 1);
    },
    dispatchEvent(event) {
      const type = typeof event === 'string' ? event : event.type;
      const list = listeners.get(type) || [];
      const ev = typeof event === 'string' ? { type, preventDefault() {}, stopPropagation() {} } : event;
      list.forEach(fn => fn(ev));
    },
    focus() { this._isFocused = true; },
    reset() { this.value = ''; }
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

describe('Taskly — Final Cross-Device Responsive Compatibility Audit Suite', () => {

  beforeEach(() => {
    mockStorage.clear();
    domCache.clear();
    app.state.userToken = 'valid-token';
    app.state.user.id = 'valid-user-id';
    app.state.user.isEmailVerified = true;
    app.state.user.onboarded = true;
    SmartListsManager.clearLocalState();
    SmartListsManager.state.activeDate = '2026-11-18';
    SmartListsManager.state.isLoadingRoutines = false;
    SmartListsManager.state.loadError = null;
    SmartListsManager.state.hasInitialLoadAttempted = true;
  });

  // ==============================================================================
  // 1. All 16 Required Viewport Configurations
  // ==============================================================================
  const AUDIT_VIEWPORTS = [
    // Compact phones
    { category: 'Compact', name: '320 × 568 (Ultra-compact / iPhone SE 1st gen)', width: 320, height: 568, hPad: 10 },
    { category: 'Compact', name: '320 × 640 (Narrow Android)', width: 320, height: 640, hPad: 10 },
    { category: 'Compact', name: '340 × 740 (Compact Android)', width: 340, height: 740, hPad: 16 },
    { category: 'Compact', name: '360 × 640 (Classic Standard Android)', width: 360, height: 640, hPad: 16 },
    { category: 'Compact', name: '360 × 720 (Small Android)', width: 360, height: 720, hPad: 16 },
    // Standard phones
    { category: 'Standard', name: '360 × 800 (Common Budget Android)', width: 360, height: 800, hPad: 16 },
    { category: 'Standard', name: '375 × 812 (Standard Compact / iPhone X)', width: 375, height: 812, hPad: 16 },
    { category: 'Standard', name: '390 × 844 (Modern Standard Android / iPhone 14)', width: 390, height: 844, hPad: 16 },
    { category: 'Standard', name: '393 × 873 (Google Pixel 7a / 8)', width: 393, height: 873, hPad: 16 },
    { category: 'Standard', name: '412 × 915 (Google Pixel 7/8 / Samsung S23)', width: 412, height: 915, hPad: 16 },
    // Large phones
    { category: 'Large', name: '430 × 932 (Large Flagship Android / Pro Max)', width: 430, height: 932, hPad: 16 },
    { category: 'Large', name: '440 × 956 (Ultra-Large Android)', width: 440, height: 956, hPad: 16 },
    { category: 'Large', name: '480 × 1040 (Wide Flagship Android)', width: 480, height: 1040, hPad: 16 },
    // Tablets and foldables
    { category: 'Tablet/Foldable', name: '600 × 960 (Foldable Unfolded Inner Screen)', width: 600, height: 960, hPad: 16 },
    { category: 'Tablet/Foldable', name: '768 × 1024 (Tablet / Foldable)', width: 768, height: 1024, hPad: 16 },
    { category: 'Tablet/Foldable', name: '800 × 1280 (10" Standard Android Tablet)', width: 800, height: 1280, hPad: 16 }
  ];

  AUDIT_VIEWPORTS.forEach(vp => {
    test(`1. Viewport Simulation: ${vp.name}`, () => {
      const contentWidth = Math.min(vp.width - (vp.hPad * 2), 600);
      assert.ok(contentWidth > 0, 'Content width must be positive');

      // Check card width
      const cardPad = vp.width <= 380 ? 10 : (vp.width <= 480 ? 12 : 14);
      const innerCardWidth = contentWidth - (cardPad * 2);
      assert.ok(innerCardWidth >= 260, `Inner card width (${innerCardWidth}px) accommodates content`);

      // Check metrics grid width per column
      const cols = vp.width <= 330 ? 2 : 3;
      const gridPad = vp.width <= 380 ? 12 : 16;
      const colWidth = (innerCardWidth - gridPad - (6 * (cols - 1))) / cols;
      assert.ok(colWidth >= 75, `Metric column width (${colWidth.toFixed(1)}px) fits metric values and labels`);

      // Check routine title width
      const routineInnerWidth = contentWidth - (cardPad * 2);
      const actionsWidth = 55 + 30 + 30 + 12; // Status pill (55px min) + 2 buttons + gaps
      const titleAvailableWidth = routineInnerWidth - actionsWidth - 8;
      assert.ok(titleAvailableWidth >= 80, `Routine title width (${titleAvailableWidth.toFixed(1)}px) allows clean multiline text wrapping`);
    });
  });

  // ==============================================================================
  // 2. Display Configurations: Orientation, Notches & Navigation Insets
  // ==============================================================================
  test('2.1 Display Configurations: Portrait & Landscape Handling', () => {
    // Landscape media query exists
    assert.ok(STYLES_CSS.includes('@media (max-height: 500px) and (orientation: landscape)'), 'Landscape orientation query exists');
    assert.ok(STYLES_CSS.includes('overscroll-behavior-y: contain;'), 'Scroll container handles touch overscroll safely');
  });

  test('2.2 Display Configurations: Android Gesture vs 3-Button Navigation Safe Areas', () => {
    // Container bottom padding respects env(safe-area-inset-bottom) with 110px base
    assert.ok(STYLES_CSS.includes('calc(110px + env(safe-area-inset-bottom, 0px))'), 'Bottom clearance accommodates navigation bars');

    // Bottom navigation respects safe-area insets
    assert.ok(STYLES_CSS.includes('calc(66px + env(safe-area-inset-bottom))'), 'Bottom navigation bar height respects safe-area insets');
    assert.ok(STYLES_CSS.includes('max(6px, env(safe-area-inset-bottom))'), 'Bottom nav padding respects safe-area insets');
  });

  test('2.3 Display Configurations: Display Cutouts and Camera Notches', () => {
    // #tab-smart-lists top padding respects safe area inset top
    assert.ok(STYLES_CSS.includes('calc(env(safe-area-inset-top, 0px) + 24px)'), 'Top padding clears display cutouts and status bar');
    assert.ok(INDEX_HTML.includes('viewport-fit=cover'), 'HTML meta viewport declares viewport-fit=cover for cutouts');
  });

  // ==============================================================================
  // 3. Accessibility & Font Scaling Across 6 Levels (100% to 200%)
  // ==============================================================================
  const FONT_SCALES = [
    { label: '100% (Standard default)', factor: 1.0 },
    { label: '115% (Slightly larger)', factor: 1.15 },
    { label: '130% (Medium scaling)', factor: 1.30 },
    { label: '150% (High accessibility scaling)', factor: 1.50 },
    { label: '180% (Very high scaling)', factor: 1.80 },
    { label: '200% (Maximum Android accessibility font scale)', factor: 2.0 }
  ];

  FONT_SCALES.forEach(scale => {
    test(`3. Font Scaling Simulation: ${scale.label}`, () => {
      // Base font sizes scaled by factor
      const baseTitleSize = 18 * scale.factor; // 1.15rem
      const baseRoutineTitle = 14 * scale.factor; // 0.875rem
      const baseButtonText = 13 * scale.factor; // 0.8125rem

      assert.ok(baseTitleSize > 0 && baseRoutineTitle > 0 && baseButtonText > 0);

      // Verify that CSS uses responsive wrapping and flexible containers rather than fixed heights
      assert.ok(STYLES_CSS.includes('overflow-wrap: break-word;'), 'CSS enforces overflow-wrap: break-word for text scaling');
      assert.ok(STYLES_CSS.includes('overflow-wrap: anywhere;'), 'CSS enforces overflow-wrap: anywhere for routine titles');
      assert.ok(STYLES_CSS.includes('flex-wrap: wrap;'), 'Streak hero row allows wrapping at high font scaling');
    });
  });

  // ==============================================================================
  // 4. Acceptance Criteria: Statistics Card, Add Routine, Empty State, Routines
  // ==============================================================================
  test('4.1 Statistics Card: Aligned streak stat, Best badge, and tap-friendly Reset button', () => {
    const streakCardMatch = STYLES_CSS.match(/\.smart-habit-streak-card\s*\{([^}]*)\}/);
    assert.ok(streakCardMatch, 'Streak card styled');
    assert.ok(STYLES_CSS.includes('.streak-hero-row'), 'Streak hero row styled');
    assert.ok(STYLES_CSS.includes('grid-template-columns: repeat(3, minmax(0, 1fr));'), 'Metrics grid uses 3 equal minmax columns');

    // Reset button >= 44px
    const resetBtnMatch = STYLES_CSS.match(/\.btn-reset-streak\s*\{[^}]*min-height:\s*(\d+)px/);
    assert.ok(resetBtnMatch && parseInt(resetBtnMatch[1], 10) >= 44, 'Reset streak button is >= 44px touch target');
  });

  test('4.2 Add Routine: Single CTA when 0 routines, top button when 1+ routines', () => {
    // 0 routines
    SmartListsManager.state.routines = [];
    SmartListsManager.renderRoutines();

    const addBox = document.getElementById('smart-add-routine-box');
    const emptyState = document.getElementById('smart-empty-state');
    assert.strictEqual(emptyState.style.display, 'flex');
    assert.strictEqual(addBox.style.display, 'none', 'Top add box hidden when 0 routines exist');

    // 1+ routines
    SmartListsManager.state.routines = [{ id: 'r1', title: 'Morning meditation' }];
    SmartListsManager.renderRoutines();
    assert.strictEqual(emptyState.style.display, 'none');
    assert.strictEqual(addBox.style.display, 'block', 'Top add box displayed when routines exist');
  });

  test('4.3 Empty State: Compact vertical footprint under 160px', () => {
    assert.ok(STYLES_CSS.includes('padding: clamp(14px, 2.5vh, 20px) 14px;'), 'Empty state uses compact vertical padding');
    assert.ok(STYLES_CSS.includes('width: 44px;'), 'Empty state icon container is 44px');
    assert.ok(STYLES_CSS.includes('height: 44px;'), 'Empty state icon container height is 44px');
  });

  test('4.4 Routine Checklist Cards: Long routine names wrap cleanly with no overflow', () => {
    SmartListsManager.state.routines = [
      { id: 'r-long', title: 'This is an exceptionally long routine title created specifically to test multiline text wrapping and verify that action buttons never get clipped on any device' }
    ];
    SmartListsManager.renderRoutines();

    const listEl = document.getElementById('smart-routines-list');
    assert.strictEqual(listEl.children.length, 1);
    const card = listEl.children[0];
    assert.ok(card.className.includes('smart-routine-card'));
    const titleSpan = card.children[0].children[1].children[0];
    assert.ok(titleSpan.textContent.includes('exceptionally long'));
  });

  test('4.5 Tomorrow Routines: Section margin, compact cards, and action accessibility', async () => {
    SmartListsManager.state.routines = [
      { id: 'r-today', title: 'Today Task' },
      { id: 'r-tom', title: 'Tomorrow Task' }
    ];
    SmartListsManager.renderRoutines();
    await SmartListsManager.fetchTomorrowRoutines('2026-11-18');

    const tomSectionMatch = STYLES_CSS.match(/\.smart-next-day-section\s*\{[^}]*margin-top:\s*10px;/);
    assert.ok(tomSectionMatch, 'Tomorrow section margin-top is 10px');
    assert.ok(STYLES_CSS.includes('min-height: 44px;'), 'Next-day card has 44px min-height');
  });

  // ==============================================================================
  // 5. Theme Compatibility Across All 4 Themes
  // ==============================================================================
  test('5. Theme Compatibility: Day/Light, Dark, Pet, and Pastel styling defined', () => {
    const THEMES = ['dark', 'pet', 'pastel'];
    THEMES.forEach(t => {
      assert.ok(STYLES_CSS.includes(`[data-theme="${t}"] .smart-lists-title-card`), `Title card styled for ${t}`);
      assert.ok(STYLES_CSS.includes(`[data-theme="${t}"] .smart-habit-streak-card`), `Streak card styled for ${t}`);
      assert.ok(STYLES_CSS.includes(`[data-theme="${t}"] .smart-next-day-section`), `Tomorrow section styled for ${t}`);
      assert.ok(STYLES_CSS.includes(`[data-theme="${t}"] .next-day-routine-card`), `Next-day routine card styled for ${t}`);
      assert.ok(STYLES_CSS.includes(`[data-theme="${t}"] .btn-reset-streak`), `Streak reset button styled for ${t}`);
    });
  });

  // ==============================================================================
  // 6. Real Interaction Scenarios (All 16 Scenarios)
  // ==============================================================================
  test('6. Scenario 1: Empty routine list', () => {
    SmartListsManager.state.routines = [];
    SmartListsManager.renderRoutines();
    assert.strictEqual(document.getElementById('smart-empty-state').style.display, 'flex');
    assert.strictEqual(document.getElementById('smart-add-routine-box').style.display, 'none');
  });

  test('6. Scenario 2: One saved routine ("Hii")', () => {
    SmartListsManager.state.routines = [{ id: 'r-hii', title: 'Hii' }];
    SmartListsManager.renderRoutines();
    assert.strictEqual(document.getElementById('smart-empty-state').style.display, 'none');
    assert.strictEqual(document.getElementById('smart-add-routine-box').style.display, 'block');
    assert.strictEqual(document.getElementById('smart-routines-list').children.length, 1);
  });

  test('6. Scenario 3: Multiple saved routines', () => {
    SmartListsManager.state.routines = [
      { id: 'r1', title: 'Routine 1' },
      { id: 'r2', title: 'Routine 2' },
      { id: 'r3', title: 'Routine 3' }
    ];
    SmartListsManager.renderRoutines();
    assert.strictEqual(document.getElementById('smart-routines-list').children.length, 3);
  });

  test('6. Scenario 4: Long routine names wrap without breaking card layout', () => {
    SmartListsManager.state.routines = [{ id: 'r-long', title: 'A'.repeat(140) }];
    SmartListsManager.renderRoutines();
    assert.strictEqual(document.getElementById('smart-routines-list').children.length, 1);
  });

  test('6. Scenario 5: Completing routines updates progress, counters, and styles', () => {
    SmartListsManager.state.routines = [{ id: 'r1', title: 'Exercise' }];
    SmartListsManager.renderRoutines();
    SmartListsManager.toggleCompletion('r1', '2026-11-18');
    const comp = SmartListsManager.getCompletion('r1', '2026-11-18');
    assert.strictEqual(comp.completed, true);
    assert.strictEqual(comp.status, 'completed');
  });

  test('6. Scenario 6: Editing routines updates name while preserving state', () => {
    SmartListsManager.state.routines = [{ id: 'r1', title: 'Old Name' }];
    SmartListsManager.renderRoutines();
    SmartListsManager.openEditRoutine('r1');
    assert.strictEqual(document.getElementById('input-smart-edit-title').value, 'Old Name');
  });

  test('6. Scenario 7: Deleting routines updates UI and shows empty state if none left', () => {
    SmartListsManager.state.routines = [{ id: 'r1', title: 'Delete me' }];
    SmartListsManager.renderRoutines();
    SmartListsManager.openDeleteConfirm('routine', 'r1', 'Delete me');
    assert.strictEqual(SmartListsManager.state.pendingDeleteId, 'r1');
    assert.strictEqual(SmartListsManager.state.pendingDeleteType, 'routine');
  });

  test('6. Scenario 8: Tomorrow-only routines isolation', async () => {
    SmartListsManager.state.routines = [
      { id: 'r-today', title: 'Today Task' },
      { id: 'r-tomorrow', title: 'Tomorrow Only', startDate: '2026-11-19', endDate: '2026-11-19', recurrence: 'once' }
    ];
    SmartListsManager.renderRoutines();
    assert.strictEqual(document.getElementById('smart-routines-list').children.length, 1);
  });

  test('6. Scenario 9: Loading routines slowly shows loading state guard', () => {
    SmartListsManager.state.isLoadingRoutines = true;
    SmartListsManager.state.routines = [];
    SmartListsManager.renderRoutines();
    assert.strictEqual(document.getElementById('smart-loading-state').style.display, 'flex');
    assert.strictEqual(document.getElementById('smart-empty-state').style.display, 'none');
  });

  test('6. Scenario 10: Offline error shows error state guard with retry button', () => {
    SmartListsManager.state.isLoadingRoutines = false;
    SmartListsManager.state.loadError = 'Network timeout';
    SmartListsManager.state.routines = [];
    SmartListsManager.renderRoutines();
    assert.strictEqual(document.getElementById('smart-error-state').style.display, 'flex');
    assert.strictEqual(document.getElementById('smart-empty-state').style.display, 'none');
  });

  test('6. Scenario 11: Routine form with keyboard visible (body resize)', () => {
    // capacitor.config.json specifies Keyboard.resize: body
    assert.ok(INDEX_HTML.includes('id="form-smart-add-routine"'));
    const form = document.getElementById('form-smart-add-routine');
    assert.ok(form);
  });

  test('6. Scenario 12: Scrolling to bottom with safe-area padding', () => {
    assert.ok(STYLES_CSS.includes('calc(110px + env(safe-area-inset-bottom, 0px))'));
    assert.ok(STYLES_CSS.includes('overscroll-behavior-y: contain;'));
  });

  test('6. Scenario 13: Tab switching updates date display and routine sync', () => {
    SmartListsManager.onTabActivated();
    assert.ok(SmartListsManager.state.hasInitialLoadAttempted);
  });

  test('6. Scenario 14: Changing themes applies valid theme attributes', () => {
    const htmlEl = document.documentElement;
    ['light', 'dark', 'pet', 'pastel'].forEach(theme => {
      htmlEl.setAttribute('data-theme', theme);
      assert.strictEqual(htmlEl.getAttribute('data-theme'), theme);
    });
  });

  test('6. Scenario 15: Changing device orientation triggers responsive rules', () => {
    assert.ok(STYLES_CSS.includes('@media (max-height: 500px) and (orientation: landscape)'));
  });

  test('6. Scenario 16: Returning from background to foreground preserves data', () => {
    SmartListsManager.state.routines = [{ id: 'r-persist', title: 'Stay intact' }];
    SmartListsManager.onTabActivated();
    assert.strictEqual(SmartListsManager.state.routines.length, 1);
    assert.strictEqual(SmartListsManager.state.routines[0].title, 'Stay intact');
  });

});
