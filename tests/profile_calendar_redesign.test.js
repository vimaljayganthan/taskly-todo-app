const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Setup mock element for simulated DOM testing
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
    textContent: '',
    innerHTML: '',
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
    }
  };
}

describe('Taskly Profile Redesign & Dynamic Calendar Suite', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const stylesCss = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');

  let elements = {};
  let clientApp;

  function getMockElement(id, tag = 'div') {
    if (!elements[id]) {
      elements[id] = createMockElement(id, tag);
    }
    return elements[id];
  }

  beforeEach(() => {
    elements = {};

    global.document = {
      documentElement: getMockElement('html'),
      body: getMockElement('body'),
      getElementById: (id) => getMockElement(id),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    global.window = {
      location: {
        origin: 'http://localhost:3000',
        hostname: 'localhost',
        protocol: 'http:',
        pathname: '/',
        search: '',
        hash: ''
      },
      history: {
        replaceState() {},
        pushState() {}
      },
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    global.localStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {}
    };

    delete require.cache[require.resolve('../public/app.js')];
    clientApp = require('../public/app.js');
    clientApp.state.userToken = 'mock-valid-token-for-testing';
    clientApp.state.user.id = 'mock-user-123';
    clientApp.state.flow = 'main';
  });

  afterEach(() => {
    delete global.document;
    delete global.window;
    delete global.localStorage;
  });

  // --------------------------------------------------------------------------
  // 1. Profile Redesign (Sky Blue 70/30)
  // --------------------------------------------------------------------------
  describe('1. Profile Redesign & Menu Items', () => {
    test('public/index.html includes profile menu items without learning, quiz, or messages', () => {
      assert.ok(indexHtml.includes('id="btn-profile-notifications"'), 'Must have top notification bell button');
      assert.ok(indexHtml.includes('id="menu-track-tasks"'), 'Must have Track Tasks menu item');
      assert.ok(indexHtml.includes('id="menu-appointments"'), 'Must have Appointments menu item');
      assert.ok(indexHtml.includes('id="menu-progress"'), 'Must have Progress menu item');
      assert.ok(indexHtml.includes('id="menu-faq"'), 'Must have FAQ menu item');
      assert.ok(indexHtml.includes('id="btn-toggle-theme"'), 'Must keep Theme selection accessible');
      assert.ok(indexHtml.includes('id="btn-logout"'), 'Must have Log out action');

      // Verify removed items per user instruction
      assert.ok(!indexHtml.includes('id="menu-learning"'), 'Learning menu item must be removed');
      assert.ok(!indexHtml.includes('id="menu-quiz"'), 'Quiz menu item must be removed');
      assert.ok(!indexHtml.includes('id="menu-messages"'), 'Messages menu item must be removed');
    });

    test('Profile drawer card uses sky-blue styling in Day Theme', () => {
      assert.ok(stylesCss.includes('[data-theme="day"] #tab-profile .profile-drawer-card'), 'Day Theme must style profile drawer card');
      assert.ok(stylesCss.includes('[data-theme="day"] #tab-profile .btn-profile-notif'), 'Day Theme must style notification bell');
      assert.ok(stylesCss.includes('#38BDF8'), 'Must use Sky Blue theme background #38BDF8');
    });

    test('Profile menu items trigger existing navigation and modals', () => {
      clientApp.setupEventListeners();

      // Test Track Tasks -> navigates to home
      const menuTrack = getMockElement('menu-track-tasks');
      menuTrack.trigger('click');
      assert.strictEqual(clientApp.state.activeTab, 'home');

      // Test Appointments -> navigates to calendar
      const menuAppt = getMockElement('menu-appointments');
      menuAppt.trigger('click');
      assert.strictEqual(clientApp.state.activeTab, 'calendar');

      // Test Progress -> navigates to progress
      const menuProg = getMockElement('menu-progress');
      menuProg.trigger('click');
      assert.strictEqual(clientApp.state.activeTab, 'progress');
    });
  });

  // --------------------------------------------------------------------------
  // 2. Dynamic Calendar & Real Task Synchronization
  // --------------------------------------------------------------------------
  describe('2. Dynamic Calendar with Live Database Tasks', () => {
    test('public/index.html includes 7-day strip, summary metrics and chronological timeline (habits removed)', () => {
      assert.ok(indexHtml.includes('id="calendar-days-container"'), 'Must have calendar container');
      assert.ok(indexHtml.includes('id="calendar-task-list"'), 'Must have calendar task list');
      assert.ok(indexHtml.includes('id="cal-metric-tasks-count"'), 'Must have tasks metric counter');
      assert.ok(!indexHtml.includes('id="cal-metric-habits-count"'), 'Habits metric counter must be removed');
      assert.ok(indexHtml.includes('id="btn-cal-add-fab"'), 'Must have floating add task button in calendar');
      assert.ok(indexHtml.includes('id="calendar-undated-section"'), 'Must have undated tasks section');
    });

    test('Calendar displays user tasks for the selected date chronologically', () => {
      clientApp.state.selectedDateStr = '2026-11-05';
      clientApp.state.todos = [
        { id: 'task-1', title: 'Afternoon Dev', dueDate: '2026-11-05', time: '14:00', category: 'Work', completed: false },
        { id: 'task-2', title: 'Morning Routine', dueDate: '2026-11-05', time: '08:00', category: 'Personal', completed: true },
        { id: 'task-3', title: 'Evening Study', dueDate: '2026-11-05', time: '18:30', category: 'Study', completed: false },
        { id: 'task-other', title: 'Other Day Task', dueDate: '2026-11-06', time: '09:00', category: 'Health', completed: false }
      ];

      clientApp.renderCalendar();

      const taskList = getMockElement('calendar-task-list');
      assert.ok(taskList.innerHTML.includes('Morning Routine'), 'Must include task scheduled for 2026-11-05');
      assert.ok(taskList.innerHTML.includes('Afternoon Dev'), 'Must include task scheduled for 2026-11-05');
      assert.ok(taskList.innerHTML.includes('Evening Study'), 'Must include task scheduled for 2026-11-05');
      assert.ok(!taskList.innerHTML.includes('Other Day Task'), 'Must NOT display task scheduled for a different date');

      // Check chronological order (Morning Routine first, then Afternoon Dev, then Evening Study)
      const morningIdx = taskList.innerHTML.indexOf('Morning Routine');
      const afternoonIdx = taskList.innerHTML.indexOf('Afternoon Dev');
      const eveningIdx = taskList.innerHTML.indexOf('Evening Study');

      assert.ok(morningIdx < afternoonIdx, '08:00 task must appear before 14:00 task');
      assert.ok(afternoonIdx < eveningIdx, '14:00 task must appear before 18:30 task');
    });

    test('Floating Add Task button pre-fills selected calendar date and sets previous tab', () => {
      clientApp.setupEventListeners();
      clientApp.state.selectedDateStr = '2026-11-18';

      const dateInput = getMockElement('add-due-date', 'input');
      const btnAddFab = getMockElement('btn-cal-add-fab');

      btnAddFab.trigger('click');

      assert.strictEqual(dateInput.value, '2026-11-18', 'Must prefill the selected calendar date');
      assert.strictEqual(clientApp.state.activeTab, 'add', 'Must navigate to the Add Task screen');
      assert.strictEqual(clientApp.state.previousTab, 'calendar', 'Must track that we originated from calendar');
    });

    test('Undated tasks are placed outside the daily timeline in undated section', () => {
      clientApp.state.selectedDateStr = '2026-11-05';
      clientApp.state.todos = [
        { id: 'dated-1', title: 'Dated Task', dueDate: '2026-11-05', time: '10:00', completed: false },
        { id: 'undated-1', title: 'Undated Grocery', dueDate: null, completed: false },
        { id: 'undated-2', title: 'Undated Ideas', dueDate: '', completed: false }
      ];

      clientApp.renderCalendar();

      const taskList = getMockElement('calendar-task-list');
      const undatedSection = getMockElement('calendar-undated-section');
      const undatedCount = getMockElement('undated-tasks-count');
      const undatedList = getMockElement('calendar-undated-list');

      // Timeline must only contain dated task
      assert.ok(taskList.innerHTML.includes('Dated Task'));
      assert.ok(!taskList.innerHTML.includes('Undated Grocery'));

      // Undated section must display both undated tasks
      assert.strictEqual(undatedSection.style.display, 'block');
      assert.strictEqual(undatedCount.textContent, 2);
      assert.ok(undatedList.innerHTML.includes('Undated Grocery'));
      assert.ok(undatedList.innerHTML.includes('Undated Ideas'));
    });
  });

  // --------------------------------------------------------------------------
  // 3. Theme Compatibility & Styling Overrides
  // --------------------------------------------------------------------------
  describe('3. Theme Compatibility (Pastel Light & Day Theme)', () => {
    test('styles.css contains Light Red Theme rules for calendar (#FFE1E7, #FFC6D1, #F04455)', () => {
      assert.ok(stylesCss.includes('#FFE1E7'), 'Calendar background must support #FFE1E7');
      assert.ok(stylesCss.includes('#FFC6D1'), 'Calendar secondary accent must support #FFC6D1');
      assert.ok(stylesCss.includes('#F04455'), 'Calendar active red accent must support #F04455');
    });

    test('styles.css contains Sky Blue Theme rules for profile (#38BDF8, #7DD3FC, #0284C7)', () => {
      assert.ok(stylesCss.includes('#38BDF8'), 'Profile background must support #38BDF8');
      assert.ok(stylesCss.includes('#7DD3FC'), 'Profile secondary blue must support #7DD3FC');
      assert.ok(stylesCss.includes('#0284C7'), 'Profile primary accent must support #0284C7');
      assert.ok(stylesCss.includes('#E0F2FE'), 'Profile light blue container must support #E0F2FE');
    });

    test('Both Pastel Light and Day Theme can be switched and persisted', () => {
      clientApp.applyTheme('day');
      assert.strictEqual(clientApp.state.theme, 'day');

      clientApp.applyTheme('pastel');
      assert.strictEqual(clientApp.state.theme, 'pastel');
    });
  });
});
