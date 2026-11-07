/**
 * Taskly - Comprehensive Suite for:
 * 1. Calendar Priority Intelligence Workload Colours
 * 2. Add Task & Edit Task - Custom Category (Yellow #FACC15)
 * 3. Android Application Logo Resources (Mipmaps, Splash, Adaptive)
 * 4. Immediate Notifications (Eliminate 5s delay, Success Guards, Performance Instrumentation)
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
const ANDROID_MANIFEST = fs.readFileSync(path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');

const app = require(path.join(ROOT_DIR, 'public', 'app.js'));

describe('Taskly Priority Intelligence, Custom Category, Android Logo & Instant Notifications Suite', () => {

  // =========================================================================
  // 1. CALENDAR DYNAMIC PRIORITY WORKLOAD TESTS
  // =========================================================================
  describe('1. Calendar Dynamic Priority Workload Engine', () => {
    const engine = app.TasklyWorkloadEngine;

    test('High + Medium produces Pink (#E83E9D)', () => {
      const d = '2026-11-01';
      const todos = [
        { id: 1, dueDate: d, priority: 'High', title: 'Task 1' },
        { id: 2, dueDate: d, priority: 'Medium', title: 'Task 2' }
      ];
      const res = engine.getWorkloadCategory(d, todos);
      assert.equal(res.hex.toUpperCase(), '#E83E9D');
      assert.equal(res.priority, 'high');
    });

    test('High + Low produces Pink (#E83E9D)', () => {
      const d = '2026-11-02';
      const todos = [
        { id: 1, dueDate: d, priority: 'High', title: 'Task 1' },
        { id: 2, dueDate: d, priority: 'Low', title: 'Task 2' }
      ];
      const res = engine.getWorkloadCategory(d, todos);
      assert.equal(res.hex.toUpperCase(), '#E83E9D');
      assert.equal(res.priority, 'high');
    });

    test('Medium + Low produces Green (#83DF64)', () => {
      const d = '2026-11-03';
      const todos = [
        { id: 1, dueDate: d, priority: 'Medium', title: 'Task 1' },
        { id: 2, dueDate: d, priority: 'Low', title: 'Task 2' }
      ];
      const res = engine.getWorkloadCategory(d, todos);
      assert.equal(res.hex.toUpperCase(), '#83DF64');
      assert.equal(res.priority, 'medium');
    });

    test('All three priorities (High + Medium + Low) produce Pink (#E83E9D)', () => {
      const d = '2026-11-04';
      const todos = [
        { id: 1, dueDate: d, priority: 'High', title: 'Task 1' },
        { id: 2, dueDate: d, priority: 'Medium', title: 'Task 2' },
        { id: 3, dueDate: d, priority: 'Low', title: 'Task 3' }
      ];
      const res = engine.getWorkloadCategory(d, todos);
      assert.equal(res.hex.toUpperCase(), '#E83E9D');
      assert.equal(res.priority, 'high');
    });

    test('Equal High priorities (High + High) produce Grey (#EEEEEE)', () => {
      const d = '2026-11-05';
      const todos = [
        { id: 1, dueDate: d, priority: 'High', title: 'Task 1' },
        { id: 2, dueDate: d, priority: 'High', title: 'Task 2' }
      ];
      const res = engine.getWorkloadCategory(d, todos);
      assert.equal(res.hex.toUpperCase(), '#EEEEEE');
      assert.equal(res.key, 'equal');
    });

    test('Equal Medium priorities (Medium + Medium) produce Grey (#EEEEEE)', () => {
      const d = '2026-11-06';
      const todos = [
        { id: 1, dueDate: d, priority: 'Medium', title: 'Task 1' },
        { id: 2, dueDate: d, priority: 'Medium', title: 'Task 2' }
      ];
      const res = engine.getWorkloadCategory(d, todos);
      assert.equal(res.hex.toUpperCase(), '#EEEEEE');
      assert.equal(res.key, 'equal');
    });

    test('Equal Low priorities (Low + Low) produce Grey (#EEEEEE)', () => {
      const d = '2026-11-07';
      const todos = [
        { id: 1, dueDate: d, priority: 'Low', title: 'Task 1' },
        { id: 2, dueDate: d, priority: 'Low', title: 'Task 2' }
      ];
      const res = engine.getWorkloadCategory(d, todos);
      assert.equal(res.hex.toUpperCase(), '#EEEEEE');
      assert.equal(res.key, 'equal');
    });

    test('Empty dates (0 tasks) remain neutral without classifying as workload', () => {
      const d = '2026-11-08';
      const todos = [];
      const res = engine.getWorkloadCategory(d, todos);
      assert.equal(res.key, 'empty');
      assert.equal(res.count, 0);
      assert.equal(res.hex, 'transparent');
    });

    test('Editing, completing, moving, and deleting tasks dynamically recalculate both affected dates', () => {
      const dFrom = '2026-11-10';
      const dTo = '2026-11-11';

      let todos = [
        { id: 't1', dueDate: dFrom, priority: 'High', completed: false },
        { id: 't2', dueDate: dFrom, priority: 'Low', completed: false }
      ];

      // Initially dFrom has High + Low -> Pink; dTo is empty -> neutral
      assert.equal(engine.getWorkloadCategory(dFrom, todos).hex.toUpperCase(), '#E83E9D');
      assert.equal(engine.getWorkloadCategory(dTo, todos).key, 'empty');

      // Edit priority of t1 to Low -> now dFrom has Low + Low -> Grey (#EEEEEE)
      todos[0].priority = 'Low';
      assert.equal(engine.getWorkloadCategory(dFrom, todos).hex.toUpperCase(), '#EEEEEE');

      // Move t1 to dTo -> dFrom has only t2 (Low -> Cyan); dTo has t1 (Low -> Cyan)
      todos[0].dueDate = dTo;
      assert.equal(engine.getWorkloadCategory(dFrom, todos).hex.toUpperCase(), '#83DDE8');
      assert.equal(engine.getWorkloadCategory(dTo, todos).hex.toUpperCase(), '#83DDE8');

      // Delete t2 from dFrom -> dFrom becomes empty neutral; dTo remains Cyan
      todos = todos.filter(t => t.id !== 't2');
      assert.equal(engine.getWorkloadCategory(dFrom, todos).key, 'empty');
      assert.equal(engine.getWorkloadCategory(dTo, todos).hex.toUpperCase(), '#83DDE8');
    });
  });

  // =========================================================================
  // 2. CUSTOM CATEGORY TESTS
  // =========================================================================
  describe('2. Custom Category (Yellow #FACC15) Functionality & Persistence', () => {
    let mockStorage = {};

    beforeEach(() => {
      mockStorage = {};
      global.localStorage = {
        getItem: (k) => mockStorage[k] || null,
        setItem: (k, v) => { mockStorage[k] = String(v); },
        removeItem: (k) => { delete mockStorage[k]; },
        clear: () => { mockStorage = {}; }
      };
    });

    test('TaskCategoryColors defines Custom with Yellow #FACC15 and dark badgeText #422006', () => {
      const cat = app.TaskCategoryColors.Custom;
      assert.ok(cat, 'Custom category must be present in TaskCategoryColors');
      assert.equal(cat.hex.toUpperCase(), '#FACC15');
      assert.equal(cat.badgeText.toUpperCase(), '#422006');
    });

    test('Custom category creation stores category in persistent storage', () => {
      const created = app.saveCustomCategory('Fitness');
      assert.equal(created, 'Fitness');

      const stored = app.getStoredCustomCategories();
      assert.equal(stored.length, 1);
      assert.equal(stored[0], 'Fitness');
    });

    test('Duplicate category prevention (case-insensitive) rejects duplicates', () => {
      app.saveCustomCategory('Marketing');
      assert.throws(() => {
        app.saveCustomCategory('marketing');
      }, /already exists/i);

      const stored = app.getStoredCustomCategories();
      assert.equal(stored.length, 1, 'Only one instance should be stored');
    });

    test('Empty name validation rejects empty or whitespace-only names', () => {
      assert.throws(() => app.saveCustomCategory(''), /cannot be empty/i);
      assert.throws(() => app.saveCustomCategory('   '), /cannot be empty/i);
      assert.throws(() => app.saveCustomCategory(null), /cannot be empty/i);
    });

    test('getTaskCategoryConfig resolves any custom category name to Yellow #FACC15', () => {
      const cfg = app.getTaskCategoryConfig('Fitness');
      assert.equal(cfg.hex.toUpperCase(), '#FACC15');
      assert.equal(cfg.key, 'custom');
      assert.equal(cfg.badgeText.toUpperCase(), '#422006');
    });

    test('Existing categories (Project, Work, Study, Personal) remain unaffected', () => {
      assert.equal(app.getTaskCategoryConfig('Project').hex.toUpperCase(), '#E83E9D');
      assert.equal(app.getTaskCategoryConfig('Work').hex.toUpperCase(), '#83DF64');
      assert.equal(app.getTaskCategoryConfig('Study').hex.toUpperCase(), '#83DDE8');
      assert.equal(app.getTaskCategoryConfig('Personal').hex.toUpperCase(), '#EEEEEE');
    });

    test('CSS defines Yellow custom category badges, pill options, and timeline cards', () => {
      assert.match(STYLES_CSS, /\.cat-badge-custom/i);
      assert.match(STYLES_CSS, /background-color:\s*#FACC15/i);
      assert.match(STYLES_CSS, /\.tl-card-cat-custom/i);
      assert.match(STYLES_CSS, /border-left:\s*4px\s+solid\s+#FACC15/i);
    });

    test('HTML templates include Custom category trigger in Add Task and option in Edit Task', () => {
      assert.match(INDEX_HTML, /data-val="Custom"/i);
      assert.match(INDEX_HTML, /<option value="__new_custom__">/i);
      assert.match(INDEX_HTML, /id="add-custom-category-input-row"/i);
      assert.match(INDEX_HTML, /id="edit-custom-category-input-row"/i);
    });
  });

  // =========================================================================
  // 3. ANDROID LOGO RESOURCES TESTS
  // =========================================================================
  describe('3. Android Logo Replacement & Resources Integrity', () => {
    const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];

    test('All 5 mipmap densities contain ic_launcher.png, ic_launcher_round.png, and ic_launcher_foreground.png', () => {
      densities.forEach(density => {
        const mipmapDir = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', `mipmap-${density}`);
        assert.ok(fs.existsSync(path.join(mipmapDir, 'ic_launcher.png')), `Missing ic_launcher.png in mipmap-${density}`);
        assert.ok(fs.existsSync(path.join(mipmapDir, 'ic_launcher_round.png')), `Missing ic_launcher_round.png in mipmap-${density}`);
        assert.ok(fs.existsSync(path.join(mipmapDir, 'ic_launcher_foreground.png')), `Missing ic_launcher_foreground.png in mipmap-${density}`);

        const statLaunch = fs.statSync(path.join(mipmapDir, 'ic_launcher.png'));
        const statRound = fs.statSync(path.join(mipmapDir, 'ic_launcher_round.png'));
        const statFore = fs.statSync(path.join(mipmapDir, 'ic_launcher_foreground.png'));

        assert.ok(statLaunch.size > 500, `ic_launcher.png in ${density} too small (${statLaunch.size} bytes)`);
        assert.ok(statRound.size > 500, `ic_launcher_round.png in ${density} too small (${statRound.size} bytes)`);
        assert.ok(statFore.size > 500, `ic_launcher_foreground.png in ${density} too small (${statFore.size} bytes)`);
      });
    });

    test('All 11 splash screen resources are packaged with approved logo and #FCEFDF background', () => {
      const splashFiles = [
        path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', 'drawable', 'splash.png'),
        path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', 'drawable-port-mdpi', 'splash.png'),
        path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', 'drawable-port-hdpi', 'splash.png'),
        path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', 'drawable-port-xhdpi', 'splash.png'),
        path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', 'drawable-port-xxhdpi', 'splash.png'),
        path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', 'drawable-port-xxxhdpi', 'splash.png'),
        path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', 'drawable-land-mdpi', 'splash.png'),
        path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', 'drawable-land-hdpi', 'splash.png'),
        path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', 'drawable-land-xhdpi', 'splash.png'),
        path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', 'drawable-land-xxhdpi', 'splash.png'),
        path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', 'drawable-land-xxxhdpi', 'splash.png')
      ];

      splashFiles.forEach(f => {
        assert.ok(fs.existsSync(f), `Splash screen missing: ${f}`);
        const stat = fs.statSync(f);
        assert.ok(stat.size > 1000, `Splash screen file empty or corrupted: ${f}`);
      });
    });

    test('AndroidManifest.xml references correct launcher icons', () => {
      assert.match(ANDROID_MANIFEST, /android:icon="@mipmap\/ic_launcher"/);
      assert.match(ANDROID_MANIFEST, /android:roundIcon="@mipmap\/ic_launcher_round"/);
    });

    test('Web branding assets (logo.png, icon-512.png, icon-192.png, favicon.png, favicon.ico) exist and are non-empty', () => {
      const webFiles = ['logo.png', 'icon-512.png', 'icon-192.png', 'favicon.png', 'favicon.ico'];
      webFiles.forEach(file => {
        const fullPath = path.join(ROOT_DIR, 'public', file);
        assert.ok(fs.existsSync(fullPath), `Web asset missing: ${file}`);
        assert.ok(fs.statSync(fullPath).size > 100, `Web asset ${file} is too small`);
      });
    });

    test('capacitor.config.json specifies #FCEFDF splash screen background color', () => {
      assert.equal(CAPACITOR_CONFIG.plugins.SplashScreen.backgroundColor.toLowerCase(), '#fcefdf');
    });
  });

  // =========================================================================
  // 4. IMMEDIATE NOTIFICATION TESTS (ELIMINATE 5S DELAY)
  // =========================================================================
  describe('4. Instant Notification Dispatch & Success Guards', () => {
    test('notifyImmediate dispatches without schedule property to avoid AlarmManager delay', async () => {
      const notifs = app.TasklyNotifications;
      let scheduledPayload = null;

      const origGetPlugin = notifs.getPlugin;
      notifs.getPlugin = () => ({
        schedule: async (opts) => {
          scheduledPayload = opts;
          return { notifications: opts.notifications };
        }
      });

      try {
        await notifs.notifyImmediate({
          title: 'Immediate Test',
          body: 'Testing direct notification',
          type: 'task_created',
          taskId: 't-instant-1'
        });

        assert.ok(scheduledPayload, 'Schedule should have been called on plugin');
        assert.ok(Array.isArray(scheduledPayload.notifications));
        const item = scheduledPayload.notifications[0];

        // CRITICAL: schedule property must NOT exist in notifyImmediate
        assert.equal(item.schedule, undefined, 'item.schedule must be undefined to bypass Android AlarmManager delay');
        assert.equal(item.channelId, 'taskly-reminders-v3');
        assert.equal(item.sound, 'taskly_meow.wav');
      } finally {
        notifs.getPlugin = origGetPlugin;
      }
    });

    test('timingMetrics instruments operation to dispatch latency', async () => {
      const notifs = app.TasklyNotifications;
      const origGetPlugin = notifs.getPlugin;
      notifs.getPlugin = () => ({
        schedule: async () => ({ notifications: [] })
      });

      try {
        await notifs.notifyImmediate({
          title: 'Timing Test',
          body: 'Check timingMetrics',
          type: 'task_updated',
          taskId: 't-timing-1'
        });

        const metrics = notifs.timingMetrics;
        assert.ok(metrics, 'timingMetrics must exist on TasklyNotifications');
        assert.ok(typeof metrics.lastNotificationRequestedAt === 'number');
        assert.ok(typeof metrics.lastNotificationDispatchedAt === 'number');
        assert.ok(typeof metrics.applicationLatencyMs === 'number');
        assert.ok(metrics.applicationLatencyMs >= 0, 'Latency must be >= 0ms');
      } finally {
        notifs.getPlugin = origGetPlugin;
      }
    });

    test('Quick Note reminders retain schedule property for future delivery', async () => {
      const notifs = app.TasklyNotifications;
      let scheduledPayload = null;

      const origGetPlugin = notifs.getPlugin;
      notifs.getPlugin = () => ({
        schedule: async (opts) => {
          scheduledPayload = opts;
          return { notifications: opts.notifications };
        }
      });

      try {
        const futureDate = new Date(Date.now() + 60000);
        await notifs.scheduleQuickNoteReminder(
          { id: 'qn-1', text: 'Important Note Reminder' },
          futureDate
        );

        assert.ok(scheduledPayload);
        const item = scheduledPayload.notifications[0];
        assert.ok(item.schedule, 'Quick Note reminder MUST have schedule for future reminder');
        assert.equal(item.channelId, 'taskly-reminders-v3');
        assert.equal(item.sound, 'taskly_meow.wav');
      } finally {
        notifs.getPlugin = origGetPlugin;
      }
    });

    test('taskly_meow.wav is present in native res/raw and web fallback', () => {
      const rawPath = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', 'raw', 'taskly_meow.wav');
      const webPath = path.join(ROOT_DIR, 'public', 'assets', 'sounds', 'taskly_meow.wav');

      assert.ok(fs.existsSync(rawPath), 'res/raw/taskly_meow.wav must exist');
      assert.ok(fs.existsSync(webPath), 'public/assets/sounds/taskly_meow.wav must exist');

      const rawStat = fs.statSync(rawPath);
      assert.ok(rawStat.size > 1000, `WAV file too small: ${rawStat.size} bytes`);
    });
  });

});
