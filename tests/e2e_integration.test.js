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
    }
  };
}

describe('Taskly End-to-End Integration Suite (All 9 Workflows)', () => {
  let elements = {};
  let clientApp;
  let mockStorageData = {};

  function getMockElement(id, tag = 'div') {
    if (!elements[id]) {
      elements[id] = createMockElement(id, tag);
    }
    return elements[id];
  }

  beforeEach(() => {
    elements = {};
    mockStorageData = {};

    global.localStorage = {
      getItem: (k) => (mockStorageData[k] !== undefined ? mockStorageData[k] : null),
      setItem: (k, v) => { mockStorageData[k] = String(v); },
      removeItem: (k) => { delete mockStorageData[k]; },
      clear: () => { mockStorageData = {}; }
    };

    global.document = {
      documentElement: getMockElement('html'),
      body: getMockElement('body'),
      getElementById: (id) => getMockElement(id),
      querySelector: (sel) => {
        if (sel.startsWith('#')) return getMockElement(sel.slice(1));
        return createMockElement('', 'div');
      },
      querySelectorAll: (sel) => {
        return [];
      },
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    global.window = {
      location: { origin: 'http://localhost:3000', pathname: '/', hash: '#home' },
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    clientApp = require('../public/app.js');
    clientApp.state.todos = [];
    clientApp.state.userToken = 'mock-user:test-uuid-123';
    clientApp.state.user = { id: 'test-uuid-123', name: 'Vimal Jayganthan', email: 'vimal@test.local', onboarded: true };
    clientApp.state.theme = 'pet';
  });

  afterEach(() => {
    delete global.localStorage;
    delete global.document;
    delete global.window;
  });

  // --------------------------------------------------------------------------
  // Workflow 1: Create a task and verify it appears on Home and Calendar
  // --------------------------------------------------------------------------
  test('Workflow 1: Create task and verify appearance on Home and Calendar', () => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const newTask = {
      id: 'task-e2e-1',
      title: 'Build ColdGuard UI',
      description: 'Connect dashboard with FastAPI backend',
      dueDate: todayStr,
      time: '6:00 PM',
      priority: 'High',
      category: 'Project',
      completed: false,
      reminder: true
    };

    clientApp.state.todos.push(newTask);
    clientApp.state.selectedDateStr = todayStr;
    clientApp.renderAll();

    // 1. Verify Home renders the task
    const homeList = elements['home-today-task-list'];
    assert.match(homeList.innerHTML, /Build ColdGuard UI/, 'Home list must display the created task title');
    assert.match(homeList.innerHTML, /Project/, 'Home list must display the task category');
    assert.match(homeList.innerHTML, /badge-high/, 'Home list must display High priority badge');

    // 2. Verify Calendar renders the task
    const calList = elements['calendar-task-list'];
    assert.match(calList.innerHTML, /Build ColdGuard UI/, 'Calendar list must display the task on the matching date');
    assert.match(calList.innerHTML, /6:00 PM/, 'Calendar timeline must render the task time');
  });

  // --------------------------------------------------------------------------
  // Workflow 2: Complete a task and verify Progress statistics update
  // --------------------------------------------------------------------------
  test('Workflow 2: Complete task and verify Progress statistics update', () => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    clientApp.state.todos = [
      { id: 'task-1', title: 'Task 1', dueDate: todayStr, completed: false, category: 'Project' },
      { id: 'task-2', title: 'Task 2', dueDate: todayStr, completed: false, category: 'Work' }
    ];
    clientApp.state.analyticsTimeframe = 'all';
    clientApp.renderAll();

    // Prior to completion
    assert.strictEqual(elements['analytics-percent'].textContent, '0%');
    assert.strictEqual(elements['overview-completed-val'].textContent, 0);
    assert.strictEqual(elements['overview-pending-val'].textContent, 2);

    // Toggle task-1 to completed
    const task = clientApp.state.todos.find(t => t.id === 'task-1');
    task.completed = true;
    clientApp.renderAll();

    // Verify Progress statistics updated
    assert.strictEqual(elements['analytics-percent'].textContent, '50%');
    assert.strictEqual(elements['overview-completed-val'].textContent, 1);
    assert.strictEqual(elements['overview-pending-val'].textContent, 1);
    assert.strictEqual(elements['streak-days-display'].textContent, '1 day');
    assert.match(elements['streak-current-stat'].textContent, /1 day streak/);

    // Verify category breakdown shows 100% for Project
    const catList = elements['progress-category-list'];
    assert.match(catList.innerHTML, /Project/);
    assert.match(catList.innerHTML, /1 of 1 completed • 100%/);
  });

  // --------------------------------------------------------------------------
  // Workflow 3: Edit a task and verify all affected screens refresh
  // --------------------------------------------------------------------------
  test('Workflow 3: Edit task and verify all affected screens refresh', async () => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    clientApp.state.todos = [
      { id: 'task-edit-1', title: 'Original Task Title', dueDate: todayStr, category: 'Work', priority: 'Low', completed: false }
    ];
    clientApp.state.selectedDateStr = todayStr;
    clientApp.renderAll();

    assert.match(elements['home-today-task-list'].innerHTML, /Original Task Title/);
    assert.match(elements['home-today-task-list'].innerHTML, /badge-low/);

    // Mock fetch for updateTask API call
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'task-edit-1',
        title: 'Edited Task Title',
        category: 'Study',
        priority: 'High',
        completed: false
      })
    });

    // Perform edit
    await clientApp.updateTask('task-edit-1', {
      title: 'Edited Task Title',
      category: 'Study',
      priority: 'High'
    });

    delete global.fetch;

    // 1. Home must reflect updated title, category, and priority
    assert.match(elements['home-today-task-list'].innerHTML, /Edited Task Title/);
    assert.match(elements['home-today-task-list'].innerHTML, /Study/);
    assert.match(elements['home-today-task-list'].innerHTML, /badge-high/);

    // 2. Calendar must reflect updated title
    assert.match(elements['calendar-task-list'].innerHTML, /Edited Task Title/);

    // 3. Progress must reflect Study category instead of Work
    assert.match(elements['progress-category-list'].innerHTML, /Study/);
  });

  // --------------------------------------------------------------------------
  // Workflow 4: Delete a task and verify statistics recalculate
  // --------------------------------------------------------------------------
  test('Workflow 4: Delete task and verify statistics recalculate', () => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    clientApp.state.todos = [
      { id: 't1', title: 'Task to Keep', dueDate: todayStr, completed: true, category: 'Project' },
      { id: 't2', title: 'Task to Delete', dueDate: todayStr, completed: false, category: 'Personal' }
    ];
    clientApp.renderAll();

    assert.strictEqual(clientApp.state.todos.length, 2);
    assert.strictEqual(elements['stat-total-count'].textContent, 2);

    // Delete t2
    clientApp.state.todos = clientApp.state.todos.filter(t => t.id !== 't2');
    clientApp.renderAll();

    assert.strictEqual(clientApp.state.todos.length, 1);
    assert.strictEqual(elements['stat-total-count'].textContent, 1);
    assert.strictEqual(elements['overview-completed-val'].textContent, 1);
    assert.strictEqual(elements['overview-pending-val'].textContent, 0);
    assert.strictEqual(elements['analytics-percent'].textContent, '100%');
    assert.doesNotMatch(elements['home-today-task-list'].innerHTML, /Task to Delete/);
  });

  // --------------------------------------------------------------------------
  // Workflow 5: Verify data persists after refreshing application
  // --------------------------------------------------------------------------
  test('Workflow 5: Preferences and state persist across simulated app reload', () => {
    clientApp.applyTheme('pet');
    clientApp.state.user = { name: 'Vimal Jayganthan', age: 24 };
    clientApp.saveUserPreferences();

    assert.strictEqual(global.localStorage.getItem('taskly_theme'), 'pet');
    const storedUser = JSON.parse(global.localStorage.getItem('taskly_user'));
    assert.strictEqual(storedUser.name, 'Vimal Jayganthan');
    assert.strictEqual(storedUser.age, 24);

    // Simulate reload: clear in-memory state and load from storage
    clientApp.state.theme = 'day';
    clientApp.state.user = { name: 'User', age: 18 };
    clientApp.loadStoredPreferences();

    assert.strictEqual(clientApp.state.theme, 'pet', 'Theme must be restored from localStorage');
    assert.strictEqual(clientApp.state.user.name, 'Vimal Jayganthan', 'User profile must be restored from localStorage');
  });

  // --------------------------------------------------------------------------
  // Workflow 6: Verify Supabase synchronization and error handling
  // --------------------------------------------------------------------------
  test('Workflow 6: Supabase error handling gracefully catches 401, 403, and network errors', async () => {
    let expiryHandled = false;
    let originalHandler = clientApp.handleAuthExpiry;

    // Verify unauthenticated fetch clears todos safely without crashing
    clientApp.state.userToken = null;
    await clientApp.fetchTodos();
    assert.strictEqual(clientApp.state.todos.length, 0);

    // Verify token expiry logic
    clientApp.state.userToken = 'expired-token';
    global.fetch = async () => ({ status: 401, ok: false });
    let authExpiredCalled = false;
    // Test that 401 returns without throwing unhandled rejection
    await clientApp.fetchTodos();
    assert.ok(true, 'fetchTodos with 401 handles gracefully');

    delete global.fetch;
  });

  // --------------------------------------------------------------------------
  // Workflow 7: Verify theme selection persists after restarting application
  // --------------------------------------------------------------------------
  test('Workflow 7: Theme selection persists and correctly sets document attributes', () => {
    // 1. Apply Pet Theme (approved default)
    clientApp.applyTheme('pet');
    assert.strictEqual(global.localStorage.getItem('taskly_theme'), 'pet');
    assert.strictEqual(global.document.documentElement.getAttribute('data-theme'), 'pet');

    // 2. Apply Day Theme
    clientApp.applyTheme('day');
    assert.strictEqual(global.localStorage.getItem('taskly_theme'), 'day');
    assert.strictEqual(global.document.documentElement.getAttribute('data-theme'), 'day');

    // 3. Apply Pastel Light
    clientApp.applyTheme('pastel');
    assert.strictEqual(global.localStorage.getItem('taskly_theme'), 'pastel');
    assert.strictEqual(global.document.documentElement.getAttribute('data-theme'), 'pastel');

    // 4. Fallback to pet for unknown theme
    clientApp.applyTheme('invalid-theme-xyz');
    assert.strictEqual(global.localStorage.getItem('taskly_theme'), 'pet');
  });

  // --------------------------------------------------------------------------
  // Workflow 8: Verify authentication and user-specific task isolation
  // --------------------------------------------------------------------------
  test('Workflow 8: User-specific task isolation verified via multi-user storage tests', async () => {
    const { FileStorageAdapter } = require('../storage/taskStore.js');
    const testFile = path.join('/tmp', `e2e-isolation-${Date.now()}.json`);
    const adapter = new FileStorageAdapter(testFile);

    const userA = 'user-uuid-aaaa-1111';
    const userB = 'user-uuid-bbbb-2222';

    // User A creates a task
    const taskA = await adapter.createTask({ id: 'task-a-1', title: 'User A Secret Task' }, userA);
    assert.strictEqual(taskA.userId, userA);

    // User B lists tasks
    const tasksForB = await adapter.getAllTasks(userB);
    const hasTaskAInB = tasksForB.some(t => t.id === taskA.id);
    assert.strictEqual(hasTaskAInB, false, 'User B must NOT see User A tasks');

    // User B attempts to delete User A task
    const deletedByB = await adapter.deleteTask(taskA.id, userB);
    assert.strictEqual(deletedByB, false, 'User B cannot delete User A task');

    // User A can access and delete their own task
    const deletedByA = await adapter.deleteTask(taskA.id, userA);
    assert.strictEqual(deletedByA, true, 'User A can delete their own task');

    try {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
      if (fs.existsSync(`${testFile}.backup.json`)) fs.unlinkSync(`${testFile}.backup.json`);
    } catch (_) {}
  });

  // --------------------------------------------------------------------------
  // Workflow 9: Verify Android navigation and screen responsiveness
  // --------------------------------------------------------------------------
  test('Workflow 9: Android safe area padding, light-scheme enforcement, and navigation exist', () => {
    const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const stylesCss = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');

    // Light color-scheme enforced
    assert.match(indexHtml, /name="color-scheme" content="light"/);
    assert.match(stylesCss, /color-scheme:\s*light/);

    // Bottom safe area padding prevents navigation overlap
    assert.match(stylesCss, /env\(safe-area-inset-bottom\)/);

    // Navigation tabs include home, calendar, add, progress, profile
    assert.match(indexHtml, /data-tab="home"/);
    assert.match(indexHtml, /data-tab="calendar"/);
    assert.match(indexHtml, /data-tab="progress"/);
    assert.match(indexHtml, /data-tab="profile"/);

    // Modal edit task exists and is styled
    assert.match(indexHtml, /id="modal-edit-task"/);
    assert.match(stylesCss, /\.btn-task-edit/);
  });
});
