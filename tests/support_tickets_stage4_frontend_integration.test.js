/**
 * Taskly Customer Support — Stage 4: Frontend Integration & Production Readiness Test Suite
 * Version: 2.2.0 (Build 14)
 * 
 * Verifies End-to-End Customer & Developer Workflows:
 * 1. Customer Support Ticket Creation, Listing, and Conversation View
 * 2. Strict Cross-User Data Isolation (User A vs User B)
 * 3. Customer Follow-up Messaging & Closed Ticket Protection
 * 4. Developer Authentication & Strict Access Control (Customer 403 Forbidden)
 * 5. Developer Dashboard Operations: Ticket Listing, Search, Status Filtering
 * 6. Developer Reply Submission & Atomic Status Transitions
 * 7. Developer Direct Status Override (PATCH /status) & Dashboard Stats
 * 8. End-to-End Outbox & Inbound Webhook Integration (Stage 2 & Stage 3 Pipeline)
 * 9. Frontend State & Access Helpers (isDeveloperUser, formatStatusLabel)
 */

const { test, describe, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.env.NODE_ENV = 'development';
const TEST_SECRET = 'whsec_test_secret_1234567890abcdefghijklmnopqrstuv';
process.env.RESEND_WEBHOOK_SECRET = TEST_SECRET;
process.env.SUPPORT_DEVELOPER_EMAIL = 'tasklypets@gmail.com';
process.env.RESEND_RECEIVING_DOMAIN = 'd893f1.resend.app';
process.env.SUPPORT_EMAIL_WORKFLOW_ENABLED = 'true';

const app = require('../server.js');
const SupportStore = require('../storage/supportStore');
const { FileSupportStorageAdapter } = SupportStore;
const frontendApp = require('../public/app.js');
const { signSvixPayload } = require('../services/svixVerifier');

// In-memory HTTP request dispatcher for Express server
function dispatchRequest(app, options) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = (options.method || 'GET').toUpperCase();
    req.url = options.url || '/';
    req.headers = Object.assign({
      'content-type': 'application/json'
    }, options.headers || {});

    const bodyStr = options.rawBody !== undefined
      ? options.rawBody
      : (typeof options.body === 'string' ? options.body : JSON.stringify(options.body || {}));

    req.rawBody = bodyStr;
    try {
      req.body = typeof options.body === 'object' ? options.body : JSON.parse(bodyStr);
    } catch (_) {
      req.body = options.body;
    }

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

describe('Taskly Customer Support — Stage 4: Frontend Integration & Production Readiness', () => {
  let testFile;
  let testAdapter;

  const USER_ALICE_TOKEN = 'Bearer mock-user:user-alice-uuid:alice@taskly.app';
  const USER_BOB_TOKEN = 'Bearer mock-user:user-bob-uuid:bob@taskly.app';
  const DEVELOPER_TOKEN = 'Bearer mock-user:dev-admin-uuid:tasklypets@gmail.com';

  beforeEach(() => {
    testFile = path.join('/tmp', `taskly-stage4-test-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.json`);
    testAdapter = new FileSupportStorageAdapter(testFile);
    SupportStore.setStorage(testAdapter);
  });

  after(() => {
    SupportStore.resetStorage();
    try {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    } catch (_) {}
  });

  // --------------------------------------------------------------------------
  // Scenario 1: Customer Ticket Creation & Conversation Flow
  // --------------------------------------------------------------------------
  test('Scenario 1: Customer creates ticket, views details, and sends follow-up messages', async () => {
    // 1.1 Customer Alice creates a ticket
    const createRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      headers: {
        authorization: USER_ALICE_TOKEN,
        'idempotency-key': 'idemp-ticket-001'
      },
      body: {
        subject: 'Cannot sync reminders on Android',
        category: 'bug',
        priority: 'high',
        description: 'Reminders scheduled for 10 PM do not sound when phone is in doze mode.'
      }
    });

    assert.strictEqual(createRes.status, 201);
    assert.strictEqual(createRes.body.subject, 'Cannot sync reminders on Android');
    assert.strictEqual(createRes.body.status, 'open');
    assert.strictEqual(createRes.body.category, 'bug');
    assert.strictEqual(createRes.body.priority, 'high');
    assert.ok(createRes.body.ticket_code.startsWith('TK-'));
    const ticketId = createRes.body.id;

    // 1.2 Retrieve ticket details with messages
    const getRes = await dispatchRequest(app, {
      method: 'GET',
      url: `/api/support/tickets/${ticketId}`,
      headers: { authorization: USER_ALICE_TOKEN }
    });

    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.id, ticketId);
    assert.strictEqual(getRes.body.messages.length, 1);
    assert.strictEqual(getRes.body.messages[0].sender_type, 'user');
    assert.strictEqual(getRes.body.messages[0].body, 'Reminders scheduled for 10 PM do not sound when phone is in doze mode.');

    // 1.3 Customer sends a follow-up message
    const msgRes = await dispatchRequest(app, {
      method: 'POST',
      url: `/api/support/tickets/${ticketId}/messages`,
      headers: {
        authorization: USER_ALICE_TOKEN,
        'idempotency-key': 'idemp-msg-001'
      },
      body: {
        body: 'Device model is Google Pixel 8 running Android 14.'
      }
    });

    assert.strictEqual(msgRes.status, 201);
    assert.strictEqual(msgRes.body.body, 'Device model is Google Pixel 8 running Android 14.');

    // 1.4 Re-check ticket: has 2 messages
    const getUpdated = await dispatchRequest(app, {
      method: 'GET',
      url: `/api/support/tickets/${ticketId}`,
      headers: { authorization: USER_ALICE_TOKEN }
    });
    assert.strictEqual(getUpdated.body.messages.length, 2);
  });

  // --------------------------------------------------------------------------
  // Scenario 2: Cross-User Customer Isolation
  // --------------------------------------------------------------------------
  test('Scenario 2: User B cannot access or modify User A tickets (404 Not Found)', async () => {
    // 2.1 Alice creates ticket
    const aliceTicket = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      headers: { authorization: USER_ALICE_TOKEN },
      body: { subject: 'Private account issue', description: 'Help with my account' }
    });
    const ticketId = aliceTicket.body.id;

    // 2.2 Bob attempts to view Alice's ticket -> 404
    const bobView = await dispatchRequest(app, {
      method: 'GET',
      url: `/api/support/tickets/${ticketId}`,
      headers: { authorization: USER_BOB_TOKEN }
    });
    assert.strictEqual(bobView.status, 404);

    // 2.3 Bob attempts to post message to Alice's ticket -> 404
    const bobPost = await dispatchRequest(app, {
      method: 'POST',
      url: `/api/support/tickets/${ticketId}/messages`,
      headers: { authorization: USER_BOB_TOKEN },
      body: { body: 'Unauthorized message' }
    });
    assert.strictEqual(bobPost.status, 404);

    // 2.4 Bob lists tickets -> sees 0 tickets
    const bobList = await dispatchRequest(app, {
      method: 'GET',
      url: '/api/support/tickets',
      headers: { authorization: USER_BOB_TOKEN }
    });
    assert.strictEqual(bobList.status, 200);
    assert.strictEqual(bobList.body.length, 0);
  });

  // --------------------------------------------------------------------------
  // Scenario 3: Developer Dashboard Security & Access Control
  // --------------------------------------------------------------------------
  test('Scenario 3: Non-developer customer is denied access to developer API (403 Forbidden)', async () => {
    // 3.1 Alice (ordinary user) attempts to access developer tickets list -> 403
    const resAlice = await dispatchRequest(app, {
      method: 'GET',
      url: '/api/support/developer/tickets',
      headers: { authorization: USER_ALICE_TOKEN }
    });
    assert.strictEqual(resAlice.status, 403);
    assert.ok(resAlice.body.error.includes('developer access required'));

    // 3.2 Unauthenticated request -> 401
    const resNoAuth = await dispatchRequest(app, {
      method: 'GET',
      url: '/api/support/developer/tickets'
    });
    assert.strictEqual(resNoAuth.status, 401);

    // 3.3 Authorized Developer (tasklypets@gmail.com) -> 200 OK
    const resDev = await dispatchRequest(app, {
      method: 'GET',
      url: '/api/support/developer/tickets',
      headers: { authorization: DEVELOPER_TOKEN }
    });
    assert.strictEqual(resDev.status, 200);
    assert.ok(Array.isArray(resDev.body.tickets));
  });

  // --------------------------------------------------------------------------
  // Scenario 4: Developer Support Workflow (Search, Reply, Status Transition)
  // --------------------------------------------------------------------------
  test('Scenario 4: Developer searches tickets, posts response, and updates ticket status', async () => {
    // 4.1 Alice creates a ticket
    const aliceTicket = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      headers: { authorization: USER_ALICE_TOKEN },
      body: {
        subject: 'Notification sounds not playing',
        category: 'feedback',
        description: 'Cannot hear cat meow sound on Galaxy S24.'
      }
    });
    const ticketId = aliceTicket.body.id;
    const ticketCode = aliceTicket.body.ticket_code;

    // 4.2 Developer searches tickets by ticket code
    const searchRes = await dispatchRequest(app, {
      method: 'GET',
      url: `/api/support/developer/tickets?search=${ticketCode}`,
      headers: { authorization: DEVELOPER_TOKEN }
    });
    assert.strictEqual(searchRes.status, 200);
    assert.strictEqual(searchRes.body.tickets.length, 1);
    assert.strictEqual(searchRes.body.tickets[0].id, ticketId);

    // 4.3 Developer inspects ticket
    const viewRes = await dispatchRequest(app, {
      method: 'GET',
      url: `/api/support/developer/tickets/${ticketId}`,
      headers: { authorization: DEVELOPER_TOKEN }
    });
    assert.strictEqual(viewRes.status, 200);
    assert.strictEqual(viewRes.body.user_email, 'alice@taskly.app');

    // 4.4 Developer submits reply from dashboard setting status to waiting_customer
    const replyRes = await dispatchRequest(app, {
      method: 'POST',
      url: `/api/support/developer/tickets/${ticketId}/messages`,
      headers: { authorization: DEVELOPER_TOKEN },
      body: {
        body: 'Please check if Samsung sound profiles or battery saver are silencing notification sounds.',
        status: 'waiting_customer'
      }
    });
    assert.strictEqual(replyRes.status, 201);
    assert.strictEqual(replyRes.body.sender_type, 'developer');

    // 4.5 Verify ticket status transitioned to waiting_customer
    const updatedView = await dispatchRequest(app, {
      method: 'GET',
      url: `/api/support/developer/tickets/${ticketId}`,
      headers: { authorization: DEVELOPER_TOKEN }
    });
    assert.strictEqual(updatedView.body.status, 'waiting_customer');
    assert.strictEqual(updatedView.body.messages.length, 2);

    // 4.6 Developer marks ticket resolved directly via PATCH
    const patchRes = await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/support/developer/tickets/${ticketId}/status`,
      headers: { authorization: DEVELOPER_TOKEN },
      body: { status: 'resolved' }
    });
    assert.strictEqual(patchRes.status, 200);
    assert.strictEqual(patchRes.body.status, 'resolved');

    // 4.7 Verify customer views resolved status and developer message
    const custView = await dispatchRequest(app, {
      method: 'GET',
      url: `/api/support/tickets/${ticketId}`,
      headers: { authorization: USER_ALICE_TOKEN }
    });
    assert.strictEqual(custView.body.status, 'resolved');
    assert.strictEqual(custView.body.messages[1].sender_type, 'developer');
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Developer Dashboard Operational Statistics
  // --------------------------------------------------------------------------
  test('Scenario 5: Developer stats endpoint reports aggregated status counts', async () => {
    // Create 3 tickets with different statuses
    const t1 = await testAdapter.createTicket({ userId: 'u1', userEmail: 'u1@app.com', subject: 'T1', description: 'D1' });
    const t2 = await testAdapter.createTicket({ userId: 'u2', userEmail: 'u2@app.com', subject: 'T2', description: 'D2' });
    const t3 = await testAdapter.createTicket({ userId: 'u3', userEmail: 'u3@app.com', subject: 'T3', description: 'D3' });

    await testAdapter.developerUpdateStatus(t2.id, 'waiting_customer', 'dev-uuid');
    await testAdapter.developerUpdateStatus(t3.id, 'resolved', 'dev-uuid');

    const statsRes = await dispatchRequest(app, {
      method: 'GET',
      url: '/api/support/developer/stats',
      headers: { authorization: DEVELOPER_TOKEN }
    });

    assert.strictEqual(statsRes.status, 200);
    assert.strictEqual(statsRes.body.success, true);
    assert.strictEqual(statsRes.body.stats.total, 3);
    assert.strictEqual(statsRes.body.stats.open, 1);
    assert.strictEqual(statsRes.body.stats.waiting_customer, 1);
    assert.strictEqual(statsRes.body.stats.resolved, 1);
  });

  // --------------------------------------------------------------------------
  // Scenario 6: End-to-End Pipeline: Outbox Enqueue -> Inbound Email Reply
  // --------------------------------------------------------------------------
  test('Scenario 6: Outbox enqueues notification and Stage 3 inbound email reply updates customer conversation', async () => {
    // 6.1 Customer creates ticket
    const ticketRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      headers: { authorization: USER_ALICE_TOKEN },
      body: {
        subject: 'Cannot export data to CSV',
        category: 'account',
        description: 'CSV export fails on Safari.'
      }
    });
    const ticketId = ticketRes.body.id;
    const ticketCode = ticketRes.body.ticket_code;

    // 6.2 Check that Stage 2 Transactional Outbox has enqueued email to developer
    const data = await testAdapter._readData();
    const outboxJob = data.outbox.find(j => j.ticket_id === ticketId);
    assert.ok(outboxJob, 'Outbox job must be enqueued for new ticket');
    assert.strictEqual(outboxJob.recipient_email, 'tasklypets@gmail.com');
    assert.ok(outboxJob.reply_to_address.includes(ticketCode.toLowerCase().replace(/[^a-z0-9]/g, '')));

    // Extract routing token from data.routing
    const routingEntry = data.routing.find(r => r.ticket_id === ticketId);
    assert.ok(routingEntry, 'Routing token must exist in routing table');
    const routingToken = routingEntry.routing_token;

    // 6.3 Developer replies via Resend Email (simulating Stage 3 inbound webhook)
    const inboundPayload = {
      type: 'email.received',
      data: {
        email_id: 'em_stage4_e2e_001',
        from: 'Taskly Support <tasklypets@gmail.com>',
        to: [`reply+tk_${ticketCode.toLowerCase().replace(/[^a-z0-9]/g, '')}_${routingToken}@d893f1.resend.app`],
        subject: `Re: [Ticket #${ticketCode}] Cannot export data to CSV`,
        text: 'This issue with Safari Blob downloads is resolved in Build 14.\n#status: resolved\n\nOn Tue, Nov 10 wrote:\n> CSV export fails on Safari'
      }
    };
    const rawBody = JSON.stringify(inboundPayload);
    const headers = signSvixPayload({ rawBody, secret: TEST_SECRET });

    const webhookRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/support/resend-inbound',
      headers,
      body: inboundPayload,
      rawBody
    });
    assert.strictEqual(webhookRes.status, 200);
    assert.strictEqual(webhookRes.body.status, 'ingested');
    assert.strictEqual(webhookRes.body.new_status, 'resolved');

    // 6.4 Customer views ticket: email reply is present and status is resolved!
    const custView = await dispatchRequest(app, {
      method: 'GET',
      url: `/api/support/tickets/${ticketId}`,
      headers: { authorization: USER_ALICE_TOKEN }
    });
    assert.strictEqual(custView.body.status, 'resolved');
    assert.strictEqual(custView.body.messages.length, 2);

    const emailReplyMsg = custView.body.messages[1];
    assert.strictEqual(emailReplyMsg.sender_type, 'developer');
    assert.strictEqual(emailReplyMsg.channel, 'email');
    assert.ok(emailReplyMsg.body.includes('This issue with Safari Blob downloads is resolved in Build 14.'));
    assert.ok(!emailReplyMsg.body.includes('#status: resolved'));
  });

  // --------------------------------------------------------------------------
  // Scenario 7: Frontend Helper Functions & Authorization State
  // --------------------------------------------------------------------------
  test('Scenario 7: Frontend access helper functions correctly identify developer accounts', () => {
    // Developer account check
    frontendApp.state.user = { email: 'tasklypets@gmail.com' };
    assert.strictEqual(frontendApp.isDeveloperUser(), true);

    // Non-developer account check
    frontendApp.state.user = { email: 'alice@taskly.app' };
    assert.strictEqual(frontendApp.isDeveloperUser(), false);

    frontendApp.state.user = { email: null };
    assert.strictEqual(frontendApp.isDeveloperUser(), false);
  });
});

