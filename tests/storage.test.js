const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { FileStorageAdapter, FirestoreStorageAdapter } = require('../storage/taskStore.js');

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

