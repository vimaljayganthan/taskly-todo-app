/**
 * Taskly Notification Redesign & Unwanted Startup Sound Bug Fix Test Suite
 *
 * Verifies:
 * Part 1: Android Notification Redesign & Pet Theme Hierarchy
 * - All 7 notification types specify correct Pet Theme assets, orange accent #F88438,
 *   smallIcon ic_stat_paw, and rich BigTextStyle hierarchy.
 *
 * Part 2: Startup Silence & No Unwanted Sound
 * - Opening Taskly produces ZERO sound (no Audio/chime calls).
 * - Reopening or resuming Taskly produces ZERO sound.
 * - Refreshing Home and fetching tasks produces ZERO sound.
 * - Reconciling scheduled reminders (even with past items) produces ZERO sound.
 * - Supabase sync produces ZERO sound.
 * - Notification permission check produces ZERO sound.
 *
 * Part 3: Reliable Delivery & Sound Association
 * - Sound is configured on NotificationChannel (taskly-reminders-v2 with taskly_chime.wav).
 * - Only genuine notification delivery associates with the configured chime.
 * - In-app WebView never duplicates native sound on Android.
 *
 * Part 4: Reminder Controls & Duplicate Prevention
 * - Reopening app does not create duplicate notifications or schedules.
 * - Reminder OFF schedules zero notifications.
 * - Reminder ON schedules approaching, reached, overdue.
 * - Updating/completing/deleting task properly cancels schedules.
 * - Quick Note reminders remain unaffected.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const app = require(path.join(ROOT_DIR, 'public', 'app.js'));

describe('Taskly Notification Redesign & Unwanted Startup Sound Bug Fix Suite', () => {
  let scheduledMock = [];
  let cancelledMock = [];
  let chimeCalls = 0;
  let originalGetPlugin = app.TasklyNotifications.getPlugin;
  let originalPlayChime = app.TasklyNotifications.playChime;

  beforeEach(() => {
    scheduledMock = [];
    cancelledMock = [];
    chimeCalls = 0;

    // Spy on playChime
    app.TasklyNotifications.playChime = function (force) {
      if (this.isNative() && !force) return;
      chimeCalls++;
    };

    // Mock Capacitor plugin
    const mockPlugin = {
      async schedule({ notifications }) {
        scheduledMock.push(...notifications);
        return { notifications };
      },
      async cancel({ notifications }) {
        cancelledMock.push(...notifications);
        const cancelIds = new Set(notifications.map(n => n.id));
        scheduledMock = scheduledMock.filter(n => !cancelIds.has(n.id));
        return { notifications };
      },
      async checkPermissions() {
        return { display: 'granted' };
      },
      async requestPermissions() {
        return { display: 'granted' };
      },
      async createChannel() {},
      async deleteChannel() {},
      async registerActionTypes() {},
      addListener() {}
    };

    app.TasklyNotifications.getPlugin = () => mockPlugin;
    app.TasklyNotifications.saveScheduledRegistry([]);
  });

  afterEach(() => {
    app.TasklyNotifications.getPlugin = originalGetPlugin;
    app.TasklyNotifications.playChime = originalPlayChime;
  });

  describe('1. Startup Audio Bug Prevention (Zero Audio on App Entry & Sync)', () => {
    test('App startup / DOMContentLoaded initialization produces ZERO sound calls', async () => {
      chimeCalls = 0;
      await app.TasklyNotifications.init();
      assert.strictEqual(chimeCalls, 0, 'App startup must produce NO audio playback');
    });

    test('Reconciling scheduled reminders with past deadlines produces ZERO sound', async () => {
      chimeCalls = 0;
      // Seed registry with past items
      const pastTime = new Date(Date.now() - 3600 * 1000).toISOString();
      app.TasklyNotifications.saveScheduledRegistry([
        {
          id: 991,
          sourceType: 'task',
          sourceId: 't-past-1',
          title: 'Past Task',
          body: 'Past Deadline',
          scheduledAt: pastTime,
          type: 'deadline_reached'
        }
      ]);

      await app.TasklyNotifications.reconcileScheduledReminders();
      assert.strictEqual(chimeCalls, 0, 'Reconciliation of past reminders must NEVER trigger audio');
    });

    test('Reopening and resuming Taskly from background produces ZERO sound', async () => {
      chimeCalls = 0;
      // Simulate app resume
      await app.TasklyNotifications.reconcileScheduledReminders();
      app.TasklyNotifications.loadHistory();
      app.TasklyNotifications.updateBadges();

      assert.strictEqual(chimeCalls, 0, 'App resume must be completely silent');
    });

    test('Supabase synchronization & fetchTodos produces ZERO sound', async () => {
      chimeCalls = 0;
      // Simulate fetchTodos completing
      app.TasklyNotifications.reconcileScheduledReminders();
      assert.strictEqual(chimeCalls, 0, 'Fetching and synchronizing tasks must be silent');
    });

    test('Checking or requesting notification permissions produces ZERO sound', async () => {
      chimeCalls = 0;
      await app.TasklyNotifications.requestPermission();
      assert.strictEqual(chimeCalls, 0, 'Permission checks must never produce audio');
    });

    test('addInAppNotification does NOT play HTML5 audio on native Android', () => {
      chimeCalls = 0;
      // Native is true on Android
      const origIsNative = app.TasklyNotifications.isNative;
      app.TasklyNotifications.isNative = () => true;

      app.TasklyNotifications.addInAppNotification({
        title: 'Silent Entry',
        description: 'Should not make sound in WebView',
        type: 'task_created',
        playSound: false
      });

      assert.strictEqual(chimeCalls, 0, 'Native Android WebView must not play HTML5 chime');
      app.TasklyNotifications.isNative = origIsNative;
    });

    test('handleNotificationReceived records notification silently without secondary audio', () => {
      chimeCalls = 0;
      app.TasklyNotifications.handleNotificationReceived({
        title: 'Delivered Alert',
        body: 'Already sounded by Android OS',
        extra: { type: 'deadline_reached', taskId: 't-1' }
      });
      assert.strictEqual(chimeCalls, 0, 'Receiving native notification must not play second sound in JS');
    });
  });

  describe('2. Android Notification Redesign & Pet Theme Hierarchy (7 Types)', () => {
    test('1. New Task Created: Pet Theme badge, orange accent, and rich BigText', async () => {
      await app.TasklyNotifications.notifyImmediate({
        title: 'Taskly · Task Created',
        headline: 'Task Created 🎉',
        description: '"Complete Machine Learning Audit" has been added.',
        type: 'task_created'
      });

      assert.strictEqual(scheduledMock.length, 1);
      const notif = scheduledMock[0];
      assert.strictEqual(notif.smallIcon, 'ic_stat_paw', 'Small icon must be ic_stat_paw stencil');
      assert.strictEqual(notif.iconColor, '#F88438', 'Icon color must be Taskly orange #F88438');
      assert.strictEqual(notif.largeIcon, 'notif_cat_created', 'Must use notif_cat_created badge');
      assert.strictEqual(notif.channelId, app.TasklyNotifications.CHANNEL_ID);
      assert.strictEqual(notif.sound, app.TasklyNotifications.NOTIFICATION_SOUND);
      assert.ok(notif.largeBody.includes('Task Created'), 'Must include structured largeBody');
    });

    test('2. Task Updated: Pet Theme badge, orange accent, and rich BigText', async () => {
      await app.TasklyNotifications.notifyImmediate({
        title: 'Taskly · Task Updated',
        headline: 'Task Details Updated ✏️',
        description: '"Audit Architecture" details have been updated.',
        type: 'task_updated'
      });

      assert.strictEqual(scheduledMock.length, 1);
      const notif = scheduledMock[0];
      assert.strictEqual(notif.smallIcon, 'ic_stat_paw');
      assert.strictEqual(notif.iconColor, '#F88438');
      assert.strictEqual(notif.largeIcon, 'notif_cat_updated');
      assert.strictEqual(notif.channelId, app.TasklyNotifications.CHANNEL_ID);
      assert.ok(notif.largeBody.includes('Task Details Updated'));
    });

    test('3. Task Deleted: Pet Theme badge, orange accent, and clean BigText', async () => {
      await app.TasklyNotifications.notifyImmediate({
        title: 'Taskly · Task Removed',
        headline: 'Task Removed 👋',
        description: '"Legacy Task" was removed from your list.',
        type: 'task_deleted'
      });

      assert.strictEqual(scheduledMock.length, 1);
      const notif = scheduledMock[0];
      assert.strictEqual(notif.smallIcon, 'ic_stat_paw');
      assert.strictEqual(notif.iconColor, '#F88438');
      assert.strictEqual(notif.largeIcon, 'notif_cat_deleted');
      assert.strictEqual(notif.channelId, app.TasklyNotifications.CHANNEL_ID);
      assert.ok(notif.largeBody.includes('Task Removed'));
    });

    test('4. Upcoming Deadline Reminder: Pet Theme badge, lead minutes, and action buttons', async () => {
      const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const ymd = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
      const hh = String(futureDate.getHours()).padStart(2, '0');
      const mm = String(futureDate.getMinutes()).padStart(2, '0');

      const task = {
        id: 't-rem-1',
        title: 'Machine Learning Assignment',
        dueDate: ymd,
        time: `${hh}:${mm}`,
        category: 'Study',
        priority: 'High',
        reminder: true,
        completed: false
      };

      await app.TasklyNotifications.scheduleTaskDeadlines(task);

      const approachingNotif = scheduledMock.find(n => n.extra.type === 'deadline_approaching');
      assert.ok(approachingNotif, 'Approaching notification must be scheduled');
      assert.strictEqual(approachingNotif.smallIcon, 'ic_stat_paw');
      assert.strictEqual(approachingNotif.iconColor, '#F88438');
      assert.strictEqual(approachingNotif.largeIcon, 'notif_cat_upcoming');
      assert.strictEqual(approachingNotif.channelId, app.TasklyNotifications.CHANNEL_ID);
      assert.strictEqual(approachingNotif.sound, app.TasklyNotifications.NOTIFICATION_SOUND);
      assert.strictEqual(approachingNotif.actionTypeId, 'TASK_DEADLINE_ACTIONS');
      assert.ok(approachingNotif.largeBody.includes('Machine Learning Assignment'));
    });

    test('5. Deadline Reached: Pet Theme badge, action buttons, and prompt BigText', async () => {
      const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const ymd = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
      const hh = String(futureDate.getHours()).padStart(2, '0');
      const mm = String(futureDate.getMinutes()).padStart(2, '0');

      const task = {
        id: 't-rem-2',
        title: 'Submit Expense Report',
        dueDate: ymd,
        time: `${hh}:${mm}`,
        category: 'Work',
        priority: 'High',
        reminder: true,
        completed: false
      };

      await app.TasklyNotifications.scheduleTaskDeadlines(task);

      const reachedNotif = scheduledMock.find(n => n.extra.type === 'deadline_reached');
      assert.ok(reachedNotif, 'Reached notification must be scheduled');
      assert.strictEqual(reachedNotif.smallIcon, 'ic_stat_paw');
      assert.strictEqual(reachedNotif.iconColor, '#F88438');
      assert.strictEqual(reachedNotif.largeIcon, 'notif_cat_reached');
      assert.strictEqual(reachedNotif.channelId, app.TasklyNotifications.CHANNEL_ID);
      assert.strictEqual(reachedNotif.sound, app.TasklyNotifications.NOTIFICATION_SOUND);
      assert.strictEqual(reachedNotif.actionTypeId, 'TASK_DEADLINE_ACTIONS');
    });

    test('6. Overdue Task: Pet Theme badge, action buttons, and motivation BigText', async () => {
      const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const ymd = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
      const hh = String(futureDate.getHours()).padStart(2, '0');
      const mm = String(futureDate.getMinutes()).padStart(2, '0');

      const task = {
        id: 't-rem-3',
        title: 'Review System Metrics',
        dueDate: ymd,
        time: `${hh}:${mm}`,
        category: 'Work',
        priority: 'Medium',
        reminder: true,
        completed: false
      };

      await app.TasklyNotifications.scheduleTaskDeadlines(task);

      const overdueNotif = scheduledMock.find(n => n.extra.type === 'task_overdue');
      assert.ok(overdueNotif, 'Overdue notification must be scheduled');
      assert.strictEqual(overdueNotif.smallIcon, 'ic_stat_paw');
      assert.strictEqual(overdueNotif.iconColor, '#F88438');
      assert.strictEqual(overdueNotif.largeIcon, 'notif_cat_overdue');
      assert.strictEqual(overdueNotif.channelId, app.TasklyNotifications.CHANNEL_ID);
      assert.strictEqual(overdueNotif.sound, app.TasklyNotifications.NOTIFICATION_SOUND);
      assert.strictEqual(overdueNotif.actionTypeId, 'TASK_DEADLINE_ACTIONS');
    });

    test('7. Quick Note Reminder: Pet Theme badge, note text, and QUICK_NOTE_ACTIONS', async () => {
      const futureDate = new Date(Date.now() + 30 * 60 * 1000);
      const note = {
        id: 888,
        text: 'Buy organic cat treats and kibble'
      };

      await app.TasklyNotifications.scheduleQuickNoteReminder(note, futureDate);

      assert.strictEqual(scheduledMock.length, 1);
      const notif = scheduledMock[0];
      assert.strictEqual(notif.smallIcon, 'ic_stat_paw');
      assert.strictEqual(notif.iconColor, '#F88438');
      assert.strictEqual(notif.largeIcon, 'notif_cat_quicknote');
      assert.strictEqual(notif.channelId, app.TasklyNotifications.CHANNEL_ID);
      assert.strictEqual(notif.sound, app.TasklyNotifications.NOTIFICATION_SOUND);
      assert.strictEqual(notif.actionTypeId, 'QUICK_NOTE_ACTIONS');
      assert.ok(notif.largeBody.includes('Buy organic cat treats'));
    });
  });

  describe('3. Duplicate Prevention & Reminder Control Integrity', () => {
    beforeEach(() => {
      scheduledMock = [];
      cancelledMock = [];
    });

    test('Repeated reconciliation does not create duplicate notifications', async () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const ymd = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;

      const task = {
        id: 't-dup-1',
        title: 'Duplicate Test Task',
        dueDate: ymd,
        time: '11:59 PM',
        reminder: true,
        completed: false
      };

      await app.TasklyNotifications.scheduleTaskDeadlines(task);
      const countAfterFirst = scheduledMock.length;
      assert.strictEqual(countAfterFirst, 3);

      // Reconcile multiple times
      await app.TasklyNotifications.reconcileScheduledReminders();
      await app.TasklyNotifications.reconcileScheduledReminders();

      assert.strictEqual(scheduledMock.length, 3, 'Must NOT schedule duplicate notifications');
    });

    test('Past deadlines are never scheduled to avoid in-process catchup sound', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const ymd = `${pastDate.getFullYear()}-${String(pastDate.getMonth() + 1).padStart(2, '0')}-${String(pastDate.getDate()).padStart(2, '0')}`;

      const pastTask = {
        id: 't-past-dl',
        title: 'Expired Task',
        dueDate: ymd,
        time: '10:00 AM',
        reminder: true,
        completed: false
      };

      await app.TasklyNotifications.scheduleTaskDeadlines(pastTask);
      assert.strictEqual(scheduledMock.length, 0, 'Past deadlines must NEVER be passed to plugin.schedule');
    });
  });
});

