const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'development';

const app = require('../server.js');
const SupportStore = require('../storage/supportStore');
const { FileSupportStorageAdapter } = SupportStore;

// Lightweight in-memory HTTP dispatcher for Express
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

describe('Taskly Customer Support & Ticket Management — Stage 1 Backend Foundation', () => {
  let testFile;
  let testAdapter;

  const USER_A_TOKEN = 'Bearer mock-user:user-stage1-a:alice@taskly.app';
  const USER_B_TOKEN = 'Bearer mock-user:user-stage1-b:bob@taskly.app';

  before(() => {
    testFile = path.join('/tmp', `taskly-support-stage1-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.json`);
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
  // Scenario 1: Authentication Requirement (Missing Token)
  // --------------------------------------------------------------------------
  test('Scenario 1: Missing authentication token returns 401 Unauthorized', async () => {
    // 1.1 POST without token
    const resPost = await mockRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      body: { subject: 'Help needed', description: 'Cannot sync tasks' }
    });
    assert.strictEqual(resPost.status, 401);
    assert.ok(resPost.body.error);

    // 1.2 GET without token
    const resGet = await mockRequest(app, {
      method: 'GET',
      url: '/api/support/tickets'
    });
    assert.strictEqual(resGet.status, 401);
    assert.ok(resGet.body.error);
  });

  // --------------------------------------------------------------------------
  // Scenario 2: Invalid / Expired Token
  // --------------------------------------------------------------------------
  test('Scenario 2: Invalid or expired Bearer token returns 401 Unauthorized', async () => {
    const res = await mockRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      headers: { authorization: 'Bearer invalid-token-xyz' },
      body: { subject: 'Help needed', description: 'Cannot sync tasks' }
    });
    assert.strictEqual(res.status, 401);
    assert.ok(res.body.error);
  });

  // --------------------------------------------------------------------------
  // Scenario 3 & 4: Valid Authenticated Ticket Creation
  // --------------------------------------------------------------------------
  test('Scenario 3 & 4: Authenticated user creates ticket with valid fields (201 Created)', async () => {
    const res = await mockRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      headers: { authorization: USER_A_TOKEN },
      body: {
        subject: 'Cannot export completed routines',
        description: 'When I click Export in Settings, the screen flashes and nothing downloads.',
        priority: 'high',
        category: 'bug'
      }
    });

    assert.strictEqual(res.status, 201);
    assert.ok(res.body.id, 'Ticket must have UUID id');
    assert.ok(res.body.ticket_code.startsWith('TK-'), 'Ticket code must follow TK-XXXXXXXX format');
    assert.strictEqual(res.body.user_id, 'user-stage1-a');
    assert.strictEqual(res.body.user_email, 'alice@taskly.app');
    assert.strictEqual(res.body.subject, 'Cannot export completed routines');
    assert.strictEqual(res.body.status, 'open');
    assert.strictEqual(res.body.priority, 'high');
    assert.strictEqual(res.body.category, 'bug');
    assert.ok(res.body.created_at);
    assert.ok(res.body.last_message_at);
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Ticket Listing (Tenant Isolation)
  // --------------------------------------------------------------------------
  test('Scenario 5: User lists only their own tickets, ordered by last_message_at DESC', async () => {
    // Create another ticket for User A
    const resA2 = await mockRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      headers: { authorization: USER_A_TOKEN },
      body: {
        subject: 'Billing question about subscription',
        description: 'Where can I view my recent invoices?',
        priority: 'normal',
        category: 'billing'
      }
    });
    assert.strictEqual(resA2.status, 201);

    // Create a ticket for User B
    const resB = await mockRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      headers: { authorization: USER_B_TOKEN },
      body: {
        subject: 'User B private issue',
        description: 'This ticket belongs to User B exclusively.',
        priority: 'urgent',
        category: 'account'
      }
    });
    assert.strictEqual(resB.status, 201);

    // User A lists tickets
    const listA = await mockRequest(app, {
      method: 'GET',
      url: '/api/support/tickets',
      headers: { authorization: USER_A_TOKEN }
    });
    assert.strictEqual(listA.status, 200);
    assert.strictEqual(Array.isArray(listA.body), true);
    assert.strictEqual(listA.body.length, 2);
    assert.ok(listA.body.every(t => t.user_id === 'user-stage1-a'));

    // Verify ordering: newest last_message_at first
    const t0 = new Date(listA.body[0].last_message_at).getTime();
    const t1 = new Date(listA.body[1].last_message_at).getTime();
    assert.ok(t0 >= t1, 'Tickets must be ordered by last_message_at DESC');

    // User B lists tickets
    const listB = await mockRequest(app, {
      method: 'GET',
      url: '/api/support/tickets',
      headers: { authorization: USER_B_TOKEN }
    });
    assert.strictEqual(listB.status, 200);
    assert.strictEqual(listB.body.length, 1);
    assert.strictEqual(listB.body[0].user_id, 'user-stage1-b');
    assert.strictEqual(listB.body[0].subject, 'User B private issue');
  });

  // --------------------------------------------------------------------------
  // Scenario 6: Individual Ticket Retrieval with Messages
  // --------------------------------------------------------------------------
  test('Scenario 6: Individual ticket retrieval returns ticket with initial messages', async () => {
    // User A creates ticket
    const createRes = await mockRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      headers: { authorization: USER_A_TOKEN },
      body: {
        subject: 'Feedback on dark mode contrast',
        description: 'The purple accent on dark background could have higher contrast.',
        category: 'feedback'
      }
    });
    assert.strictEqual(createRes.status, 201);
    const ticketId = createRes.body.id;

    // Retrieve ticket detail
    const getRes = await mockRequest(app, {
      method: 'GET',
      url: `/api/support/tickets/${ticketId}`,
      headers: { authorization: USER_A_TOKEN }
    });

    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.id, ticketId);
    assert.strictEqual(getRes.body.subject, 'Feedback on dark mode contrast');
    assert.ok(Array.isArray(getRes.body.messages));
    assert.strictEqual(getRes.body.messages.length, 1);
    assert.strictEqual(getRes.body.messages[0].sender_type, 'user');
    assert.strictEqual(getRes.body.messages[0].author_type, 'customer');
    assert.strictEqual(getRes.body.messages[0].sender_user_id, 'user-stage1-a');
    assert.strictEqual(getRes.body.messages[0].body, 'The purple accent on dark background could have higher contrast.');
  });

  // --------------------------------------------------------------------------
  // Scenario 7: Cross-User Ticket Read Denial (404 Not Found)
  // --------------------------------------------------------------------------
  test('Scenario 7: User B cannot access User A ticket (returns 404 to avoid enumeration)', async () => {
    // User A creates ticket
    const createRes = await mockRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      headers: { authorization: USER_A_TOKEN },
      body: {
        subject: 'Confidential account query',
        description: 'User A private details.'
      }
    });
    const ticketId = createRes.body.id;

    // User B attempts to access User A's ticket
    const unauthorizedGet = await mockRequest(app, {
      method: 'GET',
      url: `/api/support/tickets/${ticketId}`,
      headers: { authorization: USER_B_TOKEN }
    });

    assert.strictEqual(unauthorizedGet.status, 404);
    assert.strictEqual(unauthorizedGet.body.error, 'Ticket not found');
  });

  // --------------------------------------------------------------------------
  // Scenario 8: Cross-User Message Insertion Denial (404 Not Found)
  // --------------------------------------------------------------------------
  test('Scenario 8: User B cannot post message to User A ticket (returns 404)', async () => {
    // User A creates ticket
    const createRes = await mockRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      headers: { authorization: USER_A_TOKEN },
      body: {
        subject: 'User A ticket for message test',
        description: 'Waiting for resolution.'
      }
    });
    const ticketId = createRes.body.id;

    // User B attempts to post message to User A's ticket
    const unauthorizedMsg = await mockRequest(app, {
      method: 'POST',
      url: `/api/support/tickets/${ticketId}/messages`,
      headers: { authorization: USER_B_TOKEN },
      body: { body: 'Malicious injection attempt from User B' }
    });

    assert.strictEqual(unauthorizedMsg.status, 404);
    assert.strictEqual(unauthorizedMsg.body.error, 'Ticket not found');

    // Also verify User B cannot read messages of User A's ticket
    const unauthorizedListMsg = await mockRequest(app, {
      method: 'GET',
      url: `/api/support/tickets/${ticketId}/messages`,
      headers: { authorization: USER_B_TOKEN }
    });
    assert.strictEqual(unauthorizedListMsg.status, 404);
  });

  // --------------------------------------------------------------------------
  // Scenario 9: Client Spoofing Stripped
  // --------------------------------------------------------------------------
  test('Scenario 9: Client-supplied user_id, status, role, and ticket_code are stripped/ignored', async () => {
    const res = await mockRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      headers: { authorization: USER_A_TOKEN },
      body: {
        user_id: 'spoofed-admin-uuid-000',
        userId: 'spoofed-admin-uuid-000',
        user_email: 'ceo@taskly.app',
        status: 'closed',
        role: 'superadmin',
        ticket_code: 'TK-SPOOFED-999',
        subject: 'Security verification ticket',
        description: 'Attempting to inject elevated privileges and custom user ID.'
      }
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.user_id, 'user-stage1-a', 'user_id must come strictly from verified JWT');
    assert.strictEqual(res.body.user_email, 'alice@taskly.app', 'user_email must come strictly from verified JWT');
    assert.strictEqual(res.body.status, 'open', 'status must be open on creation, not client-supplied closed');
    assert.notStrictEqual(res.body.ticket_code, 'TK-SPOOFED-999', 'ticket_code must be server-generated');
  });

  // --------------------------------------------------------------------------
  // Scenario 10: Input Validation
  // --------------------------------------------------------------------------
  test('Scenario 10: Request validation rejects invalid payloads (400 Bad Request)', async () => {
    // 10.1 Missing subject
    const resNoSub = await mockRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      headers: { authorization: USER_A_TOKEN },
      body: { description: 'Body without subject' }
    });
    assert.strictEqual(resNoSub.status, 400);
    assert.ok(resNoSub.body.error.includes('Subject'));

    // 10.2 Subject > 255 chars
    const resLongSub = await mockRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      headers: { authorization: USER_A_TOKEN },
      body: { subject: 'a'.repeat(256), description: 'Valid description' }
    });
    assert.strictEqual(resLongSub.status, 400);

    // 10.3 Missing description
    const resNoDesc = await mockRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      headers: { authorization: USER_A_TOKEN },
      body: { subject: 'Valid subject' }
    });
    assert.strictEqual(resNoDesc.status, 400);
    assert.ok(resNoDesc.body.error.includes('Description'));

    // 10.4 Description > 10000 chars
    const resLongDesc = await mockRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      headers: { authorization: USER_A_TOKEN },
      body: { subject: 'Valid subject', description: 'x'.repeat(10001) }
    });
    assert.strictEqual(resLongDesc.status, 400);

    // 10.5 Invalid category
    const resInvalidCat = await mockRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      headers: { authorization: USER_A_TOKEN },
      body: { subject: 'Valid subject', description: 'Valid description', category: 'invalid_category_xyz' }
    });
    assert.strictEqual(resInvalidCat.status, 400);
    assert.ok(resInvalidCat.body.error.includes('Invalid category'));

    // 10.6 Invalid priority
    const resInvalidPri = await mockRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      headers: { authorization: USER_A_TOKEN },
      body: { subject: 'Valid subject', description: 'Valid description', priority: 'ultra_critical' }
    });
    assert.strictEqual(resInvalidPri.status, 400);
    assert.ok(resInvalidPri.body.error.includes('Invalid priority'));

    // 10.7 Message with empty body
    const createRes = await mockRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      headers: { authorization: USER_A_TOKEN },
      body: { subject: 'Ticket for empty msg test', description: 'Valid initial' }
    });
    const ticketId = createRes.body.id;

    const resEmptyMsg = await mockRequest(app, {
      method: 'POST',
      url: `/api/support/tickets/${ticketId}/messages`,
      headers: { authorization: USER_A_TOKEN },
      body: { body: '   ' }
    });
    assert.strictEqual(resEmptyMsg.status, 400);
  });

  // --------------------------------------------------------------------------
  // Scenario 11: Idempotency Replay and Conflict Handling
  // --------------------------------------------------------------------------
  test('Scenario 11: Idempotency replay returns cached ticket; conflict returns 409', async () => {
    const idempotencyKey = `stage1-idem-${Date.now()}`;
    const payload = {
      subject: 'Idempotency test ticket',
      description: 'First attempt with idempotency key',
      priority: 'normal',
      category: 'general'
    };

    // First request: 201 Created
    const res1 = await mockRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      headers: {
        authorization: USER_A_TOKEN,
        'idempotency-key': idempotencyKey
      },
      body: payload
    });
    assert.strictEqual(res1.status, 201);
    const originalTicketId = res1.body.id;

    // Second request with IDENTICAL payload: replay returns 200 with original ticket
    const res2 = await mockRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      headers: {
        authorization: USER_A_TOKEN,
        'idempotency-key': idempotencyKey
      },
      body: payload
    });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.body.id, originalTicketId);
    assert.strictEqual(res2.body.is_replay, true);

    // Third request with DIFFERENT payload and SAME idempotency key: 409 Conflict
    const res3 = await mockRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      headers: {
        authorization: USER_A_TOKEN,
        'idempotency-key': idempotencyKey
      },
      body: {
        subject: 'TAMPERED subject with same idempotency key',
        description: 'Payload is different now.',
        priority: 'urgent',
        category: 'bug'
      }
    });
    assert.strictEqual(res3.status, 409);
    assert.ok(res3.body.error.includes('Idempotency conflict'));

    // Message-level idempotency test
    const msgIdemKey = `stage1-msg-idem-${Date.now()}`;
    const msgPayload = { body: 'Idempotent message content' };

    const msgRes1 = await mockRequest(app, {
      method: 'POST',
      url: `/api/support/tickets/${originalTicketId}/messages`,
      headers: {
        authorization: USER_A_TOKEN,
        'idempotency-key': msgIdemKey
      },
      body: msgPayload
    });
    assert.strictEqual(msgRes1.status, 201);
    const originalMessageId = msgRes1.body.id;

    // Message replay with same key and payload
    const msgRes2 = await mockRequest(app, {
      method: 'POST',
      url: `/api/support/tickets/${originalTicketId}/messages`,
      headers: {
        authorization: USER_A_TOKEN,
        'idempotency-key': msgIdemKey
      },
      body: msgPayload
    });
    assert.strictEqual(msgRes2.status, 200);
    assert.strictEqual(msgRes2.body.id, originalMessageId);
    assert.strictEqual(msgRes2.body.is_replay, true);

    // Message conflict with same key and different payload
    const msgRes3 = await mockRequest(app, {
      method: 'POST',
      url: `/api/support/tickets/${originalTicketId}/messages`,
      headers: {
        authorization: USER_A_TOKEN,
        'idempotency-key': msgIdemKey
      },
      body: { body: 'DIFFERENT message content with reused key' }
    });
    assert.strictEqual(msgRes3.status, 409);
    assert.ok(msgRes3.body.error.includes('Idempotency conflict'));
  });

  // --------------------------------------------------------------------------
  // Scenario 12: Closed Ticket Message Rejection & Message Appending
  // --------------------------------------------------------------------------
  test('Scenario 12: Customer can add messages to open tickets; rejected on closed tickets (400)', async () => {
    // 12.1 Create open ticket
    const createRes = await mockRequest(app, {
      method: 'POST',
      url: '/api/support/tickets',
      headers: { authorization: USER_A_TOKEN },
      body: {
        subject: 'Message lifecycle test ticket',
        description: 'First message.'
      }
    });
    const ticketId = createRes.body.id;

    // 12.2 User A appends a message to their open ticket
    const addMsgRes = await mockRequest(app, {
      method: 'POST',
      url: `/api/support/tickets/${ticketId}/messages`,
      headers: { authorization: USER_A_TOKEN },
      body: { body: 'Here is additional diagnostic information.' }
    });
    assert.strictEqual(addMsgRes.status, 201);
    assert.strictEqual(addMsgRes.body.body, 'Here is additional diagnostic information.');
    assert.strictEqual(addMsgRes.body.author_type, 'customer');

    // 12.3 Verify messages list contains both initial and newly appended messages
    const listMsgRes = await mockRequest(app, {
      method: 'GET',
      url: `/api/support/tickets/${ticketId}/messages`,
      headers: { authorization: USER_A_TOKEN }
    });
    assert.strictEqual(listMsgRes.status, 200);
    assert.strictEqual(listMsgRes.body.length, 2);

    // 12.4 Close ticket using storage adapter status helper
    await testAdapter.updateTicketStatus(ticketId, 'closed');

    // 12.5 Attempt to append message to closed ticket -> 400 Bad Request
    const closedPostRes = await mockRequest(app, {
      method: 'POST',
      url: `/api/support/tickets/${ticketId}/messages`,
      headers: { authorization: USER_A_TOKEN },
      body: { body: 'Attempting to message closed ticket.' }
    });
    assert.strictEqual(closedPostRes.status, 400);
    assert.ok(closedPostRes.body.error.includes('closed'));
  });
});
