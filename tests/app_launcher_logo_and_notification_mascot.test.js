const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const resDir = path.join(rootDir, 'android', 'app', 'src', 'main', 'res');
const app = require(path.join(rootDir, 'public', 'app.js'));

describe('Taskly App Launcher Icon & Notification Mascot Separation Suite', () => {

  beforeEach(() => {
    let storage = {};
    global.localStorage = {
      getItem: (k) => storage[k] || null,
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: (k) => { delete storage[k]; }
    };
    if (app.state) {
      app.state.currentUser = { id: 'u-launcher-test', email: 'test@taskly.app' };
      app.state.todos = [];
      app.state.quickNotes = [];
      app.state.notifications = [];
    }
  });

  describe('1. Android App Launcher Icon Mipmap Verification', () => {
    const densities = {
      'mdpi': { launcher: 48, fg: 108 },
      'hdpi': { launcher: 72, fg: 162 },
      'xhdpi': { launcher: 96, fg: 216 },
      'xxhdpi': { launcher: 144, fg: 324 },
      'xxxhdpi': { launcher: 192, fg: 432 }
    };

    test('All required mipmap directories contain ic_launcher, ic_launcher_round, and ic_launcher_foreground', () => {
      Object.entries(densities).forEach(([density, sizes]) => {
        const folder = path.join(resDir, `mipmap-${density}`);
        assert.ok(fs.existsSync(folder), `Missing mipmap-${density}`);

        const launcherPath = path.join(folder, 'ic_launcher.png');
        const roundPath = path.join(folder, 'ic_launcher_round.png');
        const fgPath = path.join(folder, 'ic_launcher_foreground.png');

        assert.ok(fs.existsSync(launcherPath), `Missing ${density}/ic_launcher.png`);
        assert.ok(fs.existsSync(roundPath), `Missing ${density}/ic_launcher_round.png`);
        assert.ok(fs.existsSync(fgPath), `Missing ${density}/ic_launcher_foreground.png`);

        const launcherStat = fs.statSync(launcherPath);
        const roundStat = fs.statSync(roundPath);
        const fgStat = fs.statSync(fgPath);

        assert.ok(launcherStat.size > 500, `${density}/ic_launcher.png must be non-empty`);
        assert.ok(roundStat.size > 500, `${density}/ic_launcher_round.png must be non-empty`);
        assert.ok(fgStat.size > 500, `${density}/ic_launcher_foreground.png must be non-empty`);
      });
    });

    test('Adaptive icon XML configs exist and reference #FCEFDF background color', () => {
      const anydpiDir = path.join(resDir, 'mipmap-anydpi-v26');
      assert.ok(fs.existsSync(anydpiDir), 'mipmap-anydpi-v26 must exist');

      const icLauncherXml = fs.readFileSync(path.join(anydpiDir, 'ic_launcher.xml'), 'utf8');
      const icLauncherRoundXml = fs.readFileSync(path.join(anydpiDir, 'ic_launcher_round.xml'), 'utf8');

      assert.ok(icLauncherXml.includes('@color/ic_launcher_background') || icLauncherXml.includes('@drawable/ic_launcher_background'));
      assert.ok(icLauncherXml.includes('@mipmap/ic_launcher_foreground'));

      assert.ok(icLauncherRoundXml.includes('@color/ic_launcher_background') || icLauncherRoundXml.includes('@drawable/ic_launcher_background'));
      assert.ok(icLauncherRoundXml.includes('@mipmap/ic_launcher_foreground'));

      const bgXml = fs.readFileSync(path.join(resDir, 'values', 'ic_launcher_background.xml'), 'utf8');
      assert.ok(bgXml.includes('#FCEFDF'), 'ic_launcher_background must be #FCEFDF');
    });
  });

  describe('2. Left-Side Notification Small Icon Verification', () => {
    test('capacitor.config.json specifies ic_stat_paw with #F88438 accent color', () => {
      const config = JSON.parse(fs.readFileSync(path.join(rootDir, 'capacitor.config.json'), 'utf8'));
      assert.strictEqual(config.plugins.LocalNotifications.smallIcon, 'ic_stat_paw');
      assert.strictEqual(config.plugins.LocalNotifications.iconColor, '#F88438');
    });

    test('ic_stat_paw.png exists across all density drawables and is non-empty', () => {
      const folders = ['drawable', 'drawable-mdpi', 'drawable-hdpi', 'drawable-xhdpi', 'drawable-xxhdpi', 'drawable-xxxhdpi'];
      folders.forEach(folder => {
        const iconPath = path.join(resDir, folder, 'ic_stat_paw.png');
        assert.ok(fs.existsSync(iconPath), `Missing ic_stat_paw.png in ${folder}`);
        const stat = fs.statSync(iconPath);
        assert.ok(stat.size > 300, `ic_stat_paw.png in ${folder} must be non-empty`);
      });
    });
  });

  describe('3. Right-Side Notification Mascot Restoration & Separation from Logo', () => {
    test('Right-side mascot uses cute cat artwork for all notification scenarios, never launcher logo', async () => {
      const notifs = app.TasklyNotifications;
      const scheduled = [];
      const origPlugin = notifs.getPlugin;
      notifs.getPlugin = () => ({
        schedule: async (opts) => { scheduled.push(...opts.notifications); },
        cancel: async () => {}
      });

      try {
        // 1. Task Created -> notif_cat_created
        await notifs.notifyImmediate({ title: 'Task Created', description: 'Test', type: 'task_created' });
        const createdNotif = scheduled[scheduled.length - 1];
        assert.strictEqual(createdNotif.largeIcon, 'notif_cat_created');
        assert.notStrictEqual(createdNotif.largeIcon, 'logo');
        assert.strictEqual(createdNotif.smallIcon, 'ic_stat_paw');

        // 2. Task Updated -> notif_cat_updated
        await notifs.notifyImmediate({ title: 'Task Updated', description: 'Test', type: 'task_updated' });
        const updatedNotif = scheduled[scheduled.length - 1];
        assert.strictEqual(updatedNotif.largeIcon, 'notif_cat_updated');
        assert.notStrictEqual(updatedNotif.largeIcon, 'logo');
        assert.strictEqual(updatedNotif.smallIcon, 'ic_stat_paw');

        // 3. Task Deleted -> notif_cat_deleted
        await notifs.notifyImmediate({ title: 'Task Deleted', description: 'Test', type: 'task_deleted' });
        const deletedNotif = scheduled[scheduled.length - 1];
        assert.strictEqual(deletedNotif.largeIcon, 'notif_cat_deleted');
        assert.notStrictEqual(deletedNotif.largeIcon, 'logo');
        assert.strictEqual(deletedNotif.smallIcon, 'ic_stat_paw');

        // 4. Task Deadlines: approaching, reached, overdue
        const futureDate = new Date(Date.now() + (2 * 60 * 60 * 1000));
        const ymd = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
        const hh = String(futureDate.getHours()).padStart(2, '0');
        const mm = String(futureDate.getMinutes()).padStart(2, '0');
        await notifs.scheduleTaskDeadlines({
          id: 'test-cat-deadlines',
          title: 'Preserve Cute Mascot',
          dueDate: ymd,
          time: `${hh}:${mm}`,
          reminder: true,
          completed: false
        });

        const approaching = scheduled.find(n => n.extra.type === 'deadline_approaching');
        const reached = scheduled.find(n => n.extra.type === 'deadline_reached');
        const overdue = scheduled.find(n => n.extra.type === 'task_overdue');

        assert.ok(approaching, 'Approaching deadline notification must be scheduled');
        assert.strictEqual(approaching.largeIcon, 'notif_cat_upcoming');
        assert.notStrictEqual(approaching.largeIcon, 'logo');
        assert.strictEqual(approaching.smallIcon, 'ic_stat_paw');

        assert.ok(reached, 'Reached deadline notification must be scheduled');
        assert.strictEqual(reached.largeIcon, 'notif_cat_reached');
        assert.notStrictEqual(reached.largeIcon, 'logo');
        assert.strictEqual(reached.smallIcon, 'ic_stat_paw');

        assert.ok(overdue, 'Overdue deadline notification must be scheduled');
        assert.strictEqual(overdue.largeIcon, 'notif_cat_overdue');
        assert.notStrictEqual(overdue.largeIcon, 'logo');
        assert.strictEqual(overdue.smallIcon, 'ic_stat_paw');

        // 5. Quick Note Reminder -> notif_cat_quicknote
        await notifs.scheduleQuickNoteReminder({ id: 'qn-cat-1', text: 'Cat Treat Reminder' }, futureDate);
        const qn = scheduled.find(n => n.extra.type === 'quick_note_reminder');
        assert.ok(qn, 'Quick note reminder must be scheduled');
        assert.strictEqual(qn.largeIcon, 'notif_cat_quicknote');
        assert.notStrictEqual(qn.largeIcon, 'logo');
        assert.strictEqual(qn.smallIcon, 'ic_stat_paw');
      } finally {
        notifs.getPlugin = origPlugin;
      }
    });

    test('Existing cat mascot drawables are all present and valid RGBA PNGs', () => {
      const catDrawables = [
        'notif_cat_created.png',
        'notif_cat_updated.png',
        'notif_cat_deleted.png',
        'notif_cat_upcoming.png',
        'notif_cat_reached.png',
        'notif_cat_overdue.png',
        'notif_cat_quicknote.png'
      ];

      catDrawables.forEach(file => {
        const pWeb = path.join(rootDir, 'public', 'assets', 'pets', file);
        const pDrawable = path.join(resDir, 'drawable', file);

        assert.ok(fs.existsSync(pWeb), `Missing web asset: ${file}`);
        assert.ok(fs.existsSync(pDrawable), `Missing android drawable: ${file}`);

        assert.ok(fs.statSync(pWeb).size > 10000, `Web asset ${file} must be non-empty`);
        assert.ok(fs.statSync(pDrawable).size > 10000, `Drawable ${file} must be non-empty`);
      });
    });

    test('resolveCatIcon maps all notification types to their corresponding cute cat mascot', () => {
      const mapping = {
        'task_created': 'notif_cat_created',
        'task_completed': 'notif_cat_created',
        'task_updated': 'notif_cat_updated',
        'task_deleted': 'notif_cat_deleted',
        'deadline_approaching': 'notif_cat_upcoming',
        'reminder_upcoming': 'notif_cat_upcoming',
        'deadline_reached': 'notif_cat_reached',
        'deadline_snoozed': 'notif_cat_reached',
        'task_overdue': 'notif_cat_overdue',
        'quick_note_reminder': 'notif_cat_quicknote',
        'quick_note_snoozed': 'notif_cat_quicknote'
      };

      Object.entries(mapping).forEach(([type, expectedLarge]) => {
        const res = app.TasklyNotifications.resolveCatIcon(type);
        assert.strictEqual(res.largeIcon, expectedLarge, `Type "${type}" must resolve largeIcon "${expectedLarge}"`);
        assert.strictEqual(res.webIcon, `/assets/pets/${expectedLarge}.png`, `Type "${type}" webIcon must match cat mascot`);
        assert.notStrictEqual(res.largeIcon, 'logo', `Type "${type}" largeIcon must never be "logo"`);
      });
    });
  });
});
