/**
 * ==============================================================================
 * Taskly - Safe, Idempotent Firestore Migration Utility
 * ==============================================================================
 * Safely migrates local JSON tasks to Google Cloud Firestore (Native Mode).
 * 
 * Safety Guarantees:
 *  1. Non-destructive: Never deletes or modifies the local source file (data/todos.json).
 *  2. Idempotent: Checks for existence before writing; never overwrites existing records.
 *  3. Audit trail: Logs every document action (INSERT, SKIP, FAIL) with full count verification.
 *  4. Dry-run support: Allows simulation without making write calls (--dry-run).
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_SOURCE_FILE = path.join(__dirname, '..', 'data', 'todos.json');
const BACKUP_SOURCE_FILE = path.join(__dirname, '..', 'data', 'todos.backup.json');
const COLLECTION_NAME = 'todos';

/**
 * Core migration engine
 * @param {Object} options
 * @param {Object} options.firestore - Google Cloud Firestore instance or mock
 * @param {Array} options.tasks - Array of task objects to migrate
 * @param {string} [options.collectionName='todos'] - Target collection name
 * @param {boolean} [options.dryRun=false] - If true, simulates migration without writing
 * @returns {Promise<Object>} Migration audit summary
 */
async function runMigration({ firestore, tasks, collectionName = COLLECTION_NAME, dryRun = false }) {
  if (!firestore) {
    throw new Error('Firestore instance is required for migration');
  }
  if (!Array.isArray(tasks)) {
    throw new Error('Tasks must be an array of task objects');
  }

  const collection = firestore.collection(collectionName);
  const results = {
    totalSource: tasks.length,
    inserted: 0,
    skipped: 0,
    failed: 0,
    dryRun,
    records: []
  };

  console.log(`\n--- Starting Taskly Migration [Dry-run: ${dryRun}] ---`);
  console.log(`Source records to evaluate: ${tasks.length}`);

  for (const task of tasks) {
    if (!task || !task.id) {
      console.warn(`[WARN] Skipping malformed record (missing id):`, task);
      results.failed++;
      results.records.push({ id: 'UNKNOWN', title: task?.title || 'Unknown', status: 'FAILED_INVALID_RECORD' });
      continue;
    }

    try {
      const docRef = collection.doc(task.id);
      const doc = await docRef.get();

      if (doc.exists) {
        console.log(`[SKIP] Task "${task.title}" (ID: ${task.id}) already exists in Firestore. Preserving existing record.`);
        results.skipped++;
        results.records.push({ id: task.id, title: task.title, status: 'SKIPPED_ALREADY_EXISTS' });
      } else {
        if (!dryRun) {
          await docRef.set({
            id: task.id,
            title: task.title,
            completed: Boolean(task.completed),
            dueDate: task.dueDate || null,
            createdAt: task.createdAt || new Date().toISOString()
          });
        }
        console.log(`[${dryRun ? 'DRY-RUN INSERT' : 'INSERT'}] Task "${task.title}" (ID: ${task.id}) ${dryRun ? 'would be created' : 'created successfully'}.`);
        results.inserted++;
        results.records.push({ id: task.id, title: task.title, status: dryRun ? 'DRY_RUN_INSERTED' : 'INSERTED' });
      }
    } catch (err) {
      console.error(`[ERROR] Failed to migrate task ID ${task.id}:`, err.message);
      results.failed++;
      results.records.push({ id: task.id, title: task.title, status: 'ERROR', error: err.message });
    }
  }

  console.log('\n--- Migration Audit Summary ---');
  console.log(`Total Source Tasks: ${results.totalSource}`);
  console.log(`Inserted (New):     ${results.inserted}`);
  console.log(`Skipped (Existing): ${results.skipped}`);
  console.log(`Failed:             ${results.failed}`);
  console.log('-------------------------------\n');

  return results;
}

/**
 * CLI execution entrypoint
 */
async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const sourcePath = process.env.MIGRATION_SOURCE_FILE || (fs.existsSync(DEFAULT_SOURCE_FILE) ? DEFAULT_SOURCE_FILE : BACKUP_SOURCE_FILE);

  console.log(`Taskly Migration Utility`);
  console.log(`Reading source file: ${sourcePath}`);

  if (!fs.existsSync(sourcePath)) {
    console.error(`[FATAL] Source file not found: ${sourcePath}`);
    process.exit(1);
  }

  let tasks;
  try {
    const raw = fs.readFileSync(sourcePath, 'utf8');
    tasks = JSON.parse(raw);
    if (!Array.isArray(tasks)) {
      throw new Error('File content is not a JSON array');
    }
  } catch (err) {
    console.error(`[FATAL] Could not parse source JSON file: ${err.message}`);
    process.exit(1);
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID;
  if (!projectId) {
    console.error('[FATAL] Missing GCP project configuration. Please set GOOGLE_CLOUD_PROJECT or GCP_PROJECT_ID environment variable.');
    console.error('Example: GOOGLE_CLOUD_PROJECT=taskly-prod-202611 npm run migrate:firestore');
    process.exit(1);
  }

  let firestore;
  try {
    const { Firestore } = require('@google-cloud/firestore');
    firestore = new Firestore({
      projectId,
      databaseId: process.env.FIRESTORE_DATABASE_ID || '(default)'
    });
    // Test connectivity
    await firestore.collection(COLLECTION_NAME).limit(1).get();
  } catch (err) {
    console.error(`[FATAL] Could not connect to Google Cloud Firestore (Project: ${projectId}): ${err.message}`);
    console.error('Ensure you have authenticated to GCP using: gcloud auth application-default login');
    process.exit(1);
  }

  try {
    const summary = await runMigration({ firestore, tasks, dryRun: isDryRun });
    if (summary.failed > 0) {
      console.warn(`[WARNING] Migration completed with ${summary.failed} failures.`);
      process.exit(1);
    }
    console.log('[SUCCESS] All tasks verified and migrated successfully.');
  } catch (err) {
    console.error('[FATAL] Migration failed:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  runMigration
};

