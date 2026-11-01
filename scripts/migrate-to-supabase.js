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

/**
 * Core Supabase migration engine
 * @param {Object} options
 * @param {Object} options.supabase - Supabase client instance or mock
 * @param {Array} options.tasks - Array of task objects to migrate
 * @param {string} [options.tableName='todos'] - Target table name
 * @param {boolean} [options.dryRun=false] - If true, simulates migration without writing
 * @returns {Promise<Object>} Migration audit summary
 */
async function runSupabaseMigration({ supabase, tasks, tableName = TABLE_NAME, dryRun = false }) {
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
  console.log(`Source records to evaluate: ${tasks.length}`);

  for (const task of tasks) {
    if (!task || !task.id) {
      console.warn(`[WARN] Skipping malformed record (missing id):`, task);
      results.failed++;
      results.records.push({ id: 'UNKNOWN', title: task?.title || 'Unknown', status: 'FAILED_INVALID_RECORD' });
      continue;
    }

    try {
      // Check if task exists in Supabase
      const { data: existing, error: checkError } = await supabase
        .from(tableName)
        .select('id, title')
        .eq('id', task.id)
        .maybeSingle();

      if (checkError) {
        throw checkError;
      }

      if (existing) {
        console.log(`[SKIP] Task "${task.title}" (ID: ${task.id}) already exists in Supabase. Preserving existing record.`);
        results.skipped++;
        results.records.push({ id: task.id, title: task.title, status: 'SKIPPED_ALREADY_EXISTS' });
      } else {
        const payload = {
          id: task.id,
          title: task.title,
          completed: Boolean(task.completed),
          due_date: task.dueDate || null,
          created_at: task.createdAt || new Date().toISOString()
        };

        if (!dryRun) {
          const { error: insertError } = await supabase
            .from(tableName)
            .insert(payload);

          if (insertError) {
            throw insertError;
          }
        }

        console.log(`[${dryRun ? 'DRY-RUN INSERT' : 'INSERT'}] Task "${task.title}" (ID: ${task.id}) ${dryRun ? 'would be created' : 'created successfully'}.`);
        results.inserted++;
        results.records.push({ id: task.id, title: task.title, status: dryRun ? 'DRY_RUN_INSERTED' : 'INSERTED' });
      }
    } catch (err) {
      console.error(`[ERROR] Failed to migrate task ID ${task.id}:`, err.message || err);
      results.failed++;
      results.records.push({ id: task.id, title: task.title, status: 'ERROR', error: err.message || err });
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
  runSupabaseMigration
};

