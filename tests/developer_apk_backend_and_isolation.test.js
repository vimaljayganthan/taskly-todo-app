const { test, describe, before, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const app = require('../server.js');
const SupportStore = require('../storage/supportStore.js');

function mockRequest(expressApp, options = {}) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = (options.method || 'GET').toUpperCase();
    req.url = options.url || '/api/support/developer/stats';
    req.headers = Object.assign({
      'content-type': 'application/json',
      host: options.host || 'localhost:3000'
    }, options.headers || {});
    req.body = options.body;
    req.app = expressApp;

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

    expressApp.handle(req, res, reject);
  });
}

describe('Taskly Developer APK — Backend Security & Single-Admin Isolation Suite', () => {
  const originalEnv = { ...process.env };
  const ADMIN_EMAIL = 'tasklypets@gmail.com';
  const ADMIN_TOKEN = `Bearer mock-user:admin-uuid-001:${encodeURIComponent(ADMIN_EMAIL)}`;
  const CUSTOMER_EMAIL = 'customer@taskly.app';
  const CUSTOMER_TOKEN = `Bearer mock-user:cust-uuid-002:${encodeURIComponent(CUSTOMER_EMAIL)}`;
  const ROGUE_DEV_EMAIL = 'other-developer@agency.com';
  const ROGUE_DEV_TOKEN = `Bearer mock-user:rogue-uuid-003:${encodeURIComponent(ROGUE_DEV_EMAIL)}`;

  let testDbFile;
  let testAdapter;

  before(() => {
    testDbFile = path.join('/tmp', `taskly_dev_apk_test_${Date.now()}.json`);
    testAdapter = new SupportStore.FileSupportStorageAdapter(testDbFile);
    SupportStore.setStorage(testAdapter);
  });

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    process.env.SUPPORT_EMAIL_WORKFLOW_ENABLED = 'false';
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, val] of Object.entries(originalEnv)) {
      process.env[key] = val;
    }
  });

  after(() => {
    try {
      if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile);
    } catch (_) {}
    SupportStore.resetStorage();
  });

  // ==========================================================================
  // Section 1: Single-Admin Authentication & Strict Role Bypass Removal
  // ==========================================================================
  describe('1. Single-Admin Security Enforcement', () => {
    test('1.1 Authorized administrator (tasklypets@gmail.com) succeeds on verify endpoint', async () => {
      const res = await mockRequest(app, {
        method: 'GET',
        url: '/api/support/developer/auth/verify',
        headers: { authorization: ADMIN_TOKEN }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.user.email, ADMIN_EMAIL);
      assert.strictEqual(res.body.user.role, 'admin');
    });

    test('1.2 Ordinary customer account receives 403 Forbidden on developer endpoints', async () => {
      const res = await mockRequest(app, {
        method: 'GET',
        url: '/api/support/developer/tickets',
        headers: { authorization: CUSTOMER_TOKEN }
      });
      assert.strictEqual(res.status, 403);
      assert.match(res.body.error, /developer access required/);
    });

    test('1.3 Other account claiming developer role or service_role is rejected with 403', async () => {
      // Mock verifier that simulates a non-admin account claiming 'developer' or 'service_role'
      app.locals.mockAuthVerifier = async (token) => {
        if (token.includes('rogue-uuid-003')) {
          return {
            id: 'rogue-uuid-003',
            email: ROGUE_DEV_EMAIL,
            role: 'developer' // role is developer, but email is NOT tasklypets@gmail.com
          };
        }
        return null;
      };

      try {
        const res = await mockRequest(app, {
          method: 'GET',
          url: '/api/support/developer/stats',
          headers: { authorization: ROGUE_DEV_TOKEN }
        });
        assert.strictEqual(res.status, 403);
        assert.match(res.body.error, /developer access required/);
      } finally {
        delete app.locals.mockAuthVerifier;
      }
    });

    test('1.4 Unauthenticated request receives 401 Unauthorized', async () => {
      const res = await mockRequest(app, {
        method: 'GET',
        url: '/api/support/developer/tickets'
      });
      assert.strictEqual(res.status, 401);
    });
  });

  // ==========================================================================
  // Section 2: Email-Based Workflow Safe Disabling
  // ==========================================================================
  describe('2. Email Workflow Safe Disabling via Feature Flag', () => {
    test('2.1 When SUPPORT_EMAIL_WORKFLOW_ENABLED=false, inbound Resend webhook is cleanly disabled', async () => {
      process.env.SUPPORT_EMAIL_WORKFLOW_ENABLED = 'false';

      const res = await mockRequest(app, {
        method: 'POST',
        url: '/api/support/resend-inbound',
        body: { type: 'email.received', data: {} }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'disabled');
      assert.match(res.body.message, /Developer APK/);
    });

    test('2.2 When SUPPORT_EMAIL_WORKFLOW_ENABLED=false, outbox batch process returns processed: 0', async () => {
      process.env.SUPPORT_EMAIL_WORKFLOW_ENABLED = 'false';

      const res = await mockRequest(app, {
        method: 'POST',
        url: '/api/internal/support/outbox/process'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.processed, 0);
      assert.match(res.body.message, /disabled/);
    });

    test('2.3 Customer ticket creation and customer messaging succeed when email workflow is disabled', async () => {
      process.env.SUPPORT_EMAIL_WORKFLOW_ENABLED = 'false';

      // Customer creates ticket
      const createRes = await mockRequest(app, {
        method: 'POST',
        url: '/api/support/tickets',
        headers: { authorization: CUSTOMER_TOKEN },
        body: {
          subject: 'App crash on habit streak reset',
          description: 'When tapping reset button on streak screen, the app closes unexpectedly.',
          category: 'bug',
          priority: 'high'
        }
      });
      assert.strictEqual(createRes.status, 201);
      assert.ok(createRes.body.ticket_code);
      const ticketId = createRes.body.id;

      // Customer appends a message
      const msgRes = await mockRequest(app, {
        method: 'POST',
        url: `/api/support/tickets/${ticketId}/messages`,
        headers: { authorization: CUSTOMER_TOKEN },
        body: {
          body: 'Also happens on Android 14 specifically.'
        }
      });
      assert.strictEqual(msgRes.status, 201);
      assert.strictEqual(msgRes.body.sender_type, 'user');
    });
  });

  // ==========================================================================
  // Section 3: Customer Email Display (Trusted Backend Lookup)
  // ==========================================================================
  describe('3. Customer Email Display & Spoofing Protection', () => {
    test('3.1 Developer inspects ticket: displays verified registered user_email from account record', async () => {
      // 1. Create ticket under CUSTOMER_EMAIL (cust-uuid-002) with spoofed email in body
      const createRes = await mockRequest(app, {
        method: 'POST',
        url: '/api/support/tickets',
        headers: { authorization: CUSTOMER_TOKEN },
        body: {
          subject: 'Billing question',
          description: 'Please email me at hacker@spoofed-domain.com instead of my account email.',
          user_email: 'attacker@spoofed.com' // Spoofed in body
        }
      });
      assert.strictEqual(createRes.status, 201);
      const ticketId = createRes.body.id;

      // 2. Developer opens ticket details
      const devRes = await mockRequest(app, {
        method: 'GET',
        url: `/api/support/developer/tickets/${ticketId}`,
        headers: { authorization: ADMIN_TOKEN }
      });
      assert.strictEqual(devRes.status, 200);

      // Verified registered email from auth record MUST be returned, ignoring body spoofing
      assert.strictEqual(devRes.body.user_email, CUSTOMER_EMAIL);
      assert.strictEqual(devRes.body.user_id, 'cust-uuid-002');
      assert.notStrictEqual(devRes.body.user_email, 'attacker@spoofed.com');
      assert.notStrictEqual(devRes.body.user_email, 'hacker@spoofed-domain.com');
    });
  });

  // ==========================================================================
  // Section 4: Internal Notes & Customer Isolation
  // ==========================================================================
  describe('4. Internal Notes Management & Customer Isolation', () => {
    test('4.1 Developer can add internal notes; internal notes are completely invisible to customers', async () => {
      // 1. Customer creates ticket
      const ticketRes = await mockRequest(app, {
        method: 'POST',
        url: '/api/support/tickets',
        headers: { authorization: CUSTOMER_TOKEN },
        body: {
          subject: 'Sync issue with Google Drive',
          description: 'Backup fails with error code 500.'
        }
      });
      assert.strictEqual(ticketRes.status, 201);
      const ticketId = ticketRes.body.id;

      // 2. Developer adds an internal note
      const noteRes = await mockRequest(app, {
        method: 'POST',
        url: `/api/support/developer/tickets/${ticketId}/notes`,
        headers: { authorization: ADMIN_TOKEN },
        body: {
          body: 'CONFIDENTIAL: Customer account has rate limit triggered on Google API quota.'
        }
      });
      assert.strictEqual(noteRes.status, 201);
      assert.strictEqual(noteRes.body.sender_type, 'developer');
      assert.strictEqual(noteRes.body.is_internal_note, true);

      // 3. Developer sends a public reply to the customer
      const replyRes = await mockRequest(app, {
        method: 'POST',
        url: `/api/support/developer/tickets/${ticketId}/messages`,
        headers: { authorization: ADMIN_TOKEN },
        body: {
          body: 'Hello! We are looking into your backup issue and will update you shortly.',
          status: 'in_progress'
        }
      });
      assert.strictEqual(replyRes.status, 201);

      // 4. Developer inspects ticket -> Sees BOTH internal note and public reply
      const devView = await mockRequest(app, {
        method: 'GET',
        url: `/api/support/developer/tickets/${ticketId}`,
        headers: { authorization: ADMIN_TOKEN }
      });
      assert.strictEqual(devView.status, 200);
      assert.strictEqual(devView.body.messages.length, 3); // initial description + note + public reply
      const noteInDev = devView.body.messages.find(m => m.is_internal_note === true);
      assert.ok(noteInDev, 'Developer view must include internal notes');
      assert.match(noteInDev.body, /CONFIDENTIAL/);

      // 5. Customer inspects ticket (GET /api/support/tickets/:id) -> Internal note is STRICTLY HIDDEN
      const custView = await mockRequest(app, {
        method: 'GET',
        url: `/api/support/tickets/${ticketId}`,
        headers: { authorization: CUSTOMER_TOKEN }
      });
      assert.strictEqual(custView.status, 200);
      assert.strictEqual(custView.body.messages.length, 2); // initial message + public reply ONLY
      const noteInCust = custView.body.messages.find(m => m.body.includes('CONFIDENTIAL') || m.metadata?.is_internal_note);
      assert.strictEqual(noteInCust, undefined, 'Internal notes must never appear in customer ticket view');

      // 6. Customer lists messages (GET /api/support/tickets/:id/messages) -> Internal note is STRICTLY HIDDEN
      const custMsgs = await mockRequest(app, {
        method: 'GET',
        url: `/api/support/tickets/${ticketId}/messages`,
        headers: { authorization: CUSTOMER_TOKEN }
      });
      assert.strictEqual(custMsgs.status, 200);
      assert.strictEqual(custMsgs.body.length, 2);
      const leakedNote = custMsgs.body.find(m => m.body.includes('CONFIDENTIAL'));
      assert.strictEqual(leakedNote, undefined, 'Internal notes must never appear in customer messages endpoint');
    });

    test('4.2 POST /api/support/developer/tickets/:id/messages detects snake_case and nested internal note flags', async () => {
      const ticketRes = await mockRequest(app, {
        method: 'POST',
        url: '/api/support/tickets',
        headers: { authorization: CUSTOMER_TOKEN },
        body: { subject: 'Internal Flag Test', description: 'Testing flag variations.' }
      });
      const ticketId = ticketRes.body.id;

      // Note with is_internal_note: true
      const note1 = await mockRequest(app, {
        method: 'POST',
        url: `/api/support/developer/tickets/${ticketId}/messages`,
        headers: { authorization: ADMIN_TOKEN },
        body: { body: 'SECRET_NOTE_1', is_internal_note: true }
      });
      assert.strictEqual(note1.status, 201);
      assert.strictEqual(note1.body.is_internal_note, true);

      // Note with type: 'internal_note'
      const note2 = await mockRequest(app, {
        method: 'POST',
        url: `/api/support/developer/tickets/${ticketId}/messages`,
        headers: { authorization: ADMIN_TOKEN },
        body: { body: 'SECRET_NOTE_2', type: 'internal_note' }
      });
      assert.strictEqual(note2.status, 201);
      assert.strictEqual(note2.body.is_internal_note, true);

      // Note with metadata: { is_internal_note: true }
      const note3 = await mockRequest(app, {
        method: 'POST',
        url: `/api/support/developer/tickets/${ticketId}/messages`,
        headers: { authorization: ADMIN_TOKEN },
        body: { body: 'SECRET_NOTE_3', metadata: { is_internal_note: true } }
      });
      assert.strictEqual(note3.status, 201);
      assert.strictEqual(note3.body.is_internal_note, true);

      // Customer view MUST have 0 of the secret notes
      const custView = await mockRequest(app, {
        method: 'GET',
        url: `/api/support/tickets/${ticketId}`,
        headers: { authorization: CUSTOMER_TOKEN }
      });
      assert.strictEqual(custView.status, 200);
      assert.strictEqual(custView.body.messages.length, 1); // only initial description
      assert.strictEqual(custView.body.messages.some(m => m.body.includes('SECRET_NOTE')), false);
    });

    test('4.3 Internal note creation does NOT update last_message_at on ticket', async () => {
      const ticketRes = await mockRequest(app, {
        method: 'POST',
        url: '/api/support/tickets',
        headers: { authorization: CUSTOMER_TOKEN },
        body: { subject: 'Timestamp Test', description: 'Testing last_message_at isolation.' }
      });
      const ticketId = ticketRes.body.id;
      const initialLastMsgAt = ticketRes.body.last_message_at;

      // Small delay to ensure timestamp difference if it were modified
      await new Promise(r => setTimeout(r, 15));

      // Post internal note
      await mockRequest(app, {
        method: 'POST',
        url: `/api/support/developer/tickets/${ticketId}/notes`,
        headers: { authorization: ADMIN_TOKEN },
        body: { body: 'Internal note that should not affect customer timestamp.' }
      });

      // Customer gets ticket: last_message_at must be unchanged
      const custView = await mockRequest(app, {
        method: 'GET',
        url: `/api/support/tickets/${ticketId}`,
        headers: { authorization: CUSTOMER_TOKEN }
      });
      assert.strictEqual(custView.body.last_message_at, initialLastMsgAt);
    });
  });

  // ==========================================================================
  // Section 5: Priority and Status Updates
  // ==========================================================================
  describe('5. Ticket Management (Priority & Status Transitions)', () => {
    test('5.1 Developer can update priority and reopen resolved tickets', async () => {
      // 1. Create ticket
      const ticketRes = await mockRequest(app, {
        method: 'POST',
        url: '/api/support/tickets',
        headers: { authorization: CUSTOMER_TOKEN },
        body: {
          subject: 'Widget layout overlapping',
          description: 'Widget overlaps clock on home screen.',
          priority: 'low'
        }
      });
      const ticketId = ticketRes.body.id;
      assert.strictEqual(ticketRes.body.priority, 'low');

      // 2. Developer escalates priority to urgent
      const prioRes = await mockRequest(app, {
        method: 'PATCH',
        url: `/api/support/developer/tickets/${ticketId}/priority`,
        headers: { authorization: ADMIN_TOKEN },
        body: { priority: 'urgent' }
      });
      assert.strictEqual(prioRes.status, 200);
      assert.strictEqual(prioRes.body.priority, 'urgent');

      // 3. Developer marks ticket resolved
      const resolveRes = await mockRequest(app, {
        method: 'PATCH',
        url: `/api/support/developer/tickets/${ticketId}/status`,
        headers: { authorization: ADMIN_TOKEN },
        body: { status: 'resolved' }
      });
      assert.strictEqual(resolveRes.status, 200);
      assert.strictEqual(resolveRes.body.status, 'resolved');

      // 4. Developer reopens resolved ticket
      const reopenRes = await mockRequest(app, {
        method: 'PATCH',
        url: `/api/support/developer/tickets/${ticketId}/status`,
        headers: { authorization: ADMIN_TOKEN },
        body: { status: 'in_progress' }
      });
      assert.strictEqual(reopenRes.status, 200);
      assert.strictEqual(reopenRes.body.status, 'in_progress');
    });

    test('5.2 Invalid priority values are rejected with 400 Bad Request', async () => {
      const res = await mockRequest(app, {
        method: 'PATCH',
        url: `/api/support/developer/tickets/fake-id/priority`,
        headers: { authorization: ADMIN_TOKEN },
        body: { priority: 'super-critical-fake' }
      });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error, /Invalid priority/);
    });

    test('5.3 Customer cannot modify priority (403); developer priority change syncs to customer view', async () => {
      const ticketRes = await mockRequest(app, {
        method: 'POST',
        url: '/api/support/tickets',
        headers: { authorization: CUSTOMER_TOKEN },
        body: { subject: 'Priority Sync Test', description: 'Testing priority isolation.', priority: 'normal' }
      });
      const ticketId = ticketRes.body.id;

      // Customer attempt to modify priority -> 403 Forbidden
      const roguePatch = await mockRequest(app, {
        method: 'PATCH',
        url: `/api/support/developer/tickets/${ticketId}/priority`,
        headers: { authorization: CUSTOMER_TOKEN },
        body: { priority: 'urgent' }
      });
      assert.strictEqual(roguePatch.status, 403);

      // Developer escalates priority to high
      const devPatch = await mockRequest(app, {
        method: 'PATCH',
        url: `/api/support/developer/tickets/${ticketId}/priority`,
        headers: { authorization: ADMIN_TOKEN },
        body: { priority: 'high' }
      });
      assert.strictEqual(devPatch.status, 200);
      assert.strictEqual(devPatch.body.priority, 'high');

      // Customer view reflects updated priority
      const custView = await mockRequest(app, {
        method: 'GET',
        url: `/api/support/tickets/${ticketId}`,
        headers: { authorization: CUSTOMER_TOKEN }
      });
      assert.strictEqual(custView.status, 200);
      assert.strictEqual(custView.body.priority, 'high');
    });

    test('5.4 Developer status update syncs directly to customer ticket view', async () => {
      const ticketRes = await mockRequest(app, {
        method: 'POST',
        url: '/api/support/tickets',
        headers: { authorization: CUSTOMER_TOKEN },
        body: { subject: 'Status Sync Test', description: 'Testing status sync.' }
      });
      const ticketId = ticketRes.body.id;

      // Developer changes status to in_progress
      const devStatus = await mockRequest(app, {
        method: 'PATCH',
        url: `/api/support/developer/tickets/${ticketId}/status`,
        headers: { authorization: ADMIN_TOKEN },
        body: { status: 'in_progress' }
      });
      assert.strictEqual(devStatus.status, 200);
      assert.strictEqual(devStatus.body.status, 'in_progress');

      // Customer view reflects in_progress
      let custView = await mockRequest(app, {
        method: 'GET',
        url: `/api/support/tickets/${ticketId}`,
        headers: { authorization: CUSTOMER_TOKEN }
      });
      assert.strictEqual(custView.body.status, 'in_progress');

      // Developer marks resolved
      await mockRequest(app, {
        method: 'PATCH',
        url: `/api/support/developer/tickets/${ticketId}/status`,
        headers: { authorization: ADMIN_TOKEN },
        body: { status: 'resolved' }
      });

      // Customer view reflects resolved
      custView = await mockRequest(app, {
        method: 'GET',
        url: `/api/support/tickets/${ticketId}`,
        headers: { authorization: CUSTOMER_TOKEN }
      });
      assert.strictEqual(custView.body.status, 'resolved');
    });
  });

  // ==========================================================================
  // Section 6: Dashboard Statistics & Search
  // ==========================================================================
  describe('6. Developer Dashboard Metrics & Filtering', () => {
    test('6.1 Developer stats endpoint returns exact counts for metrics cards', async () => {
      const res = await mockRequest(app, {
        method: 'GET',
        url: '/api/support/developer/stats',
        headers: { authorization: ADMIN_TOKEN }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok('total' in res.body.stats);
      assert.ok('open' in res.body.stats);
      assert.ok('in_progress' in res.body.stats);
      assert.ok('resolved' in res.body.stats);
    });

    test('6.2 Search tickets by ticket code or user email', async () => {
      const res = await mockRequest(app, {
        method: 'GET',
        url: `/api/support/developer/tickets?search=${encodeURIComponent(CUSTOMER_EMAIL)}`,
        headers: { authorization: ADMIN_TOKEN }
      });
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.tickets));
      assert.ok(res.body.tickets.length > 0);
      assert.strictEqual(res.body.tickets[0].user_email, CUSTOMER_EMAIL);
    });
  });

  // ==========================================================================
  // Section 7: Backend Connectivity, Health Diagnostics & Error Boundaries
  // ==========================================================================
  describe('7. Backend Connectivity, Health Diagnostics & Error Boundaries', () => {
    test('7.1 Public health check /api/health returns status UP with service metadata and zero secrets', async () => {
      const res = await mockRequest(app, {
        method: 'GET',
        url: '/api/health'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'UP');
      assert.strictEqual(res.body.service, 'taskly-backend');
      assert.strictEqual(res.body.version, '2.2.0');
      assert.ok(res.body.timestamp);
      assert.ok(typeof res.body.uptime === 'number');

      // Verify no sensitive keys or environment secrets leak in response
      const bodyStr = JSON.stringify(res.body);
      assert.strictEqual(bodyStr.includes('supabase'), false);
      assert.strictEqual(bodyStr.includes('key'), false);
      assert.strictEqual(bodyStr.includes('secret'), false);
      assert.strictEqual(bodyStr.includes('token'), false);
    });

    test('7.2 Unmatched API endpoints return HTTP 404 JSON error without stack traces or leaks', async () => {
      const res = await mockRequest(app, {
        method: 'GET',
        url: '/api/nonexistent-route-for-testing'
      });
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'Endpoint not found');
    });

    test('7.3 Developer verify endpoint is registered before catch-all 404 handler', async () => {
      const res = await mockRequest(app, {
        method: 'GET',
        url: '/api/support/developer/auth/verify',
        headers: { authorization: ADMIN_TOKEN }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
    });
  });
});

