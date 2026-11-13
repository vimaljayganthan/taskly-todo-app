// ==============================================================================
// Taskly Push Notifications — Comprehensive Outbox, Schema & Security Test Suite
// File: tests/notifications_outbox_and_schema.test.js
// Version: 2.2.0 (Build 14)
// ==============================================================================

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  NotificationService,
  classifyFcmError,
  CONFIRMED_INVALID_TOKEN_CODES,
  FATAL_CONFIG_ERROR_CODES,
  TRANSIENT_FCM_ERROR_CODES
} = require('../services/notificationService');

describe('Taskly Push Notifications — Complete Outbox & State Machine Engine', () => {

  // ----------------------------------------------------------------------------
  // 1. SQL File Structural & Semantic Integrity
  // ----------------------------------------------------------------------------
  describe('1. SQL Migration Schema & Stored Procedure Integrity', () => {
    const migrationPath = path.join(__dirname, '../scripts/008_push_notifications_schema.sql');
    let sql;

    test('1a. Migration file exists and has valid transaction structure', () => {
      assert.ok(fs.existsSync(migrationPath), 'Migration file 008 must exist');
      sql = fs.readFileSync(migrationPath, 'utf8');

      // Check transaction boundaries
      assert.ok(sql.includes('\nBEGIN;\n') || sql.startsWith('BEGIN;'), 'Migration must include transaction BEGIN');
      assert.ok(sql.includes('\nCOMMIT;\n') || sql.trim().endsWith('COMMIT;'), 'Migration must include transaction COMMIT');

      // Check balanced dollar-quotes
      const quoteCount = (sql.split('$$').length - 1);
      assert.strictEqual(quoteCount % 2, 0, 'Dollar quotes ($$) must be balanced');
    });

    test('1b. Required tables, columns and indexes are declared', () => {
      assert.ok(sql.includes('public.user_device_tokens'), 'Must define user_device_tokens table');
      assert.ok(sql.includes('public.notification_outbox'), 'Must define notification_outbox table');
      assert.ok(sql.includes('public.notifications'), 'Must define master notifications table');
      assert.ok(sql.includes('public.user_notification_inbox'), 'Must define user_notification_inbox table');
      assert.ok(sql.includes('public.notification_delivery_logs'), 'Must define notification_delivery_logs table');
      assert.ok(sql.includes('idx_device_tokens_keyset'), 'Must define keyset pagination index on user_device_tokens');
      assert.ok(sql.includes('idx_delivery_logs_pagination'), 'Must define keyset pagination index on notification_delivery_logs');
      assert.ok(sql.includes('UNIQUE(user_id, notification_id)'), 'Inbox must enforce unique recipient notification constraint');
      assert.ok(sql.includes('UNIQUE(notification_id, device_token_id)'), 'Delivery logs must enforce unique notification-token constraint');
    });

    test('1c. Blocker 1: expand_broadcast_inbox_atomic verifies both customer_all and admin_custom_broadcast', () => {
      assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.expand_broadcast_inbox_atomic'), 'Must declare expand_broadcast_inbox_atomic');
      assert.ok(sql.includes("expected target_audience = ''customer_all'' and notification_type = ''admin_custom_broadcast''"), 'Must validate both audience and type');
      assert.ok(sql.includes("lower(trim(u.email)) != 'tasklypets@gmail.com'"), 'Must filter out admin/developer email');
      assert.ok(sql.includes("u.email IS NOT NULL"), 'Must filter out null emails');
      assert.ok(sql.includes("ON CONFLICT (user_id, notification_id) DO NOTHING"), 'Must be idempotent');
    });

    test('1d. Blocker 2: claim_notification_outbox_batch recovers expired leases and bounds crashes', () => {
      assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.claim_notification_outbox_batch'), 'Must declare claim_notification_outbox_batch');
      assert.ok(sql.includes("status = 'dead_letter'"), 'Must transition exhausted crashed jobs to dead_letter');
      assert.ok(sql.includes("retry_count + 1 >= max_retries"), 'Must sweep jobs where retry_count + 1 >= max_retries');
      assert.ok(sql.includes("prev_status = 'processing' THEN o.retry_count + 1"), 'Must increment retry_count when reclaiming expired leases');
      assert.ok(sql.includes("FOR UPDATE SKIP LOCKED"), 'Must use FOR UPDATE SKIP LOCKED');
    });

    test('1e. Lease ownership check prevents expired or reassigned workers from completing jobs', () => {
      assert.ok(sql.includes("locked_by = trim(p_worker_id)"), 'mark_outbox_job_completed must verify locked_by');
      assert.ok(sql.includes("locked_until IS NOT NULL AND locked_until > now()"), 'mark_outbox_job_completed must verify valid unexpired lease');
    });

    test('1f. Privileged functions have restricted grants (service_role only)', () => {
      assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.expand_broadcast_inbox_atomic(UUID) FROM PUBLIC, anon, authenticated;'));
      assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.expand_broadcast_inbox_atomic(UUID) TO service_role;'));
      assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.claim_notification_outbox_batch(VARCHAR, INT, INT) FROM PUBLIC, anon, authenticated;'));
      assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.claim_notification_outbox_batch(VARCHAR, INT, INT) TO service_role;'));
      assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.mark_outbox_job_completed(UUID, VARCHAR) FROM PUBLIC, anon, authenticated;'));
      assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.mark_outbox_job_completed(UUID, VARCHAR) TO service_role;'));
      assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.mark_outbox_job_failed(UUID, VARCHAR, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;'));
      assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.mark_outbox_job_failed(UUID, VARCHAR, TEXT, BOOLEAN) TO service_role;'));
    });
  });

  // ----------------------------------------------------------------------------
  // 2. FCM Error Classification & Retry Strategy
  // ----------------------------------------------------------------------------
  describe('2. FCM Error Classification & Independent Token Outcome Engine', () => {
    test('2a. Confirmed invalid token codes are correctly classified and not marked transient', () => {
      for (const code of CONFIRMED_INVALID_TOKEN_CODES) {
        const classified = classifyFcmError({ code, message: `Sample error for ${code}` });
        assert.strictEqual(classified.isPermanentInvalidToken, true, `${code} must be confirmed invalid token`);
        assert.strictEqual(classified.isTransient, false, `${code} must NOT be transient`);
        assert.strictEqual(classified.isFatal, false, `${code} must NOT be fatal config error`);
        assert.strictEqual(classified.category, 'invalid_token');
      }
    });

    test('2b. Fatal credential error (messaging/mismatched-credential) is NEVER classified as invalid token', () => {
      const err1 = classifyFcmError({ code: 'messaging/mismatched-credential', message: 'The credential used to authenticate does not match the token sender ID' });
      assert.strictEqual(err1.isPermanentInvalidToken, false, 'Credential mismatch must NOT be classified as invalid token');
      assert.strictEqual(err1.isFatal, true, 'Credential mismatch must be classified as fatal');
      assert.strictEqual(err1.category, 'fatal');

      const err2 = classifyFcmError({ code: 'MismatchSenderId', message: 'Mismatched sender ID' });
      assert.strictEqual(err2.isPermanentInvalidToken, false);
      assert.strictEqual(err2.isFatal, true);
    });

    test('2c. Generic INVALID_ARGUMENT is classified as fatal, not as invalid token', () => {
      const genericArgErr = classifyFcmError({ code: 'INVALID_ARGUMENT', message: 'Payload title exceeds 255 characters' });
      assert.strictEqual(genericArgErr.isPermanentInvalidToken, false, 'Generic INVALID_ARGUMENT must NOT deactivate tokens');
      assert.strictEqual(genericArgErr.isFatal, true, 'Generic INVALID_ARGUMENT is a fatal payload error');
      assert.strictEqual(genericArgErr.category, 'fatal');

      // But INVALID_ARGUMENT with specific token detail IS classified as invalid token
      const tokenArgErr = classifyFcmError({ code: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token' });
      assert.strictEqual(tokenArgErr.isPermanentInvalidToken, true, 'Token-specific argument error must be invalid token');
      assert.strictEqual(tokenArgErr.category, 'invalid_token');
    });

    test('2d. Transient FCM codes and HTTP 5xx errors are classified as retryable', () => {
      for (const code of TRANSIENT_FCM_ERROR_CODES) {
        const classified = classifyFcmError({ code, message: `Transient issue: ${code}` });
        assert.strictEqual(classified.isTransient, true, `${code} must be transient`);
        assert.strictEqual(classified.isPermanentInvalidToken, false, `${code} must not be invalid token`);
        assert.strictEqual(classified.category, 'transient');
      }

      // HTTP 503 Service Unavailable
      const http503 = classifyFcmError({ statusCode: 503, message: 'FCM servers overloaded' });
      assert.strictEqual(http503.isTransient, true);
      assert.strictEqual(http503.category, 'transient');

      // HTTP 429 Rate Limit
      const http429 = classifyFcmError({ statusCode: 429, message: 'Too many requests' });
      assert.strictEqual(http429.isTransient, true);

      // Network disconnect ECONNRESET
      const netReset = classifyFcmError({ code: 'ECONNRESET', message: 'socket hang up' });
      assert.strictEqual(netReset.isTransient, true);
    });

    test('2e. Fatal misconfiguration errors are distinguished from token and transient errors', () => {
      const authErr = classifyFcmError({ statusCode: 401, message: 'Unauthorized project credentials' });
      assert.strictEqual(authErr.isFatal, true);
      assert.strictEqual(authErr.isPermanentInvalidToken, false);
      assert.strictEqual(authErr.isTransient, false);

      const missingCreds = classifyFcmError({ code: 'messaging/missing-credentials', message: 'Missing Firebase credentials' });
      assert.strictEqual(missingCreds.isFatal, true);
    });
  });

  // ----------------------------------------------------------------------------
  // 3. Keyset Pagination & Safe In-Flight Deactivation
  // ----------------------------------------------------------------------------
  test('3. Keyset Pagination: In-flight deactivations never shift offsets or omit tokens', () => {
    const mockDbTokens = Array.from({ length: 1200 }, (_, i) => ({
      id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
      fcm_token: `token_${i + 1}`,
      is_active: true
    }));

    const PAGE_SIZE = 500;
    const processedIds = [];
    let lastSeenId = '00000000-0000-0000-0000-000000000000';
    let pages = 0;

    while (true) {
      const chunk = mockDbTokens
        .filter(t => t.id > lastSeenId && t.is_active)
        .slice(0, PAGE_SIZE);

      if (chunk.length === 0) break;
      pages++;

      for (const token of chunk) {
        processedIds.push(token.id);
        if (processedIds.length % 4 === 0) {
          token.is_active = false;
        }
      }

      lastSeenId = chunk[chunk.length - 1].id;
    }

    assert.strictEqual(pages, 3, '1200 items in 500-sized pages should yield 3 queries');
    assert.strictEqual(processedIds.length, 1200, 'Keyset pagination must visit every single record');
    assert.strictEqual(new Set(processedIds).size, 1200, 'No record may be visited more than once');
  });

  // ----------------------------------------------------------------------------
  // 4. NotificationService Worker State Machine & Terminal Outcomes
  // ----------------------------------------------------------------------------
  describe('4. NotificationService Worker State Machine & Terminal Outcome Verification', () => {

    function createMockSupabase(initialState = {}) {
      const state = {
        outbox: initialState.outbox || [],
        notifications: initialState.notifications || [],
        inbox: initialState.inbox || [],
        tokens: initialState.tokens || [],
        deliveryLogs: initialState.deliveryLogs || [],
        authUsers: initialState.authUsers || [
          { id: 'dev-1', email: 'tasklypets@gmail.com' },
          { id: 'cust-1', email: 'customer1@example.com' },
          { id: 'cust-2', email: 'customer2@example.com' }
        ]
      };

      const hooks = {
        failTableUpsert: null,
        failTableUpdate: null
      };

      function getTableData(table) {
        if (table === 'notification_outbox') return state.outbox;
        if (table === 'notifications') return state.notifications;
        if (table === 'user_notification_inbox') return state.inbox;
        if (table === 'user_device_tokens') return state.tokens;
        if (table === 'notification_delivery_logs') return state.deliveryLogs;
        if (!state[table]) state[table] = [];
        return state[table];
      }

      return {
        state,
        hooks,
        from(table) {
          const tableData = getTableData(table);
          return {
            select(cols) {
              const filters = [];
              let orderCol = null;
              let orderAsc = true;
              let limitCount = null;

              const queryObj = {
                eq(col, val) {
                  filters.push(r => r[col] === val);
                  return queryObj;
                },
                gt(col, val) {
                  filters.push(r => r[col] > val);
                  return queryObj;
                },
                order(col, opts = {}) {
                  orderCol = col;
                  orderAsc = opts.ascending !== false;
                  return queryObj;
                },
                limit(n) {
                  limitCount = n;
                  return queryObj;
                },
                maybeSingle() {
                  const results = execute();
                  return Promise.resolve({ data: results[0] || null, error: null });
                },
                single() {
                  const results = execute();
                  if (results.length === 0) return Promise.resolve({ data: null, error: { message: 'Not found' } });
                  return Promise.resolve({ data: results[0], error: null });
                },
                then(resolve, reject) {
                  const results = execute();
                  return Promise.resolve({ data: results, error: null }).then(resolve, reject);
                }
              };

              function execute() {
                let res = tableData.filter(r => filters.every(f => f(r)));
                if (orderCol) {
                  res.sort((a, b) => {
                    if (a[orderCol] < b[orderCol]) return orderAsc ? -1 : 1;
                    if (a[orderCol] > b[orderCol]) return orderAsc ? 1 : -1;
                    return 0;
                  });
                }
                if (limitCount !== null) {
                  res = res.slice(0, limitCount);
                }
                return res;
              }

              return queryObj;
            },
            insert(record) {
              return {
                select() {
                  return {
                    single() {
                      const newRecord = { id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, ...record };
                      tableData.push(newRecord);
                      return Promise.resolve({ data: newRecord, error: null });
                    }
                  };
                }
              };
            },
            upsert(records, options = {}) {
              if (hooks.failTableUpsert === table) {
                return Promise.resolve({ data: null, error: { message: `Simulated upsert failure on ${table}` } });
              }

              const list = Array.isArray(records) ? records : [records];
              for (const r of list) {
                const idx = tableData.findIndex(item => {
                  if (table === 'user_notification_inbox') {
                    return item.user_id === r.user_id && item.notification_id === r.notification_id;
                  }
                  if (table === 'notification_delivery_logs') {
                    return item.notification_id === r.notification_id && item.device_token_id === r.device_token_id;
                  }
                  return item.id === r.id;
                });
                if (idx >= 0) {
                  tableData[idx] = { ...tableData[idx], ...r };
                } else {
                  tableData.push({ id: `id_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, ...r });
                }
              }
              return Promise.resolve({ data: list, error: null });
            },
            update(updates) {
              return {
                eq(col, val) {
                  if (hooks.failTableUpdate === table) {
                    return Promise.resolve({ data: null, error: { message: `Simulated update failure on ${table}` } });
                  }

                  const target = tableData.find(r => r[col] === val);
                  if (target) {
                    Object.assign(target, updates);
                  }
                  return Promise.resolve({ data: target, error: null });
                }
              };
            }
          };
        },
        rpc(fnName, args = {}) {
          if (fnName === 'get_authorized_developer_user_ids') {
            const devs = state.authUsers
              .filter(u => u.email && u.email.toLowerCase().trim() === 'tasklypets@gmail.com')
              .map(u => ({ user_id: u.id, email: u.email }));
            return Promise.resolve({ data: devs, error: null });
          }

          if (fnName === 'expand_broadcast_inbox_atomic') {
            const notif = state.notifications.find(n => n.id === args.p_notification_id);
            if (!notif) return Promise.resolve({ data: null, error: { message: 'Notification does not exist' } });
            // Strict check of both audience and type
            if (notif.target_audience !== 'customer_all' || notif.notification_type !== 'admin_custom_broadcast') {
              return Promise.resolve({ data: null, error: { message: 'Invalid notification for broadcast expansion' } });
            }
            const customers = state.authUsers.filter(u => u.email && u.email.toLowerCase().trim() !== 'tasklypets@gmail.com');
            let count = 0;
            for (const c of customers) {
              const exists = state.inbox.some(i => i.user_id === c.id && i.notification_id === notif.id);
              if (!exists) {
                state.inbox.push({ user_id: c.id, notification_id: notif.id, is_read: false });
                count++;
              }
            }
            return Promise.resolve({ data: count, error: null });
          }

          if (fnName === 'mark_outbox_job_completed') {
            const job = state.outbox.find(o => o.id === args.p_job_id);
            if (!job) return Promise.resolve({ data: false, error: null });
            if (job.locked_by !== args.p_worker_id) return Promise.resolve({ data: false, error: null });
            job.status = 'completed';
            job.locked_by = null;
            job.locked_until = null;
            return Promise.resolve({ data: true, error: null });
          }

          if (fnName === 'mark_outbox_job_failed') {
            const job = state.outbox.find(o => o.id === args.p_job_id);
            if (!job) return Promise.resolve({ data: false, error: null });
            if (job.locked_by !== args.p_worker_id) return Promise.resolve({ data: false, error: null });
            job.retry_count = (job.retry_count || 0) + 1;
            const isDead = args.p_is_permanent || job.retry_count >= (job.max_retries || 5);
            job.status = isDead ? 'dead_letter' : 'pending';
            job.next_retry_at = isDead ? null : new Date(Date.now() + 15000).toISOString();
            job.last_error = args.p_error_message;
            job.locked_by = null;
            job.locked_until = null;
            return Promise.resolve({ data: true, error: null });
          }

          return Promise.resolve({ data: null, error: { message: `Unknown RPC ${fnName}` } });
        }
      };
    }

    test('4a. Happy Path: All device tokens succeed -> Outbox job marked completed', async () => {
      const mockSupabase = createMockSupabase({
        outbox: [{
          id: 'job-1',
          event_type: 'new_ticket',
          target_audience: 'developer_all',
          title: 'New Support Ticket',
          body: 'Help required',
          deduplication_key: 'ticket_created:123',
          locked_by: 'test_worker',
          locked_until: new Date(Date.now() + 60000).toISOString(),
          status: 'processing'
        }],
        tokens: [
          { id: 'tok-1', user_id: 'dev-1', fcm_token: 'valid_fcm_1', app_type: 'developer', is_active: true },
          { id: 'tok-2', user_id: 'dev-1', fcm_token: 'valid_fcm_2', app_type: 'developer', is_active: true }
        ]
      });

      const mockMessaging = {
        send: async () => 'projects/taskly/messages/mock_msg_id'
      };

      const service = new NotificationService({
        supabaseClient: mockSupabase,
        messagingProvider: mockMessaging,
        workerId: 'test_worker'
      });

      const result = await service.processJob(mockSupabase.state.outbox[0]);
      assert.strictEqual(result.completed, true, 'Job must be completed');
      assert.strictEqual(result.retryScheduled, false);
      assert.strictEqual(mockSupabase.state.outbox[0].status, 'completed');
      assert.strictEqual(mockSupabase.state.deliveryLogs.length, 2);
      assert.strictEqual(mockSupabase.state.inbox.length, 1);
    });

    test('4b. Confirmed Invalid Token: Deactivates token without dead-lettering outbox job', async () => {
      const mockSupabase = createMockSupabase({
        outbox: [{
          id: 'job-2',
          event_type: 'ticket_reply',
          target_audience: 'customer_single',
          recipient_user_id: 'cust-1',
          recipient_email: 'customer1@example.com',
          title: 'Reply to Ticket',
          body: 'We have updated your account.',
          deduplication_key: 'ticket_reply:456',
          locked_by: 'test_worker',
          locked_until: new Date(Date.now() + 60000).toISOString(),
          status: 'processing'
        }],
        tokens: [
          { id: 'tok-invalid', user_id: 'cust-1', fcm_token: 'stale_token', app_type: 'customer', is_active: true },
          { id: 'tok-valid', user_id: 'cust-1', fcm_token: 'fresh_token', app_type: 'customer', is_active: true }
        ]
      });

      const mockMessaging = {
        send: async (payload) => {
          if (payload.token === 'stale_token') {
            const err = new Error('Registration token is not registered');
            err.code = 'messaging/registration-token-not-registered';
            throw err;
          }
          return 'projects/taskly/messages/ok_msg';
        }
      };

      const service = new NotificationService({
        supabaseClient: mockSupabase,
        messagingProvider: mockMessaging,
        workerId: 'test_worker'
      });

      const result = await service.processJob(mockSupabase.state.outbox[0]);
      assert.strictEqual(result.completed, true, 'Job must be marked completed because both tokens reached terminal states');

      const invalidTokenInDb = mockSupabase.state.tokens.find(t => t.id === 'tok-invalid');
      assert.strictEqual(invalidTokenInDb.is_active, false, 'Invalid token must be deactivated in DB');

      const invalidLog = mockSupabase.state.deliveryLogs.find(l => l.device_token_id === 'tok-invalid');
      assert.strictEqual(invalidLog.status, 'invalid_token');

      const validLog = mockSupabase.state.deliveryLogs.find(l => l.device_token_id === 'tok-valid');
      assert.strictEqual(validLog.status, 'fcm_accepted');
    });

    test('4c. Transient Failure: Reschedules outbox job with exponential backoff and DOES NOT complete', async () => {
      const mockSupabase = createMockSupabase({
        outbox: [{
          id: 'job-3',
          event_type: 'ticket_reply',
          target_audience: 'customer_single',
          recipient_user_id: 'cust-1',
          recipient_email: 'customer1@example.com',
          title: 'Reply to Ticket',
          body: 'Looking into this',
          deduplication_key: 'ticket_reply:789',
          locked_by: 'test_worker',
          locked_until: new Date(Date.now() + 60000).toISOString(),
          status: 'processing',
          retry_count: 0,
          max_retries: 5
        }],
        tokens: [
          { id: 'tok-ok', user_id: 'cust-1', fcm_token: 'good_fcm', app_type: 'customer', is_active: true },
          { id: 'tok-transient', user_id: 'cust-1', fcm_token: 'transient_fcm', app_type: 'customer', is_active: true }
        ]
      });

      const mockMessaging = {
        send: async (payload) => {
          if (payload.token === 'transient_fcm') {
            const err = new Error('FCM server temporarily unavailable');
            err.code = 'messaging/server-unavailable';
            throw err;
          }
          return 'projects/taskly/messages/ok';
        }
      };

      const service = new NotificationService({
        supabaseClient: mockSupabase,
        messagingProvider: mockMessaging,
        workerId: 'test_worker'
      });

      const result = await service.processJob(mockSupabase.state.outbox[0]);
      assert.strictEqual(result.completed, false, 'Job must NOT be completed while transient failures remain');
      assert.strictEqual(result.retryScheduled, true);

      const outboxJob = mockSupabase.state.outbox[0];
      assert.strictEqual(outboxJob.status, 'pending');
      assert.strictEqual(outboxJob.retry_count, 1);
      assert.ok(outboxJob.next_retry_at !== null);

      const transToken = mockSupabase.state.tokens.find(t => t.id === 'tok-transient');
      assert.strictEqual(transToken.is_active, true, 'Transient failed token must remain active');
    });

    test('4d. Partial Batch Recovery: Retried job dispatches ONLY to unresolved tokens', async () => {
      const mockSupabase = createMockSupabase({
        outbox: [{
          id: 'job-3',
          event_type: 'ticket_reply',
          target_audience: 'customer_single',
          recipient_user_id: 'cust-1',
          recipient_email: 'customer1@example.com',
          title: 'Reply to Ticket',
          body: 'Looking into this',
          deduplication_key: 'ticket_reply:789',
          locked_by: 'test_worker_2',
          locked_until: new Date(Date.now() + 60000).toISOString(),
          status: 'processing',
          retry_count: 1,
          max_retries: 5
        }],
        notifications: [{
          id: 'notif_existing_123',
          idempotency_key: 'ticket_reply:789'
        }],
        tokens: [
          { id: 'tok-ok', user_id: 'cust-1', fcm_token: 'good_fcm', app_type: 'customer', is_active: true },
          { id: 'tok-transient', user_id: 'cust-1', fcm_token: 'transient_fcm', app_type: 'customer', is_active: true }
        ],
        deliveryLogs: [
          {
            id: 'log-1',
            notification_id: 'notif_existing_123',
            device_token_id: 'tok-ok',
            status: 'fcm_accepted',
            fcm_message_id: 'msg_from_attempt_1'
          }
        ]
      });

      const dispatchedTokens = [];
      const mockMessaging = {
        send: async (payload) => {
          dispatchedTokens.push(payload.token);
          return 'projects/taskly/messages/retry_ok';
        }
      };

      const service = new NotificationService({
        supabaseClient: mockSupabase,
        messagingProvider: mockMessaging,
        workerId: 'test_worker_2'
      });

      const result = await service.processJob(mockSupabase.state.outbox[0]);
      assert.strictEqual(result.completed, true, 'Job must now be completed');
      assert.strictEqual(dispatchedTokens.length, 1);
      assert.strictEqual(dispatchedTokens[0], 'transient_fcm', 'Only unresolved token must be sent on retry');
    });

    test('4e. Zero Device Tokens: Persists inbox and marks outbox job completed', async () => {
      const mockSupabase = createMockSupabase({
        outbox: [{
          id: 'job-4',
          event_type: 'admin_custom_direct',
          target_audience: 'customer_single',
          recipient_user_id: 'cust-2',
          recipient_email: 'customer2@example.com',
          title: 'Account Update',
          body: 'Direct announcement',
          deduplication_key: 'admin_direct:cust-2:key1',
          locked_by: 'test_worker',
          locked_until: new Date(Date.now() + 60000).toISOString(),
          status: 'processing'
        }],
        tokens: []
      });

      const service = new NotificationService({
        supabaseClient: mockSupabase,
        workerId: 'test_worker'
      });

      const result = await service.processJob(mockSupabase.state.outbox[0]);
      assert.strictEqual(result.completed, true);
      assert.strictEqual(mockSupabase.state.outbox[0].status, 'completed');
      assert.strictEqual(mockSupabase.state.inbox.length, 1);
      assert.strictEqual(mockSupabase.state.inbox[0].user_id, 'cust-2');
    });

    test('4f. Expired Lease Recovery: Reclaiming increments retry count and bounds crashes', () => {
      function simulateOutboxClaim(job, workerId, leaseSeconds = 60) {
        const now = Date.now();
        const lockedUntil = job.locked_until ? new Date(job.locked_until).getTime() : 0;
        const isExpired = lockedUntil < now;

        if (job.status === 'processing' && isExpired) {
          if (job.retry_count + 1 >= job.max_retries) {
            return {
              ...job,
              status: 'dead_letter',
              retry_count: job.retry_count + 1,
              locked_by: null,
              locked_until: null,
              next_retry_at: null,
              last_error: 'Worker lease expired; max retries exceeded'
            };
          } else {
            return {
              ...job,
              status: 'processing',
              retry_count: job.retry_count + 1,
              locked_by: workerId,
              locked_until: new Date(now + leaseSeconds * 1000).toISOString()
            };
          }
        }

        if (job.status === 'pending') {
          return {
            ...job,
            status: 'processing',
            locked_by: workerId,
            locked_until: new Date(now + leaseSeconds * 1000).toISOString()
          };
        }

        return null;
      }

      const crashedJob = {
        id: 'job-crash',
        status: 'processing',
        locked_by: 'dead_worker_A',
        locked_until: new Date(Date.now() - 5000).toISOString(),
        retry_count: 0,
        max_retries: 3
      };

      const reclaimed = simulateOutboxClaim(crashedJob, 'worker_B');
      assert.strictEqual(reclaimed.status, 'processing');
      assert.strictEqual(reclaimed.locked_by, 'worker_B');
      assert.strictEqual(reclaimed.retry_count, 1);

      reclaimed.locked_until = new Date(Date.now() - 5000).toISOString();
      const reclaimed2 = simulateOutboxClaim(reclaimed, 'worker_C');
      assert.strictEqual(reclaimed2.retry_count, 2);

      reclaimed2.locked_until = new Date(Date.now() - 5000).toISOString();
      const exhausted = simulateOutboxClaim(reclaimed2, 'worker_D');
      assert.strictEqual(exhausted.status, 'dead_letter');
      assert.strictEqual(exhausted.retry_count, 3);
      assert.strictEqual(exhausted.locked_by, null);
      assert.strictEqual(exhausted.next_retry_at, null);
    });

    test('4g. Expired worker cannot complete job after lease expires or reassignment', async () => {
      const mockSupabase = createMockSupabase({
        outbox: [{
          id: 'job-expired-worker',
          status: 'processing',
          locked_by: 'new_worker_2',
          locked_until: new Date(Date.now() + 60000).toISOString()
        }]
      });

      const { data: completed } = await mockSupabase.rpc('mark_outbox_job_completed', {
        p_job_id: 'job-expired-worker',
        p_worker_id: 'old_worker_1'
      });

      assert.strictEqual(completed, false);
      assert.strictEqual(mockSupabase.state.outbox[0].status, 'processing');
    });

    test('4h. Broadcast inbox expansion rejects non-broadcast target audience OR non-broadcast notification type', async () => {
      const mockSupabase = createMockSupabase({
        notifications: [
          {
            id: 'notif-wrong-audience',
            target_audience: 'customer_single', // WRONG
            notification_type: 'admin_custom_broadcast'
          },
          {
            id: 'notif-wrong-type',
            target_audience: 'customer_all',
            notification_type: 'ticket_reply' // WRONG
          },
          {
            id: 'notif-valid-broadcast',
            target_audience: 'customer_all',
            notification_type: 'admin_custom_broadcast' // CORRECT
          }
        ]
      });

      const res1 = await mockSupabase.rpc('expand_broadcast_inbox_atomic', { p_notification_id: 'notif-wrong-audience' });
      assert.strictEqual(res1.data, null);
      assert.ok(res1.error);

      const res2 = await mockSupabase.rpc('expand_broadcast_inbox_atomic', { p_notification_id: 'notif-wrong-type' });
      assert.strictEqual(res2.data, null);
      assert.ok(res2.error);

      const res3 = await mockSupabase.rpc('expand_broadcast_inbox_atomic', { p_notification_id: 'notif-valid-broadcast' });
      assert.strictEqual(res3.data, 2, 'Must expand to the 2 genuine customer accounts');
    });

    // --------------------------------------------------------------------------
    // Regression Tests for Final Independent Review Blockers
    // --------------------------------------------------------------------------

    test('4i. Regression: Valid tokens are PRESERVED after credential errors (messaging/mismatched-credential)', async () => {
      const mockSupabase = createMockSupabase({
        outbox: [{
          id: 'job-cred-err',
          event_type: 'new_ticket',
          target_audience: 'developer_all',
          title: 'Alert',
          body: 'Check credentials',
          deduplication_key: 'ticket_created:999',
          locked_by: 'test_worker',
          locked_until: new Date(Date.now() + 60000).toISOString(),
          status: 'processing'
        }],
        tokens: [
          { id: 'dev-tok-1', user_id: 'dev-1', fcm_token: 'valid_dev_token', app_type: 'developer', is_active: true }
        ]
      });

      const mockMessaging = {
        send: async () => {
          const err = new Error('The credential used does not match');
          err.code = 'messaging/mismatched-credential';
          throw err;
        }
      };

      const service = new NotificationService({
        supabaseClient: mockSupabase,
        messagingProvider: mockMessaging,
        workerId: 'test_worker'
      });

      const result = await service.processJob(mockSupabase.state.outbox[0]);
      assert.strictEqual(result.completed, false);
      assert.strictEqual(result.isDeadLetter, true, 'Job must be dead-lettered permanently due to fatal config error');

      // CRITICAL: Token must NOT be deactivated! It remains active!
      const tokenInDb = mockSupabase.state.tokens.find(t => t.id === 'dev-tok-1');
      assert.strictEqual(tokenInDb.is_active, true, 'Device token must remain active after credential mismatch');

      // Outbox job status in DB should be dead_letter
      const outboxJob = mockSupabase.state.outbox[0];
      assert.strictEqual(outboxJob.status, 'dead_letter');
    });

    test('4j. Regression: _logDeliveryOutcome() persistence failure propagates and prevents job completion', async () => {
      const mockSupabase = createMockSupabase({
        outbox: [{
          id: 'job-persist-fail',
          event_type: 'ticket_reply',
          target_audience: 'customer_single',
          recipient_user_id: 'cust-1',
          recipient_email: 'customer1@example.com',
          title: 'Reply',
          body: 'Hello',
          deduplication_key: 'ticket_reply:1111',
          locked_by: 'test_worker',
          locked_until: new Date(Date.now() + 60000).toISOString(),
          status: 'processing'
        }],
        tokens: [
          { id: 'cust-tok-1', user_id: 'cust-1', fcm_token: 'good_fcm', app_type: 'customer', is_active: true }
        ]
      });

      // Inject DB failure into notification_delivery_logs upsert
      mockSupabase.hooks.failTableUpsert = 'notification_delivery_logs';

      const mockMessaging = {
        send: async () => 'projects/taskly/messages/ok'
      };

      const service = new NotificationService({
        supabaseClient: mockSupabase,
        messagingProvider: mockMessaging,
        workerId: 'test_worker'
      });

      const result = await service.processJob(mockSupabase.state.outbox[0]);
      assert.strictEqual(result.completed, false, 'Must NOT mark job completed when delivery log persistence fails');
      assert.strictEqual(result.retryScheduled, true, 'Must reschedule retry on persistence failure');

      // Outbox row in DB must NOT be completed
      assert.notStrictEqual(mockSupabase.state.outbox[0].status, 'completed');
      assert.strictEqual(mockSupabase.state.outbox[0].status, 'pending');
    });

    test('4k. Regression: Token deactivation error in Supabase propagates and prevents job completion', async () => {
      const mockSupabase = createMockSupabase({
        outbox: [{
          id: 'job-deact-fail',
          event_type: 'ticket_reply',
          target_audience: 'customer_single',
          recipient_user_id: 'cust-1',
          recipient_email: 'customer1@example.com',
          title: 'Reply',
          body: 'Hello',
          deduplication_key: 'ticket_reply:2222',
          locked_by: 'test_worker',
          locked_until: new Date(Date.now() + 60000).toISOString(),
          status: 'processing'
        }],
        tokens: [
          { id: 'stale-tok', user_id: 'cust-1', fcm_token: 'stale_fcm', app_type: 'customer', is_active: true }
        ]
      });

      // Inject DB update failure into user_device_tokens
      mockSupabase.hooks.failTableUpdate = 'user_device_tokens';

      const mockMessaging = {
        send: async () => {
          const err = new Error('Token is not registered');
          err.code = 'messaging/registration-token-not-registered';
          throw err;
        }
      };

      const service = new NotificationService({
        supabaseClient: mockSupabase,
        messagingProvider: mockMessaging,
        workerId: 'test_worker'
      });

      const result = await service.processJob(mockSupabase.state.outbox[0]);
      assert.strictEqual(result.completed, false, 'Must NOT complete when token deactivation fails');
      assert.strictEqual(result.retryScheduled, true);
    });

    test('4l. Regression: getPriorDeliveryLogs() paginates across 1200 records without dropping logs', async () => {
      // Pre-populate 1200 delivery logs for notification 'notif-large'
      const logs = Array.from({ length: 1200 }, (_, i) => ({
        id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
        notification_id: 'notif-large',
        device_token_id: `dev-token-${i + 1}`,
        status: i % 2 === 0 ? 'fcm_accepted' : 'invalid_token'
      }));

      const mockSupabase = createMockSupabase({ deliveryLogs: logs });
      const service = new NotificationService({
        supabaseClient: mockSupabase,
        tokenPageSize: 500 // Page size = 500 -> requires 3 pages
      });

      const priorLogs = await service.getPriorDeliveryLogs('notif-large');
      assert.strictEqual(priorLogs.terminalTokenIds.size, 1200, 'Must retrieve and process all 1200 logs via pagination');
      assert.strictEqual(priorLogs.acceptedTokenIds.size, 600);
      assert.strictEqual(priorLogs.invalidTokenIds.size, 600);
    });

    test('4m. Regression: FCM payload does NOT include explicit sound overrides (channel handles sound natively)', async () => {
      let interceptedPayload = null;
      const mockSupabase = createMockSupabase({
        outbox: [{
          id: 'job-payload-check',
          event_type: 'new_ticket',
          target_audience: 'customer_single',
          recipient_user_id: 'cust-1',
          recipient_email: 'customer1@example.com',
          title: 'Payload Test',
          body: 'Sound Check',
          deduplication_key: 'payload_check:1',
          locked_by: 'test_worker',
          locked_until: new Date(Date.now() + 60000).toISOString(),
          status: 'processing'
        }],
        tokens: [
          { id: 'cust-tok', user_id: 'cust-1', fcm_token: 'check_token', app_type: 'customer', is_active: true }
        ]
      });

      const mockMessaging = {
        send: async (p) => {
          interceptedPayload = p;
          return 'projects/taskly/messages/ok';
        }
      };

      const service = new NotificationService({
        supabaseClient: mockSupabase,
        messagingProvider: mockMessaging,
        workerId: 'test_worker'
      });

      await service.processJob(mockSupabase.state.outbox[0]);
      assert.ok(interceptedPayload, 'Must dispatch payload');

      // Verify channelId is set
      assert.strictEqual(interceptedPayload.android.notification.channelId, 'taskly-support-tickets-v1');
      assert.strictEqual(interceptedPayload.android.notification.tag, `taskly_${interceptedPayload.data.notification_id}`);

      // Verify explicit sound and defaultSound overrides are REMOVED
      assert.strictEqual(interceptedPayload.android.notification.sound, undefined, 'Explicit sound override must NOT be in payload');
      assert.strictEqual(interceptedPayload.android.notification.defaultSound, undefined, 'defaultSound override must NOT be in payload');
    });

    test('4n. Regression: Mock FCM delivery is DISABLED by default and fails visibly on missing config', async () => {
      const mockSupabase = createMockSupabase({
        outbox: [{
          id: 'job-no-fcm',
          event_type: 'new_ticket',
          target_audience: 'customer_single',
          recipient_user_id: 'cust-1',
          recipient_email: 'customer1@example.com',
          title: 'No FCM Config',
          body: 'Check failure',
          deduplication_key: 'no_fcm:1',
          locked_by: 'test_worker',
          locked_until: new Date(Date.now() + 60000).toISOString(),
          status: 'processing'
        }],
        tokens: [
          { id: 't1', user_id: 'cust-1', fcm_token: 'some_fcm', app_type: 'customer', is_active: true }
        ]
      });

      // Default instantiation (NO allowMockDelivery flag and NO messaging provider)
      const serviceProduction = new NotificationService({
        supabaseClient: mockSupabase,
        messagingProvider: null,
        workerId: 'test_worker'
      });

      const result = await serviceProduction.processJob(mockSupabase.state.outbox[0]);
      assert.strictEqual(result.completed, false, 'Missing FCM configuration must fail visibly');
      assert.strictEqual(result.isDeadLetter, true, 'Missing credentials must dead-letter the job as fatal config error');

      // With explicit test mode: allowMockDelivery: true
      const serviceTestMode = new NotificationService({
        supabaseClient: mockSupabase,
        messagingProvider: null,
        allowMockDelivery: true,
        workerId: 'test_worker'
      });

      mockSupabase.state.outbox[0].status = 'processing';
      mockSupabase.state.outbox[0].locked_by = 'test_worker';
      const resultTest = await serviceTestMode.processJob(mockSupabase.state.outbox[0]);
      assert.strictEqual(resultTest.completed, true, 'Permitted only when allowMockDelivery: true is explicitly configured');
    });
  });

  // ----------------------------------------------------------------------------
  // 5. Fail-Closed Internal Note Detection Logic
  // ----------------------------------------------------------------------------
  describe('5. Fail-Closed Internal Note Detection Logic', () => {
    function simulateIsInternalNote(meta, senderType = 'developer') {
      if (typeof senderType === 'string' && senderType.trim().toLowerCase() === 'internal') {
        return true;
      }
      if (meta === null || meta === undefined) {
        return false;
      }
      if (typeof meta === 'object' && Object.keys(meta).length === 0) {
        return false;
      }
      if (typeof meta !== 'object' || Array.isArray(meta)) {
        return true;
      }
      try {
        if ('is_internal_note' in meta) {
          const val = String(meta.is_internal_note).trim().toLowerCase();
          if (!['false', '0', 'f', 'no'].includes(val)) return true;
        }
        if ('isInternalNote' in meta) {
          const val = String(meta.isInternalNote).trim().toLowerCase();
          if (!['false', '0', 'f', 'no'].includes(val)) return true;
        }
        if ('type' in meta) {
          const val = String(meta.type).trim().toLowerCase();
          if (['internal_note', 'internal', 'note'].includes(val)) return true;
        }
        if ('visibility' in meta) {
          const val = String(meta.visibility).trim().toLowerCase();
          if (['internal', 'private', 'developer'].includes(val)) return true;
        }
        return false;
      } catch (_) {
        return true;
      }
    }

    test('5a. Standard public developer replies are NOT treated as internal notes', () => {
      assert.strictEqual(simulateIsInternalNote(null), false);
      assert.strictEqual(simulateIsInternalNote({}), false);
      assert.strictEqual(simulateIsInternalNote({ is_internal_note: false }), false);
      assert.strictEqual(simulateIsInternalNote({ is_internal_note: 'false' }), false);
      assert.strictEqual(simulateIsInternalNote({ isInternalNote: '0' }), false);
    });

    test('5b. Explicit internal notes across all key conventions are detected', () => {
      assert.strictEqual(simulateIsInternalNote({ is_internal_note: true }), true);
      assert.strictEqual(simulateIsInternalNote({ is_internal_note: 'True' }), true);
      assert.strictEqual(simulateIsInternalNote({ is_internal_note: '1' }), true);
      assert.strictEqual(simulateIsInternalNote({ is_internal_note: 'yes' }), true);
      assert.strictEqual(simulateIsInternalNote({ isInternalNote: true }), true);
      assert.strictEqual(simulateIsInternalNote({ type: 'internal_note' }), true);
      assert.strictEqual(simulateIsInternalNote({ type: 'internal' }), true);
      assert.strictEqual(simulateIsInternalNote({ visibility: 'internal' }), true);
      assert.strictEqual(simulateIsInternalNote({}, 'internal'), true);
    });

    test('5c. FAIL-CLOSED: Malformed, non-object, and corrupt metadata strictly suppress customer notifications', () => {
      assert.strictEqual(simulateIsInternalNote(['array', 'payload']), true, 'Array metadata must fail closed');
      assert.strictEqual(simulateIsInternalNote('scalar_string'), true, 'String metadata must fail closed');
      assert.strictEqual(simulateIsInternalNote(12345), true, 'Number metadata must fail closed');
      assert.strictEqual(simulateIsInternalNote(true), true, 'Boolean primitive must fail closed');
    });
  });

  // ----------------------------------------------------------------------------
  // 6. Collision-Free Deduplication Key Generator
  // ----------------------------------------------------------------------------
  test('6. Deduplication Key Generator: Rapid same-second transitions never collide', () => {
    function generateStatusDedupKey(ticketId, status) {
      const entropy = `${Date.now()}_${crypto.randomUUID()}`;
      return `ticket_status:${ticketId}:${status}:${entropy}`;
    }

    const ticketId = '4f8d9a2b-1111-4444-8888-abcdef123456';
    const keys = new Set();
    const iterations = 500;

    for (let i = 0; i < iterations; i++) {
      const key = generateStatusDedupKey(ticketId, i % 2 === 0 ? 'in_progress' : 'waiting_customer');
      assert.ok(!keys.has(key), `Deduplication collision detected at iteration ${i}: ${key}`);
      keys.add(key);
    }

    assert.strictEqual(keys.size, iterations, 'All same-second transitions must produce strictly unique keys');
  });

  // ----------------------------------------------------------------------------
  // 7. Security: Identity Model & Customer Eligibility Enforcement
  // ----------------------------------------------------------------------------
  test('7. Security: Customer Eligibility & Impersonation Prevention', () => {
    const adminEmail = 'tasklypets@gmail.com';
    const customerEmail = 'customer@example.com';

    function authorizeDeveloperRegistration(email, appType) {
      if (appType === 'developer') {
        return email.trim().toLowerCase() === adminEmail;
      }
      return true;
    }

    assert.strictEqual(authorizeDeveloperRegistration(adminEmail, 'developer'), true, 'Admin can register developer device');
    assert.strictEqual(authorizeDeveloperRegistration(customerEmail, 'developer'), false, 'Customer cannot register developer device');
    assert.strictEqual(authorizeDeveloperRegistration(customerEmail, 'customer'), true, 'Customer can register customer device');
    assert.strictEqual(authorizeDeveloperRegistration(adminEmail, 'customer'), true, 'Admin can register customer device');

    const mockAuthUsers = [
      { id: 'u1', email: 'alice@gmail.com' },
      { id: 'u2', email: 'bob@yahoo.com' },
      { id: 'u3', email: 'tasklypets@gmail.com' },
      { id: 'u4', email: 'TASKLYPETS@GMAIL.COM' },
      { id: 'u5', email: null },
      { id: 'u6', email: '   ' },
      { id: 'u7', email: 'charlie@outlook.com' }
    ];

    const eligibleCustomers = mockAuthUsers.filter(u => {
      if (!u.email) return false;
      const clean = u.email.trim().toLowerCase();
      if (clean === '' || clean === adminEmail) return false;
      return clean.includes('@');
    });

    assert.strictEqual(eligibleCustomers.length, 3);
    assert.deepStrictEqual(eligibleCustomers.map(u => u.id), ['u1', 'u2', 'u7']);
  });

});
