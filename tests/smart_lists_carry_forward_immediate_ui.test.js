// ==============================================================================
// Taskly v2.1.0 — Carry-Forward Immediate UI Refresh & Persistence Suite
// File: tests/smart_lists_carry_forward_immediate_ui.test.js
// ==============================================================================

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const app = require('../public/app');
const manager = app.SmartListsManager;

describe('Taskly v2.1.0 — Carry-Forward Immediate UI Refresh & Persistence', () => {
  const TODAY = '2026-11-09';
  const TOMORROW = '2026-11-10';

  beforeEach(() => {
    manager.clearLocalState();
    manager.state.activeDate = TODAY;
    manager.state.activeReportDate = TODAY;
    manager.state.reports = [];
    manager.state.routines = [
      { id: 'rt-1', title: 'Morning Exercise', recurrence: 'daily', orderIndex: 0 },
      { id: 'rt-2', title: 'Read 20 Pages', recurrence: 'daily', orderIndex: 1 },
      { id: 'rt-3', title: 'Code Review', recurrence: 'daily', orderIndex: 2 }
    ];
    // rt-1 is completed, rt-2 and rt-3 are pending (incomplete)
    manager.state.completions = {
      'rt-1_2026-11-09': { status: 'completed', completed: true, carriedForward: false },
      'rt-2_2026-11-09': { status: 'pending', completed: false, carriedForward: false },
      'rt-3_2026-11-09': { status: 'pending', completed: false, carriedForward: false }
    };
  });

  describe('1. Immediate In-Memory State & Tomorrow List Updates', () => {
    test('1.1 setCarryForwardDecision updates completions and tomorrow routines immediately', async () => {
      // Mock fetch
      global.fetch = async () => ({
        ok: true,
        json: async () => ({
          success: true,
          report: {
            id: 'rep-test-1',
            date: TODAY,
            totalRoutines: 3,
            completedCount: 1,
            incompleteCount: 0,
            postponedCount: 2,
            completionRate: 33,
            carryForwardDecision: 'yes',
            closingStatement: '2 incomplete routines were carried forward to tomorrow (2026-11-10).'
          }
        })
      });

      const report = await manager.setCarryForwardDecision(TODAY, 'yes');

      // 1. Report updated
      assert.strictEqual(report.carryForwardDecision, 'yes');
      assert.strictEqual(report.postponedCount, 2);

      // 2. Today completions marked postponed
      assert.strictEqual(manager.state.completions['rt-2_2026-11-09'].status, 'postponed');
      assert.strictEqual(manager.state.completions['rt-2_2026-11-09'].postponedToDate, TOMORROW);
      assert.strictEqual(manager.state.completions['rt-3_2026-11-09'].status, 'postponed');
      assert.strictEqual(manager.state.completions['rt-3_2026-11-09'].postponedToDate, TOMORROW);

      // 3. Tomorrow completions marked pending with carriedForward = true
      assert.strictEqual(manager.state.completions['rt-2_2026-11-10'].status, 'pending');
      assert.strictEqual(manager.state.completions['rt-2_2026-11-10'].carriedForward, true);
      assert.strictEqual(manager.state.completions['rt-2_2026-11-10'].originalDate, TODAY);

      assert.strictEqual(manager.state.completions['rt-3_2026-11-10'].status, 'pending');
      assert.strictEqual(manager.state.completions['rt-3_2026-11-10'].carriedForward, true);
      assert.strictEqual(manager.state.completions['rt-3_2026-11-10'].originalDate, TODAY);

      // 4. Tomorrow routines state populated immediately without app restart
      assert.ok(Array.isArray(manager.state.tomorrowRoutines));
      const carriedTom = manager.state.tomorrowRoutines.filter(r => r.carriedForward);
      assert.strictEqual(carriedTom.length, 2, 'Must contain exactly 2 carried-forward routines in tomorrow list');
      assert.ok(carriedTom.some(r => r.routineId === 'rt-2'));
      assert.ok(carriedTom.some(r => r.routineId === 'rt-3'));
    });

    test('1.2 "No, finish today\'s list" does not carry forward or postpone routines', async () => {
      global.fetch = async () => ({
        ok: true,
        json: async () => ({
          success: true,
          report: {
            id: 'rep-test-2',
            date: TODAY,
            totalRoutines: 3,
            completedCount: 1,
            incompleteCount: 2,
            postponedCount: 0,
            carryForwardDecision: 'no',
            closingStatement: "Today's checklist was closed without carrying forward routines."
          }
        })
      });

      const report = await manager.setCarryForwardDecision(TODAY, 'no');
      assert.strictEqual(report.carryForwardDecision, 'no');

      // Today's routines remain pending (not postponed)
      assert.strictEqual(manager.state.completions['rt-2_2026-11-09'].status, 'pending');
      assert.strictEqual(manager.state.completions['rt-3_2026-11-09'].status, 'pending');

      // Tomorrow has no carried-forward completions
      assert.strictEqual(manager.state.completions['rt-2_2026-11-10'], undefined);
      assert.strictEqual(manager.state.completions['rt-3_2026-11-10'], undefined);
    });
  });

  describe('2. Supabase Cloud Persistence & Data Parity', () => {
    test('2.1 Persists postponed status and carried-forward completions to Supabase', async () => {
      const upsertedCompletions = [];
      const upsertedReports = [];

      const mockSupabase = {
        from: (table) => ({
          upsert: async (payload) => {
            if (table === 'smart_routine_completions') {
              upsertedCompletions.push(payload);
            } else if (table === 'smart_routine_reports') {
              upsertedReports.push(payload);
            }
            return { data: [payload], error: null };
          },
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({
                data: [
                  { routine_id: 'rt-2', date: TOMORROW, status: 'pending', carried_forward: true, original_date: TODAY },
                  { routine_id: 'rt-3', date: TOMORROW, status: 'pending', carried_forward: true, original_date: TODAY }
                ],
                error: null
              })
            })
          })
        })
      };

      app.setSupabaseClient(mockSupabase);
      app.state.user.id = 'usr-test-123';
      app.state.userToken = 'valid-jwt';

      await manager.setCarryForwardDecision(TODAY, 'yes');

      // Check completions upserted to Supabase
      assert.ok(upsertedCompletions.length >= 4, `Must upsert 2 today postponed + 2 tomorrow carried completions (got ${upsertedCompletions.length})`);

      const postponedToday = upsertedCompletions.filter(c => c.date === TODAY && c.status === 'postponed');
      assert.strictEqual(postponedToday.length, 2);
      assert.ok(postponedToday.every(c => c.postponed_to === TOMORROW && c.user_id === 'usr-test-123'));

      const carriedTomorrow = upsertedCompletions.filter(c => c.date === TOMORROW && c.carried_forward === true);
      assert.strictEqual(carriedTomorrow.length, 2);
      assert.ok(carriedTomorrow.every(c => c.status === 'pending' && c.original_date === TODAY));

      // Check report upserted to Supabase
      assert.ok(upsertedReports.length >= 1, 'Must upsert report to Supabase');
      const latestReport = upsertedReports[upsertedReports.length - 1];
      assert.strictEqual(latestReport.carry_forward_decision, 'yes');
      assert.strictEqual(latestReport.user_id, 'usr-test-123');

      // Clean up globals
      app.setSupabaseClient(null);
      app.state.user.id = null;
      app.state.userToken = null;
    });

    test('2.2 Rollback on Supabase failure prevents false success state', async () => {
      const failingSupabase = {
        from: (table) => ({
          upsert: async () => {
            if (table === 'smart_routine_completions') {
              return { data: null, error: new Error('Simulated Supabase DB write timeout') };
            }
            return { data: [], error: null };
          }
        })
      };

      app.setSupabaseClient(failingSupabase);
      app.state.user.id = 'usr-fail-123';
      app.state.userToken = 'valid-jwt';

      const result = await manager.setCarryForwardDecision(TODAY, 'yes');
      assert.strictEqual(result, false, 'Failed persistence must return false');

      // Local state must be rolled back: rt-2 must remain pending on today, not postponed
      assert.strictEqual(manager.state.completions['rt-2_2026-11-09'].status, 'pending');
      assert.strictEqual(manager.state.completions['rt-2_2026-11-10'], undefined);

      app.setSupabaseClient(null);
      app.state.user.id = null;
      app.state.userToken = null;
    });
  });

  describe('3. Duplicate Prevention & Button Guard', () => {
    test('3.1 Concurrent carry-forward requests are prevented while processing', async () => {
      let carryForwardPostCalls = 0;
      global.fetch = async (url) => {
        if (typeof url === 'string' && url.includes('/api/smart-lists/carry-forward')) {
          carryForwardPostCalls++;
        }
        // Simulate async latency
        await new Promise(r => setTimeout(r, 20));
        return {
          ok: true,
          json: async () => ({
            success: true,
            routines: [],
            report: {
              id: 'rep-concur',
              date: TODAY,
              carryForwardDecision: 'yes'
            }
          })
        };
      };

      // Trigger two concurrent invocations
      const p1 = manager.setCarryForwardDecision(TODAY, 'yes');
      const p2 = manager.setCarryForwardDecision(TODAY, 'yes');

      await Promise.all([p1, p2]);

      assert.strictEqual(carryForwardPostCalls, 1, 'Only one carry-forward POST call should occur during concurrent taps');
      assert.strictEqual(manager.state.isProcessingCarryForward, false, 'Processing guard must reset after completion');
    });

    test('3.2 Routines already completed on tomorrow are not reset to pending by carry-forward', async () => {
      // Suppose rt-2 was already completed on tomorrow
      manager.state.completions['rt-2_2026-11-10'] = {
        status: 'completed',
        completed: true,
        carriedForward: false
      };

      global.fetch = async () => ({
        ok: true,
        json: async () => ({ success: true, report: { date: TODAY, carryForwardDecision: 'yes' } })
      });

      await manager.setCarryForwardDecision(TODAY, 'yes');

      // rt-2 on tomorrow must remain completed
      assert.strictEqual(manager.state.completions['rt-2_2026-11-10'].status, 'completed');
      assert.strictEqual(manager.state.completions['rt-2_2026-11-10'].completed, true);
    });
  });
});
