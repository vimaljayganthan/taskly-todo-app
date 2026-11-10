/**
 * Taskly Customer Support — Stage 2: Outbox Worker & Resend Integration Test Suite
 * Version: 2.2.0 (Build 14)
 * 
 * Verifies:
 * 1. Resend API provider abstraction & error classification
 * 2. Cryptographic Reply-To formatting & email template generation
 * 3. Transactional Outbox enqueuing & deduplication
 * 4. Batched claiming, atomic leasing, and successful delivery
 * 5. Transient error retry with exponential backoff & jitter
 * 6. Permanent error immediate dead-lettering (failed)
 * 7. Max retries dead-lettering
 * 8. Ambiguous outcome timeout tracking & crash recovery
 * 9. Resend 24-hour idempotency retention window safety cutoff (23h 45m)
 * 10. Multi-worker concurrency & race protection
 * 11. Operational metrics & structured logging
 */

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { getOutboxConfig, validateOutboxConfig, getMaskedConfig } = require('../config/outboxConfig');
const { calculateBackoff, classifyError, isExceedingSafetyCutoff } = require('../services/retryStrategy');
const { buildReplyToAddress, formatNewTicketNotification, formatNewMessageNotification, escapeHtml } = require('../services/emailTemplates');
const { ResendEmailProvider, MockEmailProvider } = require('../services/emailProvider');
const { FileOutboxStore } = require('../services/outboxStore');
const { OutboxWorker } = require('../services/outboxWorker');

const TEST_DATA_DIR = path.join(__dirname, '..', 'data');
const TEST_DATA_FILE = path.join(TEST_DATA_DIR, `test_outbox_${Date.now()}_${Math.random().toString(36).substring(2)}.json`);

function cleanupTestFile() {
  try {
    if (fs.existsSync(TEST_DATA_FILE)) {
      fs.unlinkSync(TEST_DATA_FILE);
    }
  } catch (_) {}
}

describe('Taskly Customer Support — Stage 2: Outbox Worker & Resend Integration Suite', () => {
  let store;
  let mockEmail;

  beforeEach(() => {
    cleanupTestFile();
    store = new FileOutboxStore(TEST_DATA_FILE);
    mockEmail = new MockEmailProvider();
  });

  after(() => {
    cleanupTestFile();
  });

  // --------------------------------------------------------------------------
  // 1. Configuration & Security Credential Masking
  // --------------------------------------------------------------------------
  test('1. Configuration & Credential Security: Validates environment settings and masks API keys in logs', () => {
    const config = getOutboxConfig();
    assert.ok(config.pollIntervalMs >= 500);
    assert.ok(config.batchSize >= 1 && config.batchSize <= 50);
    assert.ok(config.leaseSeconds >= 10);
    assert.strictEqual(config.idempotencyCutoffMinutes, 1425); // 23h 45m

    const masked = getMaskedConfig({ ...config, resendApiKey: 're_1234567890abcdef' });
    assert.strictEqual(masked.resendApiKey, 're_12...def');
    assert.strictEqual(masked.resendApiKey.includes('1234567890'), false, 'Secret must never be exposed');

    const validation = validateOutboxConfig(config);
    assert.strictEqual(typeof validation.valid, 'boolean');
  });

  // --------------------------------------------------------------------------
  // 2. Retry Strategy & Error Classification
  // --------------------------------------------------------------------------
  test('2. Error Classification & Exponential Backoff: Accurately classifies transient vs permanent errors', () => {
    // 429 Rate limit
    const err429 = new Error('Rate limit exceeded');
    err429.statusCode = 429;
    err429.retryAfter = '120';
    const c429 = classifyError(err429);
    assert.strictEqual(c429.isRetryable, true);
    assert.strictEqual(c429.isAmbiguous, false);
    assert.strictEqual(c429.retryAfterSeconds, 120);

    // 503 Provider error
    const err503 = new Error('Service Unavailable');
    err503.statusCode = 503;
    const c503 = classifyError(err503);
    assert.strictEqual(c503.isRetryable, true);
    assert.strictEqual(c503.statusCode, 503);

    // 400 Permanent rejection
    const err400 = new Error('Invalid email address format');
    err400.statusCode = 400;
    const c400 = classifyError(err400);
    assert.strictEqual(c400.isRetryable, false);
    assert.strictEqual(c400.isAmbiguous, false);

    // Timeout: Ambiguous outcome
    const errTimeout = new Error('Connection timeout waiting for server');
    errTimeout.code = 'ETIMEDOUT';
    const cTimeout = classifyError(errTimeout);
    assert.strictEqual(cTimeout.isRetryable, true);
    assert.strictEqual(cTimeout.isAmbiguous, true);

    // Exponential backoff bounds
    const delay0 = calculateBackoff({ retryCount: 0, baseDelaySeconds: 60, jitter: false });
    const delay1 = calculateBackoff({ retryCount: 1, baseDelaySeconds: 60, jitter: false });
    const delay2 = calculateBackoff({ retryCount: 2, baseDelaySeconds: 60, jitter: false });
    const delay10 = calculateBackoff({ retryCount: 10, baseDelaySeconds: 60, maxDelaySeconds: 1800, jitter: false });

    assert.strictEqual(delay0, 60);
    assert.strictEqual(delay1, 120);
    assert.strictEqual(delay2, 240);
    assert.strictEqual(delay10, 1800, 'Must cap at maxDelaySeconds');
  });

  // --------------------------------------------------------------------------
  // 3. Cryptographic Reply-To Formatting & Templates
  // --------------------------------------------------------------------------
  test('3. Templates & Reply-To Security: Generates cryptographically unguessable reply-to headers and sanitized HTML', () => {
    const ticket = {
      ticket_code: 'TK-1001-ABCD',
      subject: 'Login <script>alert(1)</script> issue',
      user_email: 'user@example.com',
      priority: 'high',
      category: 'account'
    };
    const routingToken = '8f9c1a2e7d3b4f6a5c8e1d2b3c4a5b6c';
    const receivingDomain = 'd893f1.resend.app';

    const replyTo = buildReplyToAddress(ticket.ticket_code, routingToken, receivingDomain);
    assert.strictEqual(replyTo, 'reply+tk_tk1001abcd_8f9c1a2e7d3b4f6a5c8e1d2b3c4a5b6c@d893f1.resend.app');

    const notification = formatNewTicketNotification({
      ticket,
      initialMessage: 'I am unable to <b>log in</b>',
      routingToken,
      receivingDomain
    });

    assert.strictEqual(notification.subject, '[Ticket #TK-1001-ABCD] Login <script>alert(1)</script> issue');
    assert.strictEqual(notification.replyTo, replyTo);
    assert.ok(notification.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'Must HTML escape subject');
    assert.ok(notification.html.includes('I am unable to &lt;b&gt;log in&lt;/b&gt;'), 'Must HTML escape body');
    assert.ok(!notification.html.includes('<script>'));
    assert.ok(notification.text.includes('New Taskly Support Ticket: TK-1001-ABCD'));
  });

  // --------------------------------------------------------------------------
  // 4. Outbox Enqueuing & Deduplication Prevention
  // --------------------------------------------------------------------------
  test('4. Idempotent Enqueuing: Deduplication key prevents duplicate email records in outbox', async () => {
    const ticketId = crypto.randomUUID();
    const dedupKey = `ticket-created-${ticketId}`;

    const res1 = await store.enqueue({
      ticketId,
      recipientEmail: 'developer@taskly.app',
      recipientType: 'developer',
      replyToAddress: 'reply+tk_123_abc@d893f1.resend.app',
      subject: 'New Ticket',
      bodyHtml: '<p>Body</p>',
      bodyText: 'Body',
      deduplicationKey: dedupKey
    });

    assert.strictEqual(res1.is_replay, false);
    assert.strictEqual(res1.status, 'pending');

    // Duplicate enqueue with identical key
    const res2 = await store.enqueue({
      ticketId,
      recipientEmail: 'developer@taskly.app',
      recipientType: 'developer',
      replyToAddress: 'reply+tk_123_abc@d893f1.resend.app',
      subject: 'New Ticket Replay',
      bodyHtml: '<p>Body</p>',
      bodyText: 'Body',
      deduplicationKey: dedupKey
    });

    assert.strictEqual(res2.is_replay, true);
    assert.strictEqual(res2.id, res1.id, 'Must return original outbox record');

    const metrics = await store.getMetrics();
    assert.strictEqual(metrics.total, 1, 'Only one record must exist in outbox');
  });

  // --------------------------------------------------------------------------
  // 5. Worker Batch Processing (Happy Path)
  // --------------------------------------------------------------------------
  test('5. Outbox Worker Execution (Happy Path): Batched claim, sending lock, and sent transition', async () => {
    const ticketId = crypto.randomUUID();
    await store.enqueue({
      ticketId,
      recipientEmail: 'developer@taskly.app',
      recipientType: 'developer',
      replyToAddress: 'reply+tk_123_abc@d893f1.resend.app',
      subject: 'Test Notification',
      bodyHtml: '<p>Test</p>',
      bodyText: 'Test',
      deduplicationKey: `ticket-created-${ticketId}`
    });

    const worker = new OutboxWorker({
      outboxStore: store,
      emailProvider: mockEmail
    });

    const summary = await worker.processBatch();
    assert.strictEqual(summary.processed, 1);
    assert.strictEqual(summary.successes, 1);
    assert.strictEqual(summary.failures, 0);

    const sent = mockEmail.getSentEmails();
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].to, 'developer@taskly.app');
    assert.strictEqual(sent[0].idempotencyKey, `ticket-created-${ticketId}`);

    const metrics = await store.getMetrics();
    assert.strictEqual(metrics.sent, 1);
    assert.strictEqual(metrics.pending, 0);

    // Verify audit event
    const data = await store._readData();
    assert.strictEqual(data.events.length, 1);
    assert.strictEqual(data.events[0].event_type, 'email_notification_sent');
  });

  // --------------------------------------------------------------------------
  // 6. Transient Failure & Exponential Retry
  // --------------------------------------------------------------------------
  test('6. Transient Error Retry: 5xx server error triggers retry increment and backoff rescheduling', async () => {
    const ticketId = crypto.randomUUID();
    const outboxJob = await store.enqueue({
      ticketId,
      recipientEmail: 'developer@taskly.app',
      recipientType: 'developer',
      replyToAddress: 'reply+tk_123_abc@d893f1.resend.app',
      subject: 'Transient Test',
      bodyHtml: '<p>Test</p>',
      bodyText: 'Test',
      deduplicationKey: `transient-${ticketId}`
    });

    // Simulate 503 Provider error
    const err503 = new Error('Service Temporarily Unavailable');
    err503.statusCode = 503;
    mockEmail.simulateErrorOnce(err503);

    const worker = new OutboxWorker({
      outboxStore: store,
      emailProvider: mockEmail,
      baseDelaySeconds: 30
    });

    const summary = await worker.processBatch();
    assert.strictEqual(summary.processed, 1);
    assert.strictEqual(summary.successes, 0);
    assert.strictEqual(summary.failures, 1);

    const record = await store.getRecord(outboxJob.id);
    assert.strictEqual(record.status, 'pending');
    assert.strictEqual(record.retry_count, 1);
    assert.strictEqual(record.locked_by, null, 'Lock must be released');
    assert.ok(new Date(record.next_attempt_at) > new Date());
    assert.ok(record.last_error.includes('503'));
  });

  // --------------------------------------------------------------------------
  // 7. Permanent Failure & Dead-Letter Handling
  // --------------------------------------------------------------------------
  test('7. Permanent Failure Dead-Letter: HTTP 400 client error immediately transitions to failed', async () => {
    const ticketId = crypto.randomUUID();
    const outboxJob = await store.enqueue({
      ticketId,
      recipientEmail: 'bad-email@invalid',
      recipientType: 'developer',
      replyToAddress: 'reply+tk_123_abc@d893f1.resend.app',
      subject: 'Permanent Failure Test',
      bodyHtml: '<p>Test</p>',
      bodyText: 'Test',
      deduplicationKey: `perm-fail-${ticketId}`
    });

    const err400 = new Error('The recipient address is invalid');
    err400.statusCode = 400;
    mockEmail.simulateErrorOnce(err400);

    const worker = new OutboxWorker({
      outboxStore: store,
      emailProvider: mockEmail
    });

    const summary = await worker.processBatch();
    assert.strictEqual(summary.failures, 1);

    const record = await store.getRecord(outboxJob.id);
    assert.strictEqual(record.status, 'failed', 'Must be placed directly in dead-letter state');
    assert.ok(record.last_error.includes('Permanent rejection'));
  });

  // --------------------------------------------------------------------------
  // 8. Max Retries Dead-Lettering
  // --------------------------------------------------------------------------
  test('8. Max Retries Exhaustion: Exceeding max_retries transitions status to failed', async () => {
    const ticketId = crypto.randomUUID();
    const outboxJob = await store.enqueue({
      ticketId,
      recipientEmail: 'dev@taskly.app',
      recipientType: 'developer',
      replyToAddress: 'reply+tk_123_abc@d893f1.resend.app',
      subject: 'Max Retries Test',
      bodyHtml: '<p>Test</p>',
      bodyText: 'Test',
      deduplicationKey: `max-retries-${ticketId}`,
      maxRetries: 2
    });

    const err500 = new Error('Persistent Server Error');
    err500.statusCode = 500;
    mockEmail.simulateFailureSequence([err500, err500, err500]);

    const worker = new OutboxWorker({
      outboxStore: store,
      emailProvider: mockEmail
    });

    // Attempt 1: retry_count becomes 1
    await worker.processBatch();
    let rec = await store.getRecord(outboxJob.id);
    assert.strictEqual(rec.status, 'pending');
    assert.strictEqual(rec.retry_count, 1);

    // Fast-forward next_attempt_at
    const data = await store._readData();
    data.outbox[0].next_attempt_at = new Date(Date.now() - 1000).toISOString();
    await store._writeData(data);

    // Attempt 2: retry_count reaches max_retries (2) -> failed
    await worker.processBatch();
    rec = await store.getRecord(outboxJob.id);
    assert.strictEqual(rec.status, 'failed', 'Must be dead-lettered after max_retries');
    assert.strictEqual(rec.retry_count, 2);
  });

  // --------------------------------------------------------------------------
  // 9. Resend 24-Hour Idempotency Retention Window Safety Cutoff (23h 45m)
  // --------------------------------------------------------------------------
  test('9. Resend 24-Hour Safety Cutoff: Halts retries if first attempt was >= 23h 45m ago', async () => {
    const ticketId = crypto.randomUUID();
    const outboxJob = await store.enqueue({
      ticketId,
      recipientEmail: 'dev@taskly.app',
      recipientType: 'developer',
      replyToAddress: 'reply+tk_123_abc@d893f1.resend.app',
      subject: 'Cutoff Test',
      bodyHtml: '<p>Test</p>',
      bodyText: 'Test',
      deduplicationKey: `cutoff-${ticketId}`
    });

    // Simulate job attempted 23 hours and 50 minutes ago
    const data = await store._readData();
    data.outbox[0].status = 'ambiguous_processing';
    data.outbox[0].first_attempt_started_at = new Date(Date.now() - (23 * 60 + 50) * 60 * 1000).toISOString();
    data.outbox[0].next_attempt_at = new Date(Date.now() - 1000).toISOString();
    data.outbox[0].retry_count = 1;
    await store._writeData(data);

    const worker = new OutboxWorker({
      outboxStore: store,
      emailProvider: mockEmail
    });

    // Run batch: claimBatch detects expired idempotency window and transitions to ambiguous_delivery_timeout
    await worker.processBatch();

    const rec = await store.getRecord(outboxJob.id);
    assert.strictEqual(rec.status, 'ambiguous_delivery_timeout', 'Must halt retries and flag ambiguous timeout');
    assert.strictEqual(mockEmail.getSentEmails().length, 0, 'No email must be dispatched beyond cutoff');

    // Verify sweeper also catches unleased expired jobs
    data.outbox[0].status = 'processing';
    data.outbox[0].locked_until = null;
    await store._writeData(data);

    const sweptCount = await worker.sweepTimeouts();
    assert.strictEqual(sweptCount, 1);
    const sweptRec = await store.getRecord(outboxJob.id);
    assert.strictEqual(sweptRec.status, 'ambiguous_delivery_timeout');
  });

  // --------------------------------------------------------------------------
  // 10. Worker Concurrency & Lease Isolation
  // --------------------------------------------------------------------------
  test('10. Worker Concurrency: Multiple workers claim non-overlapping distinct jobs', async () => {
    // Enqueue 4 pending jobs
    for (let i = 1; i <= 4; i++) {
      await store.enqueue({
        ticketId: crypto.randomUUID(),
        recipientEmail: `user${i}@taskly.app`,
        recipientType: 'developer',
        replyToAddress: `reply+tk_${i}@d893f1.resend.app`,
        subject: `Job ${i}`,
        bodyHtml: '<p>Job</p>',
        bodyText: 'Job',
        deduplicationKey: `concurrent-job-${i}-${Date.now()}`
      });
    }

    const worker1 = new OutboxWorker({
      workerId: 'worker_alpha',
      batchSize: 2,
      outboxStore: store,
      emailProvider: mockEmail
    });

    const worker2 = new OutboxWorker({
      workerId: 'worker_beta',
      batchSize: 2,
      outboxStore: store,
      emailProvider: mockEmail
    });

    // Run both workers
    const [res1, res2] = await Promise.all([
      worker1.processBatch(),
      worker2.processBatch()
    ]);

    assert.strictEqual(res1.processed + res2.processed, 4);
    assert.strictEqual(res1.successes + res2.successes, 4);
    assert.strictEqual(mockEmail.getSentEmails().length, 4, 'Exactly 4 emails delivered with zero duplicates');

    const metrics = await store.getMetrics();
    assert.strictEqual(metrics.sent, 4);
    assert.strictEqual(metrics.pending, 0);
  });

  // --------------------------------------------------------------------------
  // 11. Operational Metrics & Worker Lifecycle
  // --------------------------------------------------------------------------
  test('11. Operational Monitoring: Worker tracks metrics, handles start/stop lifecycle cleanly', async () => {
    const worker = new OutboxWorker({
      outboxStore: store,
      emailProvider: mockEmail,
      pollIntervalMs: 1000
    });

    worker.start();
    assert.strictEqual(worker.isRunning, true);

    const metrics = await worker.getMetrics();
    assert.ok(metrics.workerId.startsWith('worker_'));
    assert.strictEqual(metrics.isRunning, true);
    assert.strictEqual(typeof metrics.workerStats.batchesProcessed, 'number');
    assert.strictEqual(typeof metrics.storeQueueStats.total, 'number');

    await worker.stop();
    assert.strictEqual(worker.isRunning, false);
  });

  // --------------------------------------------------------------------------
  // 12. Internal Operational API Endpoints
  // --------------------------------------------------------------------------
  test('12. Internal API Routes: /api/internal/support/outbox endpoints support batch triggering and metrics', async () => {
    const app = require('../server');
    const { EventEmitter } = require('events');
    const { setOutboxStore, resetOutboxStore } = require('../services/outboxStore');
    const { setEmailProvider, resetEmailProvider } = require('../services/emailProvider');

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

    setOutboxStore(store);
    setEmailProvider(mockEmail);

    try {
      // Enqueue job
      await store.enqueue({
        ticketId: crypto.randomUUID(),
        recipientEmail: 'endpoint-test@taskly.app',
        recipientType: 'developer',
        replyToAddress: 'reply+tk_test@d893f1.resend.app',
        subject: 'Endpoint Trigger Test',
        bodyHtml: '<p>Endpoint</p>',
        bodyText: 'Endpoint',
        deduplicationKey: `endpoint-test-${Date.now()}`
      });

      // 1. Test POST /api/internal/support/outbox/process
      const processRes = await dispatchRequest({
        method: 'POST',
        url: '/api/internal/support/outbox/process'
      });

      assert.strictEqual(processRes.status, 200);
      assert.strictEqual(processRes.body.success, true);
      assert.strictEqual(processRes.body.processed, 1);
      assert.strictEqual(processRes.body.successes, 1);

      // 2. Test GET /api/internal/support/outbox/metrics
      const metricsRes = await dispatchRequest({
        method: 'GET',
        url: '/api/internal/support/outbox/metrics'
      });

      assert.strictEqual(metricsRes.status, 200);
      assert.strictEqual(metricsRes.body.success, true);
      assert.strictEqual(metricsRes.body.queue.sent, 1);
      assert.strictEqual(metricsRes.body.queue.pending, 0);

      // 3. Test POST /api/internal/support/outbox/sweep
      const sweepRes = await dispatchRequest({
        method: 'POST',
        url: '/api/internal/support/outbox/sweep'
      });

      assert.strictEqual(sweepRes.status, 200);
      assert.strictEqual(sweepRes.body.success, true);
      assert.strictEqual(typeof sweepRes.body.sweptTimeouts, 'number');

    } finally {
      resetOutboxStore();
      resetEmailProvider();
    }
  });
});
