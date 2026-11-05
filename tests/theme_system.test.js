const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

// Setup simulated browser DOM environment for theme testing
function createMockElement(id = '') {
  const attributes = {};
  return {
    id,
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
    addEventListener() {},
    removeEventListener() {}
  };
}

let mockStorage = {};
const mockLocalStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(mockStorage, k) ? mockStorage[k] : null; },
  setItem(k, v) { mockStorage[k] = String(v); },
  removeItem(k) { delete mockStorage[k]; },
  clear() { mockStorage = {}; }
};

describe('Taskly Theme System Suite (Pastel Light & Day Theme)', () => {
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
      location: {
        origin: 'http://localhost:3000',
        hostname: 'localhost',
        protocol: 'http:',
        pathname: '/',
        search: '',
        hash: ''
      },
      history: {
        replaceState() {},
        pushState() {}
      },
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

  test('1. Default theme is pastel for new users without stored preference', () => {
    mockStorage = {};
    clientApp.loadStoredPreferences();
    assert.strictEqual(clientApp.state.theme, 'pastel');
  });

  test('2. applyTheme("day") activates Day Theme and persists to localStorage', () => {
    clientApp.applyTheme('day');
    assert.strictEqual(clientApp.state.theme, 'day');
    assert.strictEqual(global.document.documentElement.getAttribute('data-theme'), 'day');
    assert.strictEqual(mockLocalStorage.getItem('taskly_theme'), 'day');

    const themeLabel = getMockElement('theme-display-val');
    assert.strictEqual(themeLabel.textContent, 'Day Theme ›');
  });

  test('3. applyTheme("pastel") activates Pastel Light and persists to localStorage', () => {
    clientApp.applyTheme('pastel');
    assert.strictEqual(clientApp.state.theme, 'pastel');
    assert.strictEqual(global.document.documentElement.getAttribute('data-theme'), 'pastel');
    assert.strictEqual(mockLocalStorage.getItem('taskly_theme'), 'pastel');

    const themeLabel = getMockElement('theme-display-val');
    assert.strictEqual(themeLabel.textContent, 'Pastel Light ›');
  });

  test('4. loadStoredPreferences() restores previously saved Day Theme', () => {
    mockLocalStorage.setItem('taskly_theme', 'day');
    clientApp.loadStoredPreferences();
    assert.strictEqual(clientApp.state.theme, 'day');
  });

  test('5. loadStoredPreferences() falls back safely to pastel for unknown themes', () => {
    mockLocalStorage.setItem('taskly_theme', 'unknown-dark-mode');
    clientApp.loadStoredPreferences();
    assert.strictEqual(clientApp.state.theme, 'pastel');
  });

  test('6. Legacy "light" preference safely resolves to pastel', () => {
    mockLocalStorage.setItem('taskly_theme', 'light');
    clientApp.loadStoredPreferences();
    assert.strictEqual(clientApp.state.theme, 'pastel');
  });

  test('7. Meta theme color adapts to active section in Day Theme', () => {
    const metaTheme = getMockElement('meta-theme-color');
    clientApp.state.activeTab = 'calendar';
    clientApp.applyTheme('day');
    assert.strictEqual(metaTheme.getAttribute('content'), '#FFE1E7');

    clientApp.state.activeTab = 'progress';
    clientApp.applyTheme('day');
    assert.strictEqual(metaTheme.getAttribute('content'), '#FFF1B8');

    clientApp.state.activeTab = 'home';
    clientApp.applyTheme('day');
    assert.strictEqual(metaTheme.getAttribute('content'), '#38BDF8');

    clientApp.applyTheme('pastel');
    assert.strictEqual(metaTheme.getAttribute('content'), '#F5F3FF');
  });
});
