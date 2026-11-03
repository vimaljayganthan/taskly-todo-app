const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'development';
const app = require('../server.js');
const { setStorage, FileStorageAdapter, SupabaseStorageAdapter } = require('../storage/taskStore.js');

function mockRequest(app, options) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = (options.method || 'GET').toUpperCase();
    req.url = options.url || '/';
    req.headers = Object.assign({
      'content-type': 'application/json'
    }, options.headers || {});
    req.body = options.body;

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

describe('Taskly Multi-User Security & Tenant Isolation Suite (File Storage)', () => {
  const testFile = path.join('/tmp', `taskly-sec-test-${Date.now()}.json`);
  const userA = {
    id: 'user-aaa-111',
    token: 'Bearer mock-user:user-aaa-111:userA@taskly.app'
  };
  const userB = {
    id: 'user-bbb-222',
    token: 'Bearer mock-user:user-bbb-222:userB@taskly.app'
  };

  let taskAId;
  let taskBId;

  before(() => {
    setStorage(new FileStorageAdapter(testFile));
  });

  after(() => {
    try {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    } catch (_) {}
  });

  test('Public Endpoints: /healthz does not require authentication', async () => {
    const res = await mockRequest(app, { method: 'GET', url: '/healthz' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'UP');
  });

  test('Public Endpoints: /api/config returns public URL & anon key, never exposes service role key', async () => {
    const res = await mockRequest(app, { method: 'GET', url: '/api/config' });
    assert.strictEqual(res.status, 200);
    assert.ok(typeof res.body.supabaseUrl === 'string');
    assert.ok('supabaseAnonKey' in res.body);
    assert.strictEqual(res.body.serviceRoleKey, undefined);
    assert.strictEqual(res.body.service_role, undefined);
    assert.strictEqual(res.body.SUPABASE_SERVICE_ROLE_KEY, undefined);
  });

  test('Authentication: Rejects requests missing Authorization header with 401', async () => {
    const res = await mockRequest(app, { method: 'GET', url: '/api/todos' });
    assert.strictEqual(res.status, 401);
    assert.match(res.body.error, /Bearer|token|Unauthorized/i);
  });

  test('Authentication: Rejects requests with malformed Authorization token with 401', async () => {
    const res = await mockRequest(app, {
      method: 'GET',
      url: '/api/todos',
      headers: { authorization: 'Basic dXNlcjpwYXNz' }
    });
    assert.strictEqual(res.status, 401);
  });

  test('Authentication: Rejects invalid or expired Bearer token with 401', async () => {
    const res = await mockRequest(app, {
      method: 'GET',
      url: '/api/todos',
      headers: { authorization: 'Bearer invalid-token-xyz' }
    });
    assert.strictEqual(res.status, 401);
  });

  test('Task Creation: User A creates a task scoped to user A', async () => {
    const res = await mockRequest(app, {
      method: 'POST',
      url: '/api/todos',
      headers: { authorization: userA.token },
      body: { title: 'User A Secret Task', dueDate: '2026-11-20' }
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.title, 'User A Secret Task');
    assert.strictEqual(res.body.user_id, userA.id);
    taskAId = res.body.id;
  });

  test('Task Creation: User B creates a task scoped to user B', async () => {
    const res = await mockRequest(app, {
      method: 'POST',
      url: '/api/todos',
      headers: { authorization: userB.token },
      body: { title: 'User B Secret Task', dueDate: '2026-11-21' }
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.title, 'User B Secret Task');
    assert.strictEqual(res.body.user_id, userB.id);
    taskBId = res.body.id;
  });

  test('Isolation: User A only sees User A tasks; User B tasks are hidden', async () => {
    const res = await mockRequest(app, {
      method: 'GET',
      url: '/api/todos',
      headers: { authorization: userA.token }
    });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body));
    const ids = res.body.map(t => t.id);
    assert.ok(ids.includes(taskAId), 'User A tasks must include Task A');
    assert.ok(!ids.includes(taskBId), 'User A tasks must NOT include Task B');
  });

  test('Isolation: User B only sees User B tasks; User A tasks are hidden', async () => {
    const res = await mockRequest(app, {
      method: 'GET',
      url: '/api/todos',
      headers: { authorization: userB.token }
    });
    assert.strictEqual(res.status, 200);
    const ids = res.body.map(t => t.id);
    assert.ok(ids.includes(taskBId), 'User B tasks must include Task B');
    assert.ok(!ids.includes(taskAId), 'User B tasks must NOT include Task A');
  });

  test('Cross-Tenant Protection: User B cannot update User A task (returns 404)', async () => {
    const res = await mockRequest(app, {
      method: 'PATCH',
      url: `/api/todos/${taskAId}`,
      headers: { authorization: userB.token },
      body: { completed: true, title: 'Hacked by User B' }
    });
    assert.strictEqual(res.status, 404);

    // Verify User A task remained unchanged
    const verifyRes = await mockRequest(app, {
      method: 'GET',
      url: '/api/todos',
      headers: { authorization: userA.token }
    });
    const taskA = verifyRes.body.find(t => t.id === taskAId);
    assert.strictEqual(taskA.title, 'User A Secret Task');
    assert.strictEqual(taskA.completed, false);
  });

  test('Cross-Tenant Protection: User B cannot delete User A task (returns 404)', async () => {
    const res = await mockRequest(app, {
      method: 'DELETE',
      url: `/api/todos/${taskAId}`,
      headers: { authorization: userB.token }
    });
    assert.strictEqual(res.status, 404);

    // Verify User A task still exists
    const verifyRes = await mockRequest(app, {
      method: 'GET',
      url: '/api/todos',
      headers: { authorization: userA.token }
    });
    const exists = verifyRes.body.some(t => t.id === taskAId);
    assert.strictEqual(exists, true);
  });

  test('Cross-Tenant Protection: User B bulk clear completed does not delete User A completed tasks', async () => {
    // Complete User A task
    await mockRequest(app, {
      method: 'PATCH',
      url: `/api/todos/${taskAId}`,
      headers: { authorization: userA.token },
      body: { completed: true }
    });

    // Complete User B task
    await mockRequest(app, {
      method: 'PATCH',
      url: `/api/todos/${taskBId}`,
      headers: { authorization: userB.token },
      body: { completed: true }
    });

    // User B executes bulk clear completed
    const clearRes = await mockRequest(app, {
      method: 'DELETE',
      url: '/api/todos',
      headers: { authorization: userB.token }
    });
    assert.strictEqual(clearRes.status, 200);

    // User B has no completed tasks remaining
    const userBTasks = await mockRequest(app, {
      method: 'GET',
      url: '/api/todos',
      headers: { authorization: userB.token }
    });
    assert.strictEqual(userBTasks.body.length, 0);

    // User A STILL has their completed task
    const userATasks = await mockRequest(app, {
      method: 'GET',
      url: '/api/todos',
      headers: { authorization: userA.token }
    });
    assert.strictEqual(userATasks.body.length, 1);
    assert.strictEqual(userATasks.body[0].id, taskAId);
    assert.strictEqual(userATasks.body[0].completed, true);
  });
});

describe('Taskly Multi-User Security Suite (Supabase PostgreSQL Mode)', () => {
  let mockRows;
  const userA = {
    id: 'user-supabase-aaa',
    token: 'Bearer mock-user:user-supabase-aaa:userA@taskly.app'
  };
  const userB = {
    id: 'user-supabase-bbb',
    token: 'Bearer mock-user:user-supabase-bbb:userB@taskly.app'
  };

  before(() => {
    mockRows = new Map();

    const mockSupabase = {
      from: () => {
        const filters = [];
        let pendingInsert = null;
        let pendingUpdate = null;
        let isDelete = false;

        const matchesFilters = (row) => filters.every(f => row[f.col] === f.val);

        const builder = {
          select: () => builder,
          order: () => builder,
          eq: (col, val) => {
            filters.push({ col, val });
            return builder;
          },
          insert: (payload) => {
            pendingInsert = Array.isArray(payload) ? payload : [payload];
            return builder;
          },
          update: (payload) => {
            pendingUpdate = payload;
            return builder;
          },
          delete: () => {
            isDelete = true;
            return builder;
          },
          single: async () => {
            const res = await builder;
            return { data: res.data ? res.data[0] : null, error: res.error };
          },
          then: (resolve) => {
            if (pendingInsert) {
              const inserted = [];
              for (const item of pendingInsert) {
                mockRows.set(item.id, Object.assign({}, item));
                inserted.push(item);
              }
              return resolve({ data: inserted, error: null });
            }
            if (pendingUpdate) {
              const updated = [];
              for (const [id, row] of mockRows.entries()) {
                if (matchesFilters(row)) {
                  const newRow = Object.assign({}, row, pendingUpdate);
                  mockRows.set(id, newRow);
                  updated.push(newRow);
                }
              }
              return resolve({ data: updated, error: null });
            }
            if (isDelete) {
              const deleted = [];
              for (const [id, row] of Array.from(mockRows.entries())) {
                if (matchesFilters(row)) {
                  mockRows.delete(id);
                  deleted.push(row);
                }
              }
              return resolve({ data: deleted, error: null });
            }
            const rows = Array.from(mockRows.values()).filter(matchesFilters);
            return resolve({ data: rows, error: null });
          }
        };
        return builder;
      }
    };

    setStorage(new SupabaseStorageAdapter(mockSupabase, 'todos'), 'supabase');
  });

  test('Supabase: Isolated writes and reads between User A and User B', async () => {
    const resA = await mockRequest(app, {
      method: 'POST',
      url: '/api/todos',
      headers: { authorization: userA.token },
      body: { title: 'Supabase User A Task', dueDate: '2026-11-25' }
    });
    assert.strictEqual(resA.status, 201);
    assert.strictEqual(resA.body.user_id, userA.id);

    const resB = await mockRequest(app, {
      method: 'POST',
      url: '/api/todos',
      headers: { authorization: userB.token },
      body: { title: 'Supabase User B Task', dueDate: '2026-11-26' }
    });
    assert.strictEqual(resB.status, 201);
    assert.strictEqual(resB.body.user_id, userB.id);

    // User A fetches tasks
    const getA = await mockRequest(app, {
      method: 'GET',
      url: '/api/todos',
      headers: { authorization: userA.token }
    });
    assert.strictEqual(getA.body.length, 1);
    assert.strictEqual(getA.body[0].title, 'Supabase User A Task');

    // User B fetches tasks
    const getB = await mockRequest(app, {
      method: 'GET',
      url: '/api/todos',
      headers: { authorization: userB.token }
    });
    assert.strictEqual(getB.body.length, 1);
    assert.strictEqual(getB.body[0].title, 'Supabase User B Task');

    // Cross-user modification blocked
    const updateRes = await mockRequest(app, {
      method: 'PATCH',
      url: `/api/todos/${resA.body.id}`,
      headers: { authorization: userB.token },
      body: { title: 'Attacked Task' }
    });
    assert.strictEqual(updateRes.status, 404);
  });
});
