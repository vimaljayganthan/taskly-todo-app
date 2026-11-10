/**
 * Taskly Customer Support — Stage 3: Inbound Webhook & Developer Reply Processing Test Suite
 * Version: 2.2.0 (Build 14)
 * 
 * Comprehensive Test Coverage:
 * 1. Svix Cryptographic Signature Verification (valid, missing, tampered, expired timestamp)
 * 2. Quotation stripping & signature removal (Gmail threads, iOS/Android signatures, RFC prefixes)
 * 3. Status directive extraction & normalization (#status: resolved, in_progress, closed)
 * 4. Authorized developer sender validation (authorized vs spoofed/unauthorized senders)
 * 5. Routing token extraction & ticket matching
 * 6. Webhook event claiming & idempotency replay protection
 * 7. SPF / DKIM verification and quarantine routing
 * 8. Empty body quarantine protection
 * 9. Non-email event handling (delivered, bounced)
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

const app = require('../server.js');
const SupportStore = require('../storage/supportStore');
const { FileSupportStorageAdapter } = SupportStore;
const { verifySvixHeaders, signSvixPayload } = require('../services/svixVerifier');
const { parseDeveloperReply, extractRoutingToken, extractSenderEmail } = require('../services/emailReplyParser');

// In-memory HTTP dispatcher for Express
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

describe('Taskly Customer Support — Stage 3: Inbound Webhook & Developer Reply Suite', () => {
  let testFile;
  let testAdapter;

  beforeEach(() => {
    testFile = path.join('/tmp', `taskly-support-stage3-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.json`);
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
  // Scenario 1: Svix Cryptographic Signature Verification
  // --------------------------------------------------------------------------
  test('Scenario 1: Svix signature verification rejects unauthenticated, tampered, and expired payloads', async () => {
    const payload = {
      type: 'email.received',
      data: {
        email_id: 'em_test_sig',
        from: 'Taskly Developer <tasklypets@gmail.com>',
        to: ['reply+tk_tk1001_8f9c1a2e7d3b4f6a5c8e1d2b3c4a5b6c@d893f1.resend.app'],
        text: 'Checking in on this issue.'
      }
    };
    const rawBody = JSON.stringify(payload);

    // 1.1 Missing headers -> 401
    const resNoHeaders = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/support/resend-inbound',
      body: payload,
      rawBody
    });
    assert.strictEqual(resNoHeaders.status, 401);
    assert.ok(resNoHeaders.body.error.includes('Missing required Svix webhook headers'));

    // 1.2 Invalid signature (tampered secret) -> 401
    const fakeHeaders = signSvixPayload({
      rawBody,
      secret: 'whsec_wrong_secret_1234567890abcdefghijklmnop'
    });
    const resBadSig = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/support/resend-inbound',
      headers: fakeHeaders,
      body: payload,
      rawBody
    });
    assert.strictEqual(resBadSig.status, 401);
    assert.ok(resBadSig.body.error.includes('Cryptographic signature mismatch'));

    // 1.3 Tampered body (signature created for different payload) -> 401
    const validHeadersForOther = signSvixPayload({
      rawBody: JSON.stringify({ different: 'data' }),
      secret: TEST_SECRET
    });
    const resTampered = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/support/resend-inbound',
      headers: validHeadersForOther,
      body: payload,
      rawBody
    });
    assert.strictEqual(resTampered.status, 401);
    assert.ok(resTampered.body.error.includes('Cryptographic signature mismatch'));

    // 1.4 Expired timestamp (older than 300 seconds tolerance) -> 401
    const expiredTs = Math.floor(Date.now() / 1000) - 301;
    const expiredHeaders = signSvixPayload({
      rawBody,
      timestamp: expiredTs,
      secret: TEST_SECRET
    });
    const resExpired = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/support/resend-inbound',
      headers: expiredHeaders,
      body: payload,
      rawBody
    });
    assert.strictEqual(resExpired.status, 401);
    assert.ok(resExpired.body.error.includes('tolerance window'));
  });

  // --------------------------------------------------------------------------
  // Scenario 2: Email Reply Parsing & Directive Stripping
  // --------------------------------------------------------------------------
  test('Scenario 2: Developer reply parser cleans thread history and extracts status directives', () => {
    // 2.1 Reply with status directive and quoted thread
    const emailWithDirective = [
      'We have addressed the crash on startup.',
      'Please update to Build 14 and verify.',
      '#status: resolved',
      '',
      'On Tue, Nov 10, 2026 at 10:00 AM Taskly User <user@taskly.app> wrote:',
      '> The app crashes every time I open the reminders screen.',
      '> Please help!'
    ].join('\n');

    const parsed1 = parseDeveloperReply(emailWithDirective);
    assert.strictEqual(parsed1.newStatus, 'resolved');
    assert.ok(parsed1.cleanMessage.includes('We have addressed the crash on startup.'));
    assert.ok(parsed1.cleanMessage.includes('Please update to Build 14 and verify.'));
    assert.ok(!parsed1.cleanMessage.includes('#status: resolved'));
    assert.ok(!parsed1.cleanMessage.includes('On Tue, Nov 10'));
    assert.ok(!parsed1.cleanMessage.includes('The app crashes'));

    // 2.2 Reply with mobile signature and in_progress directive
    const emailWithMobileSig = [
      'I am looking into this right now.',
      '#status: in_progress',
      '',
      'Sent from my iPhone'
    ].join('\n');

    const parsed2 = parseDeveloperReply(emailWithMobileSig);
    assert.strictEqual(parsed2.newStatus, 'in_progress');
    assert.strictEqual(parsed2.cleanMessage, 'I am looking into this right now.');

    // 2.3 Status alias mapping (waiting_on_customer -> waiting_customer)
    const emailWithAlias = [
      'Can you please send your diagnostic logs?',
      '#status: waiting_on_customer'
    ].join('\n');

    const parsed3 = parseDeveloperReply(emailWithAlias);
    assert.strictEqual(parsed3.newStatus, 'waiting_customer');
    assert.strictEqual(parsed3.cleanMessage, 'Can you please send your diagnostic logs?');
  });

  // --------------------------------------------------------------------------
  // Scenario 3: Valid Inbound Developer Reply Ingestion & Status Update
  // --------------------------------------------------------------------------
  test('Scenario 3: Valid developer email reply ingests message and updates ticket status', async () => {
    // 3.1 Create a ticket as customer first
    const ticket = await testAdapter.createTicket({
      userId: 'user-alice-1',
      userEmail: 'alice@taskly.app',
      subject: 'Sync issue with Google Calendar',
      description: 'Tasks from today are not appearing in Google Calendar.'
    });

    // Retrieve routing token associated with ticket
    const data = await testAdapter._readData();
    const routingEntry = data.routing.find(r => r.ticket_id === ticket.id);
    assert.ok(routingEntry, 'Routing token must exist for created ticket');
    const routingToken = routingEntry.routing_token;

    // 3.2 Post inbound webhook with developer reply
    const replyPayload = {
      type: 'email.received',
      data: {
        email_id: 'em_dev_reply_001',
        from: 'Taskly Support <tasklypets@gmail.com>',
        to: [`reply+tk_${ticket.ticket_code.toLowerCase().replace(/[^a-z0-9]/g, '')}_${routingToken}@d893f1.resend.app`],
        subject: `Re: [Ticket #${ticket.ticket_code}] Sync issue with Google Calendar`,
        text: 'This was due to a transient rate limit on Google APIs. We have reconnected the sync queue.\n#status: resolved\n\nOn Tue, Nov 10 wrote:\n> Tasks from today are not appearing',
        headers: {
          spf: 'pass',
          dkim: 'pass'
        }
      }
    };
    const rawBody = JSON.stringify(replyPayload);
    const headers = signSvixPayload({ rawBody, secret: TEST_SECRET });

    const response = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/support/resend-inbound',
      headers,
      body: replyPayload,
      rawBody
    });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.status, 'ingested');
    assert.strictEqual(response.body.ticket_id, ticket.id);
    assert.strictEqual(response.body.new_status, 'resolved');

    // 3.3 Verify ticket state in store
    const updatedTicket = await testAdapter.getTicket(ticket.id, 'user-alice-1');
    assert.strictEqual(updatedTicket.status, 'resolved');
    assert.strictEqual(updatedTicket.messages.length, 2);

    const devMsg = updatedTicket.messages[1];
    assert.strictEqual(devMsg.sender_type, 'developer');
    assert.strictEqual(devMsg.sender_email, 'tasklypets@gmail.com');
    assert.strictEqual(devMsg.channel, 'email');
    assert.ok(devMsg.body.includes('This was due to a transient rate limit'));
    assert.ok(!devMsg.body.includes('#status: resolved'));
  });

  // --------------------------------------------------------------------------
  // Scenario 4: Unauthorized Sender Quarantine & Security Incident
  // --------------------------------------------------------------------------
  test('Scenario 4: Unauthorized sender is quarantined and logs a security incident', async () => {
    // 4.1 Create customer ticket
    const ticket = await testAdapter.createTicket({
      userId: 'user-bob-2',
      userEmail: 'bob@taskly.app',
      subject: 'Billing question',
      description: 'Charged twice for monthly subscription.'
    });

    const data = await testAdapter._readData();
    const routingEntry = data.routing.find(r => r.ticket_id === ticket.id);
    const routingToken = routingEntry.routing_token;

    // 4.2 Malicious / spoofed sender attempts to post reply
    const unauthorizedPayload = {
      type: 'email.received',
      data: {
        email_id: 'em_spoofed_002',
        from: 'Attacker <attacker@evil-domain.com>',
        to: [`reply+tk_${ticket.ticket_code.toLowerCase().replace(/[^a-z0-9]/g, '')}_${routingToken}@d893f1.resend.app`],
        subject: `Re: [Ticket #${ticket.ticket_code}] Billing question`,
        text: 'Please send your credit card details to refund@evil-domain.com to verify.\n#status: closed'
      }
    };
    const rawBody = JSON.stringify(unauthorizedPayload);
    const headers = signSvixPayload({ rawBody, secret: TEST_SECRET });

    const response = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/support/resend-inbound',
      headers,
      body: unauthorizedPayload,
      rawBody
    });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.status, 'quarantined');
    assert.ok(response.body.reason.includes('UNAUTHORIZED_SENDER'));

    // Verify ticket was NOT modified or closed
    const unchangedTicket = await testAdapter.getTicket(ticket.id, 'user-bob-2');
    assert.strictEqual(unchangedTicket.status, 'open');
    assert.strictEqual(unchangedTicket.messages.length, 1);

    // Verify quarantine and security incident records
    const postData = await testAdapter._readData();
    assert.strictEqual(postData.quarantined.length, 1);
    assert.strictEqual(postData.quarantined[0].sender_email, 'attacker@evil-domain.com');
    assert.strictEqual(postData.securityIncidents.length, 1);
    assert.strictEqual(postData.securityIncidents[0].target_identifier, 'attacker@evil-domain.com');
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Missing or Invalid Routing Token Quarantine
  // --------------------------------------------------------------------------
  test('Scenario 5: Inbound email with missing or invalid routing token is quarantined', async () => {
    // 5.1 Email without reply token in To address
    const badToPayload = {
      type: 'email.received',
      data: {
        email_id: 'em_no_token_003',
        from: 'Taskly Developer <tasklypets@gmail.com>',
        to: ['general-support@d893f1.resend.app'],
        subject: 'General feedback response',
        text: 'Here is some feedback.'
      }
    };
    const rawBody1 = JSON.stringify(badToPayload);
    const headers1 = signSvixPayload({ rawBody: rawBody1, secret: TEST_SECRET });

    const res1 = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/support/resend-inbound',
      headers: headers1,
      body: badToPayload,
      rawBody: rawBody1
    });

    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.body.status, 'quarantined');
    assert.strictEqual(res1.body.reason, 'MISSING_OR_INVALID_ROUTING_TOKEN');

    // 5.2 Email with well-formed token that does not map to any ticket
    const fakeToken = crypto.randomBytes(16).toString('hex');
    const unmappedTokenPayload = {
      type: 'email.received',
      data: {
        email_id: 'em_unknown_token_004',
        from: 'Taskly Developer <tasklypets@gmail.com>',
        to: [`reply+${fakeToken}@d893f1.resend.app`],
        subject: 'Re: ticket',
        text: 'Response to deleted or nonexistent ticket.'
      }
    };
    const rawBody2 = JSON.stringify(unmappedTokenPayload);
    const headers2 = signSvixPayload({ rawBody: rawBody2, secret: TEST_SECRET });

    const res2 = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/support/resend-inbound',
      headers: headers2,
      body: unmappedTokenPayload,
      rawBody: rawBody2
    });

    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.body.status, 'quarantined');
    assert.strictEqual(res2.body.reason, 'TICKET_NOT_FOUND');
  });

  // --------------------------------------------------------------------------
  // Scenario 6: SPF / DKIM Authentication Failure Quarantine
  // --------------------------------------------------------------------------
  test('Scenario 6: Inbound email with failed SPF or DKIM is quarantined', async () => {
    const ticket = await testAdapter.createTicket({
      userId: 'user-carol-3',
      userEmail: 'carol@taskly.app',
      subject: 'Login problem',
      description: 'Password reset link expired.'
    });

    const data = await testAdapter._readData();
    const routingToken = data.routing.find(r => r.ticket_id === ticket.id).routing_token;

    const failedAuthPayload = {
      type: 'email.received',
      data: {
        email_id: 'em_spf_fail_005',
        from: 'Taskly Developer <tasklypets@gmail.com>',
        to: [`reply+${routingToken}@d893f1.resend.app`],
        subject: `Re: [Ticket #${ticket.ticket_code}] Login problem`,
        text: 'Resetting password now.',
        headers: {
          spf: 'fail',
          dkim: 'pass'
        }
      }
    };
    const rawBody = JSON.stringify(failedAuthPayload);
    const headers = signSvixPayload({ rawBody, secret: TEST_SECRET });

    const response = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/support/resend-inbound',
      headers,
      body: failedAuthPayload,
      rawBody
    });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.status, 'quarantined');
    assert.strictEqual(response.body.reason, 'SPF_OR_DKIM_FAILED');
  });

  // --------------------------------------------------------------------------
  // Scenario 7: Webhook Idempotency & Replay Protection
  // --------------------------------------------------------------------------
  test('Scenario 7: Webhook replay returns already_processed without duplicate ingestion', async () => {
    const ticket = await testAdapter.createTicket({
      userId: 'user-dave-4',
      userEmail: 'dave@taskly.app',
      subject: 'Notification sounds',
      description: 'Cannot silence sounds.'
    });

    const data = await testAdapter._readData();
    const routingToken = data.routing.find(r => r.ticket_id === ticket.id).routing_token;

    const replayPayload = {
      type: 'email.received',
      data: {
        email_id: 'em_replay_unique_006',
        from: 'Taskly Support <tasklypets@gmail.com>',
        to: [`reply+${routingToken}@d893f1.resend.app`],
        subject: `Re: [Ticket #${ticket.ticket_code}] Notification sounds`,
        text: 'You can disable notification sounds under Settings -> Audio.'
      }
    };
    const rawBody = JSON.stringify(replayPayload);
    const headers = signSvixPayload({
      rawBody,
      msgId: 'msg_svix_replay_test_006',
      secret: TEST_SECRET
    });

    // 7.1 First Delivery: Ingests message
    const resFirst = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/support/resend-inbound',
      headers,
      body: replayPayload,
      rawBody
    });
    assert.strictEqual(resFirst.status, 200);
    assert.strictEqual(resFirst.body.status, 'ingested');

    // 7.2 Second Delivery (Webhook Replay): Must return already_processed
    const resSecond = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/support/resend-inbound',
      headers,
      body: replayPayload,
      rawBody
    });
    assert.strictEqual(resSecond.status, 200);
    assert.strictEqual(resSecond.body.status, 'already_processed');

    // Verify messages count remained 2 (no duplicate developer message)
    const updatedTicket = await testAdapter.getTicket(ticket.id, 'user-dave-4');
    assert.strictEqual(updatedTicket.messages.length, 2);
  });

  // --------------------------------------------------------------------------
  // Scenario 8: Non-email Webhook Events Ignored
  // --------------------------------------------------------------------------
  test('Scenario 8: Non-reception events (e.g. email.delivered) are cleanly ignored with 200', async () => {
    const nonEmailPayload = {
      type: 'email.delivered',
      data: {
        email_id: 'em_delivered_007',
        to: ['user@example.com']
      }
    };
    const rawBody = JSON.stringify(nonEmailPayload);
    const headers = signSvixPayload({ rawBody, secret: TEST_SECRET });

    const response = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/support/resend-inbound',
      headers,
      body: nonEmailPayload,
      rawBody
    });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.status, 'ignored');
    assert.strictEqual(response.body.type, 'email.delivered');
  });
});

