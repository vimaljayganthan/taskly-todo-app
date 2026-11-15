/**
 * Taskly Dual Supabase Push Notification Architecture Test Suite
 * File: tests/dual_supabase_notification_architecture.test.js
 * 
 * Verifies:
 * 1. Independent Supabase Client Separation & Configuration Validation
 * 2. Customer Search & Eligibility (app_metadata vs activity evidence, tokenless, partial search, admin exclusion)
 * 3. Master Notification Dual-Persistence & Foreign-Key Integrity
 * 4. Customer Broadcast Inbox Expansion (all eligible customers, no developer DB leaks)
 * 5. FCM Token Retrieval & Isolated Token Deactivation
 * 6. FCM Partial Failure Handling & In-App Notification Durability
 * 7. Retry Idempotency & Duplicate Prevention
 * 8. Developer Notification Pipeline Isolation
 * 9. Support Ticket Notification Workflows (ticket created, customer message, developer reply, status update)
 */

const { describe, it, before, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const app = require('../server');

const { NotificationService, classifyFcmError } = require('../services/notificationService');
const {
  isEligibleCustomerAccount,
  fetchCustomerActivityEvidence,
  listEligibleCustomerUsers,
  findEligibleCustomerByEmail,
  searchEligibleCustomers,
  DEVELOPER_ADMIN_EMAILS
} = require('../services/customerEligibility');

// Helper to create fully isolated mock Supabase clients
function createDualMockClients() {
  const devDb = {
    notifications: new Map(),
    user_notification_inbox: new Map(),
    notification_outbox: new Map(),
    user_device_tokens: new Map(),
    notification_delivery_logs: new Map(),
    support_tickets: new Map()
  };

  const customerDb = {
    notifications: new Map(),
    user_notification_inbox: new Map(),
    user_device_tokens: new Map(),
    todos: new Map(),
    habits: new Map(),
    support_tickets: new Map(),
    users: []
  };

  // Seed customer users
  // 1. Fully verified customer with app_metadata.is_customer === true
  customerDb.users.push({
    id: 'cust-uuid-1',
    email: 'vimaljayganthan16@gmail.com',
    email_confirmed_at: '2026-11-01T10:00:00Z',
    user_metadata: { name: 'Vimal Jayganthan', onboarded: true },
    app_metadata: { is_customer: true, provider: 'email' }
  });

  // 2. Verified customer WITHOUT device token (tokenless)
  customerDb.users.push({
    id: 'cust-uuid-2-tokenless',
    email: 'sarah.smith@example.com',
    email_confirmed_at: '2026-11-02T10:00:00Z',
    user_metadata: { name: 'Sarah Smith', onboarded: true },
    app_metadata: { is_customer: true, provider: 'email' }
  });

  // 3. Legacy customer WITHOUT app_metadata.is_customer, but WITH customer activity (todos & tokens)
  customerDb.users.push({
    id: 'cust-uuid-3-legacy',
    email: 'alex.activity@example.com',
    email_confirmed_at: '2026-11-03T10:00:00Z',
    user_metadata: { name: 'Alex Johnson' },
    app_metadata: { provider: 'email' } // NO is_customer
  });

  // 4. Developer Administrator (MUST be strictly excluded from customer search/eligibility)
  customerDb.users.push({
    id: 'admin-uuid-dev',
    email: 'tasklypets@gmail.com',
    email_confirmed_at: '2026-11-01T00:00:00Z',
    user_metadata: { name: 'Taskly Developer Admin' },
    app_metadata: { role: 'developer' }
  });

  // 5. Unverified email account (MUST be rejected)
  customerDb.users.push({
    id: 'unverified-uuid-5',
    email: 'unconfirmed@example.com',
    email_confirmed_at: null,
    confirmed_at: null,
    user_metadata: { name: 'Unconfirmed User' },
    app_metadata: { provider: 'email' }
  });

  // 6. Arbitrary unregistered Auth account (verified email, but ZERO customer activity)
  customerDb.users.push({
    id: 'arbitrary-uuid-6',
    email: 'random.visitor@example.com',
    email_confirmed_at: '2026-11-05T10:00:00Z',
    user_metadata: {},
    app_metadata: { provider: 'email' }
  });

  // Seed Customer Device Tokens
  customerDb.user_device_tokens.set('tok-cust-1', {
    id: 'tok-cust-1',
    user_id: 'cust-uuid-1',
    user_email: 'vimaljayganthan16@gmail.com',
    fcm_token: 'fcm_cust_token_valid_1',
    device_platform: 'android',
    app_type: 'customer',
    is_active: true,
    last_seen_at: '2026-11-15T08:00:00Z'
  });

  // Legacy user has a customer device token
  customerDb.user_device_tokens.set('tok-cust-legacy', {
    id: 'tok-cust-legacy',
    user_id: 'cust-uuid-3-legacy',
    user_email: 'alex.activity@example.com',
    fcm_token: 'fcm_cust_legacy_token',
    device_platform: 'android',
    app_type: 'customer',
    is_active: true,
    last_seen_at: '2026-11-15T09:00:00Z'
  });

  // Seed Customer Todos for legacy customer
  customerDb.todos.set('todo-1', {
    id: 'todo-1',
    user_id: 'cust-uuid-3-legacy',
    title: 'Review quarterly goals'
  });

  // Seed Developer Device Tokens in devDb
  devDb.user_device_tokens.set('tok-dev-admin', {
    id: 'tok-dev-admin',
    user_id: 'admin-uuid-dev',
    user_email: 'tasklypets@gmail.com',
    fcm_token: 'fcm_developer_admin_token',
    device_platform: 'android',
    app_type: 'developer',
    is_active: true,
    last_seen_at: '2026-11-15T10:00:00Z'
  });

  function createMockSupabase(db, isCustomer = false) {
    return {
      _db: db,
      auth: {
        admin: {
          listUsers: async ({ page = 1, perPage = 200 } = {}) => {
            const users = db.users || [];
            const start = (page - 1) * perPage;
            return {
              data: { users: users.slice(start, start + perPage) },
              error: null
            };
          }
        }
      },
      rpc: async (fn, params = {}) => {
        if (fn === 'claim_notification_outbox_batch') {
          const batchSize = params.p_batch_size || 10;
          const claimed = [];
          for (const job of db.notification_outbox.values()) {
            if (job.status === 'pending') {
              job.status = 'processing';
              job.worker_id = params.p_worker_id;
              claimed.push({ ...job });
              if (claimed.length >= batchSize) break;
            }
          }
          return { data: claimed, error: null };
        }
        if (fn === 'get_authorized_developer_user_ids') {
          return { data: [{ user_id: 'admin-uuid-dev' }], error: null };
        }
        if (fn === 'mark_outbox_job_completed') {
          const job = db.notification_outbox.get(params.p_job_id);
          if (job) {
            job.status = 'completed';
            job.processed_at = new Date().toISOString();
          }
          return { data: true, error: null };
        }
        if (fn === 'mark_outbox_job_failed') {
          const job = db.notification_outbox.get(params.p_job_id);
          if (job) {
            job.status = params.p_is_permanent ? 'dead_letter' : 'pending';
            job.last_error = params.p_error_message;
          }
          return { data: true, error: null };
        }
        return { data: null, error: null };
      },
      from: (tableName) => {
        const table = db[tableName] || new Map();
        let selectedCols = '*';
        let selectOpts = {};
        let filters = [];
        let orderCol = null;
        let orderAsc = true;
        let limitVal = null;
        let rangeStart = null;
        let rangeEnd = null;

        const chain = {
          select: (cols = '*', opts = {}) => {
            selectedCols = cols;
            selectOpts = opts;
            return chain;
          },
          eq: (col, val) => {
            filters.push({ col, op: 'eq', val });
            return chain;
          },
          in: (col, vals) => {
            filters.push({ col, op: 'in', val: vals });
            return chain;
          },
          gt: (col, val) => {
            filters.push({ col, op: 'gt', val });
            return chain;
          },
          order: (col, opts = {}) => {
            orderCol = col;
            orderAsc = opts.ascending !== false;
            return chain;
          },
          limit: (n) => {
            limitVal = n;
            return chain;
          },
          range: (from, to) => {
            rangeStart = from;
            rangeEnd = to;
            return chain;
          },
          _getFilteredRows: () => {
            let list = Array.from(table.values()).filter(row => {
              return filters.every(f => {
                if (f.op === 'eq') return row[f.col] === f.val;
                if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(row[f.col]);
                if (f.op === 'gt') return row[f.col] > f.val;
                return true;
              });
            });

            if (tableName === 'user_notification_inbox') {
              list = list.map(inboxRow => ({
                ...inboxRow,
                notifications: db.notifications.get(inboxRow.notification_id) || {}
              }));
            }

            const totalCount = list.length;

            if (orderCol) {
              list.sort((a, b) => {
                const valA = a[orderCol] ?? '';
                const valB = b[orderCol] ?? '';
                if (valA < valB) return orderAsc ? -1 : 1;
                if (valA > valB) return orderAsc ? 1 : -1;
                return 0;
              });
            }

            if (rangeStart != null && rangeEnd != null) {
              list = list.slice(rangeStart, rangeEnd + 1);
            } else if (limitVal) {
              list = list.slice(0, limitVal);
            }

            return { list, totalCount };
          },
          single: async () => {
            const { list } = chain._getFilteredRows();
            return { data: list[0] || null, error: list[0] ? null : { message: 'Row not found', code: 'PGRST116' } };
          },
          maybeSingle: async () => {
            const { list } = chain._getFilteredRows();
            return { data: list[0] || null, error: null };
          },
          insert: (rows) => {
            const records = Array.isArray(rows) ? rows : [rows];
            const inserted = [];
            for (const r of records) {
              const id = r.id || `uuid_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
              const rec = { id, created_at: new Date().toISOString(), ...r };

              // Foreign key validation for user_notification_inbox!
              if (tableName === 'user_notification_inbox') {
                if (!db.notifications.has(rec.notification_id)) {
                  const fkErr = new Error(`violates foreign key constraint "user_notification_inbox_notification_id_fkey" in ${isCustomer ? 'Customer DB' : 'Developer DB'}`);
                  fkErr.code = '23503';
                  return {
                    select: () => ({
                      single: async () => ({ data: null, error: fkErr }),
                      maybeSingle: async () => ({ data: null, error: fkErr }),
                      then: (resolve, reject) => Promise.resolve({ data: null, error: fkErr }).then(resolve, reject)
                    }),
                    then: (resolve, reject) => Promise.resolve({ data: null, error: fkErr }).then(resolve, reject)
                  };
                }
              }

              // Foreign key validation for notification_delivery_logs in Developer DB!
              if (tableName === 'notification_delivery_logs') {
                if (!db.notifications.has(rec.notification_id)) {
                  const fkErr = new Error(`violates foreign key constraint "notification_delivery_logs_notification_id_fkey" in Developer DB`);
                  fkErr.code = '23503';
                  return {
                    select: () => ({
                      single: async () => ({ data: null, error: fkErr }),
                      maybeSingle: async () => ({ data: null, error: fkErr }),
                      then: (resolve, reject) => Promise.resolve({ data: null, error: fkErr }).then(resolve, reject)
                    }),
                    then: (resolve, reject) => Promise.resolve({ data: null, error: fkErr }).then(resolve, reject)
                  };
                }
              }

              table.set(id, rec);
              inserted.push(rec);
            }
            const res = { data: Array.isArray(rows) ? inserted : inserted[0], error: null };
            return {
              select: () => ({
                single: async () => ({ data: inserted[0], error: null }),
                maybeSingle: async () => ({ data: inserted[0], error: null }),
                then: (resolve, reject) => Promise.resolve(res).then(resolve, reject)
              }),
              then: (resolve, reject) => Promise.resolve(res).then(resolve, reject)
            };
          },
          upsert: (rows, opts = {}) => {
            const records = Array.isArray(rows) ? rows : [rows];
            const saved = [];
            for (const r of records) {
              // Find matching by onConflict or id
              let key = r.id;
              if (opts.onConflict === 'user_id,notification_id') {
                for (const existing of table.values()) {
                  if (existing.user_id === r.user_id && existing.notification_id === r.notification_id) {
                    key = existing.id;
                    break;
                  }
                }
              } else if (opts.onConflict === 'notification_id,device_token_id') {
                for (const existing of table.values()) {
                  if (existing.notification_id === r.notification_id && existing.device_token_id === r.device_token_id) {
                    key = existing.id;
                    break;
                  }
                }
              } else if (opts.onConflict === 'fcm_token') {
                for (const existing of table.values()) {
                  if (existing.fcm_token === r.fcm_token) {
                    key = existing.id;
                    break;
                  }
                }
              }

              // Foreign key check for user_notification_inbox
              if (tableName === 'user_notification_inbox') {
                if (!db.notifications.has(r.notification_id)) {
                  const fkErr = new Error(`violates foreign key constraint "user_notification_inbox_notification_id_fkey" in ${isCustomer ? 'Customer DB' : 'Developer DB'}`);
                  fkErr.code = '23503';
                  return {
                    select: () => ({
                      single: async () => ({ data: null, error: fkErr }),
                      maybeSingle: async () => ({ data: null, error: fkErr }),
                      then: (resolve, reject) => Promise.resolve({ data: null, error: fkErr }).then(resolve, reject)
                    }),
                    then: (resolve, reject) => Promise.resolve({ data: null, error: fkErr }).then(resolve, reject)
                  };
                }
              }

              // Foreign key check for notification_delivery_logs
              if (tableName === 'notification_delivery_logs') {
                if (!db.notifications.has(r.notification_id)) {
                  const fkErr = new Error(`violates foreign key constraint "notification_delivery_logs_notification_id_fkey" in Developer DB`);
                  fkErr.code = '23503';
                  return {
                    select: () => ({
                      single: async () => ({ data: null, error: fkErr }),
                      maybeSingle: async () => ({ data: null, error: fkErr }),
                      then: (resolve, reject) => Promise.resolve({ data: null, error: fkErr }).then(resolve, reject)
                    }),
                    then: (resolve, reject) => Promise.resolve({ data: null, error: fkErr }).then(resolve, reject)
                  };
                }
              }

              if (!key) {
                key = `uuid_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
              }
              const rec = { ...(table.get(key) || {}), id: key, ...r };
              table.set(key, rec);
              saved.push(rec);
            }
            const res = { data: Array.isArray(rows) ? saved : saved[0], error: null };
            return {
              select: () => ({
                single: async () => ({ data: saved[0], error: null }),
                maybeSingle: async () => ({ data: saved[0], error: null }),
                then: (resolve, reject) => Promise.resolve(res).then(resolve, reject)
              }),
              then: (resolve, reject) => Promise.resolve(res).then(resolve, reject)
            };
          },
          update: (updates) => {
            const updateFilters = [];
            const executeUpdate = () => {
              let count = 0;
              const matched = [];
              for (const row of table.values()) {
                if (updateFilters.every(f => row[f.col] === f.val)) {
                  Object.assign(row, updates);
                  count++;
                  matched.push({ ...row });
                }
              }
              return { data: matched, count, error: null };
            };

            const uChain = {
              eq: (col, val) => {
                updateFilters.push({ col, val });
                return uChain;
              },
              select: () => ({
                single: async () => {
                  const res = executeUpdate();
                  return { data: res.data[0] || null, error: res.data[0] ? null : { message: 'Row not found' } };
                },
                maybeSingle: async () => {
                  const res = executeUpdate();
                  return { data: res.data[0] || null, error: null };
                },
                then: (resolve, reject) => Promise.resolve(executeUpdate()).then(resolve, reject)
              }),
              single: async () => {
                const res = executeUpdate();
                return { data: res.data[0] || null, error: res.data[0] ? null : { message: 'Row not found' } };
              },
              maybeSingle: async () => {
                const res = executeUpdate();
                return { data: res.data[0] || null, error: null };
              },
              then: (resolve, reject) => {
                const res = executeUpdate();
                Promise.resolve({ data: null, error: null, count: res.count }).then(resolve, reject);
              }
            };
            return uChain;
          },
          then: (resolve, reject) => {
            const { list, totalCount } = chain._getFilteredRows();
            if (selectOpts.head === true) {
              Promise.resolve({ data: [], count: totalCount, error: null }).then(resolve, reject);
            } else {
              Promise.resolve({ data: list, count: totalCount, error: null }).then(resolve, reject);
            }
          }
        };
        return chain;
      }
    };
  }

  const devSupabase = createMockSupabase(devDb, false);
  const custSupabase = createMockSupabase(customerDb, true);

  return { devSupabase, custSupabase, devDb, customerDb };
}

describe('Taskly Dual Supabase Notification Architecture Suite', () => {
  let devSupabase;
  let custSupabase;
  let devDb;
  let customerDb;
  let mockMessaging;
  let sentMessages;

  beforeEach(() => {
    const clients = createDualMockClients();
    devSupabase = clients.devSupabase;
    custSupabase = clients.custSupabase;
    devDb = clients.devDb;
    customerDb = clients.customerDb;

    sentMessages = [];
    mockMessaging = {
      send: async (payload) => {
        sentMessages.push(payload);
        return `projects/taskly-notifications/messages/fcm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      }
    };
  });

  // ==========================================================================
  // Section 1: Supabase Client Separation & Configuration Validation
  // ==========================================================================
  describe('1. Supabase Client Separation & Configuration Validation', () => {
    it('1.1 Developer Supabase client and Customer Supabase client are separate instances', () => {
      assert.notStrictEqual(devSupabase, custSupabase);
      assert.notStrictEqual(devDb, customerDb);
    });

    it('1.2 Customer Supabase client queries point strictly to Customer Database', async () => {
      const { data: custTokens } = await custSupabase
        .from('user_device_tokens')
        .select('*')
        .eq('app_type', 'customer');

      assert.strictEqual(custTokens.length, 2);
      assert.strictEqual(custTokens[0].user_email, 'vimaljayganthan16@gmail.com');

      // Developer DB has zero customer tokens
      const { data: devCustTokens } = await devSupabase
        .from('user_device_tokens')
        .select('*')
        .eq('app_type', 'customer');
      assert.strictEqual(devCustTokens.length, 0);
    });

    it('1.3 Developer Supabase client queries point strictly to Developer Database', async () => {
      const { data: devTokens } = await devSupabase
        .from('user_device_tokens')
        .select('*')
        .eq('app_type', 'developer');

      assert.strictEqual(devTokens.length, 1);
      assert.strictEqual(devTokens[0].user_email, 'tasklypets@gmail.com');

      // Customer DB has zero developer tokens
      const { data: custDevTokens } = await custSupabase
        .from('user_device_tokens')
        .select('*')
        .eq('app_type', 'developer');
      assert.strictEqual(custDevTokens.length, 0);
    });
  });

  // ==========================================================================
  // Section 2: Customer Eligibility, Search & Recipient Validation
  // ==========================================================================
  describe('2. Customer Eligibility, Search & Recipient Validation', () => {
    it('2.1 Verified customer with app_metadata.is_customer is eligible', () => {
      const user = customerDb.users[0]; // vimaljayganthan16@gmail.com
      assert.strictEqual(isEligibleCustomerAccount(user), true);
    });

    it('2.2 Verified customer WITHOUT device token remains 100% eligible (tokenless customer)', async () => {
      const tokenlessUser = customerDb.users[1]; // sarah.smith@example.com
      assert.strictEqual(isEligibleCustomerAccount(tokenlessUser), true);

      // Verify they appear in customer search with is_active = false
      const results = await searchEligibleCustomers(custSupabase, { search: 'sarah' });
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].user_email, 'sarah.smith@example.com');
      assert.strictEqual(results[0].is_active, false);
      assert.strictEqual(results[0].device_platform, 'customer');
    });

    it('2.3 Legacy customer WITHOUT is_customer qualifies via authoritative customer activity evidence', async () => {
      const legacyUser = customerDb.users[2]; // alex.activity@example.com
      assert.strictEqual(legacyUser.app_metadata.is_customer, undefined);

      // Raw user without evidence fails
      assert.strictEqual(isEligibleCustomerAccount(legacyUser), false);

      // When checked against Customer Supabase activity evidence (todos / tokens), qualifies
      const evidence = await fetchCustomerActivityEvidence(custSupabase, [legacyUser.id]);
      assert.strictEqual(evidence.has(legacyUser.id), true);

      assert.strictEqual(isEligibleCustomerAccount(legacyUser, evidence), true);

      // Appears in search
      const searchRes = await searchEligibleCustomers(custSupabase, { search: 'alex' });
      assert.strictEqual(searchRes.length, 1);
      assert.strictEqual(searchRes[0].user_email, 'alex.activity@example.com');
      assert.strictEqual(searchRes[0].is_active, true);
    });

    it('2.4 Developer administrator (tasklypets@gmail.com) is strictly excluded from customer eligibility', async () => {
      const adminUser = customerDb.users[3]; // tasklypets@gmail.com
      assert.strictEqual(isEligibleCustomerAccount(adminUser), false);

      const searchRes = await searchEligibleCustomers(custSupabase, { search: 'tasklypets' });
      assert.strictEqual(searchRes.length, 0);

      const byEmail = await findEligibleCustomerByEmail(custSupabase, 'tasklypets@gmail.com');
      assert.strictEqual(byEmail, null);
    });

    it('2.5 Unverified email account is rejected', async () => {
      const unverified = customerDb.users[4];
      assert.strictEqual(isEligibleCustomerAccount(unverified), false);

      const byEmail = await findEligibleCustomerByEmail(custSupabase, 'unconfirmed@example.com');
      assert.strictEqual(byEmail, null);
    });

    it('2.6 Arbitrary unregistered Auth account with zero customer activity is rejected', async () => {
      const arbitrary = customerDb.users[5];
      assert.strictEqual(isEligibleCustomerAccount(arbitrary), false);

      const byEmail = await findEligibleCustomerByEmail(custSupabase, 'random.visitor@example.com');
      assert.strictEqual(byEmail, null);
    });

    it('2.7 Partial email search functions case-insensitively', async () => {
      const results = await searchEligibleCustomers(custSupabase, { search: 'vimal' });
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].user_email, 'vimaljayganthan16@gmail.com');

      const upperResults = await searchEligibleCustomers(custSupabase, { search: 'VIMAL' });
      assert.strictEqual(upperResults.length, 1);
      assert.strictEqual(upperResults[0].user_email, 'vimaljayganthan16@gmail.com');
    });
  });

  // ==========================================================================
  // Section 3: Master Notification Dual-Persistence & Foreign-Key Integrity
  // ==========================================================================
  describe('3. Master Notification Dual-Persistence & Foreign-Key Integrity', () => {
    it('3.1 Customer single notification creates master row in Customer DB and Developer DB', async () => {
      const worker = new NotificationService({
        supabaseClient: devSupabase,
        customerSupabaseClient: custSupabase,
        messagingProvider: mockMessaging,
        allowMockDelivery: true
      });

      const job = {
        id: 'job-direct-1',
        event_type: 'admin_custom_direct',
        target_audience: 'customer_single',
        recipient_user_id: 'cust-uuid-1',
        recipient_email: 'vimaljayganthan16@gmail.com',
        title: 'Order Shipped',
        body: 'Your item is on the way',
        data: {},
        priority: 'high',
        deduplication_key: 'dedup_order_shipped_1',
        status: 'processing'
      };

      const result = await worker.processJob(job);
      assert.strictEqual(result.completed, true);

      // Verify master notification exists in Customer DB
      const custMaster = Array.from(customerDb.notifications.values()).find(n => n.idempotency_key === job.deduplication_key);
      assert.ok(custMaster, 'Master notification must exist in Customer DB');
      assert.strictEqual(custMaster.title, 'Order Shipped');

      // Verify master notification exists in Developer DB
      const devMaster = Array.from(devDb.notifications.values()).find(n => n.idempotency_key === job.deduplication_key);
      assert.ok(devMaster, 'Master notification must exist in Developer DB');

      // Verify user_notification_inbox in Customer DB references Customer master ID
      const custInbox = Array.from(customerDb.user_notification_inbox.values());
      assert.strictEqual(custInbox.length, 1);
      assert.strictEqual(custInbox[0].user_id, 'cust-uuid-1');
      assert.strictEqual(custInbox[0].notification_id, custMaster.id, 'Inbox must reference Customer DB master UUID');

      // Verify ZERO customer inbox rows exist in Developer DB
      assert.strictEqual(devDb.user_notification_inbox.size, 0, 'No customer inbox rows should be written to Developer DB');

      // Verify notification_delivery_logs in Developer DB references Developer master ID
      const devLogs = Array.from(devDb.notification_delivery_logs.values());
      assert.strictEqual(devLogs.length, 1);
      assert.strictEqual(devLogs[0].notification_id, devMaster.id, 'Delivery log must reference Developer DB master UUID');
      assert.strictEqual(devLogs[0].status, 'fcm_accepted');
    });

    it('3.2 Broadcast notification creates inbox rows in Customer DB for ALL eligible customers', async () => {
      const worker = new NotificationService({
        supabaseClient: devSupabase,
        customerSupabaseClient: custSupabase,
        messagingProvider: mockMessaging,
        allowMockDelivery: true
      });

      const broadcastJob = {
        id: 'job-broadcast-1',
        event_type: 'admin_custom_broadcast',
        target_audience: 'customer_all',
        title: 'Platform Maintenance Notice',
        body: 'Taskly will undergo scheduled upgrades tonight.',
        data: {},
        priority: 'normal',
        deduplication_key: 'dedup_maintenance_tonight',
        status: 'processing'
      };

      const result = await worker.processJob(broadcastJob);
      assert.strictEqual(result.completed, true);

      // Master notification in Customer DB
      const custMaster = Array.from(customerDb.notifications.values()).find(n => n.idempotency_key === broadcastJob.deduplication_key);
      assert.ok(custMaster);

      // Inbox rows in Customer DB: all eligible customers (Vimal, Sarah, Alex) = 3
      const custInbox = Array.from(customerDb.user_notification_inbox.values());
      assert.strictEqual(custInbox.length, 3, 'Must create inbox records for all 3 eligible customers');

      const recipientIds = new Set(custInbox.map(i => i.user_id));
      assert.ok(recipientIds.has('cust-uuid-1'), 'Vimal must have inbox record');
      assert.ok(recipientIds.has('cust-uuid-2-tokenless'), 'Tokenless Sarah must have inbox record');
      assert.ok(recipientIds.has('cust-uuid-3-legacy'), 'Legacy Alex must have inbox record');
      assert.ok(!recipientIds.has('admin-uuid-dev'), 'Developer admin must NOT have customer inbox record');
      assert.ok(!recipientIds.has('unverified-uuid-5'), 'Unverified account must NOT have inbox record');

      // All customer inbox records point to Customer DB master notification ID
      for (const row of custInbox) {
        assert.strictEqual(row.notification_id, custMaster.id);
      }

      // Zero customer inbox rows written to Developer DB
      assert.strictEqual(devDb.user_notification_inbox.size, 0);
    });
  });

  // ==========================================================================
  // Section 4: FCM Token Retrieval & Deactivation Isolation
  // ==========================================================================
  describe('4. FCM Token Retrieval & Deactivation Isolation', () => {
    it('4.1 FCM tokens are retrieved strictly from Customer DB for customer notifications', async () => {
      const worker = new NotificationService({
        supabaseClient: devSupabase,
        customerSupabaseClient: custSupabase,
        messagingProvider: mockMessaging,
        allowMockDelivery: true
      });

      const tokens = await worker.fetchAllTargetTokens({
        target_audience: 'customer_single',
        recipient_user_id: 'cust-uuid-1'
      });

      assert.strictEqual(tokens.length, 1);
      assert.strictEqual(tokens[0].fcm_token, 'fcm_cust_token_valid_1');
      assert.strictEqual(tokens[0].app_type, 'customer');
    });

    it('4.2 Confirmed invalid customer token is deactivated ONLY in Customer DB', async () => {
      // Mock FCM to return invalid token error
      const invalidTokenMessaging = {
        send: async () => {
          const err = new Error('The registration token is not a valid FCM registration token');
          err.code = 'messaging/invalid-registration-token';
          throw err;
        }
      };

      const worker = new NotificationService({
        supabaseClient: devSupabase,
        customerSupabaseClient: custSupabase,
        messagingProvider: invalidTokenMessaging,
        allowMockDelivery: true
      });

      const job = {
        id: 'job-invalid-tok',
        event_type: 'admin_custom_direct',
        target_audience: 'customer_single',
        recipient_user_id: 'cust-uuid-1',
        recipient_email: 'vimaljayganthan16@gmail.com',
        title: 'Test Invalid Token',
        body: 'Testing token deactivation',
        deduplication_key: 'dedup_invalid_tok_1',
        status: 'processing'
      };

      await worker.processJob(job);

      // Verify token in Customer DB is marked is_active = false
      const custTok = customerDb.user_device_tokens.get('tok-cust-1');
      assert.strictEqual(custTok.is_active, false, 'Invalid token must be deactivated in Customer DB');

      // Verify developer token in Developer DB remains untouched and active!
      const devTok = devDb.user_device_tokens.get('tok-dev-admin');
      assert.strictEqual(devTok.is_active, true, 'Developer token must NEVER be deactivated');
    });
  });

  // ==========================================================================
  // Section 5: FCM Partial Failure & In-App Notification Durability
  // ==========================================================================
  describe('5. FCM Partial Failure & In-App Notification Durability', () => {
    it('5.1 Transient FCM error reschedules outbox job without losing persisted customer inbox row', async () => {
      let callCount = 0;
      const transientFailingMessaging = {
        send: async () => {
          callCount++;
          const err = new Error('Server unavailable');
          err.code = 'messaging/server-unavailable';
          throw err;
        }
      };

      const worker = new NotificationService({
        supabaseClient: devSupabase,
        customerSupabaseClient: custSupabase,
        messagingProvider: transientFailingMessaging,
        allowMockDelivery: true
      });

      const job = {
        id: 'job-transient-1',
        event_type: 'admin_custom_direct',
        target_audience: 'customer_single',
        recipient_user_id: 'cust-uuid-1',
        recipient_email: 'vimaljayganthan16@gmail.com',
        title: 'Account Verification',
        body: 'Please verify your phone',
        deduplication_key: 'dedup_transient_1',
        status: 'processing'
      };

      const result = await worker.processJob(job);
      assert.strictEqual(result.completed, false);
      assert.strictEqual(result.retryScheduled, true);

      // In-app inbox row was ALREADY persisted in Customer DB and NOT lost!
      const custInbox = Array.from(customerDb.user_notification_inbox.values());
      assert.strictEqual(custInbox.length, 1);
      assert.strictEqual(custInbox[0].user_id, 'cust-uuid-1');

      // Device token remains active for retry
      const tok = customerDb.user_device_tokens.get('tok-cust-1');
      assert.strictEqual(tok.is_active, true);
    });
  });

  // ==========================================================================
  // Section 6: Retry Idempotency & Duplicate Prevention
  // ==========================================================================
  describe('6. Retry Idempotency & Duplicate Prevention', () => {
    it('6.1 Retrying an outbox job does NOT create duplicate master notifications or duplicate inboxes', async () => {
      const worker = new NotificationService({
        supabaseClient: devSupabase,
        customerSupabaseClient: custSupabase,
        messagingProvider: mockMessaging,
        allowMockDelivery: true
      });

      const job = {
        id: 'job-idempotent-1',
        event_type: 'admin_custom_direct',
        target_audience: 'customer_single',
        recipient_user_id: 'cust-uuid-1',
        recipient_email: 'vimaljayganthan16@gmail.com',
        title: 'Duplicate Test Alert',
        body: 'Testing idempotency',
        deduplication_key: 'dedup_idempotency_unique_test',
        status: 'processing'
      };

      // Run 1
      await worker.processJob(job);
      const initialCustMasterCount = customerDb.notifications.size;
      const initialCustInboxCount = customerDb.user_notification_inbox.size;
      const initialSentCount = sentMessages.length;

      assert.strictEqual(initialCustMasterCount, 1);
      assert.strictEqual(initialCustInboxCount, 1);
      assert.strictEqual(initialSentCount, 1);

      // Run 2 (Simulating immediate retry or re-sweep)
      await worker.processJob(job);

      assert.strictEqual(customerDb.notifications.size, 1, 'Zero duplicate master notifications');
      assert.strictEqual(customerDb.user_notification_inbox.size, 1, 'Zero duplicate inbox records');

      // The device token already reached fcm_accepted in delivery logs, so it was filtered out and NOT resent!
      assert.strictEqual(sentMessages.length, initialSentCount, 'Already-accepted token is not resent on retry');
    });
  });

  // ==========================================================================
  // Section 7: Developer Notification Pipeline Isolation
  // ==========================================================================
  describe('7. Developer Notification Pipeline Isolation', () => {
    it('7.1 Developer notification creates inbox and delivery log ONLY in Developer DB', async () => {
      const worker = new NotificationService({
        supabaseClient: devSupabase,
        customerSupabaseClient: custSupabase,
        messagingProvider: mockMessaging,
        allowMockDelivery: true
      });

      const devJob = {
        id: 'job-dev-alert-1',
        event_type: 'new_ticket',
        target_audience: 'developer_all',
        recipient_email: 'tasklypets@gmail.com',
        title: 'New Support Ticket #TK-101',
        body: 'Customer submitted ticket: Cannot sync todos',
        deduplication_key: 'dedup_dev_new_ticket_101',
        status: 'processing'
      };

      const result = await worker.processJob(devJob);
      assert.strictEqual(result.completed, true);

      // Verify developer inbox in Developer DB
      const devInbox = Array.from(devDb.user_notification_inbox.values());
      assert.strictEqual(devInbox.length, 1);
      assert.strictEqual(devInbox[0].user_id, 'admin-uuid-dev');

      // Verify ZERO impact on Customer DB
      assert.strictEqual(customerDb.notifications.size, 0, 'No rows created in Customer DB notifications');
      assert.strictEqual(customerDb.user_notification_inbox.size, 0, 'No rows created in Customer DB inbox');

      // Delivery log in Developer DB
      const logs = Array.from(devDb.notification_delivery_logs.values());
      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0].device_token_id, 'tok-dev-admin');
      assert.strictEqual(logs[0].status, 'fcm_accepted');
    });
  });

  // ==========================================================================
  // Section 8: Support Ticket Notification Workflows
  // ==========================================================================
  describe('8. Support Ticket Notification Workflows', () => {
    it('8.1 Customer ticket creation and customer message enqueue developer notifications', async () => {
      // Simulate ticket creation outbox row
      const ticketId = 'tck-123';
      const ticketCode = 'TK-456';
      const client = devSupabase;

      const { data: job1 } = await client.from('notification_outbox').insert({
        event_type: 'new_ticket',
        target_audience: 'developer_all',
        recipient_email: 'tasklypets@gmail.com',
        title: `New Ticket: ${ticketCode}`,
        body: 'Customer submitted urgent ticket',
        data: { ticket_id: ticketId, ticket_code: ticketCode, screen: 'ticket_detail' },
        priority: 'high',
        deduplication_key: `new_ticket_${ticketId}`
      }).select().single();

      assert.strictEqual(job1.event_type, 'new_ticket');
      assert.strictEqual(job1.target_audience, 'developer_all');

      // Process job via worker
      const worker = new NotificationService({
        supabaseClient: devSupabase,
        customerSupabaseClient: custSupabase,
        messagingProvider: mockMessaging,
        allowMockDelivery: true
      });

      const res = await worker.processJob(job1);
      assert.strictEqual(res.completed, true);

      // Verify developer receives inbox entry in Developer DB
      const devInbox = Array.from(devDb.user_notification_inbox.values());
      assert.ok(devInbox.some(i => i.user_id === 'admin-uuid-dev'));
    });

    it('8.2 Developer reply enqueues customer_single ticket_reply notification targeting Customer DB', async () => {
      const client = devSupabase;
      const messageId = 'msg-dev-reply-1';
      const ticketId = 'tck-123';

      const { data: replyJob } = await client.from('notification_outbox').insert({
        event_type: 'ticket_reply',
        target_audience: 'customer_single',
        recipient_user_id: 'cust-uuid-1',
        recipient_email: 'vimaljayganthan16@gmail.com',
        title: 'Support Reply: TK-456',
        body: 'We have updated your account settings.',
        data: { ticket_id: ticketId, ticket_code: 'TK-456', screen: 'support' },
        priority: 'high',
        deduplication_key: `ticket_reply_${messageId}`
      }).select().single();

      assert.strictEqual(replyJob.event_type, 'ticket_reply');
      assert.strictEqual(replyJob.target_audience, 'customer_single');

      const worker = new NotificationService({
        supabaseClient: devSupabase,
        customerSupabaseClient: custSupabase,
        messagingProvider: mockMessaging,
        allowMockDelivery: true
      });

      const res = await worker.processJob(replyJob);
      assert.strictEqual(res.completed, true);

      // Master notification and inbox in Customer DB
      const custMaster = Array.from(customerDb.notifications.values()).find(n => n.idempotency_key === replyJob.deduplication_key);
      assert.ok(custMaster, 'Master row in Customer DB');

      const custInbox = Array.from(customerDb.user_notification_inbox.values()).filter(i => i.user_id === 'cust-uuid-1');
      assert.ok(custInbox.some(i => i.notification_id === custMaster.id), 'Customer inbox has reply notification');
    });

    it('8.3 Developer status change enqueues customer_single status_changed notification', async () => {
      const client = devSupabase;
      const ticketId = 'tck-123';

      const { data: statusJob } = await client.from('notification_outbox').insert({
        event_type: 'status_changed',
        target_audience: 'customer_single',
        recipient_user_id: 'cust-uuid-1',
        recipient_email: 'vimaljayganthan16@gmail.com',
        title: 'Ticket TK-456 Updated',
        body: 'Status changed to resolved',
        data: { ticket_id: ticketId, ticket_code: 'TK-456', status: 'resolved', screen: 'support' },
        priority: 'high',
        deduplication_key: `ticket_status_${ticketId}_resolved_test`
      }).select().single();

      const worker = new NotificationService({
        supabaseClient: devSupabase,
        customerSupabaseClient: custSupabase,
        messagingProvider: mockMessaging,
        allowMockDelivery: true
      });

      const res = await worker.processJob(statusJob);
      assert.strictEqual(res.completed, true);

      const custMaster = Array.from(customerDb.notifications.values()).find(n => n.idempotency_key === statusJob.deduplication_key);
      assert.ok(custMaster);
      assert.strictEqual(custMaster.notification_type, 'status_changed');

      const custInbox = Array.from(customerDb.user_notification_inbox.values()).filter(i => i.user_id === 'cust-uuid-1');
      assert.ok(custInbox.some(i => i.notification_id === custMaster.id));
    });
  });

  // ==========================================================================
  // Section 9: Environment Configuration Validation & Fail-Closed Security
  // ==========================================================================
  describe('9. Environment Configuration Validation & Fail-Closed Security', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('9.1 validateSupabaseClients verifies both projects and fails closed if customer credentials missing in production', () => {
      const app = require('../server');
      if (typeof app.validateSupabaseClients === 'function') {
        process.env.NODE_ENV = 'production';
        process.env.SUPABASE_URL = 'https://mbmqybxwibvqzomssopw.supabase.co';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-dev-key';
        delete process.env.CUSTOMER_SUPABASE_URL;
        delete process.env.CUSTOMER_SUPABASE_SERVICE_ROLE_KEY;

        assert.throws(() => {
          app.validateSupabaseClients();
        }, /Customer Supabase service-role credentials/);

        // When customer credentials added, succeeds
        process.env.CUSTOMER_SUPABASE_URL = 'https://liucmamlownxfshnaxtc.supabase.co';
        process.env.CUSTOMER_SUPABASE_SERVICE_ROLE_KEY = 'mock-customer-key';

        const result = app.validateSupabaseClients();
        assert.strictEqual(result.developerConfigured, true);
        assert.strictEqual(result.customerConfigured, true);
        assert.strictEqual(result.developerProject, 'mbmqybxwibvqzomssopw');
        assert.strictEqual(result.customerProject, 'liucmamlownxfshnaxtc');
      }
    });
  });

  // ==========================================================================
  // Section 10: Live HTTP API Audience Routing & Strict Database Isolation
  // ==========================================================================
  describe('10. Live HTTP API Audience Routing & Strict Database Isolation', () => {
    let server;
    let baseUrl;
    let devSupabase;
    let custSupabase;
    let devDb;
    let customerDb;

    before((t, done) => {
      const dual = createDualMockClients();
      devDb = dual.devDb;
      customerDb = dual.customerDb;
      devSupabase = dual.devSupabase;
      custSupabase = dual.custSupabase;

      // Seed initial customer notification & inbox row in customerDb
      const custNotif = {
        id: 'cust-notif-101',
        notification_type: 'ticket_reply',
        title: 'Customer Update: TK-101',
        body: 'Your ticket has been updated',
        data: { ticket_id: 'tck-101' },
        sender_email: 'tasklypets@gmail.com',
        created_at: new Date().toISOString()
      };
      customerDb.notifications.set(custNotif.id, custNotif);

      const custInbox = {
        id: 'cust-inbox-row-1',
        user_id: 'cust-uuid-1',
        notification_id: custNotif.id,
        is_read: false,
        read_at: null,
        is_dismissed: false,
        created_at: new Date().toISOString()
      };
      customerDb.user_notification_inbox.set(custInbox.id, custInbox);

      // Seed initial developer notification & inbox row in devDb
      const devNotif = {
        id: 'dev-notif-201',
        notification_type: 'new_ticket',
        title: 'New Customer Ticket',
        body: 'Customer opened ticket TK-999',
        data: { ticket_id: 'tck-999' },
        sender_email: 'vimaljayganthan16@gmail.com',
        created_at: new Date().toISOString()
      };
      devDb.notifications.set(devNotif.id, devNotif);

      const devInbox = {
        id: 'dev-inbox-row-1',
        user_id: 'admin-uuid-dev',
        notification_id: devNotif.id,
        is_read: false,
        read_at: null,
        is_dismissed: false,
        created_at: new Date().toISOString()
      };
      devDb.user_notification_inbox.set(devInbox.id, devInbox);

      // Inject mock clients into app locals
      app.locals.mockSupabaseClient = devSupabase;
      app.locals.mockCustomerSupabaseClient = custSupabase;

      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        done();
      });
    });

    after((t, done) => {
      if (server) {
        server.close(done);
      } else {
        done();
      }
    });

    it('10.1 getAuthenticatedAudienceClient resolves database strictly from authenticated email identity', () => {
      // Developer admin session routes to Developer Supabase
      const devReq = { user: { email: 'tasklypets@gmail.com' }, app: { locals: app.locals } };
      const devClient = app.getAuthenticatedAudienceClient(devReq);
      assert.strictEqual(devClient, devSupabase);

      // Customer session routes to Customer Supabase
      const custReq = { user: { email: 'vimaljayganthan16@gmail.com' }, app: { locals: app.locals } };
      const custClient = app.getAuthenticatedAudienceClient(custReq);
      assert.strictEqual(custClient, custSupabase);

      // Unknown or arbitrary user session routes to Customer Supabase (never leaks into Developer DB)
      const unknownReq = { user: { email: 'random.visitor@example.com' }, app: { locals: app.locals } };
      const fallbackClient = app.getAuthenticatedAudienceClient(unknownReq);
      assert.strictEqual(fallbackClient, custSupabase);
    });

    it('10.2 POST /api/notifications/tokens (Customer) routes strictly to Customer Supabase', async () => {
      const res = await fetch(`${baseUrl}/api/notifications/tokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock-user:cust-uuid-1:vimaljayganthan16%40gmail.com'
        },
        body: JSON.stringify({
          fcm_token: 'fcm_cust_live_token_http_1',
          app_type: 'customer',
          device_platform: 'android',
          device_model: 'Pixel 8 Pro',
          app_version: '2.2.0'
        })
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.token.fcm_token, 'fcm_cust_live_token_http_1');

      // Verify token exists in Customer DB
      const custToken = Array.from(customerDb.user_device_tokens.values()).find(t => t.fcm_token === 'fcm_cust_live_token_http_1');
      assert.ok(custToken, 'Device token was written to Customer DB');
      assert.strictEqual(custToken.user_id, 'cust-uuid-1');
      assert.strictEqual(custToken.user_email, 'vimaljayganthan16@gmail.com');
      assert.strictEqual(custToken.is_active, true);

      // Verify token does NOT exist in Developer DB
      const devToken = Array.from(devDb.user_device_tokens.values()).find(t => t.fcm_token === 'fcm_cust_live_token_http_1');
      assert.strictEqual(devToken, undefined, 'Customer device token must NEVER be written to Developer DB');
    });

    it('10.3 DELETE /api/notifications/tokens (Customer) deactivates token strictly in Customer Supabase', async () => {
      const res = await fetch(`${baseUrl}/api/notifications/tokens`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock-user:cust-uuid-1:vimaljayganthan16%40gmail.com'
        },
        body: JSON.stringify({
          fcm_token: 'fcm_cust_live_token_http_1'
        })
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);

      const custToken = Array.from(customerDb.user_device_tokens.values()).find(t => t.fcm_token === 'fcm_cust_live_token_http_1');
      assert.strictEqual(custToken.is_active, false);

      // Verify Developer DB remained untouched
      const devToken = Array.from(devDb.user_device_tokens.values()).find(t => t.fcm_token === 'fcm_cust_live_token_http_1');
      assert.strictEqual(devToken, undefined);
    });

    it('10.4 POST /api/notifications/tokens (Developer) routes strictly to Developer Supabase', async () => {
      const res = await fetch(`${baseUrl}/api/notifications/tokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock-user:admin-uuid-dev:tasklypets%40gmail.com'
        },
        body: JSON.stringify({
          fcm_token: 'fcm_dev_live_token_http_2',
          app_type: 'developer',
          device_platform: 'android',
          device_model: 'Developer Tablet',
          app_version: '2.2.0'
        })
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);

      // Verify token exists in Developer DB
      const devToken = Array.from(devDb.user_device_tokens.values()).find(t => t.fcm_token === 'fcm_dev_live_token_http_2');
      assert.ok(devToken, 'Device token was written to Developer DB');
      assert.strictEqual(devToken.user_id, 'admin-uuid-dev');
      assert.strictEqual(devToken.user_email, 'tasklypets@gmail.com');

      // Verify token does NOT exist in Customer DB
      const custToken = Array.from(customerDb.user_device_tokens.values()).find(t => t.fcm_token === 'fcm_dev_live_token_http_2');
      assert.strictEqual(custToken, undefined, 'Developer token must NEVER be written to Customer DB');
    });

    it('10.5 Customer attempting app_type: developer is strictly rejected with 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/notifications/tokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock-user:cust-uuid-1:vimaljayganthan16%40gmail.com'
        },
        body: JSON.stringify({
          fcm_token: 'fcm_spoofed_developer_token',
          app_type: 'developer'
        })
      });
      const body = await res.json();
      assert.strictEqual(res.status, 403);
      assert.ok(body.error.includes('Forbidden'));

      // Verify neither database received this spoofed token
      assert.strictEqual(Array.from(devDb.user_device_tokens.values()).some(t => t.fcm_token === 'fcm_spoofed_developer_token'), false);
      assert.strictEqual(Array.from(customerDb.user_device_tokens.values()).some(t => t.fcm_token === 'fcm_spoofed_developer_token'), false);
    });

    it('10.6 Token deduplication: Re-registering existing device token transfers ownership cleanly without duplicates', async () => {
      const res = await fetch(`${baseUrl}/api/notifications/tokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock-user:cust-uuid-2-tokenless:sarah.smith%40example.com'
        },
        body: JSON.stringify({
          fcm_token: 'fcm_cust_live_token_http_1',
          app_type: 'customer'
        })
      });
      assert.strictEqual(res.status, 200);

      // Verify only one entry exists for this token
      const matching = Array.from(customerDb.user_device_tokens.values()).filter(t => t.fcm_token === 'fcm_cust_live_token_http_1');
      assert.strictEqual(matching.length, 1, 'Only one record exists for this device token');
      assert.strictEqual(matching[0].user_id, 'cust-uuid-2-tokenless', 'Token reassigned to new user');
      assert.strictEqual(matching[0].is_active, true, 'Token reactivated');
    });

    it('10.7 GET /api/notifications (Customer) reads strictly from Customer Supabase with zero developer DB access', async () => {
      const res = await fetch(`${baseUrl}/api/notifications`, {
        headers: {
          'Authorization': 'Bearer mock-user:cust-uuid-1:vimaljayganthan16%40gmail.com'
        }
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.count, 1);
      assert.strictEqual(body.notifications[0].id, 'cust-inbox-row-1');
      assert.strictEqual(body.notifications[0].title, 'Customer Update: TK-101');

      // Ensure developer notification from devDb is NOT present
      const hasDevNotif = body.notifications.some(n => n.id === 'dev-inbox-row-1');
      assert.strictEqual(hasDevNotif, false, 'Developer notification must not leak into customer inbox');
    });

    it('10.8 GET /api/notifications (Developer) reads strictly from Developer Supabase with zero customer DB access', async () => {
      const res = await fetch(`${baseUrl}/api/notifications`, {
        headers: {
          'Authorization': 'Bearer mock-user:admin-uuid-dev:tasklypets%40gmail.com'
        }
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.count, 1);
      assert.strictEqual(body.notifications[0].id, 'dev-inbox-row-1');
      assert.strictEqual(body.notifications[0].title, 'New Customer Ticket');

      // Ensure customer notification from customerDb is NOT present
      const hasCustNotif = body.notifications.some(n => n.id === 'cust-inbox-row-1');
      assert.strictEqual(hasCustNotif, false, 'Customer notification must not leak into developer inbox');
    });

    it('10.9 GET /api/notifications/unread-count returns accurate unread count per audience', async () => {
      // Customer unread count
      const custRes = await fetch(`${baseUrl}/api/notifications/unread-count`, {
        headers: {
          'Authorization': 'Bearer mock-user:cust-uuid-1:vimaljayganthan16%40gmail.com'
        }
      });
      const custBody = await custRes.json();
      assert.strictEqual(custRes.status, 200);
      assert.strictEqual(custBody.unread_count, 1);

      // Developer unread count
      const devRes = await fetch(`${baseUrl}/api/notifications/unread-count`, {
        headers: {
          'Authorization': 'Bearer mock-user:admin-uuid-dev:tasklypets%40gmail.com'
        }
      });
      const devBody = await devRes.json();
      assert.strictEqual(devRes.status, 200);
      assert.strictEqual(devBody.unread_count, 1);
    });

    it('10.10 PATCH /api/notifications/:id/read (Customer) updates read status immediately', async () => {
      const res = await fetch(`${baseUrl}/api/notifications/cust-inbox-row-1/read`, {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer mock-user:cust-uuid-1:vimaljayganthan16%40gmail.com'
        }
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.is_read, true);
      assert.strictEqual(body.unread_count, 0);

      // Verify in Customer DB
      const custInbox = customerDb.user_notification_inbox.get('cust-inbox-row-1');
      assert.strictEqual(custInbox.is_read, true);
      assert.ok(custInbox.read_at);

      // Verify Developer DB remained untouched
      const devInbox = devDb.user_notification_inbox.get('dev-inbox-row-1');
      assert.strictEqual(devInbox.is_read, false, 'Developer inbox item must remain unread');
    });

    it('10.11 Cross-Database Isolation: Customer cannot mark developer notification as read (returns 404)', async () => {
      const res = await fetch(`${baseUrl}/api/notifications/dev-inbox-row-1/read`, {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer mock-user:cust-uuid-1:vimaljayganthan16%40gmail.com'
        }
      });
      assert.strictEqual(res.status, 404);

      // Verify developer notification in devDb is STILL unread
      const devInbox = devDb.user_notification_inbox.get('dev-inbox-row-1');
      assert.strictEqual(devInbox.is_read, false);
    });

    it('10.12 Cross-User Isolation: Customer cannot mark another customer notification as read (returns 404)', async () => {
      // Seed notification for Sarah
      const sarahInbox = {
        id: 'cust-inbox-sarah-1',
        user_id: 'cust-uuid-2-tokenless',
        notification_id: 'cust-notif-101',
        is_read: false,
        read_at: null,
        is_dismissed: false,
        created_at: new Date().toISOString()
      };
      customerDb.user_notification_inbox.set(sarahInbox.id, sarahInbox);

      // Vimal attempts to mark Sarah's notification as read
      const res = await fetch(`${baseUrl}/api/notifications/cust-inbox-sarah-1/read`, {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer mock-user:cust-uuid-1:vimaljayganthan16%40gmail.com'
        }
      });
      assert.strictEqual(res.status, 404);

      // Sarah's notification remains unread
      assert.strictEqual(customerDb.user_notification_inbox.get('cust-inbox-sarah-1').is_read, false);
    });

    it('10.13 POST /api/notifications/read-all marks unread notifications as read strictly for caller', async () => {
      // Seed a second unread notification for Sarah
      const sarahInbox2 = {
        id: 'cust-inbox-sarah-2',
        user_id: 'cust-uuid-2-tokenless',
        notification_id: 'cust-notif-101',
        is_read: false,
        read_at: null,
        is_dismissed: false,
        created_at: new Date().toISOString()
      };
      customerDb.user_notification_inbox.set(sarahInbox2.id, sarahInbox2);

      // Sarah calls read-all
      const res = await fetch(`${baseUrl}/api/notifications/read-all`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer mock-user:cust-uuid-2-tokenless:sarah.smith%40example.com'
        }
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.updated_count, 2);
      assert.strictEqual(body.unread_count, 0);

      // Verify Sarah's inboxes are read
      assert.strictEqual(customerDb.user_notification_inbox.get('cust-inbox-sarah-1').is_read, true);
      assert.strictEqual(customerDb.user_notification_inbox.get('cust-inbox-sarah-2').is_read, true);

      // Verify developer notification in devDb remains untouched and unread
      assert.strictEqual(devDb.user_notification_inbox.get('dev-inbox-row-1').is_read, false);
    });

    it('10.14 DELETE /api/notifications/:id dismisses notification strictly within audience database', async () => {
      const res = await fetch(`${baseUrl}/api/notifications/cust-inbox-sarah-1`, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer mock-user:cust-uuid-2-tokenless:sarah.smith%40example.com'
        }
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.dismissed, true);

      assert.strictEqual(customerDb.user_notification_inbox.get('cust-inbox-sarah-1').is_dismissed, true);

      // Sarah's GET /api/notifications should only return 1 non-dismissed item now
      const listRes = await fetch(`${baseUrl}/api/notifications`, {
        headers: {
          'Authorization': 'Bearer mock-user:cust-uuid-2-tokenless:sarah.smith%40example.com'
        }
      });
      const listBody = await listRes.json();
      assert.strictEqual(listBody.count, 1);
      assert.strictEqual(listBody.notifications[0].id, 'cust-inbox-sarah-2');
    });

    it('10.15 DELETE /api/notifications/tokens (Developer) deactivates token strictly in Developer Supabase', async () => {
      const res = await fetch(`${baseUrl}/api/notifications/tokens`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock-user:admin-uuid-dev:tasklypets%40gmail.com'
        },
        body: JSON.stringify({
          fcm_token: 'fcm_dev_live_token_http_2'
        })
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);

      const devToken = Array.from(devDb.user_device_tokens.values()).find(t => t.fcm_token === 'fcm_dev_live_token_http_2');
      assert.strictEqual(devToken.is_active, false);
    });
  });

});
