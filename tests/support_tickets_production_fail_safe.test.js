/**
 * Taskly Customer Support — Production Fail-Safe & Outbox Error Visibility Suite
 * Version: 2.2.0 (Build 14)
 * 
 * Verifies production fail-safe guarantees:
 * 1. Outbox storage fails closed in production / Vercel when Supabase credentials are missing.
 * 2. Outbox storage strictly forbids FileOutboxStore fallback in production.
 * 3. Email provider fails closed in production / Vercel when Resend credentials are missing or mock.
 * 4. Email provider strictly forbids MockEmailProvider in production.
 * 5. Vercel environment flags (VERCEL, VERCEL_ENV) trigger production fail-closed behavior.
 * 6. Local development and test environments preserve mock and file-based adapters.
 * 7. OutboxWorker propagates infrastructure / database failures rather than swallowing them.
 * 8. OutboxWorker sweepTimeouts propagates failures rather than returning 0.
 * 9. HTTP endpoints (/api/internal/support/outbox/process, /sweep, /metrics) return 500 on failure
 *    and 200 with accurate payloads on success.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const fs = require('fs');

const { getOutboxConfig, validateOutboxConfig, getMaskedConfig } = require('../config/outboxConfig');
const { getOutboxStore, setOutboxStore, resetOutboxStore, FileOutboxStore, SupabaseOutboxStore } = require('../services/outboxStore');
const { getEmailProvider, setEmailProvider, resetEmailProvider, MockEmailProvider, ResendEmailProvider } = require('../services/emailProvider');
const { OutboxWorker } = require('../services/outboxWorker');
const app = require('../server');

function dispatchRequest(options) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = (options.method || 'GET').toUpperCase();
    req.url = options.url || '/';
    req.headers = Object.assign({ 'content-type': 'application/json' }, options.headers || {});
    req.body = options.body;

    const res = new EventEmitter();
    res.statusCode = 200;
    res._headers = {};
    res.setHeader = (k, v) => { res._headers[k.toLowerCase()] = v; };
    res.getHeader = (k) => res._headers[k.toLowerCase()];
    res.status = (code) => { res.statusCode = code; return res; };

    res.json = (data) => {
      resolve({ status: res.statusCode, headers: res._headers, body: data });
    };
    res.send = (data) => {
      resolve({ status: res.statusCode, headers: res._headers, body: data });
    };
    res.end = (data) => {
      resolve({ status: res.statusCode, headers: res._headers, body: data });
    };

    app.handle(req, res, reject);
  });
}

describe('Taskly Customer Support — Production Fail-Safe Suite', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.SUPPORT_EMAIL_WORKFLOW_ENABLED = 'true';
    delete process.env.CRON_SECRET;
    resetOutboxStore();
    resetEmailProvider();
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
    resetOutboxStore();
    resetEmailProvider();
  });

  // --------------------------------------------------------------------------
  // 1. Production with Missing Supabase URL
  // --------------------------------------------------------------------------
  test('1. Production fails closed when SUPABASE_URL is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_secret_key_123';

    assert.throws(
      () => getOutboxStore(),
      /Missing Supabase configuration in production.*SUPABASE_URL/i
    );
  });

  // --------------------------------------------------------------------------
  // 2. Production with Missing Service-Role Key
  // --------------------------------------------------------------------------
  test('2. Production fails closed when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    process.env.SUPABASE_URL = 'https://prod-supabase.taskly.app';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    assert.throws(
      () => getOutboxStore(),
      /Missing Supabase configuration in production.*SUPABASE_SERVICE_ROLE_KEY/i
    );
  });

  // --------------------------------------------------------------------------
  // 2b. Production Never Falls Back to FileOutboxStore
  // --------------------------------------------------------------------------
  test('2b. FileOutboxStore cannot be instantiated or used in production', () => {
    process.env.NODE_ENV = 'production';
    assert.throws(
      () => new FileOutboxStore(),
      /FileOutboxStore cannot be used in production/i
    );

    // Setting an active FileOutboxStore is also rejected
    process.env.NODE_ENV = 'test';
    const fileStore = new FileOutboxStore();
    process.env.NODE_ENV = 'production';
    setOutboxStore(fileStore);
    assert.throws(
      () => getOutboxStore(),
      /FileOutboxStore is strictly prohibited in production/i
    );
  });

  // --------------------------------------------------------------------------
  // 3. Production with Missing Resend API Key
  // --------------------------------------------------------------------------
  test('3. Production fails closed when RESEND_API_KEY is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.RESEND_API_KEY;

    assert.throws(
      () => getEmailProvider(),
      /Missing Resend API key in production/i
    );

    const config = getOutboxConfig();
    const validation = validateOutboxConfig(config);
    assert.strictEqual(validation.valid, false);
    assert.ok(validation.errors.some(e => e.includes('RESEND_API_KEY is required in production')));
  });

  // --------------------------------------------------------------------------
  // 4. Production with a Mock Resend Key
  // --------------------------------------------------------------------------
  test('4. Production rejects mock Resend API keys', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    process.env.RESEND_API_KEY = 're_mock_test_key_12345';

    assert.throws(
      () => getEmailProvider(),
      /Mock Resend API key is prohibited in production/i
    );

    assert.throws(
      () => new ResendEmailProvider({ apiKey: 're_mock_key' }),
      /Mock Resend API key is prohibited in production/i
    );

    const config = getOutboxConfig();
    const validation = validateOutboxConfig(config);
    assert.strictEqual(validation.valid, false);
    assert.ok(validation.errors.some(e => e.includes('must not be a mock key')));
  });

  // --------------------------------------------------------------------------
  // 4b. Production Prohibits MockEmailProvider
  // --------------------------------------------------------------------------
  test('4b. MockEmailProvider cannot be instantiated or forced in production', () => {
    process.env.NODE_ENV = 'production';
    assert.throws(
      () => new MockEmailProvider(),
      /MockEmailProvider cannot be used in production/i
    );

    assert.throws(
      () => getEmailProvider({ forceMock: true }),
      /forceMock is strictly prohibited in production/i
    );
  });

  // --------------------------------------------------------------------------
  // 5. Vercel Environment Detection
  // --------------------------------------------------------------------------
  test('5. Vercel environment flags enforce production fail-closed behavior', () => {
    process.env.NODE_ENV = 'development';
    process.env.VERCEL = '1';

    const config = getOutboxConfig();
    assert.strictEqual(config.isProduction, true);
    assert.strictEqual(config.isVercel, true);

    // Missing Supabase service role key throws in Vercel
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.throws(
      () => getOutboxStore(),
      /Missing Supabase configuration in production/i
    );

    // Missing Resend key throws in Vercel
    delete process.env.RESEND_API_KEY;
    assert.throws(
      () => getEmailProvider(),
      /Missing Resend API key in production/i
    );

    // Test with VERCEL_ENV='preview'
    delete process.env.VERCEL;
    process.env.VERCEL_ENV = 'preview';
    assert.throws(
      () => getOutboxStore(),
      /Missing Supabase configuration in production/i
    );
  });

  // --------------------------------------------------------------------------
  // 6. Development / Test Mock Provider Compatibility
  // --------------------------------------------------------------------------
  test('6. Development and test environments cleanly default to mock and file adapters', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.RESEND_API_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const emailProvider = getEmailProvider();
    assert.ok(emailProvider instanceof MockEmailProvider);

    const sent = await emailProvider.sendEmail({
      from: 'test@taskly.app',
      to: 'recipient@taskly.app',
      subject: 'Dev Test',
      html: '<p>Test</p>',
      text: 'Test'
    });

    assert.strictEqual(sent.success, true);
    assert.strictEqual(sent.provider, 'mock');

    const store = getOutboxStore();
    assert.ok(store instanceof FileOutboxStore);
  });

  // --------------------------------------------------------------------------
  // 7. Outbox Worker Infrastructure Failure Propagation
  // --------------------------------------------------------------------------
  test('7. OutboxWorker.processBatch propagates database / infrastructure errors', async () => {
    const failingStore = {
      claimBatch: async () => {
        throw new Error('Supabase database connection failed: ECONNREFUSED');
      }
    };
    const mockEmail = new MockEmailProvider();
    const worker = new OutboxWorker({
      outboxStore: failingStore,
      emailProvider: mockEmail
    });

    await assert.rejects(
      async () => await worker.processBatch(),
      /Supabase database connection failed: ECONNREFUSED/
    );
  });

  // --------------------------------------------------------------------------
  // 7b. Process Endpoint Returns Non-2xx on Batch Execution Failure
  // --------------------------------------------------------------------------
  test('7b. POST /api/internal/support/outbox/process returns HTTP 500 on batch failure', async () => {
    const failingStore = {
      claimBatch: async () => {
        throw new Error('PostgreSQL RPC mark_outbox_failure timeout');
      }
    };
    setOutboxStore(failingStore);

    const res = await dispatchRequest({
      method: 'POST',
      url: '/api/internal/support/outbox/process'
    });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.error.includes('PostgreSQL RPC mark_outbox_failure timeout'));
  });

  // --------------------------------------------------------------------------
  // 8. Sweep Failure Propagation
  // --------------------------------------------------------------------------
  test('8. OutboxWorker.sweepTimeouts propagates database errors rather than returning 0', async () => {
    const failingStore = {
      sweepAmbiguousTimeouts: async () => {
        throw new Error('Database disk full: cannot sweep ambiguous timeouts');
      }
    };
    const mockEmail = new MockEmailProvider();
    const worker = new OutboxWorker({
      outboxStore: failingStore,
      emailProvider: mockEmail
    });

    await assert.rejects(
      async () => await worker.sweepTimeouts(),
      /Database disk full: cannot sweep ambiguous timeouts/
    );
  });

  // --------------------------------------------------------------------------
  // 8b. Sweep Endpoint Returns Non-2xx on Failure
  // --------------------------------------------------------------------------
  test('8b. POST /api/internal/support/outbox/sweep returns HTTP 500 on sweep failure', async () => {
    const failingStore = {
      sweepAmbiguousTimeouts: async () => {
        throw new Error('Dead-letter queue lock conflict');
      }
    };
    setOutboxStore(failingStore);

    const res = await dispatchRequest({
      method: 'POST',
      url: '/api/internal/support/outbox/sweep'
    });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.error.includes('Dead-letter queue lock conflict'));
  });

  // --------------------------------------------------------------------------
  // 9. Successful Process, Sweep, and Metrics Endpoints
  // --------------------------------------------------------------------------
  test('9. Internal outbox endpoints report success on valid execution', async () => {
    const mockStore = {
      claimBatch: async () => [],
      sweepAmbiguousTimeouts: async () => 3,
      getMetrics: async () => ({
        pending: 1,
        processing: 0,
        sending: 0,
        ambiguous_processing: 0,
        sent: 5,
        failed: 0,
        ambiguous_delivery_timeout: 0,
        total: 6
      })
    };
    setOutboxStore(mockStore);
    setEmailProvider(new MockEmailProvider());

    // 1. Process
    const processRes = await dispatchRequest({
      method: 'POST',
      url: '/api/internal/support/outbox/process'
    });
    assert.strictEqual(processRes.status, 200);
    assert.strictEqual(processRes.body.success, true);
    assert.strictEqual(processRes.body.processed, 0);

    // 2. Sweep
    const sweepRes = await dispatchRequest({
      method: 'POST',
      url: '/api/internal/support/outbox/sweep'
    });
    assert.strictEqual(sweepRes.status, 200);
    assert.strictEqual(sweepRes.body.success, true);
    assert.strictEqual(sweepRes.body.sweptTimeouts, 3);

    // 3. Metrics
    const metricsRes = await dispatchRequest({
      method: 'GET',
      url: '/api/internal/support/outbox/metrics'
    });
    assert.strictEqual(metricsRes.status, 200);
    assert.strictEqual(metricsRes.body.success, true);
    assert.strictEqual(metricsRes.body.queue.sent, 5);
    assert.strictEqual(metricsRes.body.queue.pending, 1);
  });

  // --------------------------------------------------------------------------
  // 10. Metrics Endpoint Returns Non-2xx on Database Failure
  // --------------------------------------------------------------------------
  test('10. GET /api/internal/support/outbox/metrics returns HTTP 500 on query error', async () => {
    const failingStore = {
      getMetrics: async () => {
        throw new Error('Supabase client query aborted');
      }
    };
    setOutboxStore(failingStore);

    const res = await dispatchRequest({
      method: 'GET',
      url: '/api/internal/support/outbox/metrics'
    });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.error.includes('Supabase client query aborted'));
  });

  // --------------------------------------------------------------------------
  // 11. Inbound Email Defaults to Disabled in Production (Zero Hard-Coded Fallback)
  // --------------------------------------------------------------------------
  test('11. Inbound email defaults to disabled in production with zero hard-coded fallback domain', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.SUPPORT_INBOUND_EMAIL_ENABLED;
    delete process.env.RESEND_RECEIVING_DOMAIN;

    const config = getOutboxConfig();
    assert.strictEqual(config.isProduction, true);
    assert.strictEqual(config.inboundEmailEnabled, false, 'Must default to disabled in production');
    assert.strictEqual(config.receivingDomain, null, 'Must not use hard-coded production domain fallback');
  });

  // --------------------------------------------------------------------------
  // 12. Disabled Webhook Requests Return HTTP 503 Without Reaching Svix or DB
  // --------------------------------------------------------------------------
  test('12. POST /api/support/resend-inbound returns HTTP 503 when inbound email is disabled', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SUPPORT_INBOUND_EMAIL_ENABLED; // Defaults to disabled
    delete process.env.RESEND_WEBHOOK_SECRET; // No secret needed; fails before Svix verification

    const res = await dispatchRequest({
      method: 'POST',
      url: '/api/support/resend-inbound',
      body: { type: 'email.received', data: { from: 'attacker@evil.com' } }
    });

    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.disabled, true);
    assert.strictEqual(res.body.code, 'INBOUND_EMAIL_DISABLED');
    assert.strictEqual(res.body.error, 'Inbound email processing is disabled');
  });

  // --------------------------------------------------------------------------
  // 13. Enabled Inbound Email Requires an Explicitly Configured Receiving Domain
  // --------------------------------------------------------------------------
  test('13. Enabled inbound email requires an explicitly configured receiving domain in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.SUPPORT_INBOUND_EMAIL_ENABLED = 'true';
    process.env.RESEND_API_KEY = 're_live_test_valid_key';
    process.env.RESEND_SENDER_EMAIL = 'support@taskly.app';
    delete process.env.RESEND_RECEIVING_DOMAIN;

    const configWithoutDomain = getOutboxConfig();
    assert.strictEqual(configWithoutDomain.inboundEmailEnabled, true);
    assert.strictEqual(configWithoutDomain.receivingDomain, null);

    const validationFailed = validateOutboxConfig(configWithoutDomain);
    assert.strictEqual(validationFailed.valid, false);
    assert.ok(
      validationFailed.errors.some(e => e.includes('RESEND_RECEIVING_DOMAIN is required and must be a valid domain')),
      'Must require receiving domain when enabled in production'
    );

    // When valid receiving domain is provided
    process.env.RESEND_RECEIVING_DOMAIN = 'inbound.taskly.app';
    const configWithDomain = getOutboxConfig();
    const validationSuccess = validateOutboxConfig(configWithDomain);
    assert.strictEqual(validationSuccess.valid, true);
  });

  // --------------------------------------------------------------------------
  // 14. In-App Ticket Creation and Messaging Still Work When Inbound Email Is Disabled
  // --------------------------------------------------------------------------
  test('14. In-app ticket creation and messaging continue working seamlessly when inbound email is disabled', async () => {
    const SupportStore = require('../storage/supportStore');
    const { FileSupportStorageAdapter } = SupportStore;
    const testFile = `/tmp/test_in_app_${Date.now()}_${Math.random().toString(36).substring(2)}.json`;

    process.env.NODE_ENV = 'test';
    process.env.SUPPORT_INBOUND_EMAIL_ENABLED = 'false';
    delete process.env.RESEND_RECEIVING_DOMAIN;

    const adapter = new FileSupportStorageAdapter(testFile);
    try {
      // 1. Customer creates ticket
      const ticket = await adapter.createTicket({
        userId: '11111111-1111-1111-1111-111111111111',
        userEmail: 'customer@taskly.app',
        subject: 'Cannot sync routines offline',
        description: 'Offline sync failed after battery saver enabled',
        category: 'bug',
        priority: 'high'
      });

      assert.ok(ticket.id);
      assert.ok(ticket.ticket_code.startsWith('TK-'));
      assert.strictEqual(ticket.status, 'open');

      // 2. Customer adds follow-up message
      const msg = await adapter.addMessage({
        ticketId: ticket.id,
        userId: '11111111-1111-1111-1111-111111111111',
        userEmail: 'customer@taskly.app',
        body: 'Follow-up: Also observed on Android 14'
      });

      assert.ok(msg.id);
      assert.strictEqual(msg.ticket_id, ticket.id);

      // 3. Conversation history retrieval
      const messages = await adapter.getMessages(ticket.id, '11111111-1111-1111-1111-111111111111');
      assert.strictEqual(messages.length, 2);
      assert.strictEqual(messages[0].body, 'Offline sync failed after battery saver enabled');
      assert.strictEqual(messages[1].body, 'Follow-up: Also observed on Android 14');

      // 4. Verify outbox notification uses sender/dev email fallback instead of hard-coded d893f1.resend.app
      const data = await adapter._readData();
      assert.ok(data.outbox.length > 0);
      for (const item of data.outbox) {
        assert.ok(!item.reply_to_address.includes('d893f1.resend.app'));
      }
    } finally {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    }
  });
});

