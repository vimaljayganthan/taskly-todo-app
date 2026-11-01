const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const { runSupabaseMigration } = require('../scripts/migrate-to-supabase.js');

describe('Safe Supabase Migration Test Suite', () => {
  let mockRows;
  let mockSupabase;

  before(() => {
    mockRows = new Map();

    mockSupabase = {
      from: (table) => {
        let currentFilter = null;
        let isInsert = false;
        let insertData = null;

        const builder = {
          select: () => builder,
          eq: (col, val) => {
            currentFilter = { col, val };
            return builder;
          },
          maybeSingle: async () => {
            if (currentFilter) {
              const row = mockRows.get(currentFilter.val);
              return { data: row || null, error: null };
            }
            return { data: null, error: null };
          },
          insert: (payload) => {
            isInsert = true;
            insertData = payload;
            mockRows.set(payload.id, Object.assign({}, payload));
            return Promise.resolve({ data: [payload], error: null });
          }
        };
        return builder;
      }
    };
  });

  test('Dry-run does not write to Supabase', async () => {
    const tasks = [
      { id: 'sb-dry-1', title: 'Dry Run Supabase Task', completed: false }
    ];
    const summary = await runSupabaseMigration({
      supabase: mockSupabase,
      tasks,
      dryRun: true
    });

    assert.strictEqual(summary.inserted, 1);
    assert.strictEqual(summary.dryRun, true);
    assert.strictEqual(mockRows.size, 0); // No records actually written
  });

  test('Migrates new tasks into Supabase', async () => {
    const tasks = [
      { id: 'sb-mig-1', title: 'Supabase Task 1', completed: false, dueDate: '2026-12-01' },
      { id: 'sb-mig-2', title: 'Supabase Task 2', completed: true, dueDate: null }
    ];
    const summary = await runSupabaseMigration({
      supabase: mockSupabase,
      tasks,
      dryRun: false
    });

    assert.strictEqual(summary.inserted, 2);
    assert.strictEqual(summary.skipped, 0);
    assert.strictEqual(summary.failed, 0);
    assert.strictEqual(mockRows.size, 2);
    assert.strictEqual(mockRows.get('sb-mig-1').title, 'Supabase Task 1');
  });

  test('Idempotency: Re-running migration skips existing tasks without overwriting', async () => {
    const tasks = [
      { id: 'sb-mig-1', title: 'TAMPERED TITLE - MUST NOT OVERWRITE', completed: true },
      { id: 'sb-mig-3', title: 'Supabase Task 3', completed: false }
    ];

    const summary = await runSupabaseMigration({
      supabase: mockSupabase,
      tasks,
      dryRun: false
    });

    assert.strictEqual(summary.inserted, 1); // Only sb-mig-3 is inserted
    assert.strictEqual(summary.skipped, 1);  // sb-mig-1 is skipped
    assert.strictEqual(summary.failed, 0);

    // Assert sb-mig-1 still retains its original title
    const row = mockRows.get('sb-mig-1');
    assert.strictEqual(row.title, 'Supabase Task 1');
    assert.notStrictEqual(row.title, 'TAMPERED TITLE - MUST NOT OVERWRITE');
  });

  test('Skips and logs malformed tasks gracefully', async () => {
    const malformed = [
      null,
      { title: 'No ID task' }
    ];

    const summary = await runSupabaseMigration({
      supabase: mockSupabase,
      tasks: malformed,
      dryRun: false
    });

    assert.strictEqual(summary.failed, 2);
  });
});

