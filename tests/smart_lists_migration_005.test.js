// ==============================================================================
// Taskly v2.1.0 — Supabase Migration 005 & title_override Schema Suite
// File: tests/smart_lists_migration_005.test.js
// ==============================================================================

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const MIGRATION_005_PATH = path.join(ROOT_DIR, 'scripts', '005_smart_routine_title_override.sql');
const APP_JS_PATH = path.join(ROOT_DIR, 'public', 'app.js');
const STORE_JS_PATH = path.join(ROOT_DIR, 'storage', 'smartListStore.js');

describe('Taskly v2.1.0 — Migration 005 & title_override Schema Verification', () => {
  const migrationSql = fs.readFileSync(MIGRATION_005_PATH, 'utf8');
  const appJs = fs.readFileSync(APP_JS_PATH, 'utf8');
  const storeJs = fs.readFileSync(STORE_JS_PATH, 'utf8');

  describe('1. Migration 005 SQL File Integrity & Safety', () => {
    test('1.1 Migration file exists and is transaction-wrapped', () => {
      assert.ok(fs.existsSync(MIGRATION_005_PATH), '005_smart_routine_title_override.sql must exist');
      assert.ok(migrationSql.includes('BEGIN;'), 'Migration must contain transaction BEGIN;');
      assert.ok(migrationSql.includes('COMMIT;'), 'Migration must conclude with transaction COMMIT;');
    });

    test('1.2 Pre-migration checks verify prerequisite table and unique constraint', () => {
      assert.ok(migrationSql.includes("tablename = 'smart_routine_completions'"), 'Must verify smart_routine_completions table exists');
      assert.ok(migrationSql.includes("contype = 'u'"), 'Must verify unique constraint exists');
      assert.ok(migrationSql.includes("RAISE EXCEPTION 'Pre-migration check failed"), 'Must abort transaction if prerequisites are missing');
    });

    test('1.3 Uses idempotent ALTER TABLE with TEXT DEFAULT NULL', () => {
      const expectedDdl = 'ALTER TABLE public.smart_routine_completions\n  ADD COLUMN IF NOT EXISTS title_override TEXT DEFAULT NULL;';
      assert.ok(
        migrationSql.includes('ADD COLUMN IF NOT EXISTS title_override TEXT DEFAULT NULL;'),
        'Must add column title_override TEXT DEFAULT NULL idempotently'
      );
    });

    test('1.4 Explicitly notifies PostgREST to reload schema cache', () => {
      assert.ok(
        migrationSql.includes("NOTIFY pgrst, 'reload schema';"),
        "Must include NOTIFY pgrst, 'reload schema'; to clear PGRST204 schema cache error"
      );
    });

    test('1.5 Preserves Row Level Security (RLS)', () => {
      assert.ok(
        migrationSql.includes('ALTER TABLE public.smart_routine_completions ENABLE ROW LEVEL SECURITY;'),
        'Must explicitly confirm RLS remains enabled'
      );
    });

    test('1.6 Post-migration checks validate column creation and nullability', () => {
      assert.ok(migrationSql.includes("column_name = 'title_override'"), 'Must verify title_override column exists in information_schema');
      assert.ok(migrationSql.includes("v_is_nullable <> 'YES'"), 'Must verify column is nullable');
      assert.ok(migrationSql.includes("RAISE NOTICE 'Post-migration verification PASSED"), 'Must log successful verification');
    });

    test('1.7 Documents non-destructive and destructive rollback options in comments', () => {
      assert.ok(migrationSql.includes('OPTION A: Non-Destructive Rollback'), 'Must document non-destructive rollback');
      assert.ok(migrationSql.includes('OPTION B: Destructive Rollback'), 'Must document destructive rollback');
      assert.ok(migrationSql.includes('DROP COLUMN IF EXISTS title_override'), 'Destructive rollback must document column drop');
    });
  });

  describe('2. Client & Backend Query Parity for title_override', () => {
    test('2.1 public/app.js sends title_override in updateTomorrowRoutine upsert', () => {
      assert.ok(
        appJs.includes('title_override: cleanTitle'),
        'updateTomorrowRoutine must pass title_override: cleanTitle to Supabase'
      );
    });

    test('2.2 public/app.js ingests item.title_override in fetchCompletions and fetchTomorrowRoutines', () => {
      assert.ok(
        appJs.includes('item.title_override'),
        'Client must read item.title_override from Supabase responses'
      );
    });

    test('2.3 public/app.js preserves title_override in handleToggleRoutine', () => {
      assert.ok(
        appJs.includes('title_override: current.titleOverride || null'),
        'handleToggleRoutine must preserve title_override during completion toggle'
      );
    });

    test('2.4 storage/smartListStore.js maps title_override and titleOverride bidirectionally', () => {
      assert.ok(
        storeJs.includes('c.titleOverride || c.title_override'),
        'smartListStore must map titleOverride from database c.title_override'
      );
    });
  });

  describe('3. Tomorrow Routine Title Isolation Logic', () => {
    test('3.1 Title override on tomorrow occurrence does not alter master routine title', () => {
      const app = require('../public/app');
      const manager = app.SmartListsManager;
      manager.clearLocalState();

      const routineId = 'rt-iso-1';
      const todayStr = '2026-11-09';
      const tomStr = '2026-11-10';

      manager.state.routines = [
        { id: routineId, title: 'Morning Meditation', recurrence: 'daily', orderIndex: 0 }
      ];

      // Simulate tomorrow title override
      manager.state.completions[`${routineId}_${tomStr}`] = {
        status: 'pending',
        completed: false,
        titleOverride: 'Deep Meditation (30 mins)'
      };

      // 1. Check tomorrow title
      const tomComp = manager.getCompletion(routineId, tomStr);
      assert.strictEqual(tomComp.titleOverride, 'Deep Meditation (30 mins)');

      // 2. Check today title (no override on today)
      const todayComp = manager.getCompletion(routineId, todayStr);
      assert.strictEqual(todayComp.titleOverride, null);

      // 3. Check master routine
      const masterRoutine = manager.state.routines.find(r => r.id === routineId);
      assert.strictEqual(masterRoutine.title, 'Morning Meditation', 'Master routine title must remain unchanged');
    });

    test('3.2 Day after tomorrow does not inherit tomorrow title override', () => {
      const app = require('../public/app');
      const manager = app.SmartListsManager;

      const routineId = 'rt-iso-1';
      const dayAfterStr = '2026-11-11';

      const futureComp = manager.getCompletion(routineId, dayAfterStr);
      assert.strictEqual(futureComp.titleOverride, null, 'Day after tomorrow must have no titleOverride');

      const masterRoutine = manager.state.routines.find(r => r.id === routineId);
      const displayTitle = futureComp.titleOverride || masterRoutine.title;
      assert.strictEqual(displayTitle, 'Morning Meditation', 'Day after tomorrow must display master title');
    });
  });
});
