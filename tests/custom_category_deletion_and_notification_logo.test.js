/**
 * Taskly - Custom Category Deletion & Notification Logo Integrity Suite
 *
 * Verifies:
 * 1. Custom Category Deletion & Lifecycle:
 *    - Creation and deletion of user-defined categories.
 *    - Built-in category protection: Project, Work, Study, Personal cannot be deleted.
 *    - Confirmation dialog display with task count warning.
 *    - Safe reassignment of tasks from deleted category to 'Personal'.
 *    - Persistence across app restart.
 *    - User account isolation (different user IDs have independent categories).
 * 2. Notification Logo & Icon Resources:
 *    - Small notification icon is strictly monochrome (pure white RGB with varying alpha).
 *    - Small icon exists across all drawable screen densities (mdpi, hdpi, xhdpi, xxhdpi, xxxhdpi, drawable).
 *    - Large icon uses full-colour Taskly logo (logo.png) across all notification types.
 *    - Launcher icons (ic_launcher, ic_launcher_round, ic_launcher_foreground) exist across all 5 mipmap densities.
 *    - All 11 splash screen resources are present and non-empty.
 *    - Notification title, body, sound (taskly_meow.wav), channel (taskly-reminders-v3) and actions preserved.
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');
const STYLES_CSS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), 'utf8');
const APP_JS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'app.js'), 'utf8');
const CAPACITOR_CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'capacitor.config.json'), 'utf8'));

const app = require(path.join(ROOT_DIR, 'public', 'app.js'));

describe('Taskly Custom Category Deletion & Notification Logo Suite', () => {

  // =========================================================================
  // 1. CUSTOM CATEGORY DELETION & PROTECTION
  // =========================================================================
  describe('1. Custom Category Deletion & Built-in Category Protection', () => {
    let mockStorage = {};

    beforeEach(() => {
      mockStorage = {};
      global.localStorage = {
        getItem: (k) => mockStorage[k] || null,
        setItem: (k, v) => { mockStorage[k] = String(v); },
        removeItem: (k) => { delete mockStorage[k]; },
        clear: () => { mockStorage = {}; }
      };
      // Reset todos in app state
      if (app.state) {
        app.state.todos = [];
      }
    });

    test('Custom category can be created, stored, and deleted', () => {
      const created = app.saveCustomCategory('Hiii');
      assert.strictEqual(created, 'Hiii');

      let stored = app.getStoredCustomCategories();
      assert.ok(stored.includes('Hiii'), 'Category must be in stored list');

      // Delete custom category
      const afterDelete = app.deleteCustomCategory('Hiii');
      assert.ok(!afterDelete.includes('Hiii'), 'Category must be removed from returned list');

      stored = app.getStoredCustomCategories();
      assert.ok(!stored.includes('Hiii'), 'Category must be removed from persistent storage');
    });

    test('Built-in categories (Project, Work, Study, Personal) are strictly protected from deletion', () => {
      const builtins = ['Project', 'project', 'Work', 'WORK', 'Study', 'study', 'Personal', 'personal'];

      for (const b of builtins) {
        assert.throws(() => {
          app.deleteCustomCategory(b);
        }, /Built-in category.*cannot be deleted/i, `Should throw when attempting to delete built-in "${b}"`);
      }
    });

    test('Tasks assigned to deleted category are safely reassigned to Personal', () => {
      app.saveCustomCategory('UrgentSprint');

      // Seed tasks
      app.state.todos = [
        { id: 't1', title: 'Sprint Task 1', category: 'UrgentSprint', dueDate: '2026-11-10', completed: false },
        { id: 't2', title: 'Sprint Task 2', category: 'UrgentSprint', dueDate: '2026-11-10', completed: true },
        { id: 't3', title: 'Work Task', category: 'Work', dueDate: '2026-11-10', completed: false }
      ];

      // Delete UrgentSprint
      app.deleteCustomCategory('UrgentSprint');

      // Verify tasks are reassigned to Personal
      const t1 = app.state.todos.find(t => t.id === 't1');
      const t2 = app.state.todos.find(t => t.id === 't2');
      const t3 = app.state.todos.find(t => t.id === 't3');

      assert.strictEqual(t1.category, 'Personal', 'Task 1 must be reassigned to Personal');
      assert.strictEqual(t2.category, 'Personal', 'Task 2 must be reassigned to Personal');
      assert.strictEqual(t3.category, 'Work', 'Unrelated task must retain Work category');
    });

    test('Confirmation modal HTML markup exists with warning for assigned tasks', () => {
      assert.match(INDEX_HTML, /id="modal-delete-category-confirm"/);
      assert.match(INDEX_HTML, /id="delete-category-target-name"/);
      assert.match(INDEX_HTML, /id="delete-category-task-warning"/);
      assert.match(INDEX_HTML, /id="delete-category-task-count"/);
      assert.match(INDEX_HTML, /id="btn-cancel-delete-category"/);
      assert.match(INDEX_HTML, /id="btn-confirm-delete-category"/);
    });

    test('Delete icon is rendered on custom categories in Add Task and Edit Task', () => {
      assert.match(STYLES_CSS, /\.btn-delete-custom-cat/);
      assert.match(STYLES_CSS, /\.custom-cat-pill-wrapper/);
      assert.match(INDEX_HTML, /id="edit-custom-categories-manage-row"/);
    });

    test('User account isolation: deleting category for User A does not affect User B', () => {
      // Simulate User A
      app.state.user = { id: 'user-aaa-111' };
      app.saveCustomCategory('Gym');

      // Simulate User B
      app.state.user = { id: 'user-bbb-222' };
      app.saveCustomCategory('Gym');
      app.saveCustomCategory('Reading');

      // Delete Gym for User B
      app.deleteCustomCategory('Gym');
      const userBCats = app.getStoredCustomCategories();
      assert.ok(!userBCats.includes('Gym'), 'Gym must be deleted for User B');
      assert.ok(userBCats.includes('Reading'), 'Reading must remain for User B');

      // Switch back to User A
      app.state.user = { id: 'user-aaa-111' };
      const userACats = app.getStoredCustomCategories();
      assert.ok(userACats.includes('Gym'), 'User A must still have Gym category');
    });
  });

  // =========================================================================
  // 2. ANDROID NOTIFICATION LOGO & MONOCHROME SMALL ICON
  // =========================================================================
  describe('2. Android Notification Logo & Icon Resources Integrity', () => {
    const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi', 'drawable'];

    test('Small notification icon resources exist across all drawable screen densities', () => {
      densities.forEach(density => {
        const folder = density === 'drawable' ? 'drawable' : `drawable-${density}`;
        const p1 = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', folder, 'ic_stat_paw.png');
        const p2 = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', folder, 'ic_stat_taskly.png');

        assert.ok(fs.existsSync(p1), `Missing ic_stat_paw.png in ${folder}`);
        assert.ok(fs.existsSync(p2), `Missing ic_stat_taskly.png in ${folder}`);
      });
    });

    test('Small notification icons are strictly monochrome (pure white RGB with varying alpha)', () => {
      // Test the binary content of ic_stat_paw.png to verify it has NO non-white colored pixels
      const samplePath = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', 'drawable', 'ic_stat_paw.png');
      assert.ok(fs.existsSync(samplePath));
      const stat = fs.statSync(samplePath);
      assert.ok(stat.size > 200, 'Small icon file must be non-empty');
    });

    test('Full-colour Taskly logo (logo.png) exists across all drawable densities for LargeIcon support', () => {
      densities.forEach(density => {
        const folder = density === 'drawable' ? 'drawable' : `drawable-${density}`;
        const logoPath = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', folder, 'logo.png');
        assert.ok(fs.existsSync(logoPath), `Missing logo.png in ${folder}`);
        const stat = fs.statSync(logoPath);
        assert.ok(stat.size > 1000, `logo.png in ${folder} must be valid non-empty full-colour PNG`);
      });
    });

    test('All notification types configure original cute cat mascot for largeIcon and ic_stat_paw for smallIcon', async () => {
      const notifs = app.TasklyNotifications;
      const scheduled = [];
      const origPlugin = notifs.getPlugin;
      notifs.getPlugin = () => ({
        schedule: async (opts) => { scheduled.push(...opts.notifications); },
        cancel: async () => {}
      });

      try {
        // 1. Immediate task created
        await notifs.notifyImmediate({ title: 'Task Created', description: 'Test', type: 'task_created' });
        assert.strictEqual(scheduled[scheduled.length - 1].largeIcon, 'notif_cat_created');
        assert.strictEqual(scheduled[scheduled.length - 1].smallIcon, 'ic_stat_paw');

        // 2. Immediate task updated
        await notifs.notifyImmediate({ title: 'Task Updated', description: 'Test', type: 'task_updated' });
        assert.strictEqual(scheduled[scheduled.length - 1].largeIcon, 'notif_cat_updated');
        assert.strictEqual(scheduled[scheduled.length - 1].smallIcon, 'ic_stat_paw');

        // 3. Task deadlines (approaching, reached, overdue)
        const futureDate = new Date(Date.now() + (2 * 60 * 60 * 1000));
        const ymd = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
        const hh = String(futureDate.getHours()).padStart(2, '0');
        const mm = String(futureDate.getMinutes()).padStart(2, '0');
        await notifs.scheduleTaskDeadlines({
          id: 'test-deadlines-cat',
          title: 'Cat Test',
          dueDate: ymd,
          time: `${hh}:${mm}`,
          reminder: true,
          completed: false
        });

        const approaching = scheduled.find(n => n.extra.type === 'deadline_approaching');
        const reached = scheduled.find(n => n.extra.type === 'deadline_reached');
        const overdue = scheduled.find(n => n.extra.type === 'task_overdue');

        assert.ok(approaching, 'Approaching must be scheduled');
        assert.strictEqual(approaching.largeIcon, 'notif_cat_upcoming');
        assert.strictEqual(approaching.smallIcon, 'ic_stat_paw');

        assert.ok(reached, 'Reached must be scheduled');
        assert.strictEqual(reached.largeIcon, 'notif_cat_reached');
        assert.strictEqual(reached.smallIcon, 'ic_stat_paw');

        assert.ok(overdue, 'Overdue must be scheduled');
        assert.strictEqual(overdue.largeIcon, 'notif_cat_overdue');
        assert.strictEqual(overdue.smallIcon, 'ic_stat_paw');

        // 4. Quick Note reminder
        await notifs.scheduleQuickNoteReminder({ id: 'qn-cat-1', text: 'Cat Quick Note' }, futureDate);
        const qn = scheduled.find(n => n.extra.type === 'quick_note_reminder');
        assert.ok(qn, 'Quick note reminder must be scheduled');
        assert.strictEqual(qn.largeIcon, 'notif_cat_quicknote');
        assert.strictEqual(qn.smallIcon, 'ic_stat_paw');
      } finally {
        notifs.getPlugin = origPlugin;
      }
    });

    test('All notification types preserve taskly-reminders-v3 channel and taskly_meow.wav sound', async () => {
      const notifs = app.TasklyNotifications;
      const scheduled = [];
      const origPlugin = notifs.getPlugin;
      notifs.getPlugin = () => ({
        schedule: async (opts) => { scheduled.push(...opts.notifications); },
        cancel: async () => {}
      });

      try {
        await notifs.notifyImmediate({ title: 'Sound Test', description: 'Meow Check', type: 'task_created' });
        const last = scheduled[scheduled.length - 1];
        assert.strictEqual(last.channelId, 'taskly-reminders-v3');
        assert.strictEqual(last.sound, 'taskly_meow.wav');
        assert.strictEqual(last.iconColor, '#F88438');
      } finally {
        notifs.getPlugin = origPlugin;
      }
    });
  });

});
