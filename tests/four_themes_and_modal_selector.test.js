const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');
const STYLES_CSS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), 'utf8');

function createMockElement(id = '', tag = 'div') {
  const attributes = {};
  const listeners = {};
  return {
    id,
    tagName: tag.toUpperCase(),
    classList: {
      classes: new Set(),
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (this.classes.has(c)) this.classes.delete(c);
          else this.classes.add(c);
        } else if (force) {
          this.classes.add(c);
        } else {
          this.classes.delete(c);
        }
      },
      contains(c) { return this.classes.has(c); }
    },
    style: {},
    dataset: {},
    value: '',
    textContent: '',
    innerHTML: '',
    setAttribute(name, value) { attributes[name] = String(value); },
    getAttribute(name) { return attributes[name] || null; },
    addEventListener(event, fn) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    removeEventListener(event, fn) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter(h => h !== fn);
    },
    trigger(event, payload = {}) {
      if (listeners[event]) {
        listeners[event].forEach(fn => fn(payload));
      }
    },
    querySelector(selector) {
      if (selector === '.explore-btn-icon') return createMockElement('explore-btn-icon');
      return null;
    }
  };
}

let mockStorage = {};
const mockLocalStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(mockStorage, k) ? mockStorage[k] : null; },
  setItem(k, v) { mockStorage[k] = String(v); },
  removeItem(k) { delete mockStorage[k]; },
  clear() { mockStorage = {}; }
};

describe('Taskly – Four Theme Modes & Redesigned Theme Selector Suite', () => {
  let elements = {};
  let clientApp;

  function getMockElement(id) {
    if (!elements[id]) {
      elements[id] = createMockElement(id);
    }
    return elements[id];
  }

  beforeEach(() => {
    elements = {};
    mockStorage = {};

    const docElement = createMockElement('html');
    const docBody = createMockElement('body');

    global.document = {
      documentElement: docElement,
      body: docBody,
      getElementById: (id) => getMockElement(id),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    global.window = {
      location: { origin: 'http://localhost:3000', hostname: 'localhost', pathname: '/' },
      history: { replaceState() {}, pushState() {} },
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    global.localStorage = mockLocalStorage;

    delete require.cache[require.resolve('../public/app.js')];
    clientApp = require('../public/app.js');
  });

  afterEach(() => {
    delete global.document;
    delete global.window;
    delete global.localStorage;
  });

  // ==========================================================================
  // PART 1: Four Theme Modes & Naming Verification
  // ==========================================================================
  describe('1. Four Theme Modes & Renaming Verification', () => {
    test('Taskly supports Light Mode, Dark Mode, Pet Mode, and Pastel Light Mode', () => {
      // 1. Light Mode
      clientApp.applyTheme('light');
      assert.strictEqual(clientApp.state.theme, 'light');
      assert.strictEqual(global.document.documentElement.getAttribute('data-theme'), 'light');
      assert.strictEqual(getMockElement('theme-display-val').textContent, 'Light Mode ›');

      // 2. Dark Mode
      clientApp.applyTheme('dark');
      assert.strictEqual(clientApp.state.theme, 'dark');
      assert.strictEqual(global.document.documentElement.getAttribute('data-theme'), 'dark');
      assert.strictEqual(getMockElement('theme-display-val').textContent, 'Dark Mode ›');

      // 3. Pet Mode
      clientApp.applyTheme('pet');
      assert.strictEqual(clientApp.state.theme, 'pet');
      assert.strictEqual(global.document.documentElement.getAttribute('data-theme'), 'pet');
      assert.strictEqual(getMockElement('theme-display-val').textContent, 'Pet Mode ›');

      // 4. Pastel Light Mode
      clientApp.applyTheme('pastel');
      assert.strictEqual(clientApp.state.theme, 'pastel');
      assert.strictEqual(global.document.documentElement.getAttribute('data-theme'), 'pastel');
      assert.strictEqual(getMockElement('theme-display-val').textContent, 'Pastel Light Mode ›');
    });

    test('Backwards-compatible Day Theme key resolves to Light Mode display', () => {
      clientApp.applyTheme('day');
      assert.strictEqual(getMockElement('theme-display-val').textContent, 'Light Mode ›');
    });
  });

  // ==========================================================================
  // PART 2: Default Theme – Light Mode
  // ==========================================================================
  describe('2. Default Theme – Light Mode for New Users', () => {
    test('public/index.html sets initial data-theme to light', () => {
      assert.match(INDEX_HTML, /<html\s+lang="en"\s+data-theme="light">/);
    });

    test('New users without stored preference default to Light Mode', () => {
      mockStorage = {};
      clientApp.loadStoredPreferences();
      assert.strictEqual(clientApp.state.theme, 'light', 'Default theme must be light');
    });

    test('Existing user preferences are preserved when present in localStorage', () => {
      mockLocalStorage.setItem('taskly_theme', 'dark');
      clientApp.loadStoredPreferences();
      assert.strictEqual(clientApp.state.theme, 'dark');

      mockLocalStorage.setItem('taskly_theme', 'pet');
      clientApp.loadStoredPreferences();
      assert.strictEqual(clientApp.state.theme, 'pet');

      mockLocalStorage.setItem('taskly_theme', 'pastel');
      clientApp.loadStoredPreferences();
      assert.strictEqual(clientApp.state.theme, 'pastel');
    });
  });

  // ==========================================================================
  // PART 3: Redesigned Theme Selection Modal & Explore More Modes
  // ==========================================================================
  describe('3. Redesigned Theme Modal & Explore More Modes Interaction', () => {
    test('index.html markup contains redesigned theme modal structure', () => {
      assert.match(INDEX_HTML, /id="modal-theme"/, 'Must contain modal-theme backdrop');
      assert.match(INDEX_HTML, /Select Appearance/, 'Must contain Select Appearance title');
      assert.match(INDEX_HTML, /id="btn-explore-modes"/, 'Must contain Explore More Modes toggle button');
      assert.match(INDEX_HTML, /id="theme-choice-light"/, 'Must contain Light Mode option');
      assert.match(INDEX_HTML, /id="theme-choice-dark"/, 'Must contain Dark Mode option');
      assert.match(INDEX_HTML, /id="theme-more-section"/, 'Must contain collapsible theme-more-section');
      assert.match(INDEX_HTML, /id="theme-choice-pet"/, 'Must contain Pet Mode option');
      assert.match(INDEX_HTML, /id="theme-choice-pastel"/, 'Must contain Pastel Light Mode option');
    });

    test('Primary options Light Mode and Dark Mode do not display long descriptions', () => {
      assert.match(INDEX_HTML, /<span class="theme-choice-title">Light Mode<\/span>/);
      assert.match(INDEX_HTML, /<span class="theme-choice-title">Dark Mode<\/span>/);
    });

    test('Additional options include the requested descriptions', () => {
      assert.ok(INDEX_HTML.includes('Warm peach colours with adorable dog and cat mascots.'));
      assert.ok(INDEX_HTML.includes('Soft lavender surfaces with gentle pastel accents.'));
    });

    test('Explore More Modes toggles expanded state and section visibility', () => {
      const btnExplore = getMockElement('btn-explore-modes');
      const moreSection = getMockElement('theme-more-section');
      btnExplore.setAttribute('aria-expanded', 'false');
      moreSection.style.display = 'none';

      clientApp.setupEventListeners();

      // Trigger click to expand
      btnExplore.trigger('click');
      assert.strictEqual(btnExplore.getAttribute('aria-expanded'), 'true');
      assert.strictEqual(moreSection.style.display, 'block');
      assert.strictEqual(btnExplore.classList.contains('expanded'), true);

      // Trigger click to collapse
      btnExplore.trigger('click');
      assert.strictEqual(btnExplore.getAttribute('aria-expanded'), 'false');
      assert.strictEqual(moreSection.style.display, 'none');
      assert.strictEqual(btnExplore.classList.contains('expanded'), false);
    });

    test('Selecting any theme immediately applies it and updates active indicator', () => {
      const optDark = getMockElement('theme-choice-dark');
      const optLight = getMockElement('theme-choice-light');
      const modalTheme = getMockElement('modal-theme');
      modalTheme.classList.add('active');

      clientApp.setupEventListeners();

      optDark.trigger('click');
      assert.strictEqual(clientApp.state.theme, 'dark');
      assert.strictEqual(optDark.classList.contains('active'), true);
      assert.strictEqual(optLight.classList.contains('active'), false);
      assert.strictEqual(modalTheme.classList.contains('active'), false, 'Modal should close on selection');
    });

    test('Theme is not reset when modal is opened, closed or reopened', () => {
      clientApp.applyTheme('dark');
      const modalTheme = getMockElement('modal-theme');
      const btnToggle = getMockElement('btn-toggle-theme');
      const btnClose = getMockElement('btn-close-theme-modal');

      clientApp.setupEventListeners();

      // Open modal
      btnToggle.trigger('click');
      assert.strictEqual(clientApp.state.theme, 'dark', 'Theme must remain dark on modal open');

      // Close modal
      btnClose.trigger('click');
      assert.strictEqual(clientApp.state.theme, 'dark', 'Theme must remain dark on modal close');

      // Reopen modal
      btnToggle.trigger('click');
      assert.strictEqual(clientApp.state.theme, 'dark', 'Theme must remain dark on modal reopen');
    });
  });

  // ==========================================================================
  // PART 4: Professional Dark Mode CSS Specifications
  // ==========================================================================
  describe('4. Professional Dark Mode CSS Design System', () => {
    test('public/styles.css defines [data-theme="dark"] tokens matching suggested palette', () => {
      assert.match(STYLES_CSS, /\[data-theme="dark"\]/);
      assert.match(STYLES_CSS, /--app-bg:\s*#121820/);
      assert.match(STYLES_CSS, /--surface:\s*#1C2733/);
      assert.match(STYLES_CSS, /--bg-card-subtle:\s*#253241/);
      assert.match(STYLES_CSS, /--text-primary:\s*#F1F5F9/);
      assert.match(STYLES_CSS, /--text-secondary:\s*#(?:B6C2CF|AAB7C4)/);
      assert.match(STYLES_CSS, /--primary:\s*#60A5FA/);
      assert.match(STYLES_CSS, /--border:\s*#(?:3B4B5C|334155)/);
      assert.match(STYLES_CSS, /--success:\s*#34D399/);
      assert.match(STYLES_CSS, /--danger:\s*#F87171/);
    });

    test('Dark Mode styles component surfaces and text across all screens', () => {
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.bottom-nav/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.desktop-header/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.stat-card/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.task-item/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.cal-day-cell/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.barchart-card/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.profile-drawer-card/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.faq-item/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.modal-card-about/);
    });

    test('Mascot artwork is preserved without recoloring or distortion', () => {
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.pet-circle-container img/);
      assert.match(STYLES_CSS, /filter:\s*none\s*!important/);
    });
  });

  // ==========================================================================
  // PART 5: Profile Menu FAQ -> FAQs Label
  // ==========================================================================
  describe('5. Profile Screen Menu Label Update', () => {
    test('Profile menu label is updated from FAQ to FAQs while retaining #menu-faq id', () => {
      assert.match(INDEX_HTML, /id="menu-faq"[\s\S]*?<span class="menu-item-label">FAQs<\/span>/);
    });
  });
});

