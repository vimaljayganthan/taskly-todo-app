const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const app = require('../server.js');
const { setStorage, FileStorageAdapter } = require('../storage/taskStore.js');
const path = require('path');
const fs = require('fs');

function mockRequest(app, options) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = (options.method || 'GET').toUpperCase();
    req.url = options.url || '/api/todos';
    req.headers = Object.assign({
      'content-type': 'application/json'
    }, options.headers || {});
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

describe('Authentication Security Enforcement Suite', () => {
  const originalEnv = Object.assign({}, process.env);
  const testFile = path.join('/tmp', `taskly-auth-sec-${Date.now()}.json`);

  before(() => {
    setStorage(new FileStorageAdapter(testFile));
  });

  after(() => {
    process.env = originalEnv;
    delete app.locals.mockAuthVerifier;
    delete app.locals.mockAuthClient;
    try {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    } catch (_) {}
  });

  beforeEach(() => {
    delete app.locals.mockAuthVerifier;
    delete app.locals.mockAuthClient;
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = 'development';
    delete app.locals.mockAuthVerifier;
    delete app.locals.mockAuthClient;
  });

  // 1. Development Mode Mock Token Acceptance
  test('1. Development mode accepts permitted mock tokens', async () => {
    process.env.NODE_ENV = 'development';

    const res = await mockRequest(app, {
      method: 'GET',
      url: '/api/todos',
      headers: {
        authorization: 'Bearer mock-user:valid-dev-user:developer@taskly.app'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body), 'Must return tasks array for authenticated dev user');
  });

  // 2. Production Mode Mock Token Rejection
  test('2. Production mode rejects mock tokens with HTTP 401', async () => {
    process.env.NODE_ENV = 'production';

    const res = await mockRequest(app, {
      method: 'GET',
      url: '/api/todos',
      headers: {
        authorization: 'Bearer mock-user:attacker:attacker@exploit.com'
      }
    });

    assert.strictEqual(res.status, 401);
    assert.match(res.body.error, /forbidden in production|only allowed in development/i);
  });

  test('2b. Vercel production environment rejects mock tokens with HTTP 401', async () => {
    process.env.NODE_ENV = 'development'; // Even if someone set NODE_ENV=development in Vercel env
    process.env.VERCEL = '1';

    const res = await mockRequest(app, {
      method: 'GET',
      url: '/api/todos',
      headers: {
        authorization: 'Bearer mock-user:attacker:attacker@exploit.com'
      }
    });

    assert.strictEqual(res.status, 401);
    assert.match(res.body.error, /forbidden in production|only allowed in development/i);
  });

  test('2c. Test mock verifier cannot become active in production', async () => {
    process.env.NODE_ENV = 'production';
    app.locals.mockAuthVerifier = async () => ({ id: 'backdoor-user', email: 'backdoor@test.com' });

    const res = await mockRequest(app, {
      method: 'GET',
      url: '/api/todos',
      headers: {
        authorization: 'Bearer mock-user:backdoor-user:backdoor@test.com'
      }
    });

    assert.strictEqual(res.status, 401);
  });

  // 3. Production Mode Fail Closed Without Supabase Configuration
  test('3. Production mode without Supabase configuration fails closed with HTTP 500', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_KEY;

    const res = await mockRequest(app, {
      method: 'GET',
      url: '/api/todos',
      headers: {
        authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy.token'
      }
    });

    assert.strictEqual(res.status, 500);
    assert.match(res.body.error, /Server configuration error|Authentication service is unavailable/i);
  });

  test('3b. Development mode without Supabase configuration rejects unverified real tokens with HTTP 401', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_KEY;

    const res = await mockRequest(app, {
      method: 'GET',
      url: '/api/todos',
      headers: {
        authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy.token'
      }
    });

    assert.strictEqual(res.status, 401);
    assert.match(res.body.error, /Unauthorized: Invalid authentication token/i);
  });

  // 4. Valid Supabase JWT Authentication Works
  test('4. Valid Supabase JWT authentication succeeds with 200', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SUPABASE_URL = 'https://liucmamlownxfshnaxtc.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'valid-test-anon-key';

    const validUser = {
      id: '8fdf606c-4746-49ef-bbde-e38d85ed5797',
      email: 'verified.user@taskly.app',
      email_confirmed_at: '2026-11-05T00:00:00Z',
      role: 'authenticated'
    };

    app.locals.mockAuthClient = {
      auth: {
        getUser: async (token) => {
          if (token === 'valid-supabase-jwt-signature') {
            return { data: { user: validUser }, error: null };
          }
          return { data: { user: null }, error: { message: 'Invalid JWT' } };
        }
      }
    };

    const res = await mockRequest(app, {
      method: 'GET',
      url: '/api/todos',
      headers: {
        authorization: 'Bearer valid-supabase-jwt-signature'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });

  // 4b. Unverified Supabase User Is Denied with HTTP 403
  test('4b. Unverified Supabase user (null email_confirmed_at) is denied access with HTTP 403', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SUPABASE_URL = 'https://liucmamlownxfshnaxtc.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'valid-test-anon-key';

    const unverifiedUser = {
      id: 'unverified-uuid-4444',
      email: 'unconfirmed@taskly.app',
      email_confirmed_at: null,
      confirmed_at: null,
      role: 'authenticated'
    };

    app.locals.mockAuthClient = {
      auth: {
        getUser: async (token) => {
          if (token === 'unverified-supabase-jwt') {
            return { data: { user: unverifiedUser }, error: null };
          }
          return { data: { user: null }, error: { message: 'Invalid JWT' } };
        }
      }
    };

    const res = await mockRequest(app, {
      method: 'GET',
      url: '/api/todos',
      headers: {
        authorization: 'Bearer unverified-supabase-jwt'
      }
    });

    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /Email address is not verified/i);
  });

  // 5. Invalid and Expired JWTs Are Rejected with HTTP 401
  test('5. Invalid Supabase JWT is rejected with HTTP 401', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SUPABASE_URL = 'https://liucmamlownxfshnaxtc.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'valid-test-anon-key';

    app.locals.mockAuthClient = {
      auth: {
        getUser: async () => {
          return { data: { user: null }, error: { message: 'Invalid signature or malformed token' } };
        }
      }
    };

    const res = await mockRequest(app, {
      method: 'GET',
      url: '/api/todos',
      headers: {
        authorization: 'Bearer invalid.tampered.signature'
      }
    });

    assert.strictEqual(res.status, 401);
    assert.match(res.body.error, /Unauthorized: Invalid or expired token/i);
  });

  test('5b. Expired Supabase JWT is rejected with HTTP 401', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SUPABASE_URL = 'https://liucmamlownxfshnaxtc.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'valid-test-anon-key';

    app.locals.mockAuthClient = {
      auth: {
        getUser: async () => {
          return { data: { user: null }, error: { message: 'JWT expired' } };
        }
      }
    };

    const res = await mockRequest(app, {
      method: 'GET',
      url: '/api/todos',
      headers: {
        authorization: 'Bearer expired.jwt.token'
      }
    });

    assert.strictEqual(res.status, 401);
    assert.match(res.body.error, /Unauthorized: Invalid or expired token/i);
  });

  test('5c. Request with non-Bearer Authorization header is rejected with HTTP 401', async () => {
    const res = await mockRequest(app, {
      method: 'GET',
      url: '/api/todos',
      headers: {
        authorization: 'Basic dXNlcjpwYXNz'
      }
    });

    assert.strictEqual(res.status, 401);
    assert.match(res.body.error, /Missing or invalid Bearer token/i);
  });

  test('5d. Request with missing Authorization header is rejected with HTTP 401', async () => {
    const res = await mockRequest(app, {
      method: 'GET',
      url: '/api/todos',
      headers: {}
    });

    assert.strictEqual(res.status, 401);
    assert.match(res.body.error, /Missing or invalid Bearer token/i);
  });
});
