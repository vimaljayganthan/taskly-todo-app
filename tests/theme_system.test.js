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

  test('1. Default theme is Light Mode for new users without stored preference', () => {
    mockStorage = {};
    clientApp.loadStoredPreferences();
    assert.strictEqual(clientApp.state.theme, 'light');
  });

  test('1b. applyTheme("light") activates Light Mode and persists to localStorage', () => {
    clientApp.applyTheme('light');
    assert.strictEqual(clientApp.state.theme, 'light');
    assert.strictEqual(global.document.documentElement.getAttribute('data-theme'), 'light');
    assert.strictEqual(mockLocalStorage.getItem('taskly_theme'), 'light');

    const themeLabel = getMockElement('theme-display-val');
    assert.strictEqual(themeLabel.textContent, 'Light Mode ›');
  });

  test('2. applyTheme("dark") activates Dark Mode and persists to localStorage', () => {
    clientApp.applyTheme('dark');
    assert.strictEqual(clientApp.state.theme, 'dark');
    assert.strictEqual(global.document.documentElement.getAttribute('data-theme'), 'dark');
    assert.strictEqual(mockLocalStorage.getItem('taskly_theme'), 'dark');

    const themeLabel = getMockElement('theme-display-val');
    assert.strictEqual(themeLabel.textContent, 'Dark Mode ›');
  });

  test('3. applyTheme("pet") activates Pet Mode and persists to localStorage', () => {
    clientApp.applyTheme('pet');
    assert.strictEqual(clientApp.state.theme, 'pet');
    assert.strictEqual(global.document.documentElement.getAttribute('data-theme'), 'pet');
    assert.strictEqual(mockLocalStorage.getItem('taskly_theme'), 'pet');

    const themeLabel = getMockElement('theme-display-val');
    assert.strictEqual(themeLabel.textContent, 'Pet Mode ›');
  });

  test('4. applyTheme("pastel") activates Pastel Light Mode and persists to localStorage', () => {
    clientApp.applyTheme('pastel');
    assert.strictEqual(clientApp.state.theme, 'pastel');
    assert.strictEqual(global.document.documentElement.getAttribute('data-theme'), 'pastel');
    assert.strictEqual(mockLocalStorage.getItem('taskly_theme'), 'pastel');

    const themeLabel = getMockElement('theme-display-val');
    assert.strictEqual(themeLabel.textContent, 'Pastel Light Mode ›');
  });

  test('5. loadStoredPreferences() restores previously saved themes (Light, Dark, Pet, Pastel, and legacy Day)', () => {
    mockLocalStorage.setItem('taskly_theme', 'light');
    clientApp.loadStoredPreferences();
    assert.strictEqual(clientApp.state.theme, 'light');

    mockLocalStorage.setItem('taskly_theme', 'dark');
    clientApp.loadStoredPreferences();
    assert.strictEqual(clientApp.state.theme, 'dark');

    mockLocalStorage.setItem('taskly_theme', 'pet');
    clientApp.loadStoredPreferences();
    assert.strictEqual(clientApp.state.theme, 'pet');

    mockLocalStorage.setItem('taskly_theme', 'pastel');
    clientApp.loadStoredPreferences();
    assert.strictEqual(clientApp.state.theme, 'pastel');

    mockLocalStorage.setItem('taskly_theme', 'day');
    clientApp.loadStoredPreferences();
    assert.strictEqual(clientApp.state.theme, 'day');
  });

  test('6. loadStoredPreferences() falls back safely to Light Mode for unknown themes', () => {
    mockLocalStorage.setItem('taskly_theme', 'unknown-theme-xyz');
    clientApp.loadStoredPreferences();
    assert.strictEqual(clientApp.state.theme, 'light');
  });

  test('7. Meta theme color adapts to active section in Light Mode, Dark Mode, Pastel Light Mode, and Pet Mode', () => {
    const metaTheme = getMockElement('meta-theme-color');
    clientApp.state.activeTab = 'calendar';
    clientApp.applyTheme('light');
    assert.strictEqual(metaTheme.getAttribute('content'), '#FFE1E7');

    clientApp.state.activeTab = 'progress';
    clientApp.applyTheme('light');
    assert.strictEqual(metaTheme.getAttribute('content'), '#FFF1B8');

    clientApp.state.activeTab = 'home';
    clientApp.applyTheme('light');
    assert.strictEqual(metaTheme.getAttribute('content'), '#38BDF8');

    clientApp.applyTheme('dark');
    assert.strictEqual(metaTheme.getAttribute('content'), '#121820');

    clientApp.applyTheme('pastel');
    assert.strictEqual(metaTheme.getAttribute('content'), '#F5F3FF');

    clientApp.applyTheme('pet');
    assert.strictEqual(metaTheme.getAttribute('content'), '#FDF1EA');
  });

  test('8. Theme selector options update active class correctly for all 4 themes', () => {
    const optLight = getMockElement('theme-choice-light');
    const optDark = getMockElement('theme-choice-dark');
    const optPet = getMockElement('theme-choice-pet');
    const optPastel = getMockElement('theme-choice-pastel');

    clientApp.applyTheme('light');
    assert.strictEqual(optLight.classList.contains('active'), true);
    assert.strictEqual(optDark.classList.contains('active'), false);

    clientApp.applyTheme('dark');
    assert.strictEqual(optLight.classList.contains('active'), false);
    assert.strictEqual(optDark.classList.contains('active'), true);

    clientApp.applyTheme('pet');
    assert.strictEqual(optPet.classList.contains('active'), true);

    clientApp.applyTheme('pastel');
    assert.strictEqual(optPastel.classList.contains('active'), true);
  });
});
