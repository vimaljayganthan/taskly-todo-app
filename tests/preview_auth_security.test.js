const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

const app = require('../server.js');
const clientApp = require('../public/app.js');
const { setStorage, FileStorageAdapter } = require('../storage/taskStore.js');

function mockRequest(app, options) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = (options.method || 'GET').toUpperCase();
    req.url = options.url || '/api/config';
    
    const lowerHeaders = {
      'content-type': 'application/json',
      host: options.host || 'localhost:3000'
    };
    if (options.headers) {
      for (const [k, v] of Object.entries(options.headers)) {
        lowerHeaders[k.toLowerCase()] = v;
      }
    }
    req.headers = lowerHeaders;
    req.hostname = (options.host || 'localhost').split(':')[0];
    req.body = options.body;
    req.app = app;

    const res = new EventEmitter();
    res.statusCode = 200;
    res._headers = {};
    res.setHeader = (k, v) => { res._headers[k.toLowerCase()] = v; };
    res.getHeader = (k) => res._headers[k.toLowerCase()];
    res.status = (code) => { res.statusCode = code; return res; };

    let resBody = '';
    res.json = (data) => {
      resBody = data;
      res.emit('finish');
      resolve({ status: res.statusCode, headers: res._headers, body: data });
    };
    res.send = (data) => {
      resBody = data;
      res.emit('finish');
      resolve({ status: res.statusCode, headers: res._headers, body: data });
    };
    res.end = (data) => {
      if (data) resBody = data;
      res.emit('finish');
      resolve({ status: res.statusCode, headers: res._headers, body: resBody });
    };

    app.handle(req, res, reject);
  });
}

describe('Preview Mode & Authentication Hardening Suite', () => {
  const originalEnv = Object.assign({}, process.env);
  const testFile = path.join('/tmp', `taskly-prev-sec-${Date.now()}.json`);

  before(() => {
    setStorage(new FileStorageAdapter(testFile));
  });

  beforeEach(() => {
    process.env = Object.assign({}, originalEnv);
    delete app.locals.mockAuthVerifier;
    delete app.locals.mockAuthClient;
  });

  after(() => {
    process.env = originalEnv;
    delete app.locals.mockAuthVerifier;
    delete app.locals.mockAuthClient;
    try {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    } catch (_) {}
  });

  // --------------------------------------------------------------------------
  // 1. Mandatory Environment Protection: Preview Mode Disabled in Production
  // --------------------------------------------------------------------------
  describe('1. Environment Gate: Preview Mode Disabled Outside Local Development', () => {
    test('Fails closed when process.env.NODE_ENV === "production"', () => {
      process.env.NODE_ENV = 'production';
      process.env.ENABLE_LOCAL_PREVIEW = 'true';
      delete process.env.VERCEL;
      delete process.env.VERCEL_ENV;

      const req = { headers: { host: 'localhost:3000' }, hostname: 'localhost' };
      assert.strictEqual(app.isLocalPreviewAllowed(req), false);
    });

    test('Fails closed when running on Vercel (even in preview or dev branch)', () => {
      process.env.NODE_ENV = 'development';
      process.env.VERCEL = '1';
      process.env.VERCEL_ENV = 'preview';
      process.env.ENABLE_LOCAL_PREVIEW = 'true';

      const req = { headers: { host: 'localhost:3000' }, hostname: 'localhost' };
      assert.strictEqual(app.isLocalPreviewAllowed(req), false);
    });

    test('Fails closed when host is not localhost (e.g. deployed domain)', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.VERCEL;
      delete process.env.VERCEL_ENV;
      process.env.ENABLE_LOCAL_PREVIEW = 'true';

      const req = { headers: { host: 'taskly-preview.vercel.app' }, hostname: 'taskly-preview.vercel.app' };
      assert.strictEqual(app.isLocalPreviewAllowed(req), false);
    });

    test('Fails closed when ENABLE_LOCAL_PREVIEW flag is not explicitly enabled', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.VERCEL;
      delete process.env.VERCEL_ENV;
      delete process.env.ENABLE_LOCAL_PREVIEW;

      const req = { headers: { host: 'localhost:3000' }, hostname: 'localhost' };
      assert.strictEqual(app.isLocalPreviewAllowed(req), false);
    });

    test('Succeeds ONLY when NODE_ENV is development, host is localhost, and flag is enabled', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.VERCEL;
      delete process.env.VERCEL_ENV;
      process.env.ENABLE_LOCAL_PREVIEW = 'true';

      const req = { headers: { host: 'localhost:3000' }, hostname: 'localhost' };
      assert.strictEqual(app.isLocalPreviewAllowed(req), true);
    });

    test('GET /api/config returns previewModeAllowed: false in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ENABLE_LOCAL_PREVIEW = 'true';
      delete process.env.VERCEL;

      const res = await mockRequest(app, {
        url: '/api/config',
        host: 'taskly.app'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.previewModeAllowed, false);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Client-side Preview Mode Checks & Fail-Closed Behavior
  // --------------------------------------------------------------------------
  describe('2. Client-side Preview Security Constraints', () => {
    let mockElements;

    beforeEach(() => {
      mockElements = {};
      global.window = {
        location: {
          hostname: 'localhost',
          origin: 'http://localhost:3000',
          protocol: 'http:',
          hash: '',
          search: ''
        },
        Capacitor: {
          isNativePlatform: () => false,
          getPlatform: () => 'web'
        },
        addEventListener() {},
        removeEventListener() {}
      };
      global.document = {
        getElementById: (id) => {
          if (!mockElements[id]) {
            mockElements[id] = {
              id,
              style: {},
              classList: {
                add() {},
                remove() {},
                toggle() {},
                contains() { return false; }
              },
              addEventListener() {},
              removeEventListener() {},
              value: '',
              textContent: ''
            };
          }
          return mockElements[id];
        },
        querySelectorAll: () => [],
        querySelector: () => null,
        documentElement: { setAttribute() {} },
        body: { classList: { add() {}, remove() {} }, setAttribute() {} }
      };
      global.localStorage = {
        _store: {},
        getItem(k) { return this._store[k] || null; },
        setItem(k, v) { this._store[k] = String(v); },
        removeItem(k) { delete this._store[k]; }
      };
    });

    afterEach(() => {
      delete global.__FORCE_PREVIEW_TEST__;
      delete global.window;
      delete global.document;
      delete global.localStorage;
    });

    test('isLocalPreview() returns false when state.config.previewModeAllowed is false', () => {
      global.__FORCE_PREVIEW_TEST__ = true;
      clientApp.state.config = { previewModeAllowed: false };
      assert.strictEqual(clientApp.isLocalPreview(), false);
    });

    test('isLocalPreview() returns false in native Capacitor platform', () => {
      global.__FORCE_PREVIEW_TEST__ = true;
      global.window.Capacitor.isNativePlatform = () => true;
      clientApp.state.config = { previewModeAllowed: true };
      assert.strictEqual(clientApp.isLocalPreview(), false);
    });

    test('isLocalPreview() returns false on deployed non-localhost origin', () => {
      global.__FORCE_PREVIEW_TEST__ = true;
      global.window.location.hostname = 'taskly.app';
      clientApp.state.config = { previewModeAllowed: true };
      assert.strictEqual(clientApp.isLocalPreview(), false);
    });

    test('initPreviewData() does not set userToken and marks isPreview: true', () => {
      global.__FORCE_PREVIEW_TEST__ = true;
      clientApp.state.config = { previewModeAllowed: true };
      clientApp.state.userToken = 'should-be-cleared';

      clientApp.initPreviewData();

      assert.strictEqual(clientApp.state.userToken, null);
      assert.strictEqual(clientApp.state.isPreviewSession, true);
      assert.strictEqual(clientApp.state.user.isPreview, true);
      assert.strictEqual(clientApp.isAuthenticated(), false);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Incorrect Passwords Must Always Be Rejected
  // --------------------------------------------------------------------------
  describe('3. Credentials Validation: Incorrect Passwords Rejected', () => {
    let mockElements;
    let eventListeners;

    beforeEach(() => {
      mockElements = {};
      eventListeners = {};
      global.window = {
        location: {
          hostname: 'localhost',
          origin: 'http://localhost:3000',
          protocol: 'http:',
          hash: '',
          search: ''
        },
        Capacitor: {
          isNativePlatform: () => false,
          getPlatform: () => 'web'
        },
        addEventListener() {},
        removeEventListener() {}
      };
      global.document = {
        getElementById: (id) => {
          if (!mockElements[id]) {
            mockElements[id] = {
              id,
              style: {},
              classList: {
                add() {},
                remove() {},
                toggle() {},
                contains() { return false; }
              },
              addEventListener: (event, handler) => {
                eventListeners[`${id}:${event}`] = handler;
              },
              removeEventListener() {},
              value: '',
              textContent: ''
            };
          }
          return mockElements[id];
        },
        querySelectorAll: () => [],
        querySelector: () => null,
        documentElement: { setAttribute() {} },
        body: { classList: { add() {}, remove() {} }, setAttribute() {} }
      };
      global.localStorage = {
        _store: {},
        getItem(k) { return this._store[k] || null; },
        setItem(k, v) { this._store[k] = String(v); },
        removeItem(k) { delete this._store[k]; }
      };
    });

    afterEach(() => {
      delete global.__FORCE_PREVIEW_TEST__;
      delete global.window;
      delete global.document;
      delete global.localStorage;
      clientApp.setSupabaseClient(null);
    });

    test('Incorrect password throws and displays error without creating preview session', async () => {
      global.__FORCE_PREVIEW_TEST__ = true;
      clientApp.state.config = { previewModeAllowed: true };
      clientApp.state.authMode = 'login';
      clientApp.state.userToken = null;

      // Mock Supabase client rejecting password
      const mockSupabase = {
        auth: {
          signInWithPassword: async ({ email, password }) => {
            return {
              data: { session: null },
              error: new Error('Invalid login credentials')
            };
          },
          getSession: async () => ({ data: { session: null }, error: null }),
          onAuthStateChange: () => {}
        }
      };
      clientApp.setSupabaseClient(mockSupabase);

      // Setup inputs
      const emailInput = global.document.getElementById('setup-email');
      const passInput = global.document.getElementById('setup-password');
      const authErrorMsg = global.document.getElementById('auth-error-msg');
      const submitBtn = global.document.getElementById('btn-auth-submit');

      emailInput.value = 'user@example.com';
      passInput.value = 'WrongPassword123!';

      clientApp.setupEventListeners();

      const formSubmitHandler = eventListeners['form-profile-setup:submit'];
      assert.ok(formSubmitHandler, 'Form submit handler must be registered');

      let prevented = false;
      await formSubmitHandler({
        preventDefault: () => { prevented = true; }
      });

      assert.strictEqual(prevented, true);
      assert.strictEqual(authErrorMsg.style.display, 'flex');
      assert.ok(authErrorMsg.textContent.includes('Invalid login credentials'));
      assert.strictEqual(clientApp.state.userToken, null);
      assert.strictEqual(clientApp.isAuthenticated(), false);
      assert.notStrictEqual(clientApp.state.flow, 'main');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Unauthenticated API Requests Are Rejected
  // --------------------------------------------------------------------------
  describe('4. API Protection: Unauthenticated Requests Rejected with 401', () => {
    test('GET /api/todos with missing Authorization header returns 401', async () => {
      const res = await mockRequest(app, {
        method: 'GET',
        url: '/api/todos',
        headers: {}
      });
      assert.strictEqual(res.status, 401);
      assert.ok(res.body.error.includes('Missing or invalid Bearer token'));
    });

    test('POST /api/todos with non-Bearer header returns 401', async () => {
      const res = await mockRequest(app, {
        method: 'POST',
        url: '/api/todos',
        headers: {
          Authorization: 'Basic dXNlcjpwYXNz'
        },
        body: { title: 'Unauthorized Task' }
      });
      assert.strictEqual(res.status, 401);
      assert.ok(res.body.error.includes('Missing or invalid Bearer token'));
    });

    test('PATCH /api/todos/:id with empty Bearer token returns 401', async () => {
      const res = await mockRequest(app, {
        method: 'PATCH',
        url: '/api/todos/fake-id-123',
        headers: {
          Authorization: 'Bearer   '
        },
        body: { completed: true }
      });
      assert.strictEqual(res.status, 401);
      assert.ok(res.body.error.includes('Missing Bearer token'));
    });
  });

  // --------------------------------------------------------------------------
  // 5. Expired or Invalid Tokens Are Rejected
  // --------------------------------------------------------------------------
  describe('5. Token Validation: Expired or Invalid Tokens Rejected with 401', () => {
    test('In production, mock tokens (mock-user:...) are rejected with 401', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.VERCEL;

      const res = await mockRequest(app, {
        method: 'GET',
        url: '/api/todos',
        headers: {
          Authorization: 'Bearer mock-user:victim-user:victim@taskly.app'
        }
      });
      assert.strictEqual(res.status, 401);
      assert.ok(res.body.error.includes('Mock tokens are forbidden in production'));
    });

    test('Invalid Supabase JWT is rejected with 401', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SUPABASE_URL = 'https://mock.supabase.co';
      process.env.SUPABASE_ANON_KEY = 'mock-anon-key';

      // Mock auth client returning error
      app.locals.mockAuthClient = {
        auth: {
          getUser: async () => ({
            data: { user: null },
            error: new Error('Invalid JWT signature')
          })
        }
      };

      const res = await mockRequest(app, {
        method: 'GET',
        url: '/api/todos',
        headers: {
          Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature'
        }
      });

      assert.strictEqual(res.status, 401);
      assert.ok(res.body.error.includes('Invalid or expired token'));
    });
  });

  // --------------------------------------------------------------------------
  // 6. Access to Another User\'s Tasks
  // --------------------------------------------------------------------------
  describe('6. Multi-Tenant Task Isolation: Cross-User Access Forbidden', () => {
    test('User B cannot see, modify, or delete User A\'s task', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.VERCEL;

      const tokenUserA = 'Bearer mock-user:tenant-user-alpha:alpha@taskly.app';
      const tokenUserB = 'Bearer mock-user:tenant-user-beta:beta@taskly.app';

      // 1. User A creates a task
      const createRes = await mockRequest(app, {
        method: 'POST',
        url: '/api/todos',
        headers: { Authorization: tokenUserA },
        body: { title: 'Alpha Private Task', priority: 'High' }
      });
      assert.strictEqual(createRes.status, 201);
      const taskId = createRes.body.id;

      // 2. User B lists tasks - must NOT see User A's task
      const listResB = await mockRequest(app, {
        method: 'GET',
        url: '/api/todos',
        headers: { Authorization: tokenUserB }
      });
      assert.strictEqual(listResB.status, 200);
      const foundTask = listResB.body.find(t => t.id === taskId);
      assert.strictEqual(foundTask, undefined, 'User B must not see User A task');

      // 3. User B attempts to modify User A's task - must return 404 (or fail)
      const patchResB = await mockRequest(app, {
        method: 'PATCH',
        url: `/api/todos/${taskId}`,
        headers: { Authorization: tokenUserB },
        body: { completed: true }
      });
      assert.strictEqual(patchResB.status, 404);

      // 4. User B attempts to delete User A's task - must return 404
      const deleteResB = await mockRequest(app, {
        method: 'DELETE',
        url: `/api/todos/${taskId}`,
        headers: { Authorization: tokenUserB }
      });
      assert.strictEqual(deleteResB.status, 404);
    });
  });

  // --------------------------------------------------------------------------
  // 7. Localhost Real Authenticated Session vs Preview Session
  // --------------------------------------------------------------------------
  describe('7. Localhost Real Authenticated Session vs Preview Session', () => {
    test('Client CRUD operations use real API when user is authenticated, not sample preview data', () => {
      const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
      assert.ok(appJs.includes('if (isLocalPreview() && state.isPreviewSession)'), 'fetchTodos must only init preview data when isPreviewSession is active');
      assert.ok(appJs.includes("if (state.authMode === 'signup' && password.length < 6)"), 'Client signup must enforce password length >= 6');
    });
  });
});
