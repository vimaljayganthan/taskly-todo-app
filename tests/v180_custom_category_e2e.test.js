/**
 * Taskly v1.8.0 Build 9 - End-to-End Real Workflow Regression Suite
 *
 * Exercises the complete custom category workflow across:
 * Category creation -> Storage -> Add Task UI -> Form submission ->
 * Supabase persistence -> Application reload -> Task card rendering ->
 * Edit Task UI -> Update persistence -> Calendar workload calculation ->
 * Cross-session sign out / sign in synchronization -> Category deletion task reassignment ->
 * Generic validation (e.g. 'Fitness').
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

// Simulated Browser Environment
const mockStorage = new Map();
global.localStorage = {
  getItem: (k) => (mockStorage.has(k) ? mockStorage.get(k) : null),
  setItem: (k, v) => mockStorage.set(k, String(v)),
  removeItem: (k) => mockStorage.delete(k),
  clear: () => mockStorage.clear()
};

function createMockElement(id = '', tag = 'div') {
  const children = [];
  const attributes = {};
  const listeners = {};
  const classList = new Set();
  const options = [];

  const el = {
    id,
    tagName: tag.toUpperCase(),
    value: '',
    checked: false,
    textContent: '',
    innerHTML: '',
    disabled: false,
    dataset: {},
    style: { display: 'block', backgroundColor: '', color: '' },
    setAttribute: (k, v) => { attributes[k] = String(v); },
    getAttribute: (k) => attributes[k] || null,
    removeAttribute: (k) => { delete attributes[k]; },
    classList: {
      add: (...c) => c.forEach(cls => classList.add(cls)),
      remove: (...c) => c.forEach(cls => classList.delete(cls)),
      contains: (cls) => classList.has(cls),
      toggle: (cls, force) => {
        if (force === true) classList.add(cls);
        else if (force === false) classList.delete(cls);
        else if (classList.has(cls)) classList.delete(cls);
        else classList.add(cls);
      }
    },
    options,
    selectedIndex: 0,
    add(opt, before) {
      if (before) {
        const idx = options.indexOf(before);
        if (idx !== -1) options.splice(idx, 0, opt);
        else options.push(opt);
      } else {
        options.push(opt);
      }
    },
    querySelector: (sel) => {
      if (sel.includes('.active')) {
        return children.find(c => c.classList.contains('active')) || null;
      }
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel.includes('.pill-opt')) {
        return children.filter(c => c.classList.contains('pill-opt'));
      }
      if (sel.includes('.btn-delete-custom-cat')) {
        return children.filter(c => c.classList.contains('btn-delete-custom-cat'));
      }
      return children;
    },
    addEventListener: (evt, fn) => {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(fn);
    },
    removeEventListener: (evt, fn) => {
      if (listeners[evt]) {
        listeners[evt] = listeners[evt].filter(f => f !== fn);
      }
    },
    dispatchEvent: (evt) => {
      const type = typeof evt === 'string' ? evt : evt.type;
      if (listeners[type]) {
        listeners[type].forEach(fn => fn(evt));
      }
      if (type === 'change' && typeof el.onchange === 'function') {
        el.onchange(evt);
      }
    },
    focus: () => {}
  };

  return el;
}

const mockElements = new Map();
global.document = {
  getElementById(id) {
    if (!mockElements.has(id)) {
      mockElements.set(id, createMockElement(id));
    }
    return mockElements.get(id);
  },
  createElement(tag) {
    return createMockElement('', tag);
  },
  querySelector(sel) {
    if (sel.startsWith('#')) {
      const parts = sel.slice(1).split(' ');
      const main = this.getElementById(parts[0]);
      if (parts.length > 1 && parts[1].includes('.active')) {
        return main.querySelector(parts[1]);
      }
      return main;
    }
    return null;
  },
  querySelectorAll(sel) {
    if (sel.startsWith('#')) {
      const parts = sel.slice(1).split(' ');
      const main = this.getElementById(parts[0]);
      if (parts.length > 1) {
        return main.querySelectorAll(parts[1]);
      }
      return [main];
    }
    return [];
  },
  documentElement: createMockElement('html'),
  body: createMockElement('body'),
  addEventListener() {},
  removeEventListener() {}
};

global.window = {
  location: { protocol: 'https:', origin: 'http://localhost:3000', hostname: 'localhost' },
  Capacitor: undefined,
  addEventListener() {},
  removeEventListener() {},
  open() {}
};

global.Option = function(text, val, defaultSelected, selected) {
  return { text, value: val, defaultSelected: Boolean(defaultSelected), selected: Boolean(selected) };
};

global.alert = () => {};

const app = require(path.join(ROOT_DIR, 'public', 'app.js'));

describe('Taskly v1.8.0 - Real End-to-End Custom Category Workflow Regression Suite', () => {
  // Simulated PostgreSQL Supabase backing table
  let db_todos = [];
  let currentUser = {
    id: 'test-user-e2e',
    email: 'user-e2e@taskly.test',
    user_metadata: {}
  };

  function createSimulatedSupabaseClient() {
    return {
      auth: {
        getUser: async () => ({ data: { user: currentUser }, error: null }),
        updateUser: async ({ data }) => {
          if (currentUser) {
            currentUser.user_metadata = Object.assign(currentUser.user_metadata || {}, data);
          }
          return { data: { user: currentUser }, error: null };
        },
        signInWithPassword: async ({ email }) => {
          currentUser = {
            id: 'test-user-e2e',
            email,
            user_metadata: {}
          };
          return {
            data: {
              session: {
                access_token: 'valid-jwt-token',
                user: currentUser
              }
            },
            error: null
          };
        },
        signOut: async () => {
          currentUser = null;
          return { error: null };
        }
      },
      from: (table) => {
        if (table !== 'todos') throw new Error(`Unexpected table ${table}`);
        return {
          select: () => ({
            eq: (col1, val1) => ({
              order: (orderCol, opts) => {
                const rows = db_todos.filter(r => r[col1] === val1);
                return Promise.resolve({ data: JSON.parse(JSON.stringify(rows)), error: null });
              }
            })
          }),
          insert: (row) => ({
            select: () => ({
              single: async () => {
                const copy = JSON.parse(JSON.stringify(row));
                db_todos.push(copy);
                return { data: copy, error: null };
              }
            })
          }),
          update: (fields) => ({
            eq: (col1, val1) => ({
              eq: (col2, val2) => ({
                select: () => ({
                  single: async () => {
                    const row = db_todos.find(r => r[col1] === val1 && r[col2] === val2);
                    if (row) Object.assign(row, JSON.parse(JSON.stringify(fields)));
                    return { data: row ? JSON.parse(JSON.stringify(row)) : null, error: null };
                  }
                }),
                then: (resolve) => {
                  const row = db_todos.find(r => r[col1] === val1 && r[col2] === val2);
                  if (row) Object.assign(row, JSON.parse(JSON.stringify(fields)));
                  return Promise.resolve({ data: row, error: null }).then(resolve);
                }
              }),
              ilike: (col2, val2) => ({
                then: (resolve) => {
                  db_todos.forEach(r => {
                    if (r[col1] === val1 && r[col2] && r[col2].toLowerCase() === val2.toLowerCase()) {
                      Object.assign(r, JSON.parse(JSON.stringify(fields)));
                    }
                  });
                  return Promise.resolve({ data: true, error: null }).then(resolve);
                }
              })
            })
          }),
          delete: () => ({
            eq: (col1, val1) => ({
              eq: async (col2, val2) => {
                const idx = db_todos.findIndex(r => r[col1] === val1 && r[col2] === val2);
                if (idx !== -1) db_todos.splice(idx, 1);
                return { error: null };
              }
            })
          })
        };
      }
    };
  }

  beforeEach(() => {
    mockStorage.clear();
    mockElements.clear();
    db_todos = [];
    currentUser = {
      id: 'test-user-e2e',
      email: 'user-e2e@taskly.test',
      user_metadata: {}
    };

    const client = createSimulatedSupabaseClient();
    app.setSupabaseClient(client);

    app.state.user = {
      id: currentUser.id,
      email: currentUser.email,
      name: 'Test User',
      user_metadata: {}
    };
    app.state.userToken = 'valid-jwt-token';
    app.state.todos = [];
    app.state.isPreviewSession = false;
  });

  test('Complete 16-Step Workflow: Check Category Creation -> Selection -> DB Persistence -> Calendar -> Sync -> Deletion', async () => {
    // -----------------------------------------------------------------------
    // Step 1: Create a custom category called "Check"
    // -----------------------------------------------------------------------
    const catName = app.saveCustomCategory('Check');
    assert.strictEqual(catName, 'Check');
    const stored = app.getStoredCustomCategories();
    assert.ok(stored.includes('Check'), 'Step 1: "Check" must be in stored custom categories');

    // -----------------------------------------------------------------------
    // Step 2 & 3: Open Add Task and Select "Check"
    // -----------------------------------------------------------------------
    app.syncCustomCategoriesToDOM('Check');
    const addCatSelect = document.getElementById('add-task-category');
    assert.ok(addCatSelect.options.some(o => o.value === 'Check'), 'Step 2: Add Task dropdown must contain Check');
    addCatSelect.value = 'Check';

    // -----------------------------------------------------------------------
    // Step 4: Create a task called "Category Test"
    // -----------------------------------------------------------------------
    const addTitleInput = document.getElementById('add-title');
    const addDueDateInput = document.getElementById('add-due-date');
    const addTimeInput = document.getElementById('add-time');
    addTitleInput.value = 'Category Test';
    addDueDateInput.value = '2026-11-20';
    addTimeInput.value = '10:00';

    await app.handleAddTask({ preventDefault() {} });

    // -----------------------------------------------------------------------
    // Step 5: Verify the task is saved with category Check in Supabase database
    // -----------------------------------------------------------------------
    assert.strictEqual(db_todos.length, 1, 'Step 5: Exactly one task must be in database');
    const dbTask = db_todos[0];
    assert.strictEqual(dbTask.title, 'Category Test');
    assert.strictEqual(dbTask.category, 'Check', 'Step 5: DB row category must be Check, NOT Personal');
    assert.strictEqual(dbTask.due_date, '2026-11-20');

    // -----------------------------------------------------------------------
    // Step 6: Reload the application
    // -----------------------------------------------------------------------
    app.state.todos = [];
    await app.fetchTodos();

    // -----------------------------------------------------------------------
    // Step 7: Verify Category Test still displays Check
    // -----------------------------------------------------------------------
    assert.strictEqual(app.state.todos.length, 1, 'Step 7: Tasks must be reloaded from database');
    const reloadedTask = app.state.todos[0];
    assert.strictEqual(reloadedTask.title, 'Category Test');
    assert.strictEqual(reloadedTask.category, 'Check', 'Step 7: Reloaded task category must be Check');

    const catConfig = app.getTaskCategoryConfig(reloadedTask.category);
    assert.strictEqual(catConfig.key, 'custom');
    assert.strictEqual(catConfig.hex.toUpperCase(), '#FACC15');
    assert.strictEqual(catConfig.badgeText.toUpperCase(), '#422006');

    // -----------------------------------------------------------------------
    // Step 8 & 9: Open Edit Task and verify Check is selected
    // -----------------------------------------------------------------------
    app.handleOpenEditTaskModal(null, reloadedTask.id);
    const editCatSelect = document.getElementById('edit-task-category');
    assert.ok(editCatSelect.options.some(o => o.value === 'Check'), 'Step 8: Edit Task dropdown must contain Check');
    assert.strictEqual(editCatSelect.value, 'Check', 'Step 9: Edit Task dropdown must have Check selected');

    // -----------------------------------------------------------------------
    // Step 10 & 11: Change task title and save, verify category remains Check
    // -----------------------------------------------------------------------
    const updated = await app.updateTask(reloadedTask.id, {
      title: 'Category Test Renamed',
      category: editCatSelect.value
    });
    assert.strictEqual(updated.title, 'Category Test Renamed');
    assert.strictEqual(updated.category, 'Check', 'Step 11: Category must remain Check after updating title');

    // Verify in backing DB table
    const dbTaskAfterEdit = db_todos.find(r => r.id === reloadedTask.id);
    assert.strictEqual(dbTaskAfterEdit.title, 'Category Test Renamed');
    assert.strictEqual(dbTaskAfterEdit.category, 'Check', 'Step 11: DB table category must remain Check');

    // -----------------------------------------------------------------------
    // Step 12: Verify calendar date indicator is yellow #FACC15
    // -----------------------------------------------------------------------
    const workload = app.TasklyWorkloadEngine.getWorkloadCategory('2026-11-20', app.state.todos);
    assert.strictEqual(workload.key, 'custom', 'Step 12: Workload key must be custom');
    assert.strictEqual(workload.hex.toUpperCase(), '#FACC15', 'Step 12: Calendar date indicator must be #FACC15');
    assert.strictEqual(workload.text.toUpperCase(), '#422006', 'Step 12: Text color must be #422006');
    assert.strictEqual(workload.class, 'workload-custom');

    // -----------------------------------------------------------------------
    // Step 13 & 14: Sign out and sign in again, verify category remains correct
    // -----------------------------------------------------------------------
    // Simulate logging in from a fresh session where localStorage is cleared
    mockStorage.clear();
    app.syncAuthSession({
      access_token: 'new-valid-session',
      user: currentUser
    });
    await app.fetchTodos();

    assert.strictEqual(app.state.todos.length, 1);
    assert.strictEqual(app.state.todos[0].category, 'Check', 'Step 14: Post-re-auth task category must be Check');
    const storedAfterRelogin = app.getStoredCustomCategories();
    assert.ok(storedAfterRelogin.includes('Check'), 'Step 14: Custom category Check must be restored in storage');

    // -----------------------------------------------------------------------
    // Step 15 & 16: Delete Check, verify affected tasks are reassigned to Personal
    // -----------------------------------------------------------------------
    app.deleteCustomCategory('Check');

    // Check memory state
    assert.strictEqual(app.state.todos[0].category, 'Personal', 'Step 16: Affected task must be reassigned to Personal in memory');
    assert.ok(!app.getStoredCustomCategories().includes('Check'), 'Step 16: Check must be purged from custom categories');

    // Check database state
    const dbTaskAfterDelete = db_todos.find(r => r.id === reloadedTask.id);
    assert.strictEqual(dbTaskAfterDelete.category, 'Personal', 'Step 16: Backing DB table must reassign task to Personal');
  });

  test('Generic Custom Category: Verifies arbitrary custom category (e.g. Fitness) works identically', async () => {
    // 1. Create 'Fitness'
    app.saveCustomCategory('Fitness');
    assert.ok(app.getStoredCustomCategories().includes('Fitness'));

    // 2. Add Task with category 'Fitness'
    const addCatSelect = document.getElementById('add-task-category');
    app.syncCustomCategoriesToDOM('Fitness');
    addCatSelect.value = 'Fitness';

    const addTitleInput = document.getElementById('add-title');
    const addDueDateInput = document.getElementById('add-due-date');
    const addTimeInput = document.getElementById('add-time');
    addTitleInput.value = 'Morning Jog';
    addDueDateInput.value = '2026-11-25';
    addTimeInput.value = '07:00';

    await app.handleAddTask({ preventDefault() {} });

    // 3. Verify in database
    const dbTask = db_todos.find(r => r.title === 'Morning Jog');
    assert.ok(dbTask, 'Task must exist in DB');
    assert.strictEqual(dbTask.category, 'Fitness', 'Generic category Fitness must be persisted in DB');

    // 4. Calendar verification
    const workload = app.TasklyWorkloadEngine.getWorkloadCategory('2026-11-25', app.state.todos);
    assert.strictEqual(workload.key, 'custom');
    assert.strictEqual(workload.hex.toUpperCase(), '#FACC15');

    // 5. Delete category 'Fitness' -> tasks reassigned to Personal
    app.deleteCustomCategory('Fitness');
    assert.strictEqual(app.state.todos.find(t => t.id === dbTask.id).category, 'Personal');
    assert.strictEqual(db_todos.find(r => r.id === dbTask.id).category, 'Personal');
  });
});
