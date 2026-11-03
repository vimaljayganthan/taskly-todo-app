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

        const builder = {
          select: () => builder,
          eq: (col, val) => {
            currentFilter = { col, val };
            return builder;
          },
          maybeSingle: async () => {
            if (currentFilter) {
              const row = mockRows.get(currentFilter.val);
              return { data: row ? Object.assign({}, row) : null, error: null };
            }
            return { data: null, error: null };
          },
          insert: (payload) => {
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
      {
        id: 'sb-mig-1',
        title: 'Supabase Task 1',
        completed: false,
        dueDate: '2026-12-01',
        time: '3:00 PM',
        description: 'Original description',
        priority: 'Medium',
        category: 'Personal',
        reminder: false,
        createdAt: '2026-11-01T12:00:00.000Z',
        updatedAt: null
      },
      {
        id: 'sb-mig-2',
        title: 'Supabase Task 2',
        completed: true,
        dueDate: null,
        time: null,
        description: '',
        priority: 'Medium',
        category: 'Personal',
        reminder: false,
        createdAt: '2026-11-01T13:00:00.000Z',
        updatedAt: null
      }
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

  test('Exact duplicate: safely skipped', async () => {
    const exactDuplicates = [
      {
        id: 'sb-mig-1',
        title: 'Supabase Task 1',
        completed: false,
        dueDate: '2026-12-01',
        time: '3:00 PM',
        description: 'Original description',
        priority: 'Medium',
        category: 'Personal',
        reminder: false,
        createdAt: '2026-11-01T12:00:00.000Z',
        updatedAt: null
      }
    ];

    const summary = await runSupabaseMigration({
      supabase: mockSupabase,
      tasks: exactDuplicates,
      dryRun: false
    });

    assert.strictEqual(summary.skipped, 1);
    assert.strictEqual(summary.inserted, 0);
    assert.strictEqual(summary.failed, 0);
    assert.strictEqual(summary.records[0].status, 'SKIPPED_ALREADY_EXISTS');
  });

  test('Same ID, different description: conflict', async () => {
    const conflictingTask = [
      {
        id: 'sb-mig-1',
        title: 'Supabase Task 1',
        completed: false,
        dueDate: '2026-12-01',
        time: '3:00 PM',
        description: 'TAMPERED OR CONFLICTING DESCRIPTION',
        priority: 'Medium',
        category: 'Personal',
        reminder: false,
        createdAt: '2026-11-01T12:00:00.000Z',
        updatedAt: null
      }
    ];

    const summary = await runSupabaseMigration({
      supabase: mockSupabase,
      tasks: conflictingTask,
      dryRun: false
    });

    assert.strictEqual(summary.failed, 1);
    assert.strictEqual(summary.inserted, 0);
    assert.strictEqual(summary.records[0].status, 'FAILED_METADATA_MISMATCH');
    assert.match(summary.records[0].error, /description/);

    // Confirm database record was NOT overwritten
    const row = mockRows.get('sb-mig-1');
    assert.strictEqual(row.description, 'Original description');
  });

  test('Same ID, different user: ownership conflict', async () => {
    // sb-mig-1 was created with DEFAULT_PRIMARY_USER_ID ('8fdf606c-4746-49ef-bbde-e38d85ed5797')
    const conflictingTasks = [
      { id: 'sb-mig-1', title: 'Task to Steal', completed: false }
    ];

    const summary = await runSupabaseMigration({
      supabase: mockSupabase,
      tasks: conflictingTasks,
      targetUserId: 'malicious-or-different-user-9999',
      dryRun: false
    });

    assert.strictEqual(summary.failed, 1);
    assert.strictEqual(summary.inserted, 0);
    assert.strictEqual(summary.records[0].status, 'FAILED_OWNERSHIP_MISMATCH');

    // Confirm original ownership is completely preserved
    const row = mockRows.get('sb-mig-1');
    assert.strictEqual(row.user_id, '8fdf606c-4746-49ef-bbde-e38d85ed5797');
    assert.notStrictEqual(row.user_id, 'malicious-or-different-user-9999');
  });

  test('Same ID, different priority or reminder: conflict', async () => {
    // 1. Priority mismatch
    const priorityMismatch = [
      {
        id: 'sb-mig-1',
        title: 'Supabase Task 1',
        completed: false,
        dueDate: '2026-12-01',
        time: '3:00 PM',
        description: 'Original description',
        priority: 'High', // was Medium
        category: 'Personal',
        reminder: false,
        createdAt: '2026-11-01T12:00:00.000Z',
        updatedAt: null
      }
    ];

    const summaryPriority = await runSupabaseMigration({
      supabase: mockSupabase,
      tasks: priorityMismatch,
      dryRun: false
    });

    assert.strictEqual(summaryPriority.failed, 1);
    assert.strictEqual(summaryPriority.inserted, 0);
    assert.strictEqual(summaryPriority.records[0].status, 'FAILED_METADATA_MISMATCH');
    assert.match(summaryPriority.records[0].error, /priority/);

    // 2. Reminder mismatch
    const reminderMismatch = [
      {
        id: 'sb-mig-1',
        title: 'Supabase Task 1',
        completed: false,
        dueDate: '2026-12-01',
        time: '3:00 PM',
        description: 'Original description',
        priority: 'Medium',
        category: 'Personal',
        reminder: true, // was false
        createdAt: '2026-11-01T12:00:00.000Z',
        updatedAt: null
      }
    ];

    const summaryReminder = await runSupabaseMigration({
      supabase: mockSupabase,
      tasks: reminderMismatch,
      dryRun: false
    });

    assert.strictEqual(summaryReminder.failed, 1);
    assert.strictEqual(summaryReminder.inserted, 0);
    assert.strictEqual(summaryReminder.records[0].status, 'FAILED_METADATA_MISMATCH');
    assert.match(summaryReminder.records[0].error, /reminder/);
  });

  test('One task conflict: no partial import', async () => {
    const initialSize = mockRows.size;
    const batchWithConflict = [
      {
        id: 'valid-new-task-1',
        title: 'Valid New Task That Must Not Be Partially Imported',
        completed: false,
        dueDate: '2026-12-15'
      },
      {
        id: 'sb-mig-1',
        title: 'Supabase Task 1',
        completed: false,
        dueDate: '2026-12-01',
        time: '3:00 PM',
        description: 'CONFLICTING DESCRIPTION - MUST CAUSE ABORT',
        priority: 'Medium',
        category: 'Personal',
        reminder: false,
        createdAt: '2026-11-01T12:00:00.000Z',
        updatedAt: null
      }
    ];

    const summary = await runSupabaseMigration({
      supabase: mockSupabase,
      tasks: batchWithConflict,
      dryRun: false
    });

    assert.strictEqual(summary.failed, 1);
    assert.strictEqual(summary.inserted, 0); // No partial writes!
    assert.strictEqual(mockRows.size, initialSize);
    assert.strictEqual(mockRows.has('valid-new-task-1'), false); // Must NOT be in database!
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

  test('Full-fidelity import: Preserves all extended task metadata fields', async () => {
    const fullTasks = [
      {
        id: 'sb-mig-full-1',
        title: 'Full Fidelity Task',
        dueDate: '2026-11-25',
        time: '7:30 PM',
        description: 'Deep architectural verification',
        priority: 'High',
        category: 'Project',
        reminder: true,
        completed: false,
        createdAt: '2026-11-02T10:00:00.000Z',
        updatedAt: '2026-11-02T11:00:00.000Z'
      }
    ];

    const summary = await runSupabaseMigration({
      supabase: mockSupabase,
      tasks: fullTasks,
      targetUserId: '8fdf606c-4746-49ef-bbde-e38d85ed5797',
      dryRun: false
    });

    assert.strictEqual(summary.inserted, 1);
    const row = mockRows.get('sb-mig-full-1');
    assert.strictEqual(row.description, 'Deep architectural verification');
    assert.strictEqual(row.time, '7:30 PM');
    assert.strictEqual(row.priority, 'High');
    assert.strictEqual(row.category, 'Project');
    assert.strictEqual(row.reminder, true);
    assert.strictEqual(row.user_id, '8fdf606c-4746-49ef-bbde-e38d85ed5797');
    assert.strictEqual(row.due_date, '2026-11-25');
    assert.strictEqual(row.created_at, '2026-11-02T10:00:00.000Z');
    assert.strictEqual(row.updated_at, '2026-11-02T11:00:00.000Z');
  });
});
