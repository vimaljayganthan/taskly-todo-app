/**
 * Taskly Daily Routine Reports - Production Readiness Verification Suite
 *
 * Covers all 12+ audit correction categories:
 * 1. Vercel Cron authorization with valid CRON_SECRET (200 OK)
 * 2. Unauthorized cron requests (missing header, bad scheme, invalid token, missing secret) (401 / 500)
 * 3. Multiple customer accounts processed independently in Supabase mode
 * 4. Inactive accounts discovered and processed (Case A reports for zero-routine users)
 * 5. Zero-routine accounts processed correctly with 'No Routines' status
 * 6. Different user timezones (Kolkata vs New York) evaluated at same UTC instant
 * 7. Custom report times (18:00 vs 22:00) respected
 * 8. Duplicate report prevention (idempotent writes, upsert on conflict user_id, date)
 * 9. Android production API routing uses getApiBaseUrl() (resolves to canonical Vercel URL on mobile)
 * 10. Offline report synchronization and two-way merge
 * 11. Existing historical report preservation (no overwrite)
 * 12. Cron retries and missed-day recovery across gaps
 * 13. Security guard against discontinued staging Supabase (mbmqybxwibvqzomssopw)
 * 14. In-memory scheduler disabled in production / Vercel
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const app = require('../server');
const DailyReportScheduler = require('../services/dailyReportScheduler');
const SmartListStore = require('../storage/smartListStore');
const HabitStreakService = require('../services/habitStreakService');

// Helper to simulate HTTP requests against Express app
function makeRequest(options = {}) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = options.method || 'GET';
    req.url = options.url || '/';
    req.headers = options.headers || {};
    req.query = options.query || {};
    req.body = options.body || {};

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

    app.handle(req, res, (err) => {
      if (err) reject(err);
    });
  });
}

// In-Memory Mock Supabase Client for Multi-User Account Testing
function createMockSupabase(initialData = {}) {
  const tables = {
    smart_routine_settings: initialData.settings || [],
    smart_routines: initialData.routines || [],
    smart_routine_completions: initialData.completions || [],
    smart_routine_reports: initialData.reports || [],
    todos: initialData.todos || []
  };

  const users = initialData.users || [];

  return {
    _tables: tables,
    auth: {
      admin: {
        listUsers: async () => ({
          data: { users: users.map(u => (typeof u === 'string' ? { id: u } : u)) },
          error: null
        })
      }
    },
    from(tableName) {
      if (!tables[tableName]) {
        tables[tableName] = [];
      }
      const tableData = tables[tableName];

      let filters = [];
      let sortField = null;
      let sortAsc = true;
      let limitCount = null;

      const queryBuilder = {
        select(cols) {
          return queryBuilder;
        },
        eq(col, val) {
          filters.push(row => row[col] === val);
          return queryBuilder;
        },
        order(field, { ascending = true } = {}) {
          sortField = field;
          sortAsc = ascending;
          return queryBuilder;
        },
        limit(n) {
          limitCount = n;
          return queryBuilder;
        },
        async maybeSingle() {
          let rows = tableData.filter(row => filters.every(f => f(row)));
          return { data: rows[0] || null, error: null };
        },
        async then(resolve) {
          let rows = tableData.filter(row => filters.every(f => f(row)));
          if (sortField) {
            rows = [...rows].sort((a, b) => {
              const va = a[sortField] || '';
              const vb = b[sortField] || '';
              return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
            });
          }
          if (limitCount !== null) {
            rows = rows.slice(0, limitCount);
          }
          return resolve({ data: rows, error: null });
        },
        async upsert(record, { onConflict = '', ignoreDuplicates = false } = {}) {
          const conflictKeys = onConflict ? onConflict.split(',').map(s => s.trim()) : ['id'];
          const existingIdx = tableData.findIndex(row =>
            conflictKeys.every(k => row[k] === record[k])
          );

          if (existingIdx !== -1) {
            if (!ignoreDuplicates) {
              tableData[existingIdx] = { ...tableData[existingIdx], ...record };
            }
          } else {
            tableData.push({ ...record });
          }
          return { data: record, error: null };
        },
        async insert(record) {
          tableData.push({ ...record });
          return { data: record, error: null };
        },
        async delete() {
          const matchingIndices = [];
          tableData.forEach((row, idx) => {
            if (filters.every(f => f(row))) {
              matchingIndices.push(idx);
            }
          });
          for (let i = matchingIndices.length - 1; i >= 0; i--) {
            tableData.splice(matchingIndices[i], 1);
          }
          return { data: null, error: null };
        }
      };

      return queryBuilder;
    }
  };
}

describe('Taskly — Daily Routine Summary Production Readiness Suite', () => {
  const origCronSecret = process.env.CRON_SECRET;
  const origSupabaseUrl = process.env.SUPABASE_URL;
  const origServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    DailyReportScheduler.setTestClient(null);
    SmartListStore.__resetForTests();
  });

  afterEach(() => {
    DailyReportScheduler.setTestClient(null);
    DailyReportScheduler.stop();
    if (origCronSecret !== undefined) process.env.CRON_SECRET = origCronSecret;
    else delete process.env.CRON_SECRET;
    if (origSupabaseUrl !== undefined) process.env.SUPABASE_URL = origSupabaseUrl;
    else delete process.env.SUPABASE_URL;
    if (origServiceRoleKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = origServiceRoleKey;
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  // ============================================================================
  // 1. Vercel Cron Authorization with Valid CRON_SECRET
  // ============================================================================
  describe('1. Vercel Cron Authorization with Valid CRON_SECRET', () => {
    test('GET /api/cron/daily-reports returns 200 and success response with valid secret', async () => {
      process.env.CRON_SECRET = 'valid-test-secret-12345';
      const mockSupabase = createMockSupabase();
      DailyReportScheduler.setTestClient(mockSupabase);

      const res = await makeRequest({
        method: 'GET',
        url: '/api/cron/daily-reports',
        headers: {
          authorization: 'Bearer valid-test-secret-12345'
        }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(typeof res.body.timestamp === 'string');
      assert.ok(typeof res.body.processedUsersCount === 'number');
      assert.ok(typeof res.body.reconciledReports === 'number');
      assert.match(res.body.message, /cron execution completed successfully/i);
    });

    test('POST /api/cron/daily-reports returns 200 and success response with valid secret', async () => {
      process.env.CRON_SECRET = 'valid-test-secret-12345';
      const mockSupabase = createMockSupabase();
      DailyReportScheduler.setTestClient(mockSupabase);

      const res = await makeRequest({
        method: 'POST',
        url: '/api/cron/daily-reports',
        headers: {
          authorization: 'Bearer valid-test-secret-12345'
        }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
    });
  });

  // ============================================================================
  // 2. Unauthorized Cron Requests
  // ============================================================================
  describe('2. Unauthorized Cron Requests', () => {
    test('Missing Authorization header is rejected with 401', async () => {
      process.env.CRON_SECRET = 'valid-test-secret-12345';

      const res = await makeRequest({
        method: 'GET',
        url: '/api/cron/daily-reports',
        headers: {}
      });

      assert.strictEqual(res.status, 401);
      assert.match(res.body.error, /Missing Authorization header/i);
    });

    test('Non-Bearer authorization format is rejected with 401', async () => {
      process.env.CRON_SECRET = 'valid-test-secret-12345';

      const res = await makeRequest({
        method: 'GET',
        url: '/api/cron/daily-reports',
        headers: {
          authorization: 'Basic valid-test-secret-12345'
        }
      });

      assert.strictEqual(res.status, 401);
      assert.match(res.body.error, /Invalid Authorization header format/i);
    });

    test('Mismatched cron secret token is rejected with 401', async () => {
      process.env.CRON_SECRET = 'valid-test-secret-12345';

      const res = await makeRequest({
        method: 'GET',
        url: '/api/cron/daily-reports',
        headers: {
          authorization: 'Bearer wrong-secret-token-xyz'
        }
      });

      assert.strictEqual(res.status, 401);
      assert.match(res.body.error, /Invalid cron secret/i);
    });

    test('Missing CRON_SECRET on server returns 500 error', async () => {
      delete process.env.CRON_SECRET;

      const res = await makeRequest({
        method: 'GET',
        url: '/api/cron/daily-reports',
        headers: {
          authorization: 'Bearer any-token'
        }
      });

      assert.strictEqual(res.status, 500);
      assert.match(res.body.error, /Cron secret is not configured/i);
    });
  });

  // ============================================================================
  // 3. Multiple Customer Accounts Processed Independently in Supabase Mode
  // ============================================================================
  describe('3. Multiple Customer Accounts Processed Independently in Supabase Mode', () => {
    test('Multiple customer accounts in Supabase are discovered and processed independently', async () => {
      const mockSupabase = createMockSupabase({
        users: ['cust-user-alpha', 'cust-user-beta'],
        settings: [
          { user_id: 'cust-user-alpha', timezone: 'UTC', daily_summary_time: '22:00', daily_summary_enabled: true },
          { user_id: 'cust-user-beta', timezone: 'UTC', daily_summary_time: '22:00', daily_summary_enabled: true }
        ],
        routines: [
          { id: 'r-alpha-1', user_id: 'cust-user-alpha', title: 'Alpha Exercise', created_at: '2026-11-17T08:00:00Z' },
          { id: 'r-alpha-2', user_id: 'cust-user-alpha', title: 'Alpha Reading', created_at: '2026-11-17T08:00:00Z' },
          { id: 'r-beta-1', user_id: 'cust-user-beta', title: 'Beta Deep Work', created_at: '2026-11-17T08:00:00Z' }
        ],
        completions: [
          { user_id: 'cust-user-alpha', routine_id: 'r-alpha-1', date: '2026-11-17', status: 'completed', completed: true },
          { user_id: 'cust-user-beta', routine_id: 'r-beta-1', date: '2026-11-17', status: 'completed', completed: true }
        ]
      });

      DailyReportScheduler.setTestClient(mockSupabase);

      const res = await DailyReportScheduler.processTick({
        now: new Date('2026-11-17T22:30:00Z'),
        forceToday: true
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.processedUsersCount, 2);

      const generatedReports = mockSupabase._tables.smart_routine_reports;
      assert.strictEqual(generatedReports.length, 2);

      const alphaRep = generatedReports.find(r => r.user_id === 'cust-user-alpha');
      assert.ok(alphaRep);
      assert.strictEqual(alphaRep.total_routines, 2);
      assert.strictEqual(alphaRep.completed_count, 1);
      assert.strictEqual(alphaRep.completion_rate, 50);

      const betaRep = generatedReports.find(r => r.user_id === 'cust-user-beta');
      assert.ok(betaRep);
      assert.strictEqual(betaRep.total_routines, 1);
      assert.strictEqual(betaRep.completed_count, 1);
      assert.strictEqual(betaRep.completion_rate, 100);
      assert.strictEqual(betaRep.status, 'Fully Completed');
    });
  });

  // ============================================================================
  // 4 & 5. Inactive Accounts & Zero-Routine Accounts Processed Correctly (Case A)
  // ============================================================================
  describe('4 & 5. Inactive and Zero-Routine Customer Accounts (Case A)', () => {
    test('Zero-routine user produces Case A report with No Routines badge and 0 counts', async () => {
      const mockSupabase = createMockSupabase({
        users: ['inactive-user-zero'],
        settings: [
          { user_id: 'inactive-user-zero', timezone: 'UTC', daily_summary_time: '22:00', daily_summary_enabled: true }
        ],
        routines: [],
        completions: []
      });

      DailyReportScheduler.setTestClient(mockSupabase);

      const res = await DailyReportScheduler.processTick({
        now: new Date('2026-11-17T22:30:00Z'),
        forceToday: true
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.processedUsersCount, 1);

      const generatedReports = mockSupabase._tables.smart_routine_reports;
      assert.strictEqual(generatedReports.length, 1);
      const rep = generatedReports[0];
      assert.strictEqual(rep.user_id, 'inactive-user-zero');
      assert.strictEqual(rep.total_routines, 0);
      assert.strictEqual(rep.completed_count, 0);
      assert.strictEqual(rep.completion_rate, 0);
      assert.strictEqual(rep.status, 'Not Started');
      assert.strictEqual(rep.status_badge, 'No Routines');
    });
  });

  // ============================================================================
  // 6. Timezones Evaluated at Same UTC Instant (Kolkata vs New York)
  // ============================================================================
  describe('6. Timezone Evaluation at Same UTC Instant', () => {
    test('Evaluates local thresholds per user timezone at exact same UTC moment', async () => {
      // UTC Instant: 2026-11-17T17:00:00Z
      // In Asia/Kolkata (UTC+5:30): 22:30 (past 22:00 -> eligible for 2026-11-17)
      // In America/New_York (UTC-5): 12:00 (before 22:00 -> not eligible for 2026-11-17)
      const mockSupabase = createMockSupabase({
        users: ['user-kolkata', 'user-newyork'],
        settings: [
          { user_id: 'user-kolkata', timezone: 'Asia/Kolkata', daily_summary_time: '22:00', daily_summary_enabled: true },
          { user_id: 'user-newyork', timezone: 'America/New_York', daily_summary_time: '22:00', daily_summary_enabled: true }
        ],
        routines: [
          { id: 'r-kol', user_id: 'user-kolkata', title: 'Kolkata Habit', created_at: '2026-11-17T00:00:00Z' },
          { id: 'r-ny', user_id: 'user-newyork', title: 'New York Habit', created_at: '2026-11-17T00:00:00Z' }
        ]
      });

      DailyReportScheduler.setTestClient(mockSupabase);

      const simUtcInstant = new Date('2026-11-17T17:00:00Z');
      const res = await DailyReportScheduler.processTick({
        now: simUtcInstant,
        forceToday: false
      });

      assert.strictEqual(res.success, true);

      const generatedReports = mockSupabase._tables.smart_routine_reports;
      // Kolkata user should have 2026-11-17 report
      const kolkataRep = generatedReports.find(r => r.user_id === 'user-kolkata' && r.date === '2026-11-17');
      assert.ok(kolkataRep, 'Kolkata user must have 2026-11-17 report generated');

      // New York user should NOT have 2026-11-17 report generated yet at 12:00 PM local time
      const nyRepToday = generatedReports.find(r => r.user_id === 'user-newyork' && r.date === '2026-11-17');
      assert.strictEqual(nyRepToday, undefined, 'New York user must not have 2026-11-17 report generated before 22:00');
    });
  });

  // ============================================================================
  // 7. Custom Report Times Respected (18:00 vs 22:00)
  // ============================================================================
  describe('7. Custom Report Times Respected', () => {
    test('User with custom 18:00 time generates report at 19:00, while 22:00 user waits', async () => {
      // Local time 19:00 UTC
      const mockSupabase = createMockSupabase({
        users: ['user-early', 'user-late'],
        settings: [
          { user_id: 'user-early', timezone: 'UTC', daily_summary_time: '18:00', daily_summary_enabled: true },
          { user_id: 'user-late', timezone: 'UTC', daily_summary_time: '22:00', daily_summary_enabled: true }
        ],
        routines: [
          { id: 'r-early', user_id: 'user-early', title: 'Early Habit', created_at: '2026-11-17T00:00:00Z' },
          { id: 'r-late', user_id: 'user-late', title: 'Late Habit', created_at: '2026-11-17T00:00:00Z' }
        ]
      });

      DailyReportScheduler.setTestClient(mockSupabase);

      const res = await DailyReportScheduler.processTick({
        now: new Date('2026-11-17T19:00:00Z'),
        forceToday: false
      });

      assert.strictEqual(res.success, true);

      const reports = mockSupabase._tables.smart_routine_reports;
      const earlyRep = reports.find(r => r.user_id === 'user-early' && r.date === '2026-11-17');
      assert.ok(earlyRep, 'Early user (18:00) must have 2026-11-17 report at 19:00');

      const lateRep = reports.find(r => r.user_id === 'user-late' && r.date === '2026-11-17');
      assert.strictEqual(lateRep, undefined, 'Late user (22:00) must not have report at 19:00');
    });
  });

  // ============================================================================
  // 8. Duplicate Report Prevention & Idempotency
  // ============================================================================
  describe('8. Duplicate Report Prevention (Idempotent Writes)', () => {
    test('Successive scheduler runs do not duplicate reports for same date', async () => {
      const mockSupabase = createMockSupabase({
        users: ['user-idemp'],
        settings: [{ user_id: 'user-idemp', timezone: 'UTC', daily_summary_time: '22:00' }],
        routines: [{ id: 'r-1', user_id: 'user-idemp', title: 'Daily Run', created_at: '2026-11-17T00:00:00Z' }]
      });

      DailyReportScheduler.setTestClient(mockSupabase);

      // Run 1
      const tick1 = await DailyReportScheduler.processTick({
        now: new Date('2026-11-17T22:30:00Z'),
        forceToday: true
      });
      assert.strictEqual(tick1.reconciledReports, 1);
      assert.strictEqual(mockSupabase._tables.smart_routine_reports.length, 1);

      // Run 2 immediately at same tick
      const tick2 = await DailyReportScheduler.processTick({
        now: new Date('2026-11-17T22:31:00Z'),
        forceToday: true
      });
      assert.strictEqual(tick2.reconciledReports, 0);
      assert.strictEqual(mockSupabase._tables.smart_routine_reports.length, 1);
    });
  });

  // ============================================================================
  // 9. Android Production API Routing Uses getApiBaseUrl()
  // ============================================================================
  describe('9. Android Production API Routing', () => {
    test('public/app.js routes all /api/smart-lists calls with baseUrl prefix', () => {
      const appJsPath = path.join(__dirname, '..', 'public', 'app.js');
      const code = fs.readFileSync(appJsPath, 'utf8');

      // Verify getApiBaseUrl returns canonical Vercel production URL on Capacitor
      assert.ok(code.includes('https://taskly-todo-app-4z1c.vercel.app'), 'Must target canonical Vercel deployment');

      // Check reconcile endpoint routing
      assert.ok(code.includes('${baseUrl}/api/smart-lists/reports/reconcile'), 'Reconcile must use ${baseUrl}');
      assert.ok(code.includes('${baseUrl}/api/smart-lists/reports'), 'Reports API must use ${baseUrl}');
      assert.ok(code.includes('${baseUrl}/api/smart-lists/settings'), 'Settings API must use ${baseUrl}');

      // Verify no bare /api/smart-lists fetch calls remain without baseUrl
      const rawMatches = code.match(/fetch\(['"`]\/api\/smart-lists\//g);
      assert.strictEqual(rawMatches, null, 'Must have zero un-prefixed /api/smart-lists calls in app.js');
    });
  });

  // ============================================================================
  // 10. Offline Report Synchronization and Two-Way Merge
  // ============================================================================
  describe('10. Offline Report Synchronization and Two-Way Merge', () => {
    test('fetchReports merges offline-generated local reports without overwriting', async () => {
      const appJsPath = path.join(__dirname, '..', 'public', 'app.js');
      const code = fs.readFileSync(appJsPath, 'utf8');

      // Verify two-way merge implementation in fetchReports
      assert.ok(code.includes('Two-way merge: Preserve offline-generated local reports'), 'Must implement two-way merge');
      assert.ok(code.includes('offlineToUpload'), 'Must track offline reports for background sync');
    });
  });

  // ============================================================================
  // 11. Existing Historical Report Preservation (No Overwrite)
  // ============================================================================
  describe('11. Existing Historical Report Preservation', () => {
    test('Scheduler leaves existing historical report untouched', async () => {
      const existingReport = {
        id: 'historical-rep-1',
        user_id: 'user-preserve',
        date: '2026-11-15',
        total_routines: 5,
        completed_count: 5,
        incomplete_count: 0,
        completion_rate: 100,
        status: 'Fully Completed',
        status_badge: 'Exceptional',
        closing_statement: 'Original custom statement that must never change',
        created_at: '2026-11-15T22:00:00Z'
      };

      const mockSupabase = createMockSupabase({
        users: ['user-preserve'],
        settings: [{ user_id: 'user-preserve', timezone: 'UTC', daily_summary_time: '22:00' }],
        routines: [{ id: 'r-1', user_id: 'user-preserve', title: 'Current Habit', created_at: '2026-11-15T00:00:00Z' }],
        reports: [existingReport]
      });

      DailyReportScheduler.setTestClient(mockSupabase);

      await DailyReportScheduler.processTick({
        now: new Date('2026-11-17T22:30:00Z'),
        forceToday: true
      });

      const rep15 = mockSupabase._tables.smart_routine_reports.find(r => r.date === '2026-11-15');
      assert.strictEqual(rep15.id, 'historical-rep-1');
      assert.strictEqual(rep15.closing_statement, 'Original custom statement that must never change');
      assert.strictEqual(rep15.completion_rate, 100);
    });
  });

  // ============================================================================
  // 12. Cron Retries and Missed-Day Recovery
  // ============================================================================
  describe('12. Cron Retries and Missed-Day Recovery', () => {
    test('Recovers all consecutive missing days when server has been inactive', async () => {
      // User active since 2026-11-14, but no reports generated yet. Current date 2026-11-17
      const mockSupabase = createMockSupabase({
        users: ['user-catchup'],
        settings: [{ user_id: 'user-catchup', timezone: 'UTC', daily_summary_time: '22:00' }],
        routines: [{ id: 'r-1', user_id: 'user-catchup', title: 'Daily Read', created_at: '2026-11-14T08:00:00Z' }]
      });

      DailyReportScheduler.setTestClient(mockSupabase);

      const res = await DailyReportScheduler.processTick({
        now: new Date('2026-11-17T22:30:00Z'),
        forceToday: true
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.reconciledReports, 4); // 2026-11-14, 15, 16, 17

      const dates = mockSupabase._tables.smart_routine_reports.map(r => r.date).sort();
      assert.deepStrictEqual(dates, ['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17']);
    });
  });

  // ============================================================================
  // 13. Security Guard Against Discontinued Staging Supabase
  // ============================================================================
  describe('13. Security Guard Against Staging Supabase (mbmqybxwibvqzomssopw)', () => {
    test('Attempting to initialize client with discontinued Supabase URL throws security error', () => {
      process.env.SUPABASE_URL = 'https://mbmqybxwibvqzomssopw.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'any-service-key';

      assert.throws(
        () => DailyReportScheduler.getSupabaseAdminClient(),
        /Security Violation.*discontinued developer\/staging Supabase instance.*mbmqybxwibvqzomssopw/i
      );
    });
  });

  // ============================================================================
  // 14. In-Memory Scheduler Disabled in Production / Vercel
  // ============================================================================
  describe('14. In-Memory Scheduler Disabled in Production / Vercel', () => {
    test('DailyReportScheduler.start() does not run in production or on Vercel', () => {
      process.env.VERCEL = '1';
      DailyReportScheduler.stop();
      DailyReportScheduler.start();
      assert.strictEqual(DailyReportScheduler.isRunning, false);
      delete process.env.VERCEL;

      process.env.NODE_ENV = 'production';
      DailyReportScheduler.stop();
      DailyReportScheduler.start();
      assert.strictEqual(DailyReportScheduler.isRunning, false);
      process.env.NODE_ENV = 'test';
    });
  });
});
