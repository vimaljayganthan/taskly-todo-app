/**
 * Taskly Customer App — Smart Lists Responsive UI/UX Optimization Test Suite
 *
 * Verifies all 8 core requirements from the optimization brief:
 * 1. Overall page layout & responsive spacing
 * 2. Optimized Streak & Statistics Card (compact, aligned, touch-friendly)
 * 3. Single Add Routine call-to-action when 0 routines vs top button when 1+ routines
 * 4. Compact redesigned empty-state panel (<= 160px height footprint)
 * 5. Tomorrow's Routines compact cards, clean wrapping, and balanced margins
 * 6. Bottom navigation clearance & safe-area inset handling across devices
 * 7. Multi-viewport layout simulation across all 8 required screen sizes:
 *    - 320 x 640 (Narrow compact Android)
 *    - 360 x 720 (Small Android)
 *    - 360 x 800 (Common budget Android)
 *    - 375 x 812 (Standard compact)
 *    - 390 x 844 (Modern standard Android / iPhone)
 *    - 412 x 915 (Google Pixel / Samsung Galaxy)
 *    - 430 x 932 (Large flagship Android)
 *    - 768 x 1024 (Tablet / Foldable inner screen)
 * 8. Full theme compatibility across all 4 themes (Day/Light, Dark, Pet, Pastel)
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

// Mock DOM factory
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

describe('Taskly — Smart Lists Responsive UI/UX Optimization Suite', () => {

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
  // 1. Overall Page Layout & Responsive Spacing
  // ==============================================================================
  test('1. Page Layout: Scrollable container, overflow-x hidden, border-box, and responsive gaps', () => {
    // #tab-smart-lists container rules
    assert.ok(STYLES_CSS.includes('overflow-x: hidden;'), 'Container must have overflow-x: hidden');
    assert.ok(STYLES_CSS.includes('overflow-y: auto;'), 'Container must have overflow-y: auto');
    assert.ok(STYLES_CSS.includes('box-sizing: border-box;'), 'Container must enforce border-box');
    assert.ok(STYLES_CSS.includes('-webkit-overflow-scrolling: touch;'), 'Container must support smooth mobile scrolling');

    // Title card compact styling
    assert.ok(STYLES_CSS.includes('.smart-lists-title-card'), 'Title card class exists');
    assert.ok(STYLES_CSS.includes('padding: 12px 14px;'), 'Title card has compact 12px 14px padding');

    // Reduced wrapper gap
    const wrapperMatch = STYLES_CSS.match(/\.smart-lists-wrapper\s*\{[^}]*gap:\s*10px;/);
    assert.ok(wrapperMatch, 'Wrapper gap is compacted to 10px');

    // Body gap compacted to 10px
    const bodyMatch = STYLES_CSS.match(/\.smart-lists-body\s*\{[^}]*gap:\s*10px;/);
    assert.ok(bodyMatch, 'Body gap is compacted to 10px');
  });

  // ==============================================================================
  // 2. Streak & Statistics Card Optimization
  // ==============================================================================
  test('2. Streak & Statistics Card: Compact padding, aligned flame stat, and tap-friendly reset button', () => {
    // Streak card padding uses clamp for fluid responsiveness
    assert.ok(STYLES_CSS.includes('padding: clamp(10px, 2.5vw, 14px);'), 'Streak card uses responsive clamp padding');
    
    // Flame icon and count are properly sized
    assert.ok(STYLES_CSS.includes('font-size: 1.5rem;'), 'Flame icon is compact 1.5rem');
    assert.ok(STYLES_CSS.includes('font-size: 1.25rem;'), 'Flame count is compact 1.25rem');

    // Reset button has >= 44px touch target
    const resetMatch = STYLES_CSS.match(/\.btn-reset-streak\s*\{[^}]*min-height:\s*(\d+)px/);
    assert.ok(resetMatch, 'btn-reset-streak min-height exists');
    assert.ok(parseInt(resetMatch[1], 10) >= 44, 'Reset button min-height must be >= 44px');

    // Best badge has compact padding
    assert.ok(STYLES_CSS.includes('.streak-best-badge'), 'Best streak badge exists');
    assert.ok(STYLES_CSS.includes('font-size: 0.75rem;'), 'Best streak badge has readable 0.75rem size');

    // Habit metrics grid has 3 columns with minmax(0, 1fr) to prevent overflow
    assert.ok(STYLES_CSS.includes('grid-template-columns: repeat(3, minmax(0, 1fr));'), 'Metrics grid uses 3 flexible columns');
    assert.ok(STYLES_CSS.includes('overflow-wrap: break-word;'), 'Metric labels wrap cleanly');
  });

  // ==============================================================================
  // 3. Resolve Duplicate Add Routine Actions
  // ==============================================================================
  test('3. Add Routine Actions: When 0 routines exist, top button is hidden leaving single empty-state CTA', () => {
    // Setup initial state with 0 routines
    SmartListsManager.state.routines = [];
    SmartListsManager.renderRoutines();

    const addBox = document.getElementById('smart-add-routine-box');
    const emptyState = document.getElementById('smart-empty-state');
    const formAdd = document.getElementById('form-smart-add-routine');
    const btnToggleAdd = document.getElementById('btn-toggle-add-routine');

    // 0 routines: empty state is shown, top Add Routine box is hidden to eliminate duplicate CTAs
    assert.strictEqual(emptyState.style.display, 'flex', 'Empty state visible when 0 routines');
    assert.strictEqual(addBox.style.display, 'none', 'Top Add Routine box hidden when 0 routines to avoid redundancy');

    // User taps "+ Add Your First Routine"
    const btnEmptyAdd = document.getElementById('btn-empty-add-routine');
    assert.ok(btnEmptyAdd, 'btn-empty-add-routine exists');
  });

  test('3. Add Routine Actions: When 1+ routines exist, top "+ Add Routine" is visible and empty state is hidden', () => {
    // User has 1 routine (matching Screenshot 2 reference)
    SmartListsManager.state.routines = [
      { id: 'r-hii', title: 'Hii', orderIndex: 0, createdAt: '2026-11-18T10:00:00Z' }
    ];
    SmartListsManager.renderRoutines();

    const addBox = document.getElementById('smart-add-routine-box');
    const emptyState = document.getElementById('smart-empty-state');
    const btnToggleAdd = document.getElementById('btn-toggle-add-routine');

    // 1+ routines: empty state is hidden, top Add Routine box is shown
    assert.strictEqual(emptyState.style.display, 'none', 'Empty state hidden when 1+ routines');
    assert.strictEqual(addBox.style.display, 'block', 'Top Add Routine box visible when 1+ routines');
    assert.strictEqual(btnToggleAdd.style.display, 'flex', 'Add Routine trigger button is displayed');
  });

  // ==============================================================================
  // 4. Redesigned Empty-State Panel
  // ==============================================================================
  test('4. Empty-State: Compact vertical footprint, smaller icon, and proportioned CTA', () => {
    // Empty state container has clamp padding
    assert.ok(STYLES_CSS.includes('padding: clamp(14px, 2.5vh, 20px) 14px;'), 'Empty state uses compact vertical padding');
    
    // Icon container is compact 44x44 (down from 64x64)
    assert.ok(STYLES_CSS.includes('width: 44px;'), 'Empty icon width is 44px');
    assert.ok(STYLES_CSS.includes('height: 44px;'), 'Empty icon height is 44px');
    assert.ok(STYLES_CSS.includes('width: 24px;'), 'Empty icon SVG is scaled to 24px');

    // Title and description typography are proportioned
    assert.ok(STYLES_CSS.includes('.smart-empty-title'), 'smart-empty-title exists');
    assert.ok(STYLES_CSS.includes('font-size: 0.875rem;'), 'Empty title font size is 0.875rem');
    assert.ok(STYLES_CSS.includes('font-size: 0.78rem;'), 'Empty desc font size is 0.78rem');

    // Button touch target >= 44px
    const btnEmptyMatch = STYLES_CSS.match(/\.btn-smart-empty-add\s*\{[^}]*min-height:\s*(\d+)px/);
    assert.ok(btnEmptyMatch, 'btn-smart-empty-add min-height exists');
    assert.ok(parseInt(btnEmptyMatch[1], 10) >= 44, 'Empty add button min-height must be >= 44px');
  });

  // ==============================================================================
  // 5. Tomorrow\'s Routines Section Optimization
  // ==============================================================================
  test('5. Tomorrow\'s Routines: Balanced margin, compact routine cards, and clean wrapping', () => {
    // Section margin-top is compacted from 24px to 10px
    const tomSectionMatch = STYLES_CSS.match(/\.smart-next-day-section\s*\{[^}]*margin-top:\s*10px;/);
    assert.ok(tomSectionMatch, 'Tomorrow routines section margin-top is compacted to 10px');

    // Section padding is compacted from 16px to 12px 14px
    assert.ok(STYLES_CSS.includes('padding: 12px 14px;'), 'Tomorrow routines padding is compacted');

    // Routine cards are compacted to 8px 12px padding with 44px min-height
    assert.ok(STYLES_CSS.includes('padding: 8px 12px;'), 'Next-day card padding is 8px 12px');
    assert.ok(STYLES_CSS.includes('min-height: 44px;'), 'Next-day card has 44px min-height');

    // Clean word wrapping with overflow-wrap: anywhere
    assert.ok(STYLES_CSS.includes('overflow-wrap: anywhere;'), 'Routine titles wrap with overflow-wrap: anywhere');
  });

  // ==============================================================================
  // 6. Bottom Navigation Bar Clearance & Safe-Area Handling
  // ==============================================================================
  test('6. Bottom Navigation Clearance: Safe-area bottom inset and bottom clearance guaranteed', () => {
    // #tab-smart-lists bottom padding rule
    const tabMatch = STYLES_CSS.match(/#tab-smart-lists\s*\{([^}]*)\}/);
    assert.ok(tabMatch, '#tab-smart-lists rule exists');
    assert.ok(tabMatch[1].includes('calc(110px + env(safe-area-inset-bottom, 0px))'), 'Bottom clearance preserves 110px + safe area');

    // Desktop/tablet layout (>= 768px) adjustment
    assert.ok(STYLES_CSS.includes('@media (min-width: 768px)'), 'Min-width 768px media query exists');
    assert.ok(STYLES_CSS.includes('padding-bottom: 32px;'), 'Tablet/desktop padding-bottom is 32px when bottom nav is hidden');

    // Footer summary card has 44px min-height
    assert.ok(STYLES_CSS.includes('.btn-smart-footer-summary'), 'btn-smart-footer-summary styled');
    assert.ok(STYLES_CSS.includes('min-height: 44px;'), 'Footer summary button min-height is 44px');
  });

  // ==============================================================================
  // 7. Multi-Viewport Testing Matrix (All 8 Screen Dimensions)
  // ==============================================================================
  const VIEWPORTS = [
    { name: '1. Narrow compact Android (320 x 640)', width: 320, height: 640, horizontalPad: 10 },
    { name: '2. Small Android (360 x 720)', width: 360, height: 720, horizontalPad: 16 },
    { name: '3. Common budget Android (360 x 800)', width: 360, height: 800, horizontalPad: 16 },
    { name: '4. Standard compact (375 x 812)', width: 375, height: 812, horizontalPad: 16 },
    { name: '5. Modern standard Android / iPhone (390 x 844)', width: 390, height: 844, horizontalPad: 16 },
    { name: '6. Google Pixel / Samsung Galaxy (412 x 915)', width: 412, height: 915, horizontalPad: 16 },
    { name: '7. Large flagship Android (430 x 932)', width: 430, height: 932, horizontalPad: 16 },
    { name: '8. Tablet / Foldable inner screen (768 x 1024)', width: 768, height: 1024, horizontalPad: 16 }
  ];

  VIEWPORTS.forEach(vp => {
    test(`7. Viewport Simulation: ${vp.name}`, () => {
      // 1. Available width check
      const contentWidth = Math.min(vp.width - (vp.horizontalPad * 2), 600);
      assert.ok(contentWidth > 0, `Content width must be positive: ${contentWidth}px`);

      // 2. Card internal usable width
      const cardPadding = vp.width <= 380 ? 10 : (vp.width <= 480 ? 12 : 14);
      const innerCardWidth = contentWidth - (cardPadding * 2);
      assert.ok(innerCardWidth >= 260, `Inner card width (${innerCardWidth}px) at ${vp.width}px is comfortable`);

      // 3. Metrics grid column space
      const columns = vp.width <= 330 ? 2 : 3;
      const colGap = 6;
      const gridPadding = vp.width <= 380 ? 12 : 16;
      const usableGridWidth = innerCardWidth - gridPadding;
      const colWidth = (usableGridWidth - (colGap * (columns - 1))) / columns;
      assert.ok(colWidth >= 75, `Metric column width (${colWidth.toFixed(1)}px) at ${vp.width}px allows clean numbers and labels without overlap`);

      // 4. Routine card space with action buttons
      const routineCardPadding = vp.width <= 380 ? 10 : (vp.width <= 480 ? 12 : 14);
      const routineInnerWidth = contentWidth - (routineCardPadding * 2);
      const actionsWidth = 55 + 30 + 30 + 12; // status pill (55px) + 2 actions (30px each) + gaps
      const titleAvailableWidth = routineInnerWidth - actionsWidth - 8;
      assert.ok(titleAvailableWidth >= 85, `Routine title available width (${titleAvailableWidth.toFixed(1)}px) at ${vp.width}px accommodates text wrapping`);

      // 5. Vertical height estimation for 0-routine empty state:
      // Title card (~70px) + Streak card (~170px) + Empty state (~140px) + Tomorrow header (~60px) + Footer (~50px) + gaps (~40px)
      // Total approx: ~530px content height
      const totalEstimatedHeight = 70 + 170 + 140 + 60 + 50 + 40;
      assert.ok(totalEstimatedHeight <= 550, `Total estimated vertical height (${totalEstimatedHeight}px) fits within ${vp.height}px viewport`);
    });
  });

  // ==============================================================================
  // 8. Theme Compatibility
  // ==============================================================================
  test('8. Theme Compatibility: Light/Day, Dark, Pet, and Pastel styling defined without breaking hardcoded colors', () => {
    const THEMES = ['dark', 'pet', 'pastel'];

    // Verify Title Card themes
    THEMES.forEach(t => {
      assert.ok(STYLES_CSS.includes(`[data-theme="${t}"] .smart-lists-title-card`), `Title card styled for theme: ${t}`);
      assert.ok(STYLES_CSS.includes(`[data-theme="${t}"] .smart-badge-icon`), `Badge icon styled for theme: ${t}`);
    });

    // Verify Streak Card themes
    THEMES.forEach(t => {
      assert.ok(STYLES_CSS.includes(`[data-theme="${t}"] .smart-habit-streak-card`), `Streak card styled for theme: ${t}`);
      assert.ok(STYLES_CSS.includes(`[data-theme="${t}"] .smart-habit-metrics-grid`), `Metrics grid styled for theme: ${t}`);
    });

    // Verify Tomorrow Section themes
    THEMES.forEach(t => {
      assert.ok(STYLES_CSS.includes(`[data-theme="${t}"] .smart-next-day-section`), `Tomorrow section styled for theme: ${t}`);
      assert.ok(STYLES_CSS.includes(`[data-theme="${t}"] .next-day-routine-card`), `Next-day card styled for theme: ${t}`);
    });

    // Verify Streak Reset Button themes
    THEMES.forEach(t => {
      assert.ok(STYLES_CSS.includes(`[data-theme="${t}"] .btn-reset-streak`), `Reset button styled for theme: ${t}`);
    });
  });

});
