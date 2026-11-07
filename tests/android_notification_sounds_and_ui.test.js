const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Mock DOM element helper
function createMockElement(id = '', tagName = 'div', type = '') {
  const attributes = {};
  const listeners = {};
  const classListSet = new Set();

  return {
    id,
    tagName: tagName.toUpperCase(),
    type,
    value: '',
    checked: false,
    disabled: false,
    textContent: '',
    innerHTML: '',
    style: {},
    classList: {
      add: (cls) => classListSet.add(cls),
      remove: (cls) => classListSet.delete(cls),
      contains: (cls) => classListSet.has(cls),
      toggle: (cls, force) => {
        if (force === undefined) {
          if (classListSet.has(cls)) classListSet.delete(cls);
          else classListSet.add(cls);
        } else if (force) {
          classListSet.add(cls);
        } else {
          classListSet.delete(cls);
        }
      }
    },
    setAttribute: (name, val) => { attributes[name] = String(val); },
    getAttribute: (name) => attributes[name] || null,
    addEventListener: (evt, fn) => {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(fn);
    },
    removeEventListener: (evt, fn) => {
      if (listeners[evt]) {
        listeners[evt] = listeners[evt].filter(cb => cb !== fn);
      }
    },
    trigger: (evtType, data = {}) => {
      const fns = listeners[evtType] || [];
      const eventObj = {
        type: evtType,
        target: null,
        defaultPrevented: false,
        preventDefault: () => { eventObj.defaultPrevented = true; },
        stopPropagation: () => {},
        ...data
      };
      eventObj.target = eventObj.target || null;
      for (const fn of fns) fn(eventObj);
      return eventObj;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    scrollIntoView: () => {}
  };
}

describe('Taskly Android Notification Sound & UI/UX Optimization Suite', () => {
  let app;
  let manifestContent;
  let capConfig;
  let cssContent;
  let gradleProps;

  beforeEach(() => {
    manifestContent = fs.readFileSync(path.join(__dirname, '../android/app/src/main/AndroidManifest.xml'), 'utf8');
    capConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../capacitor.config.json'), 'utf8'));
    cssContent = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
    gradleProps = fs.readFileSync(path.join(__dirname, '../android/gradle.properties'), 'utf8');
    app = require('../public/app.js');
  });

  describe('1. Android Native Sound Resource Packaging & Configuration', () => {
    test('taskly_meow.wav exists in android/app/src/main/res/raw/', () => {
      const soundPath = path.join(__dirname, '../android/app/src/main/res/raw/taskly_meow.wav');
      assert.ok(fs.existsSync(soundPath), 'Sound file must exist in android/app/src/main/res/raw/');
      const stats = fs.statSync(soundPath);
      assert.ok(stats.size > 1000, `Sound file must have non-zero size, found: ${stats.size} bytes`);
    });

    test('taskly_meow.wav exists in public/assets/sounds/ for offline web and sound resolver fallback', () => {
      const webSoundPath = path.join(__dirname, '../public/assets/sounds/taskly_meow.wav');
      assert.ok(fs.existsSync(webSoundPath), 'Sound file must exist in public/assets/sounds/');
    });

    test('Sound file is a valid RIFF WAVE PCM audio file', () => {
      const soundPath = path.join(__dirname, '../android/app/src/main/res/raw/taskly_meow.wav');
      const header = Buffer.alloc(12);
      const fd = fs.openSync(soundPath, 'r');
      fs.readSync(fd, header, 0, 12, 0);
      fs.closeSync(fd);

      const riff = header.toString('ascii', 0, 4);
      const wave = header.toString('ascii', 8, 12);
      assert.strictEqual(riff, 'RIFF', 'File header must begin with RIFF');
      assert.strictEqual(wave, 'WAVE', 'File format must be WAVE');
    });

    test('capacitor.config.json specifies taskly_meow.wav as notification sound', () => {
      assert.strictEqual(
        capConfig.plugins.LocalNotifications.sound,
        'taskly_meow.wav',
        'Capacitor config must define sound as taskly_meow.wav'
      );
      assert.strictEqual(
        capConfig.plugins.LocalNotifications.iconColor,
        '#F88438',
        'Capacitor config iconColor must match Pet Theme primary orange #F88438'
      );
    });
  });

  describe('2. Android Manifest Permissions & Window Resizing Configuration', () => {
    test('MainActivity declares android:windowSoftInputMode="adjustResize"', () => {
      assert.ok(
        manifestContent.includes('android:windowSoftInputMode="adjustResize"'),
        'MainActivity must declare android:windowSoftInputMode="adjustResize" to prevent keyboard overlap'
      );
    });

    test('Declares Android 13+ POST_NOTIFICATIONS permission', () => {
      assert.ok(
        manifestContent.includes('<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />'),
        'Manifest must declare POST_NOTIFICATIONS permission'
      );
    });

    test('Declares SCHEDULE_EXACT_ALARM and USE_EXACT_ALARM for reliable deadline timing', () => {
      assert.ok(
        manifestContent.includes('<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />'),
        'Manifest must declare SCHEDULE_EXACT_ALARM'
      );
      assert.ok(
        manifestContent.includes('<uses-permission android:name="android.permission.USE_EXACT_ALARM" />'),
        'Manifest must declare USE_EXACT_ALARM'
      );
    });

    test('Declares RECEIVE_BOOT_COMPLETED and VIBRATE for reboot persistence and vibration', () => {
      assert.ok(
        manifestContent.includes('<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />'),
        'Manifest must declare RECEIVE_BOOT_COMPLETED'
      );
      assert.ok(
        manifestContent.includes('<uses-permission android:name="android.permission.VIBRATE" />'),
        'Manifest must declare VIBRATE'
      );
    });

    test('gradle.properties configures compatible JDK 21 runtime', () => {
      assert.ok(
        gradleProps.includes('org.gradle.java.home=/opt/homebrew/opt/openjdk@21'),
        'gradle.properties must specify compatible JDK 21 path'
      );
    });
  });

  describe('3. Versioned Channel Creation & Safe Migration Strategy', () => {
    let deletedChannels;
    let createdChannels;
    let originalPlugin;

    beforeEach(() => {
      deletedChannels = [];
      createdChannels = [];
      originalPlugin = app.TasklyNotifications.getPlugin;
      app.TasklyNotifications.getPlugin = () => ({
        deleteChannel: async (opt) => { deletedChannels.push(opt.id); },
        createChannel: async (opt) => { createdChannels.push(opt); },
        checkPermissions: async () => ({ display: 'granted' }),
        requestPermissions: async () => ({ display: 'granted' }),
        addListener: () => {},
        schedule: async () => {},
        cancel: async () => {}
      });
    });

    afterEach(() => {
      app.TasklyNotifications.getPlugin = originalPlugin;
    });

    test('TasklyNotifications uses versioned CHANNEL_ID taskly-reminders-v3 with cat meow sound', () => {
      assert.strictEqual(app.TasklyNotifications.CHANNEL_ID, 'taskly-reminders-v3');
      assert.strictEqual(app.TasklyNotifications.NOTIFICATION_SOUND, 'taskly_meow.wav');
    });

    test('init() migrates legacy silent and v2 channels and creates taskly-reminders-v3 with sound', async () => {
      await app.TasklyNotifications.init();

      // Legacy channels must be deleted
      assert.ok(
        deletedChannels.includes('taskly-reminders'),
        'Must delete legacy silent channel taskly-reminders'
      );
      assert.ok(
        deletedChannels.includes('taskly-reminders-v2'),
        'Must delete legacy channel taskly-reminders-v2'
      );

      // New channel must be created with high importance and cat meow sound
      const newChannel = createdChannels.find(c => c.id === 'taskly-reminders-v3');
      assert.ok(newChannel, 'Must create channel taskly-reminders-v3');
      assert.strictEqual(newChannel.sound, 'taskly_meow.wav');
      assert.strictEqual(newChannel.importance, 5, 'Channel must have high/max importance');
      assert.strictEqual(newChannel.vibration, true);
      assert.strictEqual(newChannel.lightColor, '#F88438');
    });
  });

  describe('4. Notification Type Verification (All Types Deliver Sound & Channel)', () => {
    let scheduledRecords;
    let originalPlugin;

    beforeEach(() => {
      scheduledRecords = [];
      originalPlugin = app.TasklyNotifications.getPlugin;
      app.TasklyNotifications.getPlugin = () => ({
        schedule: async (opts) => {
          scheduledRecords.push(...opts.notifications);
        },
        cancel: async () => {}
      });
      if (typeof localStorage !== 'undefined') localStorage.clear();
    });

    afterEach(() => {
      app.TasklyNotifications.getPlugin = originalPlugin;
    });

    test('Immediate notification specifies channel taskly-reminders-v3 and taskly_meow.wav sound', async () => {
      await app.TasklyNotifications.notifyImmediate({
        title: 'Task Created',
        description: 'New task test',
        type: 'task_created'
      });

      assert.strictEqual(scheduledRecords.length, 1);
      const notif = scheduledRecords[0];
      assert.strictEqual(notif.channelId, 'taskly-reminders-v3');
      assert.strictEqual(notif.sound, 'taskly_meow.wav');
      assert.strictEqual(notif.iconColor, '#F88438');
    });

    test('Task deadline notifications specify taskly-reminders-v3 and taskly_meow.wav sound', async () => {
      const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const ymd = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
      const hh = String(futureDate.getHours()).padStart(2, '0');
      const mm = String(futureDate.getMinutes()).padStart(2, '0');

      const task = {
        id: 'task-sound-test-1',
        title: 'Sound Notification Verification',
        dueDate: ymd,
        time: `${hh}:${mm}`,
        completed: false
      };

      await app.TasklyNotifications.scheduleTaskDeadlines(task);

      assert.strictEqual(scheduledRecords.length, 3); // approaching, reached, overdue
      for (const notif of scheduledRecords) {
        assert.strictEqual(notif.channelId, 'taskly-reminders-v3', 'Every deadline alert must use channel v3');
        assert.strictEqual(notif.sound, 'taskly_meow.wav', 'Every deadline alert must specify taskly_meow.wav');
        assert.strictEqual(notif.iconColor, '#F88438');
      }
    });

    test('Quick Note reminder specifies taskly-reminders-v3 and taskly_meow.wav sound', async () => {
      const futureDate = new Date(Date.now() + 30 * 60 * 1000);
      const note = {
        id: 777,
        text: 'Buy organic cat treats'
      };

      await app.TasklyNotifications.scheduleQuickNoteReminder(note, futureDate);

      assert.strictEqual(scheduledRecords.length, 1);
      const notif = scheduledRecords[0];
      assert.strictEqual(notif.channelId, 'taskly-reminders-v3');
      assert.strictEqual(notif.sound, 'taskly_meow.wav');
      assert.strictEqual(notif.iconColor, '#F88438');
    });
  });

  describe('5. Android UI/UX, Safe Area Insets & Responsive Layout', () => {
    test('styles.css incorporates top and bottom safe-area insets across views and modals', () => {
      assert.ok(cssContent.includes('env(safe-area-inset-top)'), 'CSS must handle safe-area-inset-top');
      assert.ok(cssContent.includes('env(safe-area-inset-bottom)'), 'CSS must handle safe-area-inset-bottom');
      assert.ok(cssContent.includes('env(safe-area-inset-left)'), 'CSS must handle safe-area-inset-left for landscape/cutouts');
      assert.ok(cssContent.includes('env(safe-area-inset-right)'), 'CSS must handle safe-area-inset-right for landscape/cutouts');
    });

    test('styles.css defines body.keyboard-open rule hiding bottom-nav when typing', () => {
      assert.ok(
        cssContent.includes('body.keyboard-open .bottom-nav'),
        'CSS must hide bottom-nav when keyboard is open'
      );
      assert.ok(
        cssContent.includes('display: none !important'),
        'Must force hide bottom-nav with !important during keyboard display'
      );
    });

    test('Modal cards declare max-height with safe-area deduction and overflow scrolling', () => {
      assert.ok(
        cssContent.includes('max-height: calc(100dvh'),
        'Modal cards must bound height with dynamic viewport height 100dvh'
      );
      assert.ok(
        cssContent.includes('-webkit-overflow-scrolling: touch'),
        'Modal cards must enable smooth touch scrolling'
      );
    });

    test('Small screen media query (<= 360px) provides responsive padding and font scaling', () => {
      assert.ok(
        cssContent.includes('@media (max-width: 360px)'),
        'CSS must contain dedicated @media (max-width: 360px) query'
      );
    });

    test('Touch targets on interactive elements meet or exceed accessible mobile sizing', () => {
      assert.ok(cssContent.includes('.nav-tab'), 'Nav tab selector exists');
      assert.ok(cssContent.includes('min-width: 48px'), 'Nav tab touch width must be at least 48dp');
      assert.ok(cssContent.includes('min-height: 48px'), 'Nav tab touch height must be at least 48dp');
      assert.ok(cssContent.includes('.btn-task-delete'), 'Task delete selector exists');
      assert.ok(cssContent.includes('.btn-task-edit'), 'Task edit selector exists');
    });
  });

  describe('6. Accidental Double-Tap & Submission Flight Locking', () => {
    test('handleAddTask prevents duplicate submission when submit button is clicked rapidly', async () => {
      const mockSubmitBtn = createMockElement('btn-add-task-submit', 'button');
      mockSubmitBtn.disabled = true; // Simulating flight-locked button

      const origDoc = global.document;
      global.document = {
        getElementById: () => createMockElement('', 'input'),
        querySelector: (sel) => {
          if (sel.includes('button[type="submit"]')) return mockSubmitBtn;
          return null;
        }
      };

      try {
        let fetchCalled = false;
        const origFetch = global.fetch;
        global.fetch = async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; };

        await app.handleAddTask({ preventDefault: () => {}, target: { querySelector: () => mockSubmitBtn } });

        assert.strictEqual(fetchCalled, false, 'Should abort when submit button is already locked in flight');
        global.fetch = origFetch;
      } finally {
        global.document = origDoc;
      }
    });
  });

  describe('7. Redesigned Android Notifications & Native LargeIcon Suite', () => {
    const androidResDir = path.join(__dirname, '../android/app/src/main/res');
    const publicAssetsDir = path.join(__dirname, '../public/assets');

    test('All 7 cat illustrations exist in android/app/src/main/res/drawable/ as valid PNGs', () => {
      const requiredDrawables = [
        'notif_cat_created.png',
        'notif_cat_updated.png',
        'notif_cat_deleted.png',
        'notif_cat_upcoming.png',
        'notif_cat_reached.png',
        'notif_cat_overdue.png',
        'notif_cat_quicknote.png'
      ];

      for (const file of requiredDrawables) {
        const fullPath = path.join(androidResDir, 'drawable', file);
        assert.ok(fs.existsSync(fullPath), `Drawable ${file} must exist in res/drawable`);
        const stat = fs.statSync(fullPath);
        assert.ok(stat.size > 1000, `Drawable ${file} must have non-trivial size`);
      }
    });

    test('All 7 companion illustrations exist in public/assets/pets/ for web & in-app center', () => {
      const requiredPets = [
        'notif_cat_created.png',
        'notif_cat_updated.png',
        'notif_cat_deleted.png',
        'notif_cat_upcoming.png',
        'notif_cat_reached.png',
        'notif_cat_overdue.png',
        'notif_cat_quicknote.png'
      ];

      for (const file of requiredPets) {
        const fullPath = path.join(publicAssetsDir, 'pets', file);
        assert.ok(fs.existsSync(fullPath), `Pet asset ${file} must exist in public/assets/pets/`);
      }
    });

    test('scheduleTaskDeadlines passes largeIcon, largeBody, and actionTypeId for all deadline states', async () => {
      const scheduled = [];
      const origPlugin = app.TasklyNotifications.getPlugin;
      app.TasklyNotifications.getPlugin = () => ({
        schedule: async (opts) => { scheduled.push(...opts.notifications); },
        cancel: async () => {}
      });

      const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const ymd = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
      const hh = String(futureDate.getHours()).padStart(2, '0');
      const mm = String(futureDate.getMinutes()).padStart(2, '0');

      const task = {
        id: 'task-redesign-test-1',
        title: 'Mobile App Submission',
        dueDate: ymd,
        time: `${hh}:${mm}`,
        completed: false
      };

      await app.TasklyNotifications.scheduleTaskDeadlines(task);

      assert.strictEqual(scheduled.length, 3);
      const approaching = scheduled.find(n => n.extra.type === 'deadline_approaching');
      const reached = scheduled.find(n => n.extra.type === 'deadline_reached');
      const overdue = scheduled.find(n => n.extra.type === 'task_overdue');

      assert.strictEqual(approaching.largeIcon, 'notif_cat_upcoming');
      assert.strictEqual(approaching.actionTypeId, 'TASK_DEADLINE_ACTIONS');
      assert.ok(approaching.largeBody.includes('Mobile App Submission'));

      assert.strictEqual(reached.largeIcon, 'notif_cat_reached');
      assert.strictEqual(reached.actionTypeId, 'TASK_DEADLINE_ACTIONS');
      assert.ok(reached.largeBody.includes('Mobile App Submission'));

      assert.strictEqual(overdue.largeIcon, 'notif_cat_overdue');
      assert.strictEqual(overdue.actionTypeId, 'TASK_DEADLINE_ACTIONS');
      assert.ok(overdue.largeBody.includes('Mobile App Submission'));

      app.TasklyNotifications.getPlugin = origPlugin;
    });

    test('scheduleQuickNoteReminder passes largeIcon, largeBody, and QUICK_NOTE_ACTIONS', async () => {
      const scheduled = [];
      const origPlugin = app.TasklyNotifications.getPlugin;
      app.TasklyNotifications.getPlugin = () => ({
        schedule: async (opts) => { scheduled.push(...opts.notifications); },
        cancel: async () => {}
      });

      const note = { id: 'note-009', text: 'Renew car registration' };
      const futureDate = new Date(Date.now() + 60 * 60 * 1000);

      await app.TasklyNotifications.scheduleQuickNoteReminder(note, futureDate);

      assert.strictEqual(scheduled.length, 1);
      const noteNotif = scheduled[0];
      assert.strictEqual(noteNotif.largeIcon, 'notif_cat_quicknote');
      assert.strictEqual(noteNotif.actionTypeId, 'QUICK_NOTE_ACTIONS');
      assert.ok(noteNotif.largeBody.includes('Renew car registration'));

      app.TasklyNotifications.getPlugin = origPlugin;
    });

    test('handleNotificationAction handles COMPLETE_TASK and cancels task reminders', async () => {
      let cancelledTask = null;
      const origCancel = app.TasklyNotifications.cancelTaskReminders;
      app.TasklyNotifications.cancelTaskReminders = async (id) => { cancelledTask = id; };

      const task = { id: 'task-action-comp', title: 'Complete Me', completed: false };
      app.state.todos = [task];
      app.state.userToken = 'test-token-active';

      await app.TasklyNotifications.handleNotificationAction('COMPLETE_TASK', {
        extra: { taskId: task.id }
      });

      assert.strictEqual(task.completed, true, 'Task should be marked completed');
      assert.strictEqual(cancelledTask, task.id, 'Task reminders should be cancelled');

      app.TasklyNotifications.cancelTaskReminders = origCancel;
      app.state.userToken = null;
    });

    test('handleNotificationAction handles SNOOZE_TASK and schedules snoozed reminder', async () => {
      let snoozedTask = null;
      let snoozedTime = null;
      const origSnooze = app.TasklyNotifications.scheduleSnoozedTaskReminder;
      app.TasklyNotifications.scheduleSnoozedTaskReminder = async (t, d) => { snoozedTask = t; snoozedTime = d; };

      const task = { id: 'task-action-snooze', title: 'Snooze Me', completed: false };
      app.state.todos = [task];

      await app.TasklyNotifications.handleNotificationAction('SNOOZE_TASK', {
        extra: { taskId: task.id }
      });

      assert.ok(snoozedTask, 'Should trigger scheduleSnoozedTaskReminder');
      assert.strictEqual(snoozedTask.id, task.id);
      assert.ok(snoozedTime.getTime() > Date.now(), 'Snooze time must be in future');

      app.TasklyNotifications.scheduleSnoozedTaskReminder = origSnooze;
    });

    test('In-app notification rendering enforces error-hiding on cat thumbnails', () => {
      app.state.notifications = [
        {
          id: 'test-n-1',
          title: 'Taskly · Deadline',
          headline: 'Your task deadline has arrived!',
          description: 'Machine Learning Assignment is due now.',
          timestamp: new Date().toISOString(),
          read: false,
          type: 'deadline_reached',
          icon: '/assets/pets/notif_cat_reached.png',
          sourceId: 't1',
          sourceType: 'task'
        }
      ];

      const mockList = createMockElement('notifications-list');
      const origDoc = global.document;
      global.document = {
        getElementById: (id) => {
          if (id === 'notifications-list') return mockList;
          return createMockElement(id);
        }
      };

      try {
        app.TasklyNotifications.renderNotificationList();
        assert.ok(mockList.innerHTML.includes('onerror="this.style.display=\'none\'"'), 'Images must hide gracefully on error');
        assert.ok(mockList.innerHTML.includes('alt=""'), 'Images must use empty alt text');
        assert.ok(mockList.innerHTML.includes('btn-notif-orange'), 'Must render action buttons for deadlines');
      } finally {
        global.document = origDoc;
      }
    });
  });

  describe('8. Cross-Device Compatibility, SmallIcon Stencil & Grouping Suite', () => {
    const androidResDir = path.join(__dirname, '../android/app/src/main/res');
    const capConfigPath = path.join(__dirname, '../capacitor.config.json');
    const cssPath = path.join(__dirname, '../public/styles.css');
    const toYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const toTime = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

    test('ic_stat_paw exists across all Android screen density folders', () => {
      const densities = [
        'drawable',
        'drawable-mdpi',
        'drawable-hdpi',
        'drawable-xhdpi',
        'drawable-xxhdpi',
        'drawable-xxxhdpi'
      ];
      for (const d of densities) {
        const filePath = path.join(androidResDir, d, 'ic_stat_paw.png');
        assert.ok(fs.existsSync(filePath), `ic_stat_paw.png must exist in res/${d}`);
        const stat = fs.statSync(filePath);
        assert.ok(stat.size > 0, `ic_stat_paw.png in res/${d} must not be empty`);
      }
    });

    test('capacitor.config.json specifies ic_stat_paw as smallIcon', () => {
      const capConfig = JSON.parse(fs.readFileSync(capConfigPath, 'utf8'));
      assert.strictEqual(
        capConfig.plugins.LocalNotifications.smallIcon,
        'ic_stat_paw',
        'smallIcon must be ic_stat_paw for Android status bar stencil compatibility'
      );
    });

    test('All notifications configure ic_stat_paw, taskly_reminders group, and allowWhileIdle', async () => {
      const scheduled = [];
      const origPlugin = app.TasklyNotifications.getPlugin;
      app.TasklyNotifications.getPlugin = () => ({
        schedule: async (opts) => { scheduled.push(...opts.notifications); },
        cancel: async () => {}
      });

      const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const task = {
        id: 'cross-dev-task',
        title: 'Cross-Device Verification Task',
        dueDate: toYmd(futureDate),
        time: toTime(futureDate),
        completed: false
      };

      await app.TasklyNotifications.scheduleTaskDeadlines(task);

      assert.ok(scheduled.length >= 2, 'Should schedule multiple deadline triggers');
      for (const notif of scheduled) {
        assert.strictEqual(notif.smallIcon, 'ic_stat_paw', 'Must specify ic_stat_paw');
        assert.strictEqual(notif.group, 'taskly_reminders', 'Must specify notification group');
        assert.strictEqual(notif.schedule.allowWhileIdle, true, 'Must allow scheduling while device is in Doze/idle');
      }

      app.TasklyNotifications.getPlugin = origPlugin;
    });

    test('Gracefully truncates long task titles in summary while preserving full detail in largeBody', async () => {
      const scheduled = [];
      const origPlugin = app.TasklyNotifications.getPlugin;
      app.TasklyNotifications.getPlugin = () => ({
        schedule: async (opts) => { scheduled.push(...opts.notifications); },
        cancel: async () => {}
      });

      const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const longTitle = 'This is an exceptionally long task name designed to test cross-device notification line wrapping, truncation and accessibility font scaling';
      const task = {
        id: 'long-title-task',
        title: longTitle,
        description: 'Detailed user notes',
        dueDate: toYmd(futureDate),
        time: toTime(futureDate),
        completed: false
      };

      await app.TasklyNotifications.scheduleTaskDeadlines(task);

      const approaching = scheduled.find(n => n.extra.type === 'deadline_approaching');
      assert.ok(approaching, 'Approaching reminder must be scheduled');
      assert.ok(approaching.largeBody.includes(longTitle), 'largeBody must preserve the full long title');
      assert.ok(approaching.largeBody.includes('Detailed user notes'), 'largeBody must include description');

      app.TasklyNotifications.getPlugin = origPlugin;
    });

    test('Gracefully handles missing or empty task and note text with friendly defaults', async () => {
      const scheduled = [];
      const origPlugin = app.TasklyNotifications.getPlugin;
      app.TasklyNotifications.getPlugin = () => ({
        schedule: async (opts) => { scheduled.push(...opts.notifications); },
        cancel: async () => {}
      });

      const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const emptyTask = {
        id: 'empty-task',
        title: '   ',
        dueDate: toYmd(futureDate),
        time: toTime(futureDate),
        completed: false
      };

      await app.TasklyNotifications.scheduleTaskDeadlines(emptyTask);
      const notif = scheduled[0];
      assert.ok(notif, 'A notification must be scheduled');
      assert.ok(notif.largeBody.includes('Untitled Task'), 'Must fallback to Untitled Task');

      // Test empty quick note
      const emptyNote = { id: 'empty-note', text: '   ' };
      await app.TasklyNotifications.scheduleQuickNoteReminder(emptyNote, futureDate);
      const noteNotif = scheduled.find(n => n.extra.sourceType === 'quick_note');
      assert.ok(noteNotif.largeBody.includes('Quick Note Reminder'), 'Must fallback to Quick Note Reminder');

      app.TasklyNotifications.getPlugin = origPlugin;
    });

    test('Snooze cancels previous reminders before rescheduling to prevent duplicates', async () => {
      let cancelled = null;
      let scheduled = null;

      const origCancel = app.TasklyNotifications.cancelTaskReminders;
      const origSchedule = app.TasklyNotifications.scheduleSnoozedTaskReminder;

      app.TasklyNotifications.cancelTaskReminders = async (id) => { cancelled = id; };
      app.TasklyNotifications.scheduleSnoozedTaskReminder = async (t) => { scheduled = t.id; };

      const task = { id: 'dup-prevention-task', title: 'Task Anti-Duplicate', completed: false };
      app.state.todos = [task];

      await app.TasklyNotifications.handleNotificationAction('SNOOZE_TASK', {
        extra: { taskId: task.id }
      });

      assert.strictEqual(cancelled, task.id, 'Must cancel previous reminders');
      assert.strictEqual(scheduled, task.id, 'Must reschedule snoozed reminder');

      app.TasklyNotifications.cancelTaskReminders = origCancel;
      app.TasklyNotifications.scheduleSnoozedTaskReminder = origSchedule;
    });

    test('CSS defines accessible touch target sizing and small-screen breakpoint for notifications', () => {
      const css = fs.readFileSync(cssPath, 'utf8');
      assert.ok(css.includes('.btn-notif-orange'), 'Must define .btn-notif-orange');
      assert.ok(css.includes('.btn-notif-cream'), 'Must define .btn-notif-cream');
      assert.ok(css.includes('min-height: 38px'), 'Must declare min-height: 38px for accessible touch targets');
      assert.ok(css.includes('@media (max-width: 360px)'), 'Must declare small-screen breakpoint');
    });
  });
});

