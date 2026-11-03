const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'development';
const app = require('../server.js');
const { setStorage, FileStorageAdapter, SupabaseStorageAdapter } = require('../storage/taskStore.js');

// Lightweight in-memory HTTP dispatcher for Express (zero network/socket dependency)
function mockRequest(app, options) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = (options.method || 'GET').toUpperCase();
    req.url = options.url || '/';
    req.headers = Object.assign({
      'content-type': 'application/json',
      'authorization': 'Bearer mock-user:api-test-user-1:test@taskly.app'
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

describe('Taskly Production API Test Suite (File Storage)', () => {
  let createdTodoId;
  const testFile = path.join('/tmp', `taskly-api-test-${Date.now()}.json`);

  before(() => {
    setStorage(new FileStorageAdapter(testFile));
  });

  after(() => {
    try {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    } catch (_) {}
  });

  test('Health Check: GET /healthz returns 200 with UP status and metadata', async () => {
    const res = await mockRequest(app, { method: 'GET', url: '/healthz' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'UP');
    assert.ok(typeof res.body.uptime === 'number');
    assert.ok(res.body.timestamp);
  });

  test('Security Headers: Verifies strict HTTP response headers', async () => {
    const res = await mockRequest(app, { method: 'GET', url: '/healthz' });
    assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(res.headers['x-frame-options'], 'DENY');
    assert.strictEqual(res.headers['x-xss-protection'], '1; mode=block');
    assert.strictEqual(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  });

  test('GET /api/todos: Successfully returns tasks array', async () => {
    const res = await mockRequest(app, { method: 'GET', url: '/api/todos' });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });

  test('POST /api/todos: Successfully creates a new task with validation', async () => {
    const payload = {
      title: 'Automated CI/CD Validation Task',
      dueDate: '2026-12-31'
    };
    const res = await mockRequest(app, {
      method: 'POST',
      url: '/api/todos',
      body: payload
    });

    assert.strictEqual(res.status, 201);
    assert.ok(res.body.id);
    assert.strictEqual(res.body.title, payload.title);
    assert.strictEqual(res.body.dueDate, payload.dueDate);
    assert.strictEqual(res.body.completed, false);
    createdTodoId = res.body.id;
  });

  test('POST /api/todos: Rejects empty title with 400 Bad Request', async () => {
    const res = await mockRequest(app, {
      method: 'POST',
      url: '/api/todos',
      body: { title: '   ' }
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Title is required');
  });

  test('POST /api/todos: Rejects title exceeding 150 characters with 400', async () => {
    const res = await mockRequest(app, {
      method: 'POST',
      url: '/api/todos',
      body: { title: 'X'.repeat(151) }
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Title must not exceed 150 characters');
  });

  test('POST /api/todos: Rejects invalid date format with 400', async () => {
    const res = await mockRequest(app, {
      method: 'POST',
      url: '/api/todos',
      body: { title: 'Valid Title', dueDate: 'not-a-date' }
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Due date must be in YYYY-MM-DD format');
  });

  test('PATCH /api/todos/:id: Successfully updates task completion', async () => {
    assert.ok(createdTodoId);
    const res = await mockRequest(app, {
      method: 'PATCH',
      url: `/api/todos/${createdTodoId}`,
      body: { completed: true }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.completed, true);
  });

  test('DELETE /api/todos/:id: Successfully deletes a task', async () => {
    assert.ok(createdTodoId);
    const res = await mockRequest(app, {
      method: 'DELETE',
      url: `/api/todos/${createdTodoId}`
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
  });

  test('404 Handler: Unmatched /api route returns 404 JSON', async () => {
    const res = await mockRequest(app, {
      method: 'GET',
      url: '/api/non-existent-endpoint'
    });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error, 'Endpoint not found');
  });
});

describe('Taskly Production API Test Suite (Supabase PostgreSQL Mode)', () => {
  let createdTodoId;
  let mockRows;

  before(() => {
    mockRows = new Map();

    const mockSupabase = {
      from: () => {
        const filters = [];
        let pendingInsert = null;
        let pendingUpdate = null;
        let isDelete = false;

        const matchesFilters = (row) => {
          return filters.every(f => row[f.col] === f.val);
        };

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

  test('POST /api/todos (Supabase): Creates a new task and returns 201', async () => {
    const payload = {
      title: 'Supabase Task via REST API',
      dueDate: '2026-11-28'
    };
    const res = await mockRequest(app, {
      method: 'POST',
      url: '/api/todos',
      body: payload
    });

    assert.strictEqual(res.status, 201);
    assert.ok(res.body.id);
    assert.strictEqual(res.body.title, payload.title);
    assert.strictEqual(res.body.dueDate, '2026-11-28');
    assert.strictEqual(res.body.completed, false);
    createdTodoId = res.body.id;
  });

  test('GET /api/todos (Supabase): Retrieves tasks from Supabase', async () => {
    const res = await mockRequest(app, { method: 'GET', url: '/api/todos' });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.strictEqual(res.body.length, 1);
    assert.strictEqual(res.body[0].id, createdTodoId);
  });

  test('PATCH /api/todos/:id (Supabase): Updates completion status', async () => {
    const res = await mockRequest(app, {
      method: 'PATCH',
      url: `/api/todos/${createdTodoId}`,
      body: { completed: true, title: 'Completed Supabase Task' }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.completed, true);
    assert.strictEqual(res.body.title, 'Completed Supabase Task');
  });

  test('DELETE /api/todos/:id (Supabase): Deletes single task', async () => {
    const res = await mockRequest(app, {
      method: 'DELETE',
      url: `/api/todos/${createdTodoId}`
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(mockRows.size, 0);
  });

  test('DELETE /api/todos (Supabase): Bulk clears completed tasks', async () => {
    // Insert 3 tasks
    await mockRequest(app, { method: 'POST', url: '/api/todos', body: { title: 'Bulk 1' } });
    await mockRequest(app, { method: 'POST', url: '/api/todos', body: { title: 'Bulk 2' } });
    const res3 = await mockRequest(app, { method: 'POST', url: '/api/todos', body: { title: 'Bulk 3' } });

    // Mark 1 and 2 as completed
    const list = await mockRequest(app, { method: 'GET', url: '/api/todos' });
    await mockRequest(app, { method: 'PATCH', url: `/api/todos/${list.body[0].id}`, body: { completed: true } });
    await mockRequest(app, { method: 'PATCH', url: `/api/todos/${list.body[1].id}`, body: { completed: true } });

    const clearRes = await mockRequest(app, { method: 'DELETE', url: '/api/todos' });
    assert.strictEqual(clearRes.status, 200);
    assert.strictEqual(clearRes.body.count, 2);

    const afterList = await mockRequest(app, { method: 'GET', url: '/api/todos' });
    assert.strictEqual(afterList.body.length, 1);
  });
});
