const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

// Setup simulated browser DOM and localStorage environment for testing onboarding persistence
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
    setAttribute(k, v) { this[k] = v; },
    getAttribute(k) { return this[k] || null; }
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
    if (url) currentHash = url.startsWith('#') ? url : (url.slice(url.indexOf('#')) || '');
  },
  pushState(state, title, url) {
    historyLog.push({ action: 'pushState', url });
    if (url) currentHash = url.startsWith('#') ? url : (url.slice(url.indexOf('#')) || '');
  }
};

const domElements = new Map();
function getMockElement(id) {
  if (!domElements.has(id)) {
    domElements.set(id, createMockElement(id));
  }
  return domElements.get(id);
}

const mockDocument = {
  documentElement: createMockElement('documentElement'),
  body: createMockElement('body'),
  getElementById(id) {
    return getMockElement(id);
  },
  querySelectorAll(sel) {
    return [];
  },
  querySelector(sel) {
    return null;
  },
  addEventListener() {}
};

// Install globals
global.document = mockDocument;
global.window = {
  location: {
    get hash() { return currentHash; },
    set hash(v) { currentHash = v; },
    get search() { return currentSearch; },
    set search(v) { currentSearch = v; },
    origin: 'http://localhost:3000',
    hostname: 'localhost',
    pathname: '/'
  },
  history: mockHistory,
  localStorage: mockLocalStorage,
  addEventListener() {},
  removeEventListener() {}
};
global.localStorage = mockLocalStorage;
global.history = mockHistory;

// Load client app
const clientApp = require('../public/app.js');

describe('P0 Bug Fix — Onboarding Persistence & Cold-Start Startup Routing Suite', () => {

  beforeEach(() => {
    mockStorage = {};
    currentHash = '';
    currentSearch = '';
    historyLog.length = 0;
    domElements.clear();

    // Reset client state
    clientApp.state.user = {
      id: null,
      email: '',
      name: 'User',
      age: 18,
      onboarded: false
    };
    clientApp.state.userToken = null;
    clientApp.state.onboardingCompleted = false;
    clientApp.state.flow = 'onboarding';
    clientApp.state.currentOnboardingStep = 'carousel';
    clientApp.state.carouselIndex = 0;
    clientApp.state.activeTab = 'home';
    clientApp.state.todos = [];
    clientApp.state.isPreviewSession = false;

    mockDocument.body.classList.classes.clear();
    mockDocument.documentElement.classList.classes.clear();
  });

  // Scenario 1: New user → onboarding appears
  test('Scenario 1: New user on first launch sees onboarding carousel (Page 1 of 3)', () => {
    // Brand new user: no storage keys set
    assert.strictEqual(mockLocalStorage.getItem('taskly_onboarding_completed'), null);
    assert.strictEqual(clientApp.isOnboardingCompleted(), false);

    clientApp.loadStoredPreferences();
    clientApp.restoreActiveRoute();

    // Must route to onboarding carousel
    assert.strictEqual(clientApp.state.flow, 'onboarding');
    assert.strictEqual(clientApp.state.currentOnboardingStep, 'carousel');
    const screenCarousel = getMockElement('screen-carousel');
    assert.strictEqual(screenCarousel.classList.contains('active'), true);
    const mainFlow = getMockElement('main-flow');
    assert.strictEqual(mainFlow.classList.contains('active'), false);
  });

  // Scenario 2: New user → Skip → Home
  test('Scenario 2: Authenticated new user taps Skip → persists onboarding_completed and navigates to Home', () => {
    // User is authenticated but hasn't completed onboarding yet
    clientApp.state.userToken = 'valid-jwt-new-user';
    clientApp.state.user.id = 'usr-new-001';
    clientApp.state.user.email = 'newuser@example.com';
    clientApp.state.user.isEmailVerified = true;
    mockLocalStorage.setItem('taskly_user_token', 'valid-jwt-new-user');

    assert.strictEqual(clientApp.isOnboardingCompleted(), false);

    // User taps Skip on Carousel
    clientApp.handleSkipOnboarding();

    // Must persist onboarding completed in localStorage
    assert.strictEqual(mockLocalStorage.getItem('taskly_onboarding_completed'), 'true');
    assert.ok(mockLocalStorage.getItem('taskly_onboarding_completed_at'));
    assert.strictEqual(mockLocalStorage.getItem('taskly_onboarding_usr-new-001'), 'true');
    assert.strictEqual(clientApp.state.onboardingCompleted, true);
    assert.strictEqual(clientApp.state.user.onboarded, true);

    // Must navigate directly to Home Dashboard
    assert.strictEqual(clientApp.state.flow, 'main');
    assert.strictEqual(clientApp.state.activeTab, 'home');
    const mainFlow = getMockElement('main-flow');
    assert.strictEqual(mainFlow.classList.contains('active'), true);
  });

  // Scenario 3: New user → complete all three pages → Home
  test('Scenario 3: New user completes all 3 pages (taps Get Started) → Home', () => {
    clientApp.state.userToken = 'valid-jwt-carousel';
    clientApp.state.user.id = 'usr-carousel-finish';
    clientApp.state.user.isEmailVerified = true;
    mockLocalStorage.setItem('taskly_user_token', 'valid-jwt-carousel');

    // Simulate stepping through slides and clicking Get Started on Slide 3
    clientApp.state.carouselIndex = 2;
    clientApp.handleFinishOnboarding();

    // Durable completion recorded
    assert.strictEqual(mockLocalStorage.getItem('taskly_onboarding_completed'), 'true');
    assert.strictEqual(clientApp.isOnboardingCompleted(), true);

    // Must navigate to Home Dashboard
    assert.strictEqual(clientApp.state.flow, 'main');
    assert.strictEqual(clientApp.state.activeTab, 'home');
  });

  // Scenario 4: Close and reopen → Home
  test('Scenario 4: App close and reopen restores Home Dashboard directly, bypassing onboarding', () => {
    // Simulate previously completed onboarding & active session
    mockLocalStorage.setItem('taskly_onboarding_completed', 'true');
    mockLocalStorage.setItem('taskly_user_token', 'jwt-session-4');
    mockLocalStorage.setItem('taskly_active_flow', 'main');
    mockLocalStorage.setItem('taskly_active_tab', 'home');
    mockLocalStorage.setItem('taskly_user', JSON.stringify({
      id: 'usr-4',
      email: 'usr4@example.com',
      name: 'Alice',
      isEmailVerified: true,
      onboarded: true
    }));

    // Cold start simulation: fresh loadStoredPreferences and restoreActiveRoute
    clientApp.loadStoredPreferences();
    assert.strictEqual(clientApp.isOnboardingCompleted(), true);
    assert.strictEqual(clientApp.isAuthenticated(), true);

    clientApp.restoreActiveRoute();

    // Must navigate directly to Home Dashboard without carousel
    assert.strictEqual(clientApp.state.flow, 'main');
    assert.strictEqual(clientApp.state.activeTab, 'home');
    assert.notStrictEqual(clientApp.state.flow, 'onboarding');
  });

  // Scenario 5: Force-stop → Home
  test('Scenario 5: Android force-stop survival: Home Dashboard restored immediately', () => {
    // Persist session and onboarding state
    mockLocalStorage.setItem('taskly_onboarding_completed', 'true');
    mockLocalStorage.setItem('taskly_onboarding_usr-5', 'true');
    mockLocalStorage.setItem('taskly_user_token', 'jwt-session-5');
    mockLocalStorage.setItem('taskly_active_flow', 'main');
    mockLocalStorage.setItem('taskly_active_tab', 'calendar');
    mockLocalStorage.setItem('taskly_user', JSON.stringify({
      id: 'usr-5',
      email: 'usr5@example.com',
      name: 'Bob',
      isEmailVerified: true,
      onboarded: true
    }));

    // Simulate process kill: memory state completely cleared
    clientApp.state.userToken = null;
    clientApp.state.user = { id: null, email: '', onboarded: false };
    clientApp.state.onboardingCompleted = false;

    // Process resurrection
    clientApp.loadStoredPreferences();
    clientApp.restoreActiveRoute();

    assert.strictEqual(clientApp.isOnboardingCompleted(), true);
    assert.strictEqual(clientApp.state.flow, 'main');
    assert.strictEqual(clientApp.state.activeTab, 'calendar');
  });

  // Scenario 6: Restart Android phone → Home
  test('Scenario 6: Android phone reboot survival: WebView storage retains onboarding and loads Home', () => {
    mockLocalStorage.setItem('taskly_onboarding_completed', 'true');
    mockLocalStorage.setItem('taskly_user_token', 'jwt-session-6');
    mockLocalStorage.setItem('taskly_user', JSON.stringify({
      id: 'usr-6',
      email: 'usr6@example.com',
      name: 'Charlie',
      isEmailVerified: true,
      onboarded: true
    }));

    // Cold reboot
    clientApp.state.userToken = null;
    clientApp.state.user = { id: null, email: '', onboarded: false };
    clientApp.state.onboardingCompleted = false;

    clientApp.loadStoredPreferences();
    clientApp.initialRouteFastSync();
    clientApp.restoreActiveRoute();

    assert.strictEqual(clientApp.isOnboardingCompleted(), true);
    assert.strictEqual(clientApp.state.flow, 'main');
    assert.strictEqual(clientApp.state.activeTab, 'home');
  });

  // Scenario 7: Logout → login again → Home
  test('Scenario 7: Logout preserves onboarding completion; logging in again opens Home directly', () => {
    // 1. Initial state: user is logged in and completed onboarding
    clientApp.state.userToken = 'jwt-session-7';
    clientApp.state.user = { id: 'usr-7', email: 'usr7@example.com', isEmailVerified: true, onboarded: true };
    clientApp.setOnboardingCompleted(true);
    mockLocalStorage.setItem('taskly_user_token', 'jwt-session-7');

    assert.strictEqual(clientApp.isOnboardingCompleted(), true);

    // 2. User logs out
    clientApp.syncAuthSignOut();

    // Verify session credentials were removed
    assert.strictEqual(clientApp.state.userToken, null);
    assert.strictEqual(clientApp.state.user.id, null);
    assert.strictEqual(clientApp.isAuthenticated(), false);

    // CRITICAL REQUIREMENT 5: Logging out must NOT reset onboarding completion
    assert.strictEqual(mockLocalStorage.getItem('taskly_onboarding_completed'), 'true');
    assert.strictEqual(clientApp.isOnboardingCompleted(), true);

    // Route when logged out must be profile-setup (sign in), NOT carousel
    clientApp.restoreActiveRoute();
    assert.strictEqual(clientApp.state.currentOnboardingStep, 'profile-setup');
    assert.notStrictEqual(clientApp.state.currentOnboardingStep, 'carousel');

    // 3. User logs in again
    const mockSession = {
      access_token: 'new-jwt-session-7b',
      user: {
        id: 'usr-7',
        email: 'usr7@example.com',
        email_confirmed_at: '2026-01-01T00:00:00Z',
        user_metadata: { name: 'Charlie', age: 25, onboarding_completed: true }
      }
    };

    clientApp.syncAuthSession(mockSession);
    assert.strictEqual(clientApp.isAuthenticated(), true);

    // CRITICAL REQUIREMENT 6: Existing user logging in again opens Home directly
    clientApp.restoreActiveRoute();
    assert.strictEqual(clientApp.state.flow, 'main');
    assert.strictEqual(clientApp.state.activeTab, 'home');
  });

  // Scenario 8: Network unavailable during startup → Home remains
  test('Scenario 8: Network unavailable during startup preserves completed onboarding and cached session', async () => {
    mockLocalStorage.setItem('taskly_onboarding_completed', 'true');
    mockLocalStorage.setItem('taskly_user_token', 'cached-jwt-token-8');
    mockLocalStorage.setItem('taskly_user', JSON.stringify({
      id: 'usr-8-offline',
      email: 'offline@example.com',
      name: 'Offline User',
      isEmailVerified: true,
      onboarded: true
    }));

    clientApp.loadStoredPreferences();
    assert.strictEqual(clientApp.isOnboardingCompleted(), true);
    assert.strictEqual(clientApp.isAuthenticated(), true);

    // Simulate network fetch failure in initSupabaseAuth
    const originalFetch = global.fetch;
    global.fetch = async () => { throw new Error('Failed to fetch: Network unreachable'); };

    try {
      await clientApp.initSupabaseAuth();
    } catch (_) {}
    global.fetch = originalFetch;

    // CRITICAL: Offline error must NOT have signed out user or wiped onboarding
    assert.strictEqual(clientApp.isAuthenticated(), true);
    assert.strictEqual(clientApp.isOnboardingCompleted(), true);

    clientApp.restoreActiveRoute();
    assert.strictEqual(clientApp.state.flow, 'main');
    assert.strictEqual(clientApp.state.activeTab, 'home');
  });

  // Scenario 9: Existing user with completed onboarding → Home
  test('Scenario 9: Existing user with completed onboarding opens directly to Home', () => {
    // Existing user who already completed onboarding in previous versions
    mockLocalStorage.setItem('taskly_user', JSON.stringify({
      id: 'usr-existing-9',
      name: 'Existing User',
      email: 'existing@example.com',
      isEmailVerified: true,
      onboarded: true
    }));
    mockLocalStorage.setItem('taskly_user_token', 'valid-jwt-9');

    clientApp.loadStoredPreferences();

    // Auto-migration to taskly_onboarding_completed
    assert.strictEqual(clientApp.isOnboardingCompleted(), true);

    clientApp.restoreActiveRoute();
    assert.strictEqual(clientApp.state.flow, 'main');
    assert.strictEqual(clientApp.state.activeTab, 'home');
  });

  // Scenario 10: New account with incomplete onboarding → onboarding appears
  test('Scenario 10: New account with incomplete onboarding status displays onboarding carousel', () => {
    // Brand new registration: onboarding flag is not set
    clientApp.state.user = {
      id: 'usr-new-incomplete',
      email: 'fresh@example.com',
      name: 'Fresh User',
      age: 20,
      onboarded: false
    };
    clientApp.state.onboardingCompleted = false;
    assert.strictEqual(clientApp.isOnboardingCompleted(), false);

    clientApp.restoreActiveRoute();

    // Onboarding carousel must appear
    assert.strictEqual(clientApp.state.flow, 'onboarding');
    assert.strictEqual(clientApp.state.currentOnboardingStep, 'carousel');
  });

  // Feature: Pre-render fast router eliminates flash of carousel
  test('initialRouteFastSync() eliminates carousel flash by pre-activating main flow synchronously', () => {
    mockLocalStorage.setItem('taskly_onboarding_completed', 'true');
    mockLocalStorage.setItem('taskly_user_token', 'jwt-fast-sync');
    mockLocalStorage.setItem('taskly_user', JSON.stringify({
      id: 'usr-fast',
      email: 'fast@example.com',
      isEmailVerified: true,
      onboarded: true
    }));

    mockDocument.body.classList.add('onboarding-active');
    const mainFlow = getMockElement('main-flow');
    const onboardingFlow = getMockElement('onboarding-flow');
    onboardingFlow.classList.add('active');
    mainFlow.classList.remove('active');

    clientApp.loadStoredPreferences();
    clientApp.initialRouteFastSync();

    // Verify synchronous pre-activation
    assert.strictEqual(mockDocument.body.classList.contains('onboarding-active'), false);
    assert.strictEqual(mainFlow.classList.contains('active'), true);
    assert.strictEqual(onboardingFlow.classList.contains('active'), false);
    assert.strictEqual(clientApp.state.flow, 'main');
    assert.strictEqual(clientApp.state.activeTab, 'home');
  });

  // Feature: Supabase cloud metadata sync
  test('syncAuthSession() restores onboarding status from Supabase user_metadata', () => {
    const sessionWithCloudOnboarding = {
      access_token: 'jwt-cloud-meta',
      user: {
        id: 'usr-cloud-meta',
        email: 'cloud@example.com',
        email_confirmed_at: '2026-01-01T00:00:00Z',
        user_metadata: {
          name: 'Cloud User',
          onboarding_completed: true,
          onboarded: true
        }
      }
    };

    clientApp.syncAuthSession(sessionWithCloudOnboarding);

    assert.strictEqual(clientApp.isOnboardingCompleted(), true);
    assert.strictEqual(mockLocalStorage.getItem('taskly_onboarding_completed'), 'true');
    assert.strictEqual(mockLocalStorage.getItem('taskly_onboarding_usr-cloud-meta'), 'true');
    assert.strictEqual(clientApp.state.user.onboarded, true);
  });

  // UI Regression & Logout Flow Tests
  describe('UI Layout & 8-Step Complete Logout Verification', () => {
    test('styles.css does not force desktop header onto mobile viewports', () => {
      const fs = require('node:fs');
      const css = fs.readFileSync('public/styles.css', 'utf-8');

      // Verify no malformed or forced desktop-header rules exist
      assert.strictEqual(css.includes('body.onboarding-active .desktop-header {\n  display: block !important;\n}'), false);
      assert.strictEqual(css.includes('html.taskly-onboarding-done'), false);

      // Verify desktop-header default is display: none
      assert.ok(css.includes('.desktop-header {\n  display: none;\n}'));
    });

    test('Complete 8-Step Logout Flow: Profile -> Logout -> Confirm -> Profile Setup (Sign In)', async () => {
      // Wire event listeners on mock DOM elements
      clientApp.setupEventListeners();

      // Setup authenticated user on Profile tab
      clientApp.state.userToken = 'valid-jwt-logout-test';
      clientApp.state.user = { id: 'usr-logout-flow', email: 'logout@test.com', isEmailVerified: true, onboarded: true };
      clientApp.setOnboardingCompleted(true);
      mockLocalStorage.setItem('taskly_user_token', 'valid-jwt-logout-test');

      const modalLogout = getMockElement('modal-logout-confirm');
      const btnLogout = getMockElement('btn-logout');
      const btnConfirmLogout = getMockElement('btn-confirm-logout');
      const mainFlow = getMockElement('main-flow');
      const onboardingFlow = getMockElement('onboarding-flow');
      const screenProfileSetup = getMockElement('screen-profile-setup');

      // Step 1: User opens Profile tab
      clientApp.showMainFlow('profile');
      assert.strictEqual(clientApp.state.activeTab, 'profile');
      assert.strictEqual(mainFlow.classList.contains('active'), true);
      assert.strictEqual(onboardingFlow.classList.contains('active'), false);

      // Step 2 & 3: User scrolls and taps Log out
      btnLogout.dispatchEvent('click');

      // Step 4: Confirmation dialog appears
      assert.strictEqual(modalLogout.classList.contains('active'), true);

      // Step 5, 6, 7 & 8: User confirms logout
      btnConfirmLogout.dispatchEvent('click');

      // Wait a microtick for async handleConfirmLogout to complete
      await new Promise(r => setTimeout(r, 10));

      // Modal closed
      assert.strictEqual(modalLogout.classList.contains('active'), false);

      // Local auth session cleared
      assert.strictEqual(clientApp.state.userToken, null);
      assert.strictEqual(clientApp.state.user.id, null);
      assert.strictEqual(clientApp.isAuthenticated(), false);
      assert.strictEqual(mockLocalStorage.getItem('taskly_user_token'), null);

      // Navigated to Profile Setup (Sign In screen)
      assert.strictEqual(clientApp.state.flow, 'onboarding');
      assert.strictEqual(clientApp.state.currentOnboardingStep, 'profile-setup');
      assert.strictEqual(mainFlow.classList.contains('active'), false);
      assert.strictEqual(onboardingFlow.classList.contains('active'), true);
      assert.strictEqual(screenProfileSetup.classList.contains('active'), true);

      // Step 9: Onboarding completion is preserved
      assert.strictEqual(clientApp.isOnboardingCompleted(), true);
      assert.strictEqual(mockLocalStorage.getItem('taskly_onboarding_completed'), 'true');
    });
  });
});

