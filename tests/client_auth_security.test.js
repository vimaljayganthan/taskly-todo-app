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
let currentOrigin = 'http://localhost:3000';
let currentHostname = 'localhost';
let currentProtocol = 'http:';
let currentPathname = '/';
let isNativePlatformActive = false;
let capacitorPlatformName = 'web';
const historyLog = [];

const mockHistory = {
  replaceState(state, title, url) {
    historyLog.push({ action: 'replaceState', url });
    if (url) {
      if (url.startsWith('#')) {
        currentHash = url;
      } else {
        const hashIdx = url.indexOf('#');
        if (hashIdx !== -1) {
          currentHash = url.slice(hashIdx);
          currentPathname = url.slice(0, hashIdx);
        } else {
          currentPathname = url;
          currentHash = '';
        }
      }
    }
  },
  pushState(state, title, url) {
    historyLog.push({ action: 'pushState', url });
    if (url) {
      if (url.startsWith('#')) {
        currentHash = url;
      } else {
        const hashIdx = url.indexOf('#');
        if (hashIdx !== -1) {
          currentHash = url.slice(hashIdx);
          currentPathname = url.slice(0, hashIdx);
        } else {
          currentPathname = url;
          currentHash = '';
        }
      }
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
    set search(val) { currentSearch = val; },
    get origin() { return currentOrigin; },
    set origin(val) { currentOrigin = val; },
    get hostname() { return currentHostname; },
    set hostname(val) { currentHostname = val; },
    get protocol() { return currentProtocol; },
    set protocol(val) { currentProtocol = val; },
    get pathname() { return currentPathname; },
    set pathname(val) { currentPathname = val; },
    get href() {
      return (currentOrigin || 'http://localhost:3000') + (currentPathname || '/') + (currentSearch || '') + (currentHash || '');
    }
  },
  Capacitor: {
    isNativePlatform: () => isNativePlatformActive,
    getPlatform: () => capacitorPlatformName
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

// Load server and client app modules
const serverApp = require('../server.js');
const clientApp = require('../public/app.js');

describe('Client-Side Authentication Security Test Suite', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    historyLog.length = 0;
    domElements.clear();
    currentHash = '';
    currentSearch = '';
    currentOrigin = 'http://localhost:3000';
    currentHostname = 'localhost';
    currentProtocol = 'http:';
    currentPathname = '/';
    isNativePlatformActive = false;
    capacitorPlatformName = 'web';

    // Reset client state
    clientApp.state.userToken = null;
    clientApp.state.config = null;
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
    clientApp.setSupabaseClient(null);
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

    test('Testing hooks (setSupabaseClient, getSupabaseClient) are not exposed on window in browser scope', () => {
      assert.strictEqual(global.window.setSupabaseClient, undefined);
      assert.strictEqual(global.window.getSupabaseClient, undefined);
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

  describe('7. Environment-Aware Email Confirmation Redirect URL Resolution', () => {
    const originalEnv = Object.assign({}, process.env);

    afterEach(() => {
      process.env = Object.assign({}, originalEnv);
    });

    test('Local web: returns http://localhost:3000/auth/confirmed in local development', () => {
      window.location.origin = 'http://localhost:3000';
      window.location.hostname = 'localhost';
      isNativePlatformActive = false;
      capacitorPlatformName = 'web';

      const redirectUrl = clientApp.getAuthRedirectUrl();
      assert.strictEqual(redirectUrl, 'http://localhost:3000/auth/confirmed');
    });

    test('Deployed web: returns canonical deployed website URL with /auth/confirmed', () => {
      window.location.origin = 'https://taskly-todo-app-4z1c.vercel.app';
      window.location.hostname = 'taskly-todo-app-4z1c.vercel.app';
      isNativePlatformActive = false;
      capacitorPlatformName = 'web';
      clientApp.state.config = { appUrl: 'https://taskly-todo-app-4z1c.vercel.app' };

      const redirectUrl = clientApp.getAuthRedirectUrl();
      assert.strictEqual(redirectUrl, 'https://taskly-todo-app-4z1c.vercel.app/auth/confirmed');
    });

    test('Capacitor Android: returns HTTPS confirmation URL (/auth/confirmed), NEVER internal localhost or custom scheme', () => {
      // Simulate Capacitor Android environment
      window.location.origin = 'https://localhost';
      window.location.hostname = 'localhost';
      window.location.protocol = 'https:';
      isNativePlatformActive = true;
      capacitorPlatformName = 'android';

      clientApp.state.config = {
        appUrl: 'https://taskly-todo-app-4z1c.vercel.app',
        supabaseUrl: 'https://liucmamlownxfshnaxtc.supabase.co',
        supabaseAnonKey: 'valid-key'
      };

      const redirectUrl = clientApp.getAuthRedirectUrl();
      assert.strictEqual(redirectUrl, 'https://taskly-todo-app-4z1c.vercel.app/auth/confirmed');
      assert.notStrictEqual(redirectUrl, 'https://localhost');
      assert.notStrictEqual(redirectUrl, 'com.taskly.app://auth/callback');
    });

    test('Capacitor Android Deep Link: handleAuthDeepLink exchanges PKCE code and avoids duplicate processing', async () => {
      let codeExchanged = null;
      let sessionSynced = false;

      clientApp.setSupabaseClient({
        auth: {
          exchangeCodeForSession: async (code) => {
            codeExchanged = code;
            return { data: { session: { access_token: 'pkce-token-abc', user: { id: 'u1' } } }, error: null };
          }
        }
      });

      const testUrl = 'com.taskly.app://auth/callback?code=pkce-auth-code-123';
      await clientApp.handleAuthDeepLink(testUrl);

      assert.strictEqual(codeExchanged, 'pkce-auth-code-123');
      assert.strictEqual(clientApp.state.userToken, 'pkce-token-abc');

      // Duplicate processing check: Calling again with same code should be ignored
      codeExchanged = null;
      await clientApp.handleAuthDeepLink(testUrl);
      assert.strictEqual(codeExchanged, null); // Did not re-call exchangeCodeForSession
    });

    test('Capacitor Android Deep Link: handles expired or invalid confirmation links gracefully', async () => {
      const errorUrl = 'com.taskly.app://auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
      await clientApp.handleAuthDeepLink(errorUrl);

      const errEl = document.getElementById('auth-error-msg');
      assert.strictEqual(errEl.style.display, 'flex');
      assert.strictEqual(errEl.textContent, 'Email link is invalid or has expired');
    });

    test('Server getCanonicalAppUrl(): local development returns localhost URL', () => {
      delete process.env.VERCEL;
      delete process.env.VERCEL_ENV;
      delete process.env.APP_URL;
      delete process.env.SITE_URL;
      process.env.NODE_ENV = 'development';
      process.env.PORT = '3000';

      const url = serverApp.getCanonicalAppUrl();
      assert.strictEqual(url, 'http://localhost:3000');
    });

    test('Server getCanonicalAppUrl(): deployed production requires explicit APP_URL and fails closed if missing', () => {
      // 1. Explicit APP_URL configured with HTTPS
      process.env.NODE_ENV = 'production';
      process.env.APP_URL = 'https://taskly.app';
      assert.strictEqual(serverApp.getCanonicalAppUrl(), 'https://taskly.app');

      // 2. Vercel canonical production domain
      delete process.env.APP_URL;
      delete process.env.VERCEL_ENV;
      process.env.VERCEL = '1';
      process.env.VERCEL_PROJECT_PRODUCTION_URL = 'taskly-production.vercel.app';
      assert.strictEqual(serverApp.getCanonicalAppUrl(), 'https://taskly-production.vercel.app');

      // 3. Vercel deployment preview domain
      delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
      process.env.VERCEL_ENV = 'preview';
      process.env.VERCEL_URL = 'taskly-preview-123.vercel.app';
      assert.strictEqual(serverApp.getCanonicalAppUrl(), 'https://taskly-preview-123.vercel.app');

      // 4. Missing production configuration: fails closed by returning null
      delete process.env.VERCEL_URL;
      delete process.env.VERCEL_ENV;
      process.env.VERCEL = '1';
      assert.strictEqual(serverApp.getCanonicalAppUrl(), null);
    });

    test('Server getCanonicalAppUrl(): Vercel Preview prioritizes VERCEL_URL over VERCEL_PROJECT_PRODUCTION_URL', () => {
      delete process.env.APP_URL;
      delete process.env.SITE_URL;
      process.env.VERCEL = '1';
      process.env.VERCEL_ENV = 'preview';
      process.env.VERCEL_URL = 'taskly-git-feat-branch.vercel.app';
      process.env.VERCEL_PROJECT_PRODUCTION_URL = 'taskly-production.vercel.app';

      const url = serverApp.getCanonicalAppUrl();
      assert.strictEqual(url, 'https://taskly-git-feat-branch.vercel.app');
    });

    test('Server getCanonicalAppUrl(): Vercel Preview prioritizes VERCEL_URL even if APP_URL is configured globally', () => {
      process.env.VERCEL = '1';
      process.env.VERCEL_ENV = 'preview';
      process.env.APP_URL = 'https://taskly-global-prod.vercel.app';
      process.env.VERCEL_URL = 'taskly-git-feat-branch.vercel.app';
      process.env.VERCEL_PROJECT_PRODUCTION_URL = 'taskly-global-prod.vercel.app';

      const url = serverApp.getCanonicalAppUrl();
      assert.strictEqual(url, 'https://taskly-git-feat-branch.vercel.app');
    });

    test('Server getCanonicalAppUrl(): Vercel Production resolves to VERCEL_PROJECT_PRODUCTION_URL', () => {
      delete process.env.APP_URL;
      delete process.env.SITE_URL;
      process.env.VERCEL = '1';
      process.env.VERCEL_ENV = 'production';
      process.env.VERCEL_URL = 'taskly-deployment-hash.vercel.app';
      process.env.VERCEL_PROJECT_PRODUCTION_URL = 'taskly-production.vercel.app';

      const url = serverApp.getCanonicalAppUrl();
      assert.strictEqual(url, 'https://taskly-production.vercel.app');
    });

    test('Server getCanonicalAppUrl(): Vercel Production prioritizes explicit APP_URL over platform domains', () => {
      process.env.VERCEL = '1';
      process.env.VERCEL_ENV = 'production';
      process.env.APP_URL = 'https://custom-production-domain.com';
      process.env.VERCEL_URL = 'taskly-deploy-hash.vercel.app';
      process.env.VERCEL_PROJECT_PRODUCTION_URL = 'taskly-production.vercel.app';

      const url = serverApp.getCanonicalAppUrl();
      assert.strictEqual(url, 'https://custom-production-domain.com');
    });

    test('Server getCanonicalAppUrl(): rejects non-HTTPS APP_URL in deployed production', () => {
      process.env.NODE_ENV = 'production';
      process.env.APP_URL = 'http://insecure-domain.com';
      assert.strictEqual(serverApp.getCanonicalAppUrl(), null);
    });

    test('Server getCanonicalAppUrl(): rejects localhost and 127.0.0.1 in deployed environments', () => {
      process.env.NODE_ENV = 'production';
      process.env.APP_URL = 'http://localhost:3000';
      assert.strictEqual(serverApp.getCanonicalAppUrl(), null);

      process.env.APP_URL = 'https://localhost:3000';
      assert.strictEqual(serverApp.getCanonicalAppUrl(), null);

      process.env.APP_URL = 'https://127.0.0.1:3000';
      assert.strictEqual(serverApp.getCanonicalAppUrl(), null);
    });

    test('Server getCanonicalAppUrl(): rejects malformed APP_URL in deployed environments', () => {
      process.env.NODE_ENV = 'production';
      process.env.APP_URL = 'invalid ::: not-a-url';
      assert.strictEqual(serverApp.getCanonicalAppUrl(), null);
    });
  });

  describe('8. Supabase Auth Callback and Email Confirmation Handling', () => {
    test('Email confirmation callback with valid session cleans URL tokens and navigates to welcome screen', () => {
      // 1. Simulate user arriving from confirmation link with tokens in hash
      window.location.origin = 'https://taskly-todo-app-4z1c.vercel.app';
      window.location.pathname = '/';
      currentHash = '#access_token=valid-confirmed-token&refresh_token=valid-ref&type=signup';

      // 2. User has been authenticated by Supabase
      clientApp.state.userToken = 'valid-confirmed-token';
      clientApp.state.user.id = 'usr-confirmed-1';
      clientApp.state.user.onboarded = false;

      clientApp.restoreActiveRoute();

      // 3. URL tokens must be cleaned from hash to #welcome
      assert.strictEqual(currentHash, '#welcome');
      const lastHistory = historyLog[historyLog.length - 1];
      assert.strictEqual(lastHistory.action, 'replaceState');
      assert.strictEqual(lastHistory.url, '#welcome');

      // 4. Session must be preserved
      assert.strictEqual(clientApp.isAuthenticated(), true);
      assert.strictEqual(clientApp.state.userToken, 'valid-confirmed-token');

      // 5. User must be navigated to the welcome celebration screen
      assert.strictEqual(clientApp.state.flow, 'onboarding');
      assert.strictEqual(clientApp.state.currentOnboardingStep, 'welcome');
    });

    test('Email confirmation callback with expired/invalid link routes to profile-setup and displays error', () => {
      currentHash = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
      clientApp.state.userToken = null;
      clientApp.state.user.id = null;

      clientApp.restoreActiveRoute();

      // Must redirect to profile-setup
      assert.strictEqual(currentHash, '#profile-setup');
      assert.strictEqual(clientApp.state.currentOnboardingStep, 'profile-setup');

      // Must display the error message in the UI
      const authErrorMsg = getMockElement('auth-error-msg');
      assert.strictEqual(authErrorMsg.textContent, 'Email link is invalid or has expired');
      assert.strictEqual(authErrorMsg.style.display, 'flex');
    });

    test('initSupabaseAuth() exchanges authorization code (?code=) via exchangeCodeForSession', async () => {
      let exchangedCode = null;
      currentSearch = '?code=pkce-auth-code-777';
      currentHash = '';

      global.window.supabase = {
        createClient: (url, key, opts) => ({
          auth: {
            exchangeCodeForSession: async (code) => {
              exchangedCode = code;
              return {
                data: {
                  session: {
                    access_token: 'pkce-jwt-token-999',
                    user: { id: 'usr-pkce-1', email: 'pkce@example.com', email_confirmed_at: '2026-11-05T00:00:00Z' }
                  }
                },
                error: null
              };
            },
            getSession: async () => ({
              data: {
                session: {
                  access_token: 'pkce-jwt-token-999',
                  user: { id: 'usr-pkce-1', email: 'pkce@example.com', email_confirmed_at: '2026-11-05T00:00:00Z' }
                }
              },
              error: null
            }),
            onAuthStateChange: () => {}
          }
        })
      };

      const originalFetch = global.fetch;
      global.fetch = async (url) => {
        if (typeof url === 'string' && url.includes('/todos')) {
          return {
            ok: true,
            json: async () => []
          };
        }
        return {
          ok: true,
          json: async () => ({
            supabaseUrl: 'https://test.supabase.co',
            supabaseAnonKey: 'anon-key',
            appUrl: 'https://taskly.app'
          })
        };
      };

      try {
        await clientApp.initSupabaseAuth();
        assert.strictEqual(exchangedCode, 'pkce-auth-code-777');
        assert.strictEqual(clientApp.isAuthenticated(), true);
        assert.strictEqual(clientApp.state.userToken, 'pkce-jwt-token-999');
        assert.strictEqual(clientApp.state.user.id, 'usr-pkce-1');
      } finally {
        global.fetch = originalFetch;
        delete global.window.supabase;
      }
    });

    test('restoreActiveRoute() with failed auth callback redirects to profile-setup with error', () => {
      window.location.origin = 'https://taskly-todo-app-4z1c.vercel.app';
      window.location.pathname = '/';
      currentSearch = '?code=expired-or-used-code';
      currentHash = '';

      clientApp.state.userToken = null;
      clientApp.state.user.id = null;

      clientApp.restoreActiveRoute();

      assert.strictEqual(currentHash, '#profile-setup');
      assert.strictEqual(clientApp.state.currentOnboardingStep, 'profile-setup');
      const authErrorMsg = getMockElement('auth-error-msg');
      assert.strictEqual(authErrorMsg.textContent, 'Confirmation link is invalid or has already been used. Please sign in or request a new link.');
      assert.strictEqual(authErrorMsg.style.display, 'flex');
    });

    test('initSupabaseAuth() clears session and signs out unverified email user', async () => {
      currentSearch = '';
      currentHash = '';
      let signOutCalled = false;

      global.window.supabase = {
        createClient: (url, key, opts) => ({
          auth: {
            getSession: async () => ({
              data: {
                session: {
                  access_token: 'unverified-jwt-111',
                  user: { id: 'unverified-usr', email: 'unverified@example.com', email_confirmed_at: null, confirmed_at: null }
                }
              },
              error: null
            }),
            signOut: async () => { signOutCalled = true; },
            onAuthStateChange: () => {}
          }
        })
      };

      const originalFetch = global.fetch;
      global.fetch = async () => ({
        ok: true,
        json: async () => ({
          supabaseUrl: 'https://test.supabase.co',
          supabaseAnonKey: 'anon-key',
          appUrl: 'https://taskly.app'
        })
      });

      try {
        await clientApp.initSupabaseAuth();
        assert.strictEqual(signOutCalled, true);
        assert.strictEqual(clientApp.state.userToken, null);
        assert.strictEqual(clientApp.isAuthenticated(), false);
      } finally {
        global.fetch = originalFetch;
        delete global.window.supabase;
      }
    });

    test('handleUnverifiedEmail() clears session, resets state, redirects to profile-setup, and shows alert', () => {
      clientApp.state.userToken = 'some-token';
      clientApp.state.user.id = 'usr-1';
      clientApp.state.user.email = 'test@example.com';

      clientApp.handleUnverifiedEmail('Please verify your email address to access tasks.');

      assert.strictEqual(clientApp.state.userToken, null);
      assert.strictEqual(clientApp.state.user.id, null);
      assert.strictEqual(clientApp.isAuthenticated(), false);
      assert.strictEqual(currentHash, '#profile-setup');
      assert.strictEqual(clientApp.state.currentOnboardingStep, 'profile-setup');

      const authErrorMsg = getMockElement('auth-error-msg');
      assert.strictEqual(authErrorMsg.textContent, 'Please verify your email address to access tasks.');
      assert.strictEqual(authErrorMsg.style.display, 'flex');
    });

    test('fetchTodos() handles HTTP 403 Forbidden by calling handleUnverifiedEmail()', async () => {
      clientApp.state.userToken = 'unverified-token-jwt';
      clientApp.state.user.id = 'usr-unverified-403';
      clientApp.state.user.email = 'unverified@example.com';

      const originalFetch = global.fetch;
      global.fetch = async (url) => {
        if (typeof url === 'string' && url.includes('/todos')) {
          return {
            ok: false,
            status: 403,
            json: async () => ({ error: 'Forbidden: Email address is not verified. Please verify your email to access tasks.' })
          };
        }
        return { ok: true, json: async () => ({}) };
      };

      try {
        await clientApp.fetchTodos();

        assert.strictEqual(clientApp.state.userToken, null);
        assert.strictEqual(clientApp.isAuthenticated(), false);
        assert.strictEqual(currentHash, '#profile-setup');

        const authErrorMsg = getMockElement('auth-error-msg');
        assert.strictEqual(authErrorMsg.textContent, 'Forbidden: Email address is not verified. Please verify your email to access tasks.');
        assert.strictEqual(authErrorMsg.style.display, 'flex');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('9. Production & Native Signup Redirect Safeguards', () => {
    test('Signup in Capacitor Android uses HTTPS /auth/confirmed redirect URL', async () => {
      window.location.origin = 'https://localhost';
      window.location.hostname = 'localhost';
      window.location.protocol = 'https:';
      isNativePlatformActive = true;
      capacitorPlatformName = 'android';

      clientApp.state.config = {
        appUrl: 'https://taskly-todo-app-4z1c.vercel.app',
        supabaseUrl: 'https://test.supabase.co',
        supabaseAnonKey: 'anon-key'
      };
      clientApp.state.authMode = 'signup';

      let capturedRedirectUrl = null;
      let signUpCalled = false;
      const mockSupabase = {
        auth: {
          signUp: async (opts) => {
            signUpCalled = true;
            capturedRedirectUrl = opts?.options?.emailRedirectTo;
            return { data: {}, error: null };
          },
          getSession: async () => ({ data: { session: null }, error: null }),
          onAuthStateChange: () => {}
        }
      };
      clientApp.setSupabaseClient(mockSupabase);

      const emailInput = getMockElement('setup-email');
      const passInput = getMockElement('setup-password');
      const form = getMockElement('form-profile-setup');

      emailInput.value = 'native@example.com';
      passInput.value = 'Secret1234!';

      clientApp.setupEventListeners();
      await form.dispatchEvent({ type: 'submit', preventDefault() {} });

      assert.strictEqual(signUpCalled, true);
      assert.strictEqual(capturedRedirectUrl, 'https://taskly-todo-app-4z1c.vercel.app/auth/confirmed');
    });

    test('Signup is blocked on deployed web when server configuration fails closed to null', async () => {
      window.location.origin = 'https://taskly.app';
      window.location.hostname = 'taskly.app';
      window.location.protocol = 'https:';
      isNativePlatformActive = false;
      capacitorPlatformName = 'web';

      clientApp.state.config = {
        appUrl: null,
        supabaseUrl: 'https://test.supabase.co',
        supabaseAnonKey: 'anon-key'
      };
      clientApp.state.authMode = 'signup';

      let signUpCalled = false;
      const mockSupabase = {
        auth: {
          signUp: async () => {
            signUpCalled = true;
            return { data: {}, error: null };
          },
          getSession: async () => ({ data: { session: null }, error: null }),
          onAuthStateChange: () => {}
        }
      };
      clientApp.setSupabaseClient(mockSupabase);

      const emailInput = getMockElement('setup-email');
      const passInput = getMockElement('setup-password');
      const authErrorMsg = getMockElement('auth-error-msg');
      const form = getMockElement('form-profile-setup');

      emailInput.value = 'deployed@example.com';
      passInput.value = 'Secret1234!';

      clientApp.setupEventListeners();
      await form.dispatchEvent({ type: 'submit', preventDefault() {} });

      assert.strictEqual(signUpCalled, false);
      assert.strictEqual(authErrorMsg.style.display, 'flex');
      assert.strictEqual(authErrorMsg.textContent, 'Registration service is temporarily unavailable. Missing redirect configuration.');
    });

    test('Local development signup succeeds and passes http://localhost:3000 redirect', async () => {
      window.location.origin = 'http://localhost:3000';
      window.location.hostname = 'localhost';
      window.location.protocol = 'http:';
      isNativePlatformActive = false;
      capacitorPlatformName = 'web';

      clientApp.state.config = {
        appUrl: 'http://localhost:3000',
        supabaseUrl: 'https://test.supabase.co',
        supabaseAnonKey: 'anon-key'
      };
      clientApp.state.authMode = 'signup';

      let passedOptions = null;
      const mockSupabase = {
        auth: {
          signUp: async (opts) => {
            passedOptions = opts;
            return { data: { session: null }, error: null };
          },
          getSession: async () => ({ data: { session: null }, error: null }),
          onAuthStateChange: () => {}
        }
      };
      clientApp.setSupabaseClient(mockSupabase);

      const emailInput = getMockElement('setup-email');
      const passInput = getMockElement('setup-password');
      const authErrorMsg = getMockElement('auth-error-msg');
      const form = getMockElement('form-profile-setup');

      emailInput.value = 'local@example.com';
      passInput.value = 'LocalSecret123!';

      clientApp.setupEventListeners();
      await form.dispatchEvent({ type: 'submit', preventDefault() {} });

      assert.notStrictEqual(passedOptions, null);
      assert.strictEqual(passedOptions.email, 'local@example.com');
      assert.strictEqual(passedOptions.options.emailRedirectTo, 'http://localhost:3000/auth/confirmed');
      assert.strictEqual(authErrorMsg.textContent, 'Account created! Please check your email to confirm registration.');

      delete global.window.supabase;
    });

    test('Registration: Rejects password shorter than 6 characters with inline error', async () => {
      clientApp.state.authMode = 'signup';

      let signUpCalled = false;
      const mockSupabase = {
        auth: {
          signUp: async () => {
            signUpCalled = true;
            return { data: { session: null }, error: null };
          },
          getSession: async () => ({ data: { session: null }, error: null }),
          onAuthStateChange: () => {}
        }
      };
      clientApp.setSupabaseClient(mockSupabase);

      const emailInput = getMockElement('setup-email');
      const passInput = getMockElement('setup-password');
      const authErrorMsg = getMockElement('auth-error-msg');
      const form = getMockElement('form-profile-setup');

      emailInput.value = 'shortpw@example.com';
      passInput.value = '12345'; // 5 chars < 6

      clientApp.setupEventListeners();
      await form.dispatchEvent({ type: 'submit', preventDefault() {} });

      assert.strictEqual(signUpCalled, false, 'Supabase signUp must not be called when password is under 6 characters');
      assert.strictEqual(authErrorMsg.style.display, 'flex');
      assert.strictEqual(authErrorMsg.textContent, 'Password must be at least 6 characters long.');
    });

    test('Sign In: Does not restrict existing passwords with the signup minlength validation', async () => {
      clientApp.state.authMode = 'signin';

      let signInCalled = false;
      const mockSupabase = {
        auth: {
          signInWithPassword: async () => {
            signInCalled = true;
            return { data: { session: null }, error: new Error('Invalid login credentials') };
          },
          getSession: async () => ({ data: { session: null }, error: null }),
          onAuthStateChange: () => {}
        }
      };
      clientApp.setSupabaseClient(mockSupabase);

      const emailInput = getMockElement('setup-email');
      const passInput = getMockElement('setup-password');
      const form = getMockElement('form-profile-setup');

      emailInput.value = 'user@example.com';
      passInput.value = 'pass'; // 4 chars

      clientApp.setupEventListeners();
      await form.dispatchEvent({ type: 'submit', preventDefault() {} });

      assert.strictEqual(signInCalled, true, 'Sign In should delegate credential verification directly to Supabase');
    });
  });
});
