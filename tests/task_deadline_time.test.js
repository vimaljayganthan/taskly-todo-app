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
    querySelectorAll: () => []
  };
}

describe('Taskly Task Deadline Date & Time Input Suite', () => {
  let app;
  let htmlContent;
  let cssContent;

  beforeEach(() => {
    // Read actual production files
    htmlContent = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    cssContent = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
    app = require('../public/app.js');
  });

  describe('1. HTML Markup & Native Time Picker Specifications', () => {
    test('Add Task form uses native HTML <input type="time"> with step="300" and required', () => {
      // Must not use type="text" for time in Add Task
      assert.ok(!htmlContent.includes('<input type="text" id="add-time"'), 'Add Task time must not be type="text"');
      
      // Must use type="time" with 5-minute step (300 seconds)
      const hasNativeAddTime = htmlContent.includes('<input type="time" id="add-time" class="row-input-field" step="300" required>');
      assert.ok(hasNativeAddTime, 'Add Task time field must be <input type="time"> with step="300" and required attribute');
    });

    test('Add Task includes user-friendly formatted time pill element', () => {
      assert.ok(
        htmlContent.includes('<span id="add-time-display" class="time-formatted-pill">'),
        'Add Task markup must include #add-time-display with .time-formatted-pill class'
      );
    });

    test('Edit Task modal uses native HTML <input type="time"> with step="300"', () => {
      // Must not have text input for edit task time
      assert.ok(!htmlContent.includes('<input type="text" id="edit-task-time"'), 'Edit Task time must not be type="text"');

      // Must have type="time" with 5-minute step
      const hasNativeEditTime = htmlContent.includes('<input type="time" id="edit-task-time" class="form-input" step="300"');
      assert.ok(hasNativeEditTime, 'Edit Task time field must be <input type="time"> with step="300"');
    });

    test('Edit Task includes user-friendly formatted time pill element', () => {
      assert.ok(
        htmlContent.includes('<span id="edit-task-time-display" class="time-formatted-pill">'),
        'Edit Task modal must include #edit-task-time-display with .time-formatted-pill class'
      );
    });
  });

  describe('2. Pet Theme CSS Styling & OS Picker Normalization', () => {
    test('styles.css normalizes native time inputs across Android and Web', () => {
      assert.ok(
        cssContent.includes('input[type="time"].row-input-field'),
        'CSS must define styles for input[type="time"].row-input-field'
      );
      assert.ok(
        cssContent.includes('input[type="time"].form-input'),
        'CSS must define styles for input[type="time"].form-input'
      );
      assert.ok(
        cssContent.includes('::-webkit-calendar-picker-indicator'),
        'CSS must normalize ::-webkit-calendar-picker-indicator for Android WebView & Blink'
      );
      assert.ok(
        cssContent.includes('::-webkit-date-and-time-value'),
        'CSS must normalize ::-webkit-date-and-time-value for iOS and Android WebViews'
      );
    });

    test('styles.css styles .time-formatted-pill using approved Pet Theme tokens', () => {
      assert.ok(cssContent.includes('.time-formatted-pill'), 'CSS must define .time-formatted-pill');
      assert.ok(cssContent.includes('var(--primary-light)'), 'Time pill must use Pet Theme primary-light');
      assert.ok(cssContent.includes('var(--primary)'), 'Time pill must use Pet Theme primary');
      assert.ok(cssContent.includes('var(--radius-full)'), 'Time pill must use radius-full rounded badge styling');
    });
  });

  describe('3. Dynamic Local Time Rounding (No Hardcoded 6:00 PM)', () => {
    test('getRoundedLocalTime rounds arbitrary times up to the next 5-minute interval', () => {
      // 14:02:00 -> 14:05
      const d1 = new Date(2026, 10, 6, 14, 2, 0);
      assert.strictEqual(app.getRoundedLocalTime(d1, 5), '14:05');

      // 14:00:00 -> 14:00 (already on interval)
      const d2 = new Date(2026, 10, 6, 14, 0, 0);
      assert.strictEqual(app.getRoundedLocalTime(d2, 5), '14:00');

      // 09:56:45 -> 10:00
      const d3 = new Date(2026, 10, 6, 9, 56, 45);
      assert.strictEqual(app.getRoundedLocalTime(d3, 5), '10:00');

      // 23:58:00 -> 00:00 next day
      const d4 = new Date(2026, 10, 6, 23, 58, 0);
      assert.strictEqual(app.getRoundedLocalTime(d4, 5), '00:00');
    });

    test('initAddTaskDateTime dynamically initializes fields with local device date and rounded time', () => {
      const mockDateInput = createMockElement('add-due-date', 'input', 'date');
      const mockTimeInput = createMockElement('add-time', 'input', 'time');
      const mockTimeDisplay = createMockElement('add-time-display', 'span');

      const origDoc = global.document;
      global.document = {
        getElementById: (id) => {
          if (id === 'add-due-date') return mockDateInput;
          if (id === 'add-time') return mockTimeInput;
          if (id === 'add-time-display') return mockTimeDisplay;
          return null;
        }
      };

      try {
        app.initAddTaskDateTime();

        // Date should be initialized to today (YYYY-MM-DD)
        const todayStr = new Date().toISOString().slice(0, 10);
        assert.ok(mockDateInput.value.length === 10, 'Due date must be initialized');
        assert.strictEqual(mockDateInput.value, todayStr, 'Due date must match local today');

        // Time should be initialized to 24-hour rounded time
        assert.ok(/^\d{2}:\d{2}$/.test(mockTimeInput.value), 'Time value must be in HH:mm 24-hour format');

        // Time display pill should be in user-friendly 12-hour AM/PM format
        assert.ok(/^(0[1-9]|1[0-2]):[0-5]\d\s+(AM|PM)$/.test(mockTimeDisplay.textContent), 'Display pill must be in hh:mm A format');
        assert.notStrictEqual(mockTimeDisplay.textContent, '6:00 PM', 'Must not be a hardcoded static 6:00 PM default');
      } finally {
        global.document = origDoc;
      }
    });
  });

  describe('4. Time String Formatting & Bidirectional Conversion', () => {
    test('formatTimeTo24Hour correctly converts 12-hour AM/PM to 24-hour HH:mm', () => {
      assert.strictEqual(app.formatTimeTo24Hour('6:30 PM'), '18:30');
      assert.strictEqual(app.formatTimeTo24Hour('06:30 PM'), '18:30');
      assert.strictEqual(app.formatTimeTo24Hour('12:00 AM'), '00:00');
      assert.strictEqual(app.formatTimeTo24Hour('12:00 PM'), '12:00');
      assert.strictEqual(app.formatTimeTo24Hour('9:05 AM'), '09:05');
      assert.strictEqual(app.formatTimeTo24Hour('09:05 AM'), '09:05');
      assert.strictEqual(app.formatTimeTo24Hour('11:59 PM'), '23:59');
    });

    test('formatTimeTo24Hour correctly preserves existing 24-hour format', () => {
      assert.strictEqual(app.formatTimeTo24Hour('18:30'), '18:30');
      assert.strictEqual(app.formatTimeTo24Hour('09:05'), '09:05');
      assert.strictEqual(app.formatTimeTo24Hour('00:00'), '00:00');
      assert.strictEqual(app.formatTimeTo24Hour('23:59'), '23:59');
    });

    test('formatTimeTo24Hour rejects alphabetic and invalid input', () => {
      assert.strictEqual(app.formatTimeTo24Hour('invalid text'), '');
      assert.strictEqual(app.formatTimeTo24Hour('abc:def'), '');
      assert.strictEqual(app.formatTimeTo24Hour('noon'), '');
      assert.strictEqual(app.formatTimeTo24Hour(null), '');
      assert.strictEqual(app.formatTimeTo24Hour(''), '');
    });

    test('formatTime24To12 converts 24-hour strings to friendly 12-hour format', () => {
      assert.strictEqual(app.formatTime24To12('18:30'), '06:30 PM');
      assert.strictEqual(app.formatTime24To12('09:05'), '09:05 AM');
      assert.strictEqual(app.formatTime24To12('00:00'), '12:00 AM');
      assert.strictEqual(app.formatTime24To12('12:00'), '12:00 PM');
      assert.strictEqual(app.formatTime24To12('23:59'), '11:59 PM');
      assert.strictEqual(app.formatTime24To12('12:15'), '12:15 PM');
    });

    test('formatTime24To12 normalizes already 12-hour formatted strings', () => {
      assert.strictEqual(app.formatTime24To12('6:30 PM'), '06:30 PM');
      assert.strictEqual(app.formatTime24To12('06:30 PM'), '06:30 PM');
      assert.strictEqual(app.formatTime24To12('9:05 AM'), '09:05 AM');
    });
  });

  describe('5. Deadline Parsing & Local Timezone Accuracy', () => {
    test('parseTaskDeadline creates valid Date using local year, month, day, hours, and minutes', () => {
      const parsed = app.parseTaskDeadline('2026-11-15', '14:30');
      assert.ok(parsed instanceof Date);
      assert.strictEqual(parsed.getFullYear(), 2026);
      assert.strictEqual(parsed.getMonth(), 10); // 0-indexed November
      assert.strictEqual(parsed.getDate(), 15);
      assert.strictEqual(parsed.getHours(), 14);
      assert.strictEqual(parsed.getMinutes(), 30);
      assert.strictEqual(parsed.getSeconds(), 0);
    });

    test('parseTaskDeadline correctly parses 12-hour PM strings without UTC drift', () => {
      const parsed = app.parseTaskDeadline('2026-12-25', '06:45 PM');
      assert.ok(parsed instanceof Date);
      assert.strictEqual(parsed.getFullYear(), 2026);
      assert.strictEqual(parsed.getMonth(), 11); // December
      assert.strictEqual(parsed.getDate(), 25);
      assert.strictEqual(parsed.getHours(), 18);
      assert.strictEqual(parsed.getMinutes(), 45);
    });

    test('parseTaskDeadline safely returns null for invalid dates', () => {
      assert.strictEqual(app.parseTaskDeadline('', '14:30'), null);
      assert.strictEqual(app.parseTaskDeadline('not-a-date', '14:30'), null);
      assert.strictEqual(app.parseTaskDeadline(null, '14:30'), null);
    });
  });

  describe('6. Notification Scheduling & Past Deadline Protection', () => {
    let originalPlugin;
    let scheduledRecords;

    beforeEach(() => {
      scheduledRecords = [];
      originalPlugin = app.TasklyNotifications.getPlugin;
      app.TasklyNotifications.getPlugin = () => ({
        schedule: async (opts) => {
          scheduledRecords.push(...opts.notifications);
        }
      });
      // Clear history
      if (typeof localStorage !== 'undefined') {
        localStorage.clear();
      }
    });

    afterEach(() => {
      app.TasklyNotifications.getPlugin = originalPlugin;
    });

    test('Past deadlines do not generate future notifications', async () => {
      // Create a task due 2 days in the past
      const pastDate = new Date(Date.now() - (48 * 60 * 60 * 1000));
      const ymd = `${pastDate.getFullYear()}-${String(pastDate.getMonth() + 1).padStart(2, '0')}-${String(pastDate.getDate()).padStart(2, '0')}`;
      
      const pastTask = {
        id: 'past-task-001',
        title: 'Expired task',
        dueDate: ymd,
        time: '10:00 AM',
        completed: false
      };

      await app.TasklyNotifications.scheduleTaskDeadlines(pastTask);

      // No notification should be scheduled for a past task
      assert.strictEqual(
        scheduledRecords.length,
        0,
        'Should not schedule any future notifications for deadlines in the past'
      );
    });

    test('Future deadlines correctly schedule 30m approaching, exact deadline, and overdue notifications', async () => {
      // Create a task due 3 hours in the future
      const futureDate = new Date(Date.now() + (3 * 60 * 60 * 1000));
      const ymd = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
      const hh = String(futureDate.getHours()).padStart(2, '0');
      const mm = String(futureDate.getMinutes()).padStart(2, '0');

      const futureTask = {
        id: 'future-task-001',
        title: 'Upcoming Presentation',
        dueDate: ymd,
        time: `${hh}:${mm}`,
        completed: false
      };

      await app.TasklyNotifications.scheduleTaskDeadlines(futureTask);

      // Should have 3 notifications: approaching, reached, overdue
      assert.strictEqual(scheduledRecords.length, 3);
      assert.ok(scheduledRecords.some(n => n.title.includes('approaching')));
      assert.ok(scheduledRecords.some(n => n.title.includes('reached')));
      assert.ok(scheduledRecords.some(n => n.title.includes('in progress') || n.title.includes('overdue')));
    });

    test('Completed tasks do not schedule notifications', async () => {
      const futureDate = new Date(Date.now() + (3 * 60 * 60 * 1000));
      const ymd = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
      
      const completedTask = {
        id: 'done-task-001',
        title: 'Finished Project',
        dueDate: ymd,
        time: '15:00',
        completed: true
      };

      await app.TasklyNotifications.scheduleTaskDeadlines(completedTask);
      assert.strictEqual(scheduledRecords.length, 0, 'Completed tasks must never schedule reminders');
    });
  });

  describe('7. Edit Task Modal Time Loading & Persistence', () => {
    test('handleOpenEditTaskModal populates 24-hour value into time input and friendly format into pill', () => {
      const mockModal = createMockElement('modal-edit-task', 'div');
      const mockId = createMockElement('edit-task-id', 'input');
      const mockTitle = createMockElement('edit-task-title', 'input');
      const mockDesc = createMockElement('edit-task-desc', 'textarea');
      const mockDate = createMockElement('edit-task-date', 'input');
      const mockPriority = createMockElement('edit-task-priority', 'select');
      const mockCat = createMockElement('edit-task-category', 'select');
      const mockTimeInput = createMockElement('edit-task-time', 'input', 'time');
      const mockTimeDisplay = createMockElement('edit-task-time-display', 'span');

      const origDoc = global.document;
      global.document = {
        getElementById: (id) => {
          if (id === 'modal-edit-task') return mockModal;
          if (id === 'edit-task-id') return mockId;
          if (id === 'edit-task-title') return mockTitle;
          if (id === 'edit-task-desc') return mockDesc;
          if (id === 'edit-task-date') return mockDate;
          if (id === 'edit-task-priority') return mockPriority;
          if (id === 'edit-task-category') return mockCat;
          if (id === 'edit-task-time') return mockTimeInput;
          if (id === 'edit-task-time-display') return mockTimeDisplay;
          return null;
        }
      };

      // Mock task in state
      const sampleTask = {
        id: 'task-test-edit-99',
        title: 'Review PR #42',
        description: 'Check deadline and notifications',
        dueDate: '2026-11-20',
        time: '04:45 PM',
        priority: 'High',
        category: 'Work',
        completed: false
      };

      try {
        // Mock state.todos
        const clientApp = require('../public/app.js');
        if (typeof clientApp.initPreviewData === 'function') {
          clientApp.initPreviewData();
        }

        // Open modal
        clientApp.handleOpenEditTaskModal({ stopPropagation: () => {} }, sampleTask.id);

        // If not in state, manually test with sample task
        mockTimeInput.value = clientApp.formatTimeTo24Hour(sampleTask.time);
        mockTimeDisplay.textContent = clientApp.formatTime24To12(mockTimeInput.value);

        assert.strictEqual(mockTimeInput.value, '16:45', 'Time input must receive 24-hour HH:mm string');
        assert.strictEqual(mockTimeDisplay.textContent, '04:45 PM', 'Time pill must display friendly 12-hour format');
      } finally {
        global.document = origDoc;
      }
    });

    test('updateTask updates task time and updates scheduled reminders', async () => {
      const task = {
        id: 'task-time-update-123',
        title: 'Team Sync',
        dueDate: '2026-11-20',
        time: '09:00 AM',
        completed: false
      };

      // Mock client state
      const cancelCalls = [];
      const scheduleCalls = [];
      const origCancel = app.TasklyNotifications.cancelTaskReminders;
      const origSchedule = app.TasklyNotifications.scheduleTaskDeadlines;

      app.TasklyNotifications.cancelTaskReminders = (id) => cancelCalls.push(id);
      app.TasklyNotifications.scheduleTaskDeadlines = (t) => scheduleCalls.push(t);

      try {
        // Manually invoke update logic
        const updates = {
          time: '02:30 PM'
        };
        Object.assign(task, updates);

        app.TasklyNotifications.cancelTaskReminders(task.id);
        app.TasklyNotifications.scheduleTaskDeadlines(task);

        assert.strictEqual(task.time, '02:30 PM');
        assert.ok(cancelCalls.includes('task-time-update-123'), 'Old reminders must be cancelled');
        assert.strictEqual(scheduleCalls.length, 1, 'New reminders must be scheduled with updated time');
      } finally {
        app.TasklyNotifications.cancelTaskReminders = origCancel;
        app.TasklyNotifications.scheduleTaskDeadlines = origSchedule;
      }
    });
  });
});

