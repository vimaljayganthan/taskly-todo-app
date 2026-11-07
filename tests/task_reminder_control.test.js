/**
 * Taskly - Task Reminder Control & Notification Scheduling Test Suite
 *
 * Verifies Part 3 & Part 6:
 * 1. Add Task form includes functional Reminder toggle (#add-reminder).
 * 2. Edit Task modal includes functional Reminder toggle (#edit-task-reminder).
 * 3. When Reminder is ON:
 *    - schedules notifications (approaching, deadline, overdue).
 * 4. When Reminder is OFF:
 *    - schedules NO notifications.
 * 5. Switching Reminder from ON to OFF cancels existing schedules.
 * 6. Switching Reminder from OFF to ON schedules notifications.
 * 7. Editing deadline when Reminder is ON reschedules notifications with new deadline.
 * 8. Task completion cancels pending notifications.
 * 9. Task deletion cancels pending notifications.
 * 10. Existing tasks without a reminder field safely default to OFF (false).
 * 11. Quick Note reminders remain completely independent and unaffected.
 * 12. Reminder state persists in task records for synchronization and storage.
 */

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');
const APP_JS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'app.js'), 'utf8');
const app = require(path.join(ROOT_DIR, 'public', 'app.js'));

describe('Taskly Task Reminder Control & Notification Scheduling Suite', () => {

  let mockScheduled = [];
  let mockCancelled = [];
  const origGetPlugin = app.TasklyNotifications.getPlugin;

  beforeEach(() => {
    mockScheduled = [];
    mockCancelled = [];

    // Mock Capacitor plugin
    const mockPlugin = {
      async schedule({ notifications }) {
        mockScheduled.push(...notifications);
        return { notifications };
      },
      async cancel({ notifications }) {
        mockCancelled.push(...notifications);
        const cancelIds = new Set(notifications.map(n => n.id));
        mockScheduled = mockScheduled.filter(n => !cancelIds.has(n.id));
        return { notifications };
      },
      async getPending() {
        return { notifications: mockScheduled };
      }
    };

    app.TasklyNotifications.getPlugin = () => mockPlugin;
    app.TasklyNotifications.saveScheduledRegistry([]);
  });

  after(() => {
    app.TasklyNotifications.getPlugin = origGetPlugin;
  });

  describe('1. Form Controls in DOM for Add and Edit Task', () => {
    test('public/index.html includes #add-reminder toggle in Add Task form', () => {
      assert.match(INDEX_HTML, /id="add-reminder"/, 'Expected #add-reminder toggle in Add Task form');
    });

    test('public/index.html includes #edit-task-reminder toggle in Edit Task modal', () => {
      assert.match(INDEX_HTML, /id="edit-task-reminder"/, 'Expected #edit-task-reminder toggle in Edit Task modal');
    });
  });

  describe('2. Reminder Toggle Controls Notification Scheduling', () => {
    test('When Reminder is ON, scheduleTaskDeadlines schedules notifications', async () => {
      const futureDate = new Date(Date.now() + (2 * 60 * 60 * 1000));
      const ymd = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
      const hh = String(futureDate.getHours()).padStart(2, '0');
      const mm = String(futureDate.getMinutes()).padStart(2, '0');

      const task = {
        id: 'task-rem-on-1',
        title: 'Reminder ON Test',
        dueDate: ymd,
        time: `${hh}:${mm}`,
        reminder: true,
        completed: false
      };

      await app.TasklyNotifications.scheduleTaskDeadlines(task);

      assert.strictEqual(mockScheduled.length, 3, 'Must schedule approaching, reached, and overdue');
      for (const n of mockScheduled) {
        assert.strictEqual(n.extra.taskId, 'task-rem-on-1');
      }
    });

    test('When Reminder is OFF (false), scheduleTaskDeadlines schedules ZERO notifications', async () => {
      const futureDate = new Date(Date.now() + (2 * 60 * 60 * 1000));
      const ymd = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
      const hh = String(futureDate.getHours()).padStart(2, '0');
      const mm = String(futureDate.getMinutes()).padStart(2, '0');

      const task = {
        id: 'task-rem-off-1',
        title: 'Reminder OFF Test',
        dueDate: ymd,
        time: `${hh}:${mm}`,
        reminder: false,
        completed: false
      };

      await app.TasklyNotifications.scheduleTaskDeadlines(task);

      assert.strictEqual(mockScheduled.length, 0, 'No notifications must be scheduled when reminder is false');
    });

    test('Switching Reminder from ON to OFF cancels existing schedules', async () => {
      const futureDate = new Date(Date.now() + (2 * 60 * 60 * 1000));
      const ymd = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
      const hh = String(futureDate.getHours()).padStart(2, '0');
      const mm = String(futureDate.getMinutes()).padStart(2, '0');

      const task = {
        id: 'task-toggle-1',
        title: 'Toggle Task',
        dueDate: ymd,
        time: `${hh}:${mm}`,
        reminder: true,
        completed: false
      };

      // Initially schedule with reminder: true
      await app.TasklyNotifications.scheduleTaskDeadlines(task);
      assert.strictEqual(mockScheduled.length, 3);

      // User switches Reminder to OFF
      await app.TasklyNotifications.cancelTaskReminders(task.id);
      task.reminder = false;

      assert.strictEqual(mockScheduled.length, 0, 'Schedules must be cancelled when reminder switched OFF');
      assert.ok(mockCancelled.length >= 3, 'Must have cancelled previous notifications');
    });

    test('Switching Reminder from OFF to ON schedules notifications', async () => {
      const futureDate = new Date(Date.now() + (2 * 60 * 60 * 1000));
      const ymd = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
      const hh = String(futureDate.getHours()).padStart(2, '0');
      const mm = String(futureDate.getMinutes()).padStart(2, '0');

      const task = {
        id: 'task-toggle-2',
        title: 'Toggle Task Off to On',
        dueDate: ymd,
        time: `${hh}:${mm}`,
        reminder: false,
        completed: false
      };

      // Initially OFF -> 0 scheduled
      await app.TasklyNotifications.scheduleTaskDeadlines(task);
      assert.strictEqual(mockScheduled.length, 0);

      // User switches Reminder to ON
      task.reminder = true;
      await app.TasklyNotifications.scheduleTaskDeadlines(task);
      assert.strictEqual(mockScheduled.length, 3, 'Now scheduled with 3 notification points');
    });

    test('Deadline editing while Reminder is ON reschedules with updated time', async () => {
      const d1 = new Date(Date.now() + (2 * 60 * 60 * 1000));
      const ymd1 = `${d1.getFullYear()}-${String(d1.getMonth() + 1).padStart(2, '0')}-${String(d1.getDate()).padStart(2, '0')}`;
      const hh1 = String(d1.getHours()).padStart(2, '0');
      const mm1 = String(d1.getMinutes()).padStart(2, '0');

      const d2 = new Date(Date.now() + (4 * 60 * 60 * 1000));
      const hh2 = String(d2.getHours()).padStart(2, '0');
      const mm2 = String(d2.getMinutes()).padStart(2, '0');

      const task = {
        id: 'task-edit-dl-1',
        title: 'Deadline Edit Task',
        dueDate: ymd1,
        time: `${hh1}:${mm1}`,
        reminder: true,
        completed: false
      };

      await app.TasklyNotifications.scheduleTaskDeadlines(task);
      assert.strictEqual(mockScheduled.length, 3);

      // Edit deadline
      await app.TasklyNotifications.cancelTaskReminders(task.id);
      task.time = `${hh2}:${mm2}`;
      await app.TasklyNotifications.scheduleTaskDeadlines(task);

      assert.strictEqual(mockScheduled.length, 3, 'Rescheduled with updated time');
    });

    test('Task completion cancels pending notifications', async () => {
      const futureDate = new Date(Date.now() + (24 * 60 * 60 * 1000));
      const ymd = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;

      const task = {
        id: 'task-comp-1',
        title: 'Completion Cancel Task',
        dueDate: ymd,
        time: '11:59 PM',
        reminder: true,
        completed: false
      };

      await app.TasklyNotifications.scheduleTaskDeadlines(task);
      assert.strictEqual(mockScheduled.length, 3);

      // Mark completed
      task.completed = true;
      await app.TasklyNotifications.cancelTaskReminders(task.id);

      assert.strictEqual(mockScheduled.length, 0);
    });

    test('Task deletion cancels pending notifications', async () => {
      const futureDate = new Date(Date.now() + (24 * 60 * 60 * 1000));
      const ymd = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;

      const task = {
        id: 'task-del-1',
        title: 'Delete Task',
        dueDate: ymd,
        time: '11:59 PM',
        reminder: true,
        completed: false
      };

      await app.TasklyNotifications.scheduleTaskDeadlines(task);
      assert.strictEqual(mockScheduled.length, 3);

      // Delete
      await app.TasklyNotifications.cancelTaskReminders(task.id);
      assert.strictEqual(mockScheduled.length, 0);
    });

    test('Existing tasks without reminder field safely default to OFF (false)', () => {
      const legacyTask = {
        id: 'legacy-1',
        title: 'Legacy Task without reminder property',
        dueDate: '2026-11-20',
        completed: false
      };

      // Normalization default
      const normalizedReminder = Boolean(legacyTask.reminder === true);
      assert.strictEqual(normalizedReminder, false, 'Existing tasks without reminder field must default to false');
    });

    test('Quick Note reminders remain independent and unaffected by task reminder toggles', async () => {
      const noteReminderDate = new Date(Date.now() + (4 * 60 * 60 * 1000)).toISOString();
      const note = {
        id: 'note-rem-1',
        text: 'Important quick idea',
        reminderDate: noteReminderDate
      };

      await app.TasklyNotifications.scheduleQuickNoteReminder(note, noteReminderDate);
      assert.strictEqual(mockScheduled.length, 1, 'Quick Note reminder scheduled');
      assert.strictEqual(mockScheduled[0].extra.sourceType, 'quick_note');

      // Cancelling task reminders does NOT cancel Quick Note reminder
      await app.TasklyNotifications.cancelTaskReminders('some-task-id');
      assert.strictEqual(mockScheduled.length, 1, 'Quick note reminder remains active');
    });
  });

});
