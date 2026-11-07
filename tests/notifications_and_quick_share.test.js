const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Setup mock DOM element
function createMockElement(id = '', tagName = 'div') {
  const attributes = {};
  const listeners = {};
  return {
    id,
    tagName: tagName.toUpperCase(),
    classList: {
      classes: new Set(),
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (this.classes.has(c)) this.classes.delete(c);
          else this.classes.add(c);
        } else if (force) {
          this.classes.add(c);
        } else {
          this.classes.delete(c);
        }
      },
      contains(c) { return this.classes.has(c); }
    },
    style: {},
    dataset: {},
    value: '',
    checked: false,
    textContent: '',
    innerHTML: '',
    getBoundingClientRect() {
      return { top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100 };
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    setAttribute(name, value) { attributes[name] = String(value); },
    getAttribute(name) { return attributes[name] || null; },
    addEventListener(event, fn) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    removeEventListener(event, fn) {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(cb => cb !== fn);
      }
    },
    trigger(event, data) {
      if (listeners[event]) {
        listeners[event].forEach(fn => fn(data));
      }
    },
    scrollIntoView() {}
  };
}

describe('Taskly Native Notifications & Quick Share Reminders Suite (All 15 Scenarios)', () => {
  let clientApp;
  let mockScheduled = [];
  let mockCancelled = [];
  let storageMap = {};

  beforeEach(() => {
    storageMap = {};
    mockScheduled = [];
    mockCancelled = [];

    global.localStorage = {
      getItem: (k) => storageMap[k] || null,
      setItem: (k, v) => { storageMap[k] = String(v); },
      removeItem: (k) => { delete storageMap[k]; },
      clear: () => { storageMap = {}; }
    };

    const elements = {};
    function getOrCreateElement(id) {
      if (!elements[id]) {
        elements[id] = createMockElement(id);
      }
      return elements[id];
    }

    global.document = {
      getElementById: (id) => getOrCreateElement(id),
      querySelector: (sel) => {
        if (sel.startsWith('#')) return getOrCreateElement(sel.slice(1));
        return createMockElement('', sel);
      },
      querySelectorAll: (sel) => [],
      documentElement: createMockElement('html', 'html'),
      body: createMockElement('body', 'body'),
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    global.window = {
      addEventListener: () => {},
      removeEventListener: () => {},
      location: { hash: '#home', search: '' },
      history: { pushState: () => {}, replaceState: () => {} },
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => 'android',
        isPluginAvailable: (name) => name === 'LocalNotifications',
        Plugins: {
          LocalNotifications: {
            createChannel: async (opts) => opts,
            checkPermissions: async () => ({ display: 'granted' }),
            requestPermissions: async () => ({ display: 'granted' }),
            schedule: async ({ notifications }) => {
              mockScheduled.push(...notifications);
              return { notifications };
            },
            cancel: async ({ notifications }) => {
              mockCancelled.push(...notifications);
              const idsToCancel = new Set(notifications.map(n => n.id));
              mockScheduled = mockScheduled.filter(n => !idsToCancel.has(n.id));
              return { notifications };
            },
            getPending: async () => ({ notifications: mockScheduled }),
            addListener: (event, cb) => ({ remove: () => {} })
          }
        }
      }
    };

    delete require.cache[require.resolve('../public/app.js')];
    clientApp = require('../public/app.js');

    clientApp.state.user = {
      id: 'test-user-uuid-1234',
      name: 'Vimal Jayganthan',
      email: 'vimal@example.com',
      isEmailVerified: true
    };
    clientApp.state.userToken = 'valid-test-token-123';
    clientApp.state.todos = [];
    clientApp.state.quickNotes = [];
    clientApp.state.notifications = [];
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
    delete global.localStorage;
  });

  // --------------------------------------------------------------------------
  // Scenario 1: Create a task and receive an activity notification
  // --------------------------------------------------------------------------
  test('Scenario 1: Create a task and receive an activity notification', async () => {
    const newTask = {
      id: 'task-test-01',
      title: 'Design Mobile Notification Flow',
      description: 'Implement real local notifications',
      dueDate: '2026-11-20',
      time: '6:00 PM',
      priority: 'High',
      category: 'Work',
      completed: false
    };

    await clientApp.TasklyNotifications.notifyImmediate({
      title: 'New task created',
      description: `"${newTask.title}" has been added to your tasks.`,
      type: 'task_created',
      icon: '📝',
      sourceId: newTask.id,
      sourceType: 'task'
    });

    const notifs = clientApp.state.notifications;
    assert.strictEqual(notifs.length, 1);
    assert.strictEqual(notifs[0].title, 'New task created');
    assert.match(notifs[0].description, /Design Mobile Notification Flow/);
    assert.strictEqual(notifs[0].read, false);

    // Native Android local notification scheduled
    assert.ok(mockScheduled.length > 0);
    assert.strictEqual(mockScheduled[0].title, 'New task created');
  });

  // --------------------------------------------------------------------------
  // Scenario 2: Update a task and receive an activity notification
  // --------------------------------------------------------------------------
  test('Scenario 2: Update a task and receive an activity notification', async () => {
    const task = {
      id: 'task-test-02',
      title: 'Initial Title',
      dueDate: '2026-11-20',
      completed: false
    };
    clientApp.state.todos = [task];

    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ...task, title: 'Updated Title' })
    });

    await clientApp.updateTask(task.id, { title: 'Updated Title' });

    const updateNotif = clientApp.state.notifications.find(n => n.type === 'task_updated');
    assert.ok(updateNotif, 'Task updated notification exists');
    assert.ok(updateNotif.title === 'Task updated successfully' || updateNotif.title === 'Taskly · Task Updated');
    assert.match(updateNotif.description, /Updated Title/);

    delete global.fetch;
  });

  // --------------------------------------------------------------------------
  // Scenario 3: Delete a task and receive an activity notification
  // --------------------------------------------------------------------------
  test('Scenario 3: Delete a task and receive an activity notification', async () => {
    const task = { id: 'task-test-03', title: 'Task To Delete', completed: false };
    clientApp.state.todos = [task];

    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true })
    });

    await clientApp.handleDeleteTask(null, task.id);

    const deleteNotif = clientApp.state.notifications.find(n => n.type === 'task_deleted');
    assert.ok(deleteNotif, 'Task deleted notification exists');
    assert.ok(deleteNotif.title === 'Task deleted' || deleteNotif.title === 'Taskly · Task Deleted');
    assert.match(deleteNotif.description, /Task To Delete/);

    delete global.fetch;
  });

  // --------------------------------------------------------------------------
  // Scenario 4: Schedule a task deadline reminder
  // --------------------------------------------------------------------------
  test('Scenario 4: Schedule a task deadline reminder', async () => {
    // Future task (year 2030)
    const futureTask = {
      id: 'task-future-01',
      title: 'Long-term Roadmap Review',
      dueDate: '2030-05-15',
      time: '2:00 PM',
      completed: false
    };

    await clientApp.TasklyNotifications.scheduleTaskDeadlines(futureTask);

    // 3 notifications scheduled: approaching (30m before), at deadline, and overdue (1h after)
    const taskSched = mockScheduled.filter(n => n.extra?.taskId === futureTask.id);
    assert.strictEqual(taskSched.length, 3, 'Must schedule 3 deadline reminder points');

    const approaching = taskSched.find(n => n.extra.type === 'deadline_approaching');
    const reached = taskSched.find(n => n.extra.type === 'deadline_reached');
    const overdue = taskSched.find(n => n.extra.type === 'task_overdue');

    assert.ok(approaching && reached && overdue);
    assert.ok(approaching.title.includes('Reminder') || approaching.title.includes('approaching'));
    assert.ok(reached.title.includes('Deadline') || reached.title.includes('reached'));
    assert.ok(overdue.title.includes('Overdue') || overdue.title.includes('progress'));

    // Verify scheduled times are monotonically increasing
    assert.ok(approaching.schedule.at.getTime() < reached.schedule.at.getTime());
    assert.ok(reached.schedule.at.getTime() < overdue.schedule.at.getTime());
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Receive the approaching-deadline notification
  // --------------------------------------------------------------------------
  test('Scenario 5: Receive the approaching-deadline notification', () => {
    clientApp.TasklyNotifications.handleNotificationReceived({
      title: 'Task deadline approaching',
      body: '"Important Presentation" is due in 30 minutes',
      extra: { taskId: 'task-presentation', type: 'deadline_approaching' }
    });

    const received = clientApp.state.notifications.find(n => n.type === 'deadline_approaching');
    assert.ok(received, 'Approaching deadline notification was recorded');
    assert.strictEqual(received.title, 'Task deadline approaching');
    assert.strictEqual(clientApp.state.unreadNotificationsCount, 1);
  });

  // --------------------------------------------------------------------------
  // Scenario 6: Verify completed tasks do not receive future deadline notifications
  // --------------------------------------------------------------------------
  test('Scenario 6: Verify completed tasks cancel and do not receive future deadline notifications', async () => {
    const task = {
      id: 'task-to-complete',
      title: 'Fix SSL Certificate',
      dueDate: '2030-01-01',
      time: '10:00 AM',
      completed: false
    };
    clientApp.state.todos = [task];

    await clientApp.TasklyNotifications.scheduleTaskDeadlines(task);
    assert.ok(mockScheduled.length >= 3);

    // Mark task completed
    await clientApp.TasklyNotifications.cancelTaskReminders(task.id);
    assert.ok(mockCancelled.length >= 3, 'Pending notifications cancelled');

    const remaining = mockScheduled.filter(n => n.extra?.taskId === task.id);
    assert.strictEqual(remaining.length, 0, 'No active notifications remain for completed task');
  });

  // --------------------------------------------------------------------------
  // Scenario 7: Verify editing a deadline replaces old scheduled reminders
  // --------------------------------------------------------------------------
  test('Scenario 7: Verify editing a deadline replaces old scheduled reminders', async () => {
    const task = {
      id: 'task-edit-deadline',
      title: 'Submit Expense Report',
      dueDate: '2030-02-10',
      time: '5:00 PM',
      completed: false
    };
    clientApp.state.todos = [task];

    // Initial schedule
    await clientApp.TasklyNotifications.scheduleTaskDeadlines(task);
    const initialApproaching = mockScheduled.find(n => n.extra?.taskId === task.id && n.extra.type === 'deadline_approaching');
    const oldTime = initialApproaching.schedule.at.getTime();

    // Cancel old and reschedule with new deadline
    await clientApp.TasklyNotifications.cancelTaskReminders(task.id);
    const updatedTask = { ...task, dueDate: '2030-03-20', time: '10:00 AM' };
    await clientApp.TasklyNotifications.scheduleTaskDeadlines(updatedTask);

    const newApproaching = mockScheduled.find(n => n.extra?.taskId === task.id && n.extra.type === 'deadline_approaching');
    assert.ok(newApproaching);
    assert.notStrictEqual(newApproaching.schedule.at.getTime(), oldTime, 'Scheduled time changed to new date');
  });

  // --------------------------------------------------------------------------
  // Scenario 8: Create a Quick Share entry without a reminder
  // --------------------------------------------------------------------------
  test('Scenario 8: Create a Quick Share entry without a reminder', () => {
    const note = {
      id: 101,
      text: 'Milk, Eggs, and Cat food',
      createdAt: new Date().toISOString(),
      reminderDate: null,
      reminderTimeStr: null
    };

    clientApp.state.quickNotes = [note];
    clientApp.renderQuickNotes();

    const listEl = document.getElementById('qc-notes-list');
    assert.ok(listEl.innerHTML.includes('Milk, Eggs, and Cat food'));
    assert.ok(listEl.innerHTML.includes('Set Reminder'), 'Displays un-scheduled pill');
    assert.strictEqual(mockScheduled.length, 0, 'No notification scheduled');
  });

  // --------------------------------------------------------------------------
  // Scenario 9: Create a Quick Share entry with a reminder
  // --------------------------------------------------------------------------
  test('Scenario 9: Create a Quick Share entry with a reminder', async () => {
    const futureReminder = new Date('2030-06-01T15:30:00Z');
    const note = {
      id: 102,
      text: 'Call Vet for annual vaccination',
      createdAt: new Date().toISOString(),
      reminderDate: futureReminder.toISOString(),
      reminderTimeStr: 'Jun 1, 3:30 PM'
    };

    clientApp.state.quickNotes = [note];
    await clientApp.TasklyNotifications.scheduleQuickNoteReminder(note, futureReminder);

    const scheduled = mockScheduled.find(n => n.extra?.noteId === note.id);
    assert.ok(scheduled, 'Quick note notification was scheduled');
    assert.ok(scheduled.title.includes('Quick Note Reminder'));
    assert.strictEqual(scheduled.body, 'You asked Taskly to remind you about this!');
  });

  // --------------------------------------------------------------------------
  // Scenario 10: Verify the scheduled Quick Share notification
  // --------------------------------------------------------------------------
  test('Scenario 10: Verify the scheduled Quick Share notification format and extra data', async () => {
    const targetDate = new Date('2030-08-15T09:00:00Z');
    const note = {
      id: 103,
      text: 'Submit tax documentation',
      reminderDate: targetDate.toISOString()
    };

    await clientApp.TasklyNotifications.scheduleQuickNoteReminder(note, targetDate);
    const scheduled = mockScheduled.find(n => n.extra?.noteId === note.id);

    assert.strictEqual(scheduled.channelId, clientApp.TasklyNotifications.CHANNEL_ID);
    assert.strictEqual(scheduled.sound, clientApp.TasklyNotifications.NOTIFICATION_SOUND);
    assert.strictEqual(scheduled.smallIcon, 'ic_stat_paw');
    assert.strictEqual(scheduled.iconColor, '#F88438');
    assert.strictEqual(scheduled.extra.type, 'quick_note_reminder');
  });

  // --------------------------------------------------------------------------
  // Scenario 11: Edit and delete Quick Share reminders
  // --------------------------------------------------------------------------
  test('Scenario 11: Edit and delete Quick Share reminders', async () => {
    const note = {
      id: 104,
      text: 'Original Note',
      reminderDate: new Date('2030-01-01T10:00:00Z').toISOString()
    };
    clientApp.state.quickNotes = [note];

    // Initial schedule
    await clientApp.TasklyNotifications.scheduleQuickNoteReminder(note, note.reminderDate);
    assert.strictEqual(mockScheduled.filter(n => n.extra?.noteId === note.id).length, 1);

    // Cancel / Delete note reminder
    await clientApp.TasklyNotifications.cancelQuickNoteReminder(note.id);
    assert.strictEqual(mockScheduled.filter(n => n.extra?.noteId === note.id).length, 0);

    // Delete note entirely
    clientApp.deleteQuickNote(note.id);
    assert.strictEqual(clientApp.state.quickNotes.length, 0);
  });

  // --------------------------------------------------------------------------
  // Scenario 12: Verify notification history persists after restarting Taskly
  // --------------------------------------------------------------------------
  test('Scenario 12: Verify notification history persists across application reloads', () => {
    // Add two notifications
    clientApp.TasklyNotifications.addInAppNotification({
      title: 'Test Notification 1',
      description: 'Persistent alert 1',
      type: 'system'
    });
    clientApp.TasklyNotifications.addInAppNotification({
      title: 'Test Notification 2',
      description: 'Persistent alert 2',
      type: 'system'
    });

    const userKey = clientApp.TasklyNotifications.getStorageKey();
    const stored = JSON.parse(global.localStorage.getItem(userKey));
    assert.strictEqual(stored.length, 2);

    // Simulate app reload by clearing state and reloading from storage
    clientApp.state.notifications = [];
    clientApp.TasklyNotifications.loadHistory();

    assert.strictEqual(clientApp.state.notifications.length, 2);
    assert.strictEqual(clientApp.state.notifications[0].title, 'Test Notification 2');
    assert.strictEqual(clientApp.state.notifications[1].title, 'Test Notification 1');
  });

  // --------------------------------------------------------------------------
  // Scenario 13: Verify notification permissions are handled correctly
  // --------------------------------------------------------------------------
  test('Scenario 13: Verify notification permissions request on Android 13+ and Web', async () => {
    // Native permission test
    const nativePerm = await clientApp.TasklyNotifications.requestPermission();
    assert.strictEqual(nativePerm, true);

    // Web fallback test
    delete global.window.Capacitor;
    global.Notification = {
      permission: 'default',
      requestPermission: async () => 'granted'
    };

    const webPerm = await clientApp.TasklyNotifications.requestPermission();
    assert.strictEqual(webPerm, true);
    delete global.Notification;
  });

  // --------------------------------------------------------------------------
  // Scenario 14: Verify notifications do not duplicate after synchronization
  // --------------------------------------------------------------------------
  test('Scenario 14: Verify notifications do not duplicate on repeated sync or reconcile', async () => {
    const task = {
      id: 'task-sync-check',
      title: 'Sync Task',
      dueDate: '2030-10-10',
      time: '12:00 PM',
      completed: false
    };
    clientApp.state.todos = [task];

    // First schedule
    await clientApp.TasklyNotifications.scheduleTaskDeadlines(task);
    const countFirst = mockScheduled.filter(n => n.extra?.taskId === task.id).length;
    assert.strictEqual(countFirst, 3);

    // Reconcile twice
    await clientApp.TasklyNotifications.reconcileScheduledReminders();
    await clientApp.TasklyNotifications.reconcileScheduledReminders();

    const registry = clientApp.TasklyNotifications.getScheduledRegistry();
    const taskItems = registry.filter(r => r.sourceId === task.id);
    assert.strictEqual(taskItems.length, 3, 'Must have exactly 3 registry entries without duplicates');
  });

  // --------------------------------------------------------------------------
  // Scenario 15: Verify reminders are reconciled after app restart
  // --------------------------------------------------------------------------
  test('Scenario 15: Verify reminders are reconciled after app restart and elapsed items surfaced in-app', async () => {
    const pastTime = new Date(Date.now() - 3600000).toISOString(); // 1 hr ago
    const futureTime = new Date(Date.now() + 86400000).toISOString(); // tomorrow

    // Simulate pre-existing registry with 1 expired task and 1 active task
    const oldRegistry = [
      {
        id: 991,
        sourceType: 'task',
        sourceId: 'task-expired',
        title: 'Task deadline reached',
        body: '"Old Task" deadline has arrived',
        scheduledAt: pastTime,
        type: 'deadline_reached'
      },
      {
        id: 992,
        sourceType: 'task',
        sourceId: 'task-future',
        title: 'Task deadline approaching',
        body: '"Future Task" is due in 30 minutes',
        scheduledAt: futureTime,
        type: 'deadline_approaching'
      }
    ];

    clientApp.TasklyNotifications.saveScheduledRegistry(oldRegistry);
    clientApp.state.todos = [
      { id: 'task-expired', title: 'Old Task', dueDate: '2020-01-01', completed: false },
      { id: 'task-future', title: 'Future Task', dueDate: '2030-01-01', completed: false }
    ];

    await clientApp.TasklyNotifications.reconcileScheduledReminders();

    // The expired reminder should have been added to in-app notifications
    const surfaced = clientApp.state.notifications.find(n => n.title === 'Task deadline reached');
    assert.ok(surfaced, 'Expired background notification was surfaced to in-app notification centre');

    // Surviving registry should retain only the future reminder
    const updatedReg = clientApp.TasklyNotifications.getScheduledRegistry();
    assert.ok(updatedReg.some(r => r.id === 992));
    assert.ok(!updatedReg.some(r => r.id === 991));
  });
});

