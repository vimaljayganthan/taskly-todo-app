const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

// Setup minimal simulated browser DOM environment for testing client-side authentication
function createMockElement(id = '') {
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
    checked: false,
    disabled: false,
    listeners: {},
    addEventListener(event, fn) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(fn);
    },
    dispatchEvent(event) {
      const fns = this.listeners[event.type || event] || [];
      fns.forEach(fn => fn(event));
    },
    setAttribute() {},
    getAttribute() { return null; }
  };
}

let mockStorage = {};
const mockLocalStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(mockStorage, k) ? mockStorage[k] : null; },
  setItem(k, v) { mockStorage[k] = String(v); },
  removeItem(k) { delete mockStorage[k]; },
  clear() { mockStorage = {}; }
};

let currentHash = '';
let currentSearch = '';
const historyLog = [];

const mockHistory = {
  replaceState(state, title, url) {
    historyLog.push({ action: 'replaceState', url });
    if (url && url.startsWith('#')) {
      currentHash = url;
    }
  },
  pushState(state, title, url) {
    historyLog.push({ action: 'pushState', url });
    if (url && url.startsWith('#')) {
      currentHash = url;
    }
  }
};

const domElements = new Map();
function getMockElement(id) {
  if (!domElements.has(id)) {
    domElements.set(id, createMockElement(id));
  }
  return domElements.get(id);
}

// Install globals
global.window = {
  location: {
    get hash() { return currentHash; },
    set hash(val) { currentHash = val.startsWith('#') ? val : '#' + val; },
    get search() { return currentSearch; },
    set search(val) { currentSearch = val; }
  },
  addEventListener() {},
  removeEventListener() {}
};
global.document = {
  documentElement: createMockElement('html'),
  body: createMockElement('body'),
  getElementById(id) { return getMockElement(id); },
  querySelectorAll() { return []; },
  querySelector() { return null; },
  addEventListener() {}
};
global.localStorage = mockLocalStorage;
global.history = mockHistory;

// Load client app module
const clientApp = require('../public/app.js');

describe('Client-Side Authentication Security Test Suite', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    historyLog.length = 0;
    domElements.clear();
    currentHash = '';
    currentSearch = '';
    
    // Reset client state
    clientApp.state.userToken = null;
    clientApp.state.todos = [];
    clientApp.state.user = {
      id: null,
      name: 'User',
      age: 18,
      email: '',
      onboarded: false
    };
    clientApp.state.flow = 'onboarding';
    clientApp.state.currentOnboardingStep = 'launch';
    clientApp.state.activeTab = 'home';
  });

  describe('1. Session Validation and isAuthenticated() Guard', () => {
    test('Rejects when token is missing or null', () => {
      clientApp.state.userToken = null;
      clientApp.state.user.id = 'valid-user-id';
      assert.strictEqual(clientApp.isAuthenticated(), false);
    });

    test('Rejects when token is non-string or empty', () => {
      clientApp.state.userToken = '';
      clientApp.state.user.id = 'valid-user-id';
      assert.strictEqual(clientApp.isAuthenticated(), false);

      clientApp.state.userToken = 12345;
      assert.strictEqual(clientApp.isAuthenticated(), false);
    });

    test('Rejects mock authentication tokens (mock-user:*)', () => {
      clientApp.state.userToken = 'mock-user:1730000000:test%40example.com';
      clientApp.state.user.id = 'valid-user-id';
      assert.strictEqual(clientApp.isAuthenticated(), false);
    });

    test('Rejects when user.id is missing or null', () => {
      clientApp.state.userToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.valid-token';
      clientApp.state.user.id = null;
      assert.strictEqual(clientApp.isAuthenticated(), false);
    });

    test('Accepts valid non-mock token with valid user id', () => {
      clientApp.state.userToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.valid-token';
      clientApp.state.user.id = 'usr-12345';
      assert.strictEqual(clientApp.isAuthenticated(), true);
    });
  });

  describe('2. Elimination of Mock Authentication Fallback in Preferences', () => {
    test('loadStoredPreferences() immediately purges mock-user tokens from localStorage', () => {
      mockLocalStorage.setItem('taskly_user_token', 'mock-user:1730000000:attacker%40example.com');
      mockLocalStorage.setItem('taskly_user', JSON.stringify({ id: 'mock-id', name: 'Mock User' }));

      clientApp.loadStoredPreferences();

      // Token must be null in state and purged from localStorage
      assert.strictEqual(clientApp.state.userToken, null);
      assert.strictEqual(mockLocalStorage.getItem('taskly_user_token'), null);
      assert.strictEqual(clientApp.isAuthenticated(), false);
    });

    test('loadStoredPreferences() retains legitimate tokens', () => {
      const validJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.valid-jwt';
      mockLocalStorage.setItem('taskly_user_token', validJwt);
      mockLocalStorage.setItem('taskly_user', JSON.stringify({ id: 'uuid-123', name: 'Real User' }));

      clientApp.loadStoredPreferences();

      assert.strictEqual(clientApp.state.userToken, validJwt);
      assert.strictEqual(clientApp.state.user.id, 'uuid-123');
      assert.strictEqual(clientApp.isAuthenticated(), true);
    });
  });

  describe('3. Route Protection: Direct URL & Hash Access Enforcement', () => {
    const protectedRoutes = ['home', 'calendar', 'progress', 'profile', 'add'];

    for (const route of protectedRoutes) {
      test(`Blocks unauthenticated direct access to #${route} and redirects to #profile-setup`, () => {
        clientApp.state.userToken = null;
        clientApp.state.user.id = null;
        window.location.hash = `#${route}`;

        clientApp.restoreActiveRoute();

        // Must NOT activate main flow
        assert.notStrictEqual(clientApp.state.flow, 'main');
        assert.strictEqual(clientApp.state.flow, 'onboarding');
        assert.strictEqual(clientApp.state.currentOnboardingStep, 'profile-setup');

        // History must have replaced state with #profile-setup
        const lastHistory = historyLog[historyLog.length - 1];
        assert.strictEqual(lastHistory.action, 'replaceState');
        assert.strictEqual(lastHistory.url, '#profile-setup');
      });
    }

    test('Blocks unauthenticated access via query parameter (?tab=calendar)', () => {
      clientApp.state.userToken = null;
      window.location.hash = '';
      window.location.search = '?tab=calendar';

      clientApp.restoreActiveRoute();

      assert.notStrictEqual(clientApp.state.flow, 'main');
      assert.strictEqual(clientApp.state.flow, 'onboarding');
      assert.strictEqual(clientApp.state.currentOnboardingStep, 'profile-setup');
      const lastHistory = historyLog[historyLog.length - 1];
      assert.strictEqual(lastHistory.url, '#profile-setup');
    });

    test('Blocks unauthenticated access to #welcome screen and redirects to #profile-setup', () => {
      clientApp.state.userToken = null;
      window.location.hash = '#welcome';

      clientApp.restoreActiveRoute();

      assert.strictEqual(clientApp.state.currentOnboardingStep, 'profile-setup');
      const lastHistory = historyLog[historyLog.length - 1];
      assert.strictEqual(lastHistory.url, '#profile-setup');
    });

    test('Allows unauthenticated access to public onboarding steps (#launch, #carousel, #profile-setup)', () => {
      clientApp.state.userToken = null;

      window.location.hash = '#launch';
      clientApp.restoreActiveRoute();
      assert.strictEqual(clientApp.state.currentOnboardingStep, 'launch');

      window.location.hash = '#carousel';
      clientApp.restoreActiveRoute();
      assert.strictEqual(clientApp.state.currentOnboardingStep, 'carousel');

      window.location.hash = '#profile-setup';
      clientApp.restoreActiveRoute();
      assert.strictEqual(clientApp.state.currentOnboardingStep, 'profile-setup');
    });

    test('Allows authenticated users to access protected routes', () => {
      clientApp.state.userToken = 'valid-jwt-token';
      clientApp.state.user.id = 'user-uuid-1';
      window.location.hash = '#calendar';

      clientApp.restoreActiveRoute();

      assert.strictEqual(clientApp.state.flow, 'main');
      assert.strictEqual(clientApp.state.activeTab, 'calendar');
    });
  });

  describe('4. showMainFlow() Programmatic Guard', () => {
    test('showMainFlow() immediately halts and redirects if called unauthenticated', () => {
      clientApp.state.userToken = null;
      clientApp.state.user.id = null;

      clientApp.showMainFlow('home');

      assert.strictEqual(clientApp.state.flow, 'onboarding');
      assert.strictEqual(clientApp.state.currentOnboardingStep, 'profile-setup');
      const lastHistory = historyLog[historyLog.length - 1];
      assert.strictEqual(lastHistory.url, '#profile-setup');
    });

    test('showMainFlow() opens requested tab if user is authenticated', () => {
      clientApp.state.userToken = 'valid-session-jwt';
      clientApp.state.user.id = 'auth-user-99';

      clientApp.showMainFlow('progress');

      assert.strictEqual(clientApp.state.flow, 'main');
      assert.strictEqual(clientApp.state.activeTab, 'progress');
    });
  });

  describe('5. Expired Sessions & HTTP 401 Expiry Handling', () => {
    test('handleAuthExpiry() clears all tokens, state, and localStorage', () => {
      clientApp.state.userToken = 'expired-token';
      clientApp.state.user.id = 'usr-old';
      clientApp.state.user.email = 'test@example.com';
      clientApp.state.user.onboarded = true;
      clientApp.state.todos = [{ id: '1', title: 'Task' }];

      mockLocalStorage.setItem('taskly_user_token', 'expired-token');
      mockLocalStorage.setItem('taskly_active_flow', 'main');
      mockLocalStorage.setItem('taskly_active_tab', 'home');

      clientApp.handleAuthExpiry();

      // Verify state was purged
      assert.strictEqual(clientApp.state.userToken, null);
      assert.strictEqual(clientApp.state.user.id, null);
      assert.strictEqual(clientApp.state.user.email, '');
      assert.strictEqual(clientApp.state.user.onboarded, false);
      assert.strictEqual(clientApp.state.todos.length, 0);

      // Verify localStorage was purged of credentials and active tab
      assert.strictEqual(mockLocalStorage.getItem('taskly_user_token'), null);
      assert.strictEqual(mockLocalStorage.getItem('taskly_active_tab'), null);
      assert.strictEqual(mockLocalStorage.getItem('taskly_active_flow'), 'onboarding');
      assert.strictEqual(mockLocalStorage.getItem('taskly_onboarding_step'), 'profile-setup');

      // Verify redirect to profile-setup
      assert.strictEqual(clientApp.state.currentOnboardingStep, 'profile-setup');
      const lastHistory = historyLog[historyLog.length - 1];
      assert.strictEqual(lastHistory.action, 'replaceState');
      assert.strictEqual(lastHistory.url, '#profile-setup');

      // Verify expiration message display
      const authErrorMsg = getMockElement('auth-error-msg');
      assert.strictEqual(authErrorMsg.textContent, 'Your session has expired. Please sign in again.');
      assert.strictEqual(authErrorMsg.style.display, 'flex');
    });
  });

  describe('6. Logout Navigation & Browser History Back Protection', () => {
    test('syncAuthSignOut() completely invalidates active session', () => {
      clientApp.state.userToken = 'valid-jwt';
      clientApp.state.user.id = 'usr-logged-in';
      clientApp.state.user.onboarded = true;
      mockLocalStorage.setItem('taskly_user_token', 'valid-jwt');

      clientApp.syncAuthSignOut();

      assert.strictEqual(clientApp.state.userToken, null);
      assert.strictEqual(clientApp.state.user.id, null);
      assert.strictEqual(clientApp.state.user.onboarded, false);
      assert.strictEqual(mockLocalStorage.getItem('taskly_user_token'), null);
      assert.strictEqual(clientApp.isAuthenticated(), false);
    });

    test('After logout, attempting back navigation to #home is immediately intercepted', () => {
      // 1. User was logged in
      clientApp.state.userToken = 'active-jwt';
      clientApp.state.user.id = 'usr-active';
      clientApp.state.user.onboarded = true;
      clientApp.showMainFlow('home');

      // 2. User logs out
      clientApp.syncAuthSignOut();
      mockHistory.replaceState(null, '', '#launch');
      clientApp.showOnboardingStep('launch', false);

      // 3. User hits browser Back button or URL hash changes back to #home
      window.location.hash = '#home';
      clientApp.restoreActiveRoute();

      // 4. Must NOT permit access to home; must redirect to #profile-setup
      assert.notStrictEqual(clientApp.state.flow, 'main');
      assert.strictEqual(clientApp.state.flow, 'onboarding');
      assert.strictEqual(clientApp.state.currentOnboardingStep, 'profile-setup');
      const lastHistory = historyLog[historyLog.length - 1];
      assert.strictEqual(lastHistory.action, 'replaceState');
      assert.strictEqual(lastHistory.url, '#profile-setup');
    });
  });
});
