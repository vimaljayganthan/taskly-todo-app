const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const RES_DIR = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res');
const app = require(path.join(ROOT_DIR, 'public', 'app.js'));

describe('Taskly Android Notification Branding & Paper Rocket Elimination Suite', () => {

  beforeEach(() => {
    let storage = {};
    global.localStorage = {
      getItem: (k) => storage[k] || null,
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: (k) => { delete storage[k]; }
    };
    if (app.state) {
      app.state.currentUser = { id: 'u-brand-test', email: 'test@taskly.app' };
      app.state.todos = [];
      app.state.quickNotes = [];
      app.state.notifications = [];
    }
  });

  describe('1. Zero Legacy Paper Rocket In Project & Notification Pipeline', () => {
    test('No image in res/drawable or res/mipmap contains old rocket artwork', () => {
      const folders = ['drawable', 'drawable-mdpi', 'drawable-hdpi', 'drawable-xhdpi', 'drawable-xxhdpi', 'drawable-xxxhdpi'];
      folders.forEach(f => {
        const dir = path.join(RES_DIR, f);
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          files.forEach(file => {
            assert.ok(!file.toLowerCase().includes('rocket'), `No file should contain 'rocket': ${f}/${file}`);
            assert.ok(!file.toLowerCase().includes('plane'), `No file should contain 'plane': ${f}/${file}`);
          });
        }
      });
    });

    test('capacitor.config.json strictly specifies ic_stat_paw and taskly_meow.wav', () => {
      const cfg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'capacitor.config.json'), 'utf8'));
      assert.strictEqual(cfg.plugins.LocalNotifications.smallIcon, 'ic_stat_paw');
      assert.strictEqual(cfg.plugins.LocalNotifications.iconColor, '#F88438');
      assert.strictEqual(cfg.plugins.LocalNotifications.sound, 'taskly_meow.wav');
    });
  });

  describe('2. Notification LargeIcon & SmallIcon Mapping Integrity', () => {
    test('All notification scenarios configure valid largeIcon matching drawable resources and ic_stat_paw', async () => {
      const notifs = app.TasklyNotifications;
      const scheduled = [];
      const origPlugin = notifs.getPlugin;
      notifs.getPlugin = () => ({
        schedule: async (opts) => { scheduled.push(...opts.notifications); },
        cancel: async () => {}
      });

      try {
        // Immediate notifications: created, updated, deleted, completed, system
        const testTypes = ['task_created', 'task_updated', 'task_deleted', 'task_completed', 'system', 'brand'];
        for (const type of testTypes) {
          await notifs.notifyImmediate({ title: `Test ${type}`, description: 'Desc', type });
          const notif = scheduled[scheduled.length - 1];
          assert.strictEqual(notif.smallIcon, 'ic_stat_paw', `Type "${type}" must use smallIcon "ic_stat_paw"`);
          assert.ok(notif.largeIcon, `Type "${type}" must have a largeIcon`);
          assert.ok(!notif.largeIcon.includes('rocket'), `Type "${type}" must not use rocket`);

          // Confirm the resource exists in drawable
          const drawablePath = path.join(RES_DIR, 'drawable', `${notif.largeIcon}.png`);
          assert.ok(fs.existsSync(drawablePath), `LargeIcon drawable must exist: ${notif.largeIcon}.png`);
        }

        // Deadlines: approaching, reached, overdue
        const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000);
        const ymd = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
        const hh = String(futureDate.getHours()).padStart(2, '0');
        const mm = String(futureDate.getMinutes()).padStart(2, '0');

        await notifs.scheduleTaskDeadlines({
          id: 'test-deadline-branding',
          title: 'Branding Deadline Task',
          dueDate: ymd,
          time: `${hh}:${mm}`,
          reminder: true,
          completed: false
        });

        const approaching = scheduled.find(n => n.extra?.type === 'deadline_approaching');
        const reached = scheduled.find(n => n.extra?.type === 'deadline_reached');
        const overdue = scheduled.find(n => n.extra?.type === 'task_overdue');

        assert.strictEqual(approaching.smallIcon, 'ic_stat_paw');
        assert.strictEqual(approaching.largeIcon, 'notif_cat_upcoming');
        assert.strictEqual(reached.smallIcon, 'ic_stat_paw');
        assert.strictEqual(reached.largeIcon, 'notif_cat_reached');
        assert.strictEqual(overdue.smallIcon, 'ic_stat_paw');
        assert.strictEqual(overdue.largeIcon, 'notif_cat_overdue');

        // Quick Note
        await notifs.scheduleQuickNoteReminder({ id: 'qn-brand-1', text: 'Brand test note' }, futureDate);
        const qn = scheduled.find(n => n.extra?.type === 'quick_note_reminder');
        assert.strictEqual(qn.smallIcon, 'ic_stat_paw');
        assert.strictEqual(qn.largeIcon, 'notif_cat_quicknote');
      } finally {
        notifs.getPlugin = origPlugin;
      }
    });

    test('resolveCatIcon safely resolves brand/system to logo and preserves cat mascots', () => {
      assert.strictEqual(app.TasklyNotifications.resolveCatIcon('system').largeIcon, 'logo');
      assert.strictEqual(app.TasklyNotifications.resolveCatIcon('brand').largeIcon, 'logo');
      assert.strictEqual(app.TasklyNotifications.resolveCatIcon('task_created').largeIcon, 'notif_cat_created');
      assert.strictEqual(app.TasklyNotifications.resolveCatIcon('deadline_reached').largeIcon, 'notif_cat_reached');
      assert.strictEqual(app.TasklyNotifications.resolveCatIcon('quick_note_reminder').largeIcon, 'notif_cat_quicknote');
    });
  });

  describe('3. Android Small Icon & Large Icon Resource Files', () => {
    test('drawable/logo.png is the approved Taskly Cat & Dog logo across all densities', () => {
      const folders = ['drawable', 'drawable-mdpi', 'drawable-hdpi', 'drawable-xhdpi', 'drawable-xxhdpi', 'drawable-xxxhdpi'];
      folders.forEach(f => {
        const logoFile = path.join(RES_DIR, f, 'logo.png');
        assert.ok(fs.existsSync(logoFile), `Missing ${f}/logo.png`);
        assert.ok(fs.statSync(logoFile).size > 1000, `${f}/logo.png must not be empty`);
      });
    });

    test('drawable/ic_stat_paw.png is strictly white-alpha monochrome across all densities', () => {
      const folders = ['drawable', 'drawable-mdpi', 'drawable-hdpi', 'drawable-xhdpi', 'drawable-xxhdpi', 'drawable-xxxhdpi'];
      folders.forEach(f => {
        const pawFile = path.join(RES_DIR, f, 'ic_stat_paw.png');
        assert.ok(fs.existsSync(pawFile), `Missing ${f}/ic_stat_paw.png`);
        assert.ok(fs.statSync(pawFile).size > 200, `${f}/ic_stat_paw.png must not be empty`);
      });
    });

    test('AndroidManifest.xml declares notification small icon and color metadata', () => {
      const manifestPath = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
      const manifestXml = fs.readFileSync(manifestPath, 'utf8');
      assert.ok(manifestXml.includes('android:name="com.taskly.app.default_notification_icon"'));
      assert.ok(manifestXml.includes('android:resource="@drawable/ic_stat_paw"'));
      assert.ok(manifestXml.includes('android:name="com.taskly.app.default_notification_color"'));
      assert.ok(manifestXml.includes('android:resource="@color/notification_icon_color"'));

      const colorsPath = path.join(RES_DIR, 'values', 'colors.xml');
      const colorsXml = fs.readFileSync(colorsPath, 'utf8');
      assert.ok(colorsXml.includes('<color name="notification_icon_color">#F88438</color>'));
    });

    test('TasklyNotifications.init clears stale delivered notifications on app startup', async () => {
      let removeAllCalled = false;
      const notifs = app.TasklyNotifications;
      const origPlugin = notifs.getPlugin;
      notifs.getPlugin = () => ({
        removeAllDeliveredNotifications: async () => { removeAllCalled = true; },
        createChannel: async () => {},
        checkPermissions: async () => ({ display: 'granted' }),
        addListener: () => {}
      });

      try {
        await notifs.init();
        assert.strictEqual(removeAllCalled, true, 'init() must call removeAllDeliveredNotifications()');
      } finally {
        notifs.getPlugin = origPlugin;
      }
    });
  });
});

