const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const { runMigration } = require('../scripts/migrate-to-firestore.js');

describe('Safe Firestore Migration Test Suite', () => {
  let mockDocs;
  let mockFirestore;

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
      }
    });

    mockFirestore = {
      collection: (name) => ({
        name,
        doc: (id) => createDocRef(id)
      })
    };
  });

  test('Dry-run does not write to Firestore', async () => {
    const tasks = [
      { id: 'dry-1', title: 'Dry Run Task', completed: false }
    ];
    const summary = await runMigration({
      firestore: mockFirestore,
      tasks,
      dryRun: true
    });

    assert.strictEqual(summary.inserted, 1);
    assert.strictEqual(summary.dryRun, true);
    assert.strictEqual(mockDocs.size, 0); // No records actually written
  });

  test('Migrates new tasks into Firestore', async () => {
    const tasks = [
      { id: 'mig-1', title: 'Migration Task 1', completed: false, dueDate: '2026-12-01' },
      { id: 'mig-2', title: 'Migration Task 2', completed: true, dueDate: null }
    ];
    const summary = await runMigration({
      firestore: mockFirestore,
      tasks,
      dryRun: false
    });

    assert.strictEqual(summary.inserted, 2);
    assert.strictEqual(summary.skipped, 0);
    assert.strictEqual(summary.failed, 0);
    assert.strictEqual(mockDocs.size, 2);
    assert.strictEqual(mockDocs.get('mig-1').title, 'Migration Task 1');
  });

  test('Idempotency: Re-running migration skips existing tasks and never overwrites', async () => {
    // Modify one task in source list to ensure it is NOT overwritten
    const tasks = [
      { id: 'mig-1', title: 'TAMPERED TITLE - MUST NOT OVERWRITE', completed: true },
      { id: 'mig-3', title: 'New Migration Task 3', completed: false }
    ];

    const summary = await runMigration({
      firestore: mockFirestore,
      tasks,
      dryRun: false
    });

    assert.strictEqual(summary.inserted, 1); // Only mig-3 is inserted
    assert.strictEqual(summary.skipped, 1);  // mig-1 is skipped
    assert.strictEqual(summary.failed, 0);

    // Assert mig-1 still retains its original title
    const doc = mockDocs.get('mig-1');
    assert.strictEqual(doc.title, 'Migration Task 1');
    assert.notStrictEqual(doc.title, 'TAMPERED TITLE - MUST NOT OVERWRITE');
  });

  test('Skips and logs malformed tasks gracefully', async () => {
    const malformed = [
      null,
      { title: 'No ID task' }
    ];

    const summary = await runMigration({
      firestore: mockFirestore,
      tasks: malformed,
      dryRun: false
    });

    assert.strictEqual(summary.failed, 2);
  });
});
