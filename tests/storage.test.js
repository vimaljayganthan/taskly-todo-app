const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { FileStorageAdapter, FirestoreStorageAdapter, SupabaseStorageAdapter } = require('../storage/taskStore.js');

describe('Storage Adapters Test Suite', () => {
  const testFilePath = path.join('/tmp', `taskly-test-${Date.now()}.json`);

  after(() => {
    try {
      if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
      if (fs.existsSync(`${testFilePath}.backup.json`)) fs.unlinkSync(`${testFilePath}.backup.json`);
    } catch (_) {}
  });

  describe('FileStorageAdapter (Local Development)', () => {
    let adapter;

    before(() => {
      adapter = new FileStorageAdapter(testFilePath);
    });

    test('Initializes with default sample tasks', async () => {
      const tasks = await adapter.getAllTasks();
      assert.ok(Array.isArray(tasks));
      assert.ok(tasks.length >= 2);
    });

    test('Creates new task and prepends to array', async () => {
      const newTask = {
        id: 'test-uuid-1',
        title: 'Local File Task',
        dueDate: '2026-11-20',
        completed: false,
        createdAt: new Date().toISOString()
      };
      const created = await adapter.createTask(newTask);
      assert.strictEqual(created.id, 'test-uuid-1');

      const all = await adapter.getAllTasks();
      assert.strictEqual(all[0].id, 'test-uuid-1');
    });

    test('Updates existing task fields', async () => {
      const updated = await adapter.updateTask('test-uuid-1', { completed: true });
      assert.strictEqual(updated.completed, true);
      assert.strictEqual(updated.title, 'Local File Task');

      const notFound = await adapter.updateTask('non-existent', { completed: true });
      assert.strictEqual(notFound, null);
    });

    test('Deletes task by ID', async () => {
      const success = await adapter.deleteTask('test-uuid-1');
      assert.strictEqual(success, true);

      const fail = await adapter.deleteTask('non-existent');
      assert.strictEqual(fail, false);
    });

    test('Clears completed tasks in bulk', async () => {
      await adapter.createTask({
        id: 'test-completed-1',
        title: 'Completed Task',
        completed: true,
        createdAt: new Date().toISOString()
      });
      const deletedCount = await adapter.clearCompleted();
      assert.ok(deletedCount >= 1);
    });
  });

  describe('SupabaseStorageAdapter (Vercel Serverless Production Validation)', () => {
    let mockRows;
    let mockSupabase;
    let supabaseAdapter;

    before(() => {
      mockRows = new Map();

      mockSupabase = {
        from: (table) => {
          const filters = [];
          let currentOrder = null;
          let pendingInsert = null;
          let pendingUpdate = null;
          let isDelete = false;

          const matchesFilters = (row) => filters.every(f => row[f.col] === f.val);

          const queryBuilder = {
            select: () => queryBuilder,
            order: (col, opts) => {
              currentOrder = { col, ascending: opts?.ascending ?? true };
              return queryBuilder;
            },
            eq: (col, val) => {
              filters.push({ col, val });
              return queryBuilder;
            },
            insert: (payload) => {
              pendingInsert = Array.isArray(payload) ? payload : [payload];
              return queryBuilder;
            },
            update: (payload) => {
              pendingUpdate = payload;
              return queryBuilder;
            },
            delete: () => {
              isDelete = true;
              return queryBuilder;
            },
            single: async () => {
              const res = await queryBuilder;
              return { data: res.data ? res.data[0] : null, error: res.error };
            },
            then: (resolve) => {
              if (pendingInsert) {
                const inserted = [];
                for (const item of pendingInsert) {
                  mockRows.set(item.id, Object.assign({}, item));
                  inserted.push(item);
                }
                return resolve({ data: inserted, error: null });
              }

              if (pendingUpdate) {
                const updated = [];
                for (const [id, row] of mockRows.entries()) {
                  if (matchesFilters(row)) {
                    const newRow = Object.assign({}, row, pendingUpdate);
                    mockRows.set(id, newRow);
                    updated.push(newRow);
                  }
                }
                return resolve({ data: updated, error: null });
              }

              if (isDelete) {
                const deleted = [];
                for (const [id, row] of Array.from(mockRows.entries())) {
                  if (matchesFilters(row)) {
                    mockRows.delete(id);
                    deleted.push(row);
                  }
                }
                return resolve({ data: deleted, error: null });
              }

              // Query select
              let list = Array.from(mockRows.values()).filter(matchesFilters);
              if (currentOrder) {
                list.sort((a, b) => {
                  const valA = a[currentOrder.col] || '';
                  const valB = b[currentOrder.col] || '';
                  return currentOrder.ascending ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
                });
              }
              return resolve({ data: list, error: null });
            }
          };

          return queryBuilder;
        }
      };

      supabaseAdapter = new SupabaseStorageAdapter(mockSupabase, 'todos');
    });

    const testUserId = 'test-user-prod-1';

    test('Supabase: Creates and persists a task', async () => {
      const task = {
        id: 'sb-task-1',
        title: 'Production Supabase Task',
        dueDate: '2026-12-15',
        completed: false,
        createdAt: new Date().toISOString()
      };
      const created = await supabaseAdapter.createTask(task, testUserId);
      assert.strictEqual(created.id, 'sb-task-1');
      assert.strictEqual(created.title, 'Production Supabase Task');
      assert.strictEqual(created.dueDate, '2026-12-15');
      assert.strictEqual(mockRows.size, 1);
    });

    test('Supabase: Retrieves all tasks mapped to frontend contract', async () => {
      const tasks = await supabaseAdapter.getAllTasks(testUserId);
      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].id, 'sb-task-1');
      assert.strictEqual(tasks[0].dueDate, '2026-12-15');
    });

    test('Supabase: Updates task fields (completion, title, dueDate)', async () => {
      const updated = await supabaseAdapter.updateTask('sb-task-1', {
        completed: true,
        title: 'Updated Supabase Task'
      }, testUserId);
      assert.strictEqual(updated.completed, true);
      assert.strictEqual(updated.title, 'Updated Supabase Task');

      const notFound = await supabaseAdapter.updateTask('non-existent', { completed: true }, testUserId);
      assert.strictEqual(notFound, null);
    });

    test('Supabase: Deletes a task by ID', async () => {
      const success = await supabaseAdapter.deleteTask('sb-task-1', testUserId);
      assert.strictEqual(success, true);
      assert.strictEqual(mockRows.size, 0);

      const notFound = await supabaseAdapter.deleteTask('non-existent', testUserId);
      assert.strictEqual(notFound, false);
    });

    test('Supabase: Bulk clears completed tasks', async () => {
      await supabaseAdapter.createTask({ id: 's1', title: 'Task 1', completed: true }, testUserId);
      await supabaseAdapter.createTask({ id: 's2', title: 'Task 2', completed: true }, testUserId);
      await supabaseAdapter.createTask({ id: 's3', title: 'Task 3', completed: false }, testUserId);

      const deletedCount = await supabaseAdapter.clearCompleted(testUserId);
      assert.strictEqual(deletedCount, 2);

      const remaining = await supabaseAdapter.getAllTasks(testUserId);
      assert.strictEqual(remaining.length, 1);
      assert.strictEqual(remaining[0].id, 's3');
    });

    test('Supabase: Full-field task creation and retrieval preserves all metadata', async () => {
      const fullTask = {
        id: 'sb-full-1',
        title: 'Full Metadata Task',
        dueDate: '2026-11-20',
        time: '4:30 PM',
        description: 'Detailed technical specification',
        priority: 'High',
        category: 'Project',
        reminder: true,
        completed: false,
        createdAt: '2026-11-03T10:00:00.000Z',
        updatedAt: '2026-11-03T10:15:00.000Z'
      };

      const created = await supabaseAdapter.createTask(fullTask, testUserId);
      assert.strictEqual(created.id, 'sb-full-1');
      assert.strictEqual(created.title, 'Full Metadata Task');
      assert.strictEqual(created.time, '4:30 PM');
      assert.strictEqual(created.description, 'Detailed technical specification');
      assert.strictEqual(created.priority, 'High');
      assert.strictEqual(created.category, 'Project');
      assert.strictEqual(created.reminder, true);
      assert.strictEqual(created.completed, false);
      assert.strictEqual(created.dueDate, '2026-11-20');
      assert.strictEqual(created.createdAt, '2026-11-03T10:00:00.000Z');
      assert.strictEqual(created.updatedAt, '2026-11-03T10:15:00.000Z');

      const retrievedList = await supabaseAdapter.getAllTasks(testUserId);
      const found = retrievedList.find(t => t.id === 'sb-full-1');
      assert.ok(found, 'Task must be retrievable');
      assert.strictEqual(found.description, 'Detailed technical specification');
      assert.strictEqual(found.priority, 'High');
      assert.strictEqual(found.category, 'Project');
      assert.strictEqual(found.time, '4:30 PM');
      assert.strictEqual(found.reminder, true);
    });

    test('Supabase: Full-field task updates preserve all metadata', async () => {
      const updated = await supabaseAdapter.updateTask('sb-full-1', {
        title: 'Updated Metadata Task',
        time: '6:00 PM',
        description: 'Updated specification notes',
        priority: 'Low',
        category: 'Work',
        reminder: false,
        completed: true,
        dueDate: '2026-11-25',
        updatedAt: '2026-11-03T12:00:00.000Z'
      }, testUserId);

      assert.strictEqual(updated.title, 'Updated Metadata Task');
      assert.strictEqual(updated.time, '6:00 PM');
      assert.strictEqual(updated.description, 'Updated specification notes');
      assert.strictEqual(updated.priority, 'Low');
      assert.strictEqual(updated.category, 'Work');
      assert.strictEqual(updated.reminder, false);
      assert.strictEqual(updated.completed, true);
      assert.strictEqual(updated.dueDate, '2026-11-25');
      assert.strictEqual(updated.updatedAt, '2026-11-03T12:00:00.000Z');
    });

    test('Supabase: Database errors are not swallowed on insert or update', async () => {
      const failingSupabase = {
        from: () => ({
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: null, error: new Error('Simulated PG column error') })
            })
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () => Promise.resolve({ data: null, error: new Error('Simulated PG constraint error') })
              })
            })
          })
        })
      };

      const failingAdapter = new SupabaseStorageAdapter(failingSupabase, 'todos');

      await assert.rejects(
        () => failingAdapter.createTask({ id: 'err-1', title: 'Fail' }, testUserId),
        /Supabase insert failed: Simulated PG column error/i
      );

      await assert.rejects(
        () => failingAdapter.updateTask('err-1', { title: 'Fail' }, testUserId),
        /Supabase update failed: Simulated PG constraint error/i
      );
    });
  });

  describe('FirestoreStorageAdapter (Production Mock Validation)', () => {
    let mockDocs;
    let mockFirestore;
    let firestoreAdapter;

    before(() => {
      mockDocs = new Map();

      const createDocRef = (id) => ({
        id,
        get: async () => ({
          exists: mockDocs.has(id),
          data: () => mockDocs.get(id)
        }),
        set: async (data) => {
          mockDocs.set(id, data);
        },
        update: async (fields) => {
          const current = mockDocs.get(id) || {};
          mockDocs.set(id, Object.assign({}, current, fields));
        },
        delete: async () => {
          mockDocs.delete(id);
        }
      });

      mockFirestore = {
        collection: (name) => ({
          name,
          doc: (id) => createDocRef(id),
          orderBy: () => ({
            get: async () => ({
              docs: Array.from(mockDocs.values()).map(data => ({
                id: data.id,
                data: () => data
              }))
            })
          }),
          where: (field, op, val) => ({
            get: async () => {
              const matched = Array.from(mockDocs.values()).filter(d => d[field] === val);
              return {
                empty: matched.length === 0,
                size: matched.length,
                docs: matched.map(d => ({
                  ref: createDocRef(d.id),
                  data: () => d
                }))
              };
            }
          })
        }),
        batch: () => {
          const operations = [];
          return {
            delete: (ref) => operations.push(() => ref.delete()),
            commit: async () => {
              for (const op of operations) await op();
            }
          };
        }
      };

      firestoreAdapter = new FirestoreStorageAdapter(mockFirestore, 'todos');
    });

    test('Firestore: Creates and persists a document', async () => {
      const task = {
        id: 'fs-task-1',
        title: 'Production Firestore Task',
        dueDate: '2026-12-01',
        completed: false,
        createdAt: new Date().toISOString()
      };
      const created = await firestoreAdapter.createTask(task);
      assert.strictEqual(created.id, 'fs-task-1');
      assert.strictEqual(mockDocs.size, 1);
    });

    test('Firestore: Retrieves all documents', async () => {
      const tasks = await firestoreAdapter.getAllTasks();
      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].id, 'fs-task-1');
    });

    test('Firestore: Updates document fields', async () => {
      const updated = await firestoreAdapter.updateTask('fs-task-1', { completed: true });
      assert.strictEqual(updated.completed, true);

      const notFound = await firestoreAdapter.updateTask('missing-id', { completed: true });
      assert.strictEqual(notFound, null);
    });

    test('Firestore: Deletes document', async () => {
      const deleted = await firestoreAdapter.deleteTask('fs-task-1');
      assert.strictEqual(deleted, true);
      assert.strictEqual(mockDocs.size, 0);

      const notFound = await firestoreAdapter.deleteTask('missing-id');
      assert.strictEqual(notFound, false);
    });

    test('Firestore: Bulk clears completed documents via Batch write', async () => {
      await firestoreAdapter.createTask({ id: 'c1', title: 'Task 1', completed: true });
      await firestoreAdapter.createTask({ id: 'c2', title: 'Task 2', completed: true });
      await firestoreAdapter.createTask({ id: 'c3', title: 'Task 3', completed: false });

      const count = await firestoreAdapter.clearCompleted();
      assert.strictEqual(count, 2);

      const remaining = await firestoreAdapter.getAllTasks();
      assert.strictEqual(remaining.length, 1);
      assert.strictEqual(remaining[0].id, 'c3');
    });
  });
});
