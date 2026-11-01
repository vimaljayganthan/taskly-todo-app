const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const app = require('../server.js');
const { setStorage, FileStorageAdapter } = require('../storage/taskStore.js');

// Lightweight in-memory HTTP dispatcher for Express (zero network/socket dependency)
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

describe('Taskly Production API Test Suite', () => {
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
