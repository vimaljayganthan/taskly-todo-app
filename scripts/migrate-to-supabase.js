/**
 * ==============================================================================
 * Taskly - Safe, Idempotent Supabase PostgreSQL Migration Utility
 * ==============================================================================
 * Safely migrates local JSON tasks to Supabase PostgreSQL.
 * 
 * Safety Guarantees:
 *  1. Non-destructive: Never alters or deletes the local source JSON file.
 *  2. Idempotent: Checks for existing IDs before writing; never overwrites records.
 *  3. Audit trail: Logs every document action (INSERT, SKIP, FAIL) with full count verification.
 *  4. Dry-run support: Allows simulation without making write calls (--dry-run).
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_SOURCE_FILE = path.join(__dirname, '..', 'data', 'todos.json');
const BACKUP_SOURCE_FILE = path.join(__dirname, '..', 'data', 'todos.backup.json');
const TABLE_NAME = 'todos';
const DEFAULT_PRIMARY_USER_ID = '8fdf606c-4746-49ef-bbde-e38d85ed5797';

/**
 * Normalizes a task payload to match the database schema column naming and types.
 */
function normalizeTaskPayload(task, targetUserId) {
  return {
    id: task.id,
    user_id: targetUserId || task.user_id || task.userId || null,
    title: task.title,
    completed: Boolean(task.completed),
    due_date: task.dueDate !== undefined ? task.dueDate : (task.due_date || null),
    time: task.time || null,
    description: task.description || '',
    priority: task.priority || 'Medium',
    category: task.category || 'Personal',
    reminder: task.reminder !== undefined ? Boolean(task.reminder) : false,
    created_at: task.createdAt || task.created_at || new Date().toISOString(),
    updated_at: task.updatedAt || task.updated_at || null
  };
}

/**
 * Safely compares two timestamp values (supporting ISO strings, ms timestamps, or null).
 */
function compareTimestamps(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const tA = new Date(a).getTime();
  const tB = new Date(b).getTime();
  if (!isNaN(tA) && !isNaN(tB)) {
    return tA === tB;
  }
  return a === b;
}

/**
 * Compares every field of an existing database record against the expected normalized payload.
 * Returns an array of human-readable difference descriptions.
 */
function compareTaskFields(existing, expected) {
  const differences = [];

  if (existing.id !== expected.id) {
    differences.push(`id: expected "${expected.id}", got "${existing.id}"`);
  }
  if (expected.user_id && existing.user_id && existing.user_id !== expected.user_id) {
    differences.push(`user_id: expected "${expected.user_id}", got "${existing.user_id}"`);
  }
  if (existing.title !== expected.title) {
    differences.push(`title: expected "${expected.title}", got "${existing.title}"`);
  }
  if (Boolean(existing.completed) !== Boolean(expected.completed)) {
    differences.push(`completed: expected ${expected.completed}, got ${existing.completed}`);
  }
  const existingDueDate = existing.due_date !== undefined ? existing.due_date : (existing.dueDate || null);
  const expectedDueDate = expected.due_date || null;
  if (existingDueDate !== expectedDueDate) {
    differences.push(`due_date: expected ${expectedDueDate}, got ${existingDueDate}`);
  }
  const existingTime = existing.time || null;
  const expectedTime = expected.time || null;
  if (existingTime !== expectedTime) {
    differences.push(`time: expected ${expectedTime}, got ${existingTime}`);
  }
  const existingDesc = existing.description || '';
  const expectedDesc = expected.description || '';
  if (existingDesc !== expectedDesc) {
    differences.push(`description: expected "${expectedDesc}", got "${existingDesc}"`);
  }
  const existingPriority = existing.priority || 'Medium';
  const expectedPriority = expected.priority || 'Medium';
  if (existingPriority !== expectedPriority) {
    differences.push(`priority: expected ${expectedPriority}, got ${existingPriority}`);
  }
  const existingCategory = existing.category || 'Personal';
  const expectedCategory = expected.category || 'Personal';
  if (existingCategory !== expectedCategory) {
    differences.push(`category: expected ${expectedCategory}, got ${existingCategory}`);
  }
  const existingReminder = existing.reminder !== undefined ? Boolean(existing.reminder) : false;
  const expectedReminder = expected.reminder !== undefined ? Boolean(expected.reminder) : false;
  if (existingReminder !== expectedReminder) {
    differences.push(`reminder: expected ${expectedReminder}, got ${existingReminder}`);
  }

  const existingCreated = existing.created_at || existing.createdAt;
  const expectedCreated = expected.created_at;
  if (!compareTimestamps(existingCreated, expectedCreated)) {
    differences.push(`created_at: expected "${expectedCreated}", got "${existingCreated}"`);
  }

  const existingUpdated = existing.updated_at || existing.updatedAt || null;
  const expectedUpdated = expected.updated_at || null;
  if (!compareTimestamps(existingUpdated, expectedUpdated)) {
    differences.push(`updated_at: expected "${expectedUpdated}", got "${existingUpdated}"`);
  }

  return differences;
}

/**
 * Core Supabase migration engine
 * @param {Object} options
 * @param {Object} options.supabase - Supabase client instance or mock
 * @param {Array} options.tasks - Array of task objects to migrate
 * @param {string} [options.tableName='todos'] - Target table name
 * @param {string} [options.targetUserId] - Target user UUID for ownership
 * @param {boolean} [options.dryRun=false] - If true, simulates migration without writing
 * @returns {Promise<Object>} Migration audit summary
 */
async function runSupabaseMigration({ supabase, tasks, tableName = TABLE_NAME, targetUserId = process.env.MIGRATION_USER_ID || DEFAULT_PRIMARY_USER_ID, dryRun = false }) {
  if (!supabase) {
    throw new Error('Supabase client instance is required for migration');
  }
  if (!Array.isArray(tasks)) {
    throw new Error('Tasks must be an array of task objects');
  }

  const results = {
    totalSource: tasks.length,
    inserted: 0,
    skipped: 0,
    failed: 0,
    dryRun,
    records: []
  };

  console.log(`\n--- Starting Taskly Supabase Migration [Dry-run: ${dryRun}] ---`);
  console.log(`Target User UUID: ${targetUserId || '(none)'}`);
  console.log(`Source records to evaluate: ${tasks.length}`);

  // Phase 1: Pre-flight evaluation of all records in the batch
  // Validates structure, checks existing records, detects ownership and metadata conflicts.
  // If ANY task in the batch fails or conflicts, no writes are executed (all-or-nothing / no partial import).
  const plannedOperations = [];
  let hasConflictOrFailure = false;

  for (const task of tasks) {
    if (!task || !task.id) {
      console.warn(`[WARN] Skipping malformed record (missing id):`, task);
      results.failed++;
      results.records.push({ id: 'UNKNOWN', title: task?.title || 'Unknown', status: 'FAILED_INVALID_RECORD' });
      hasConflictOrFailure = true;
      continue;
    }

    const payload = normalizeTaskPayload(task, targetUserId);

    try {
      // Check if task exists in Supabase
      const { data: existing, error: checkError } = await supabase
        .from(tableName)
        .select('*')
        .eq('id', task.id)
        .maybeSingle();

      if (checkError) {
        throw checkError;
      }

      if (existing) {
        // 1. Ownership mismatch check: prevent silently reassigning an existing task to another user
        if (targetUserId && existing.user_id && existing.user_id !== targetUserId) {
          const mismatchErr = `Ownership conflict: Task "${task.title}" (ID: ${task.id}) already exists but belongs to user ${existing.user_id} (not target ${targetUserId})`;
          console.error(`[CONFLICT] ${mismatchErr}`);
          results.failed++;
          results.records.push({ id: task.id, title: task.title, status: 'FAILED_OWNERSHIP_MISMATCH', error: mismatchErr });
          hasConflictOrFailure = true;
          continue;
        }

        // 2. Strict field-by-field metadata comparison across all columns
        const differences = compareTaskFields(existing, payload);
        if (differences.length > 0) {
          const conflictErr = `Metadata conflict: Task "${task.title}" (ID: ${task.id}) already exists but metadata differs [${differences.join('; ')}]`;
          console.error(`[CONFLICT] ${conflictErr}`);
          results.failed++;
          results.records.push({
            id: task.id,
            title: task.title,
            status: 'FAILED_METADATA_MISMATCH',
            error: conflictErr,
            differences
          });
          hasConflictOrFailure = true;
          continue;
        }

        // Exact match: planned for safe skip
        plannedOperations.push({ type: 'SKIP', task, payload });
      } else {
        // New record: planned for insertion
        plannedOperations.push({ type: 'INSERT', task, payload });
      }
    } catch (err) {
      console.error(`[ERROR] Failed to evaluate task ID ${task.id}:`, err.message || err);
      results.failed++;
      results.records.push({ id: task.id, title: task.title, status: 'ERROR', error: err.message || err });
      hasConflictOrFailure = true;
    }
  }

  // Phase 2: Execution (All-or-Nothing / No Partial Import)
  // If ANY task in the batch encountered a conflict or error, halt execution with ZERO writes
  if (hasConflictOrFailure) {
    console.error(`\n[BATCH ABORTED] One or more tasks encountered conflicts or errors. Halting execution with ZERO writes to prevent partial import.`);
    for (const op of plannedOperations) {
      if (op.type === 'INSERT') {
        results.records.push({
          id: op.task.id,
          title: op.task.title,
          status: 'ABORTED_BATCH_CONFLICT',
          error: 'Skipped insert because another task in the batch had a conflict'
        });
      } else if (op.type === 'SKIP') {
        results.skipped++;
        results.records.push({ id: op.task.id, title: op.task.title, status: 'SKIPPED_ALREADY_EXISTS' });
      }
    }
  } else {
    // All tasks passed pre-flight validation; execute planned operations
    for (const op of plannedOperations) {
      if (op.type === 'SKIP') {
        console.log(`[SKIP] Task "${op.task.title}" (ID: ${op.task.id}) already exists in Supabase with exact matching metadata. Preserving existing record.`);
        results.skipped++;
        results.records.push({ id: op.task.id, title: op.task.title, status: 'SKIPPED_ALREADY_EXISTS' });
      } else if (op.type === 'INSERT') {
        try {
          if (!dryRun) {
            const { error: insertError } = await supabase
              .from(tableName)
              .insert(op.payload);

            if (insertError) {
              throw insertError;
            }
          }

          console.log(`[${dryRun ? 'DRY-RUN INSERT' : 'INSERT'}] Task "${op.task.title}" (ID: ${op.task.id}) ${dryRun ? 'would be created' : 'created successfully'}.`);
          results.inserted++;
          results.records.push({ id: op.task.id, title: op.task.title, status: dryRun ? 'DRY_RUN_INSERTED' : 'INSERTED' });
        } catch (insertErr) {
          console.error(`[ERROR] Failed to insert task ID ${op.task.id}:`, insertErr.message || insertErr);
          results.failed++;
          results.records.push({ id: op.task.id, title: op.task.title, status: 'ERROR', error: insertErr.message || insertErr });
        }
      }
    }
  }

  console.log('\n--- Supabase Migration Audit Summary ---');
  console.log(`Total Source Tasks: ${results.totalSource}`);
  console.log(`Inserted (New):     ${results.inserted}`);
  console.log(`Skipped (Existing): ${results.skipped}`);
  console.log(`Failed:             ${results.failed}`);
  console.log('----------------------------------------\n');

  return results;
}

/**
 * CLI execution entrypoint
 */
async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const sourcePath = process.env.MIGRATION_SOURCE_FILE || (fs.existsSync(DEFAULT_SOURCE_FILE) ? DEFAULT_SOURCE_FILE : BACKUP_SOURCE_FILE);

  console.log('Taskly Supabase Migration Utility');
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

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('[FATAL] Missing Supabase configuration. Please set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY).');
    console.error('Example: SUPABASE_URL=https://xyz.supabase.co SUPABASE_ANON_KEY=... npm run migrate:supabase');
    process.exit(1);
  }

  let supabase;
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    });
    // Test connectivity
    const { error } = await supabase.from(TABLE_NAME).select('id').limit(1);
    if (error) {
      throw error;
    }
  } catch (err) {
    console.error(`[FATAL] Could not connect to Supabase table "${TABLE_NAME}":`, err.message || err);
    console.error('Make sure you have run scripts/supabase-schema.sql in your Supabase SQL Editor first.');
    process.exit(1);
  }

  try {
    const summary = await runSupabaseMigration({ supabase, tasks, dryRun: isDryRun });
    if (summary.failed > 0) {
      console.warn(`[WARNING] Migration completed with ${summary.failed} failures.`);
      process.exit(1);
    }
    console.log('[SUCCESS] All tasks verified and migrated successfully to Supabase.');
  } catch (err) {
    console.error('[FATAL] Migration failed:', err.message || err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  runSupabaseMigration,
  compareTaskFields,
  normalizeTaskPayload
};

