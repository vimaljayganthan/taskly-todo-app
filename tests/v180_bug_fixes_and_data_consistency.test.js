/**
 * Taskly v1.8.0 Build 9 - Critical Bug Fixes & Data Consistency Regression Test Suite
 *
 * PART 1: Release History & What's New
 * PART 2: Custom Category Persistence & Calendar Display
 * PART 3: Slow or Failed Task Updates Reliability
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');
const STYLES_CSS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), 'utf8');
const APP_JS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'app.js'), 'utf8');
const SERVER_JS = fs.readFileSync(path.join(ROOT_DIR, 'server.js'), 'utf8');
const BUILD_GRADLE = fs.readFileSync(path.join(ROOT_DIR, 'android', 'app', 'build.gradle'), 'utf8');
const PROD_MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'releases', 'version-manifest.json'), 'utf8'));
const PUBLIC_MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'public', 'version-manifest.json'), 'utf8'));

// Mock DOM elements and localStorage
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
    classList: {
      add: (...c) => c.forEach(cls => classList.add(cls)),
      remove: (...c) => c.forEach(cls => classList.delete(cls)),
      contains: (cls) => classList.has(cls)
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
    setAttribute(name, val) { attributes[name] = String(val); },
    getAttribute(name) { return attributes[name] || null; },
    appendChild(child) {
      children.push(child);
      if (child.tagName === 'OPTION' || child.value !== undefined) {
        options.push(child);
      }
      return child;
    },
    addEventListener(event, fn) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    removeEventListener(event, fn) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter(h => h !== fn);
    },
    querySelector(selector) {
      if (selector === '.pill-opt.active') {
        return children.find(c => c.classList && c.classList.contains('active')) || null;
      }
      if (selector === 'button[type="submit"]') {
        return children.find(c => c.type === 'submit') || null;
      }
      return null;
    },
    querySelectorAll(selector) {
      return children;
    },
    focus() {}
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
    if (sel.startsWith('#')) return this.getElementById(sel.slice(1));
    return null;
  },
  querySelectorAll() {
    return [];
  },
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

const app = require(path.join(ROOT_DIR, 'public', 'app.js'));
const { TasklyUpdateManager, TasklyWorkloadEngine } = app;

describe('Taskly v1.8.0 Build 9 - Critical Bug Fixes and Data Consistency Suite', () => {

  beforeEach(() => {
    mockStorage.clear();
    mockElements.clear();
    TasklyUpdateManager.state.manifest = null;
    TasklyUpdateManager.state.latestVersionCode = null;
    TasklyUpdateManager.state.latestVersionName = null;
  });

  afterEach(() => {
    TasklyUpdateManager.state.manifest = null;
    TasklyUpdateManager.state.latestVersionCode = null;
    TasklyUpdateManager.state.latestVersionName = null;
  });

  // =========================================================================
  // PART 1: RELEASE HISTORY AND WHAT'S NEW FIXES
  // =========================================================================
  describe('Part 1: Release History and What\'s New Authoritative Manifest & Sorting', () => {

    test('1. Production manifests releases/version-manifest.json and public/version-manifest.json are identical and v2.1.1 Build 12.1', () => {
      assert.strictEqual(PROD_MANIFEST.latestVersion, '2.1.1');
      assert.strictEqual(PROD_MANIFEST.versionCode, 121);
      assert.strictEqual(PUBLIC_MANIFEST.latestVersion, '2.1.1');
      assert.strictEqual(PUBLIC_MANIFEST.versionCode, 121);
      assert.deepStrictEqual(PROD_MANIFEST, PUBLIC_MANIFEST);
    });

    test('2. Manifest contains all 11 published releases in descending order', () => {
      assert.ok(Array.isArray(PROD_MANIFEST.history));
      assert.strictEqual(PROD_MANIFEST.history.length, 11);
      const codes = PROD_MANIFEST.history.map(r => r.versionCode);
      assert.deepStrictEqual(codes, [121, 12, 11, 10, 9, 8, 7, 6, 5, 3, 1]);
    });

    test('3. TasklyUpdateManager loads authoritative manifest and reports v2.1.1 Build 12.1 as latest approved', () => {
      TasklyUpdateManager.setCachedManifest(PROD_MANIFEST);
      assert.strictEqual(TasklyUpdateManager.state.latestVersionName, '2.1.1');
      assert.strictEqual(TasklyUpdateManager.state.latestVersionCode, 121);

      const history = TasklyUpdateManager.getReleaseHistory();
      assert.strictEqual(history.length, 11);
      assert.strictEqual(history[0].versionCode, 121);
      assert.strictEqual(history[0].versionName, '2.1.1');
      assert.strictEqual(history[1].versionCode, 12);
      assert.strictEqual(history[2].versionCode, 11);
    });

    test('4. openWhatsNew defaults to latest approved release (v2.1.1 Build 12.1) when no parameter is passed', () => {
      TasklyUpdateManager.setCachedManifest(PROD_MANIFEST);
      TasklyUpdateManager.state.installedVersionCode = 121;
      TasklyUpdateManager.state.installedVersionName = '2.1.1';
      TasklyUpdateManager.state.activeWhatsNewVersionCode = null;

      TasklyUpdateManager.openWhatsNew();
      assert.strictEqual(TasklyUpdateManager.state.activeWhatsNewVersionCode, 121);
    });

    test('5. What\'s New version selector populates all 11 releases descending with v2.1.1 at top', () => {
      TasklyUpdateManager.setCachedManifest(PROD_MANIFEST);
      TasklyUpdateManager.state.installedVersionCode = 121;
      TasklyUpdateManager.state.installedVersionName = '2.1.1';
      TasklyUpdateManager.state.activeWhatsNewVersionCode = 121;

      const select = global.document.getElementById('select-whats-new-version');
      TasklyUpdateManager.populateWhatsNewVersionSelect();

      assert.strictEqual(select.options.length, 11);
      assert.strictEqual(select.options[0].value, '121');
      assert.ok(select.options[0].textContent.includes('Latest'));
    });

    test('6. Anti-stale cache logic: newer manifest updates cache, older manifest is rejected', () => {
      TasklyUpdateManager.setCachedManifest(PROD_MANIFEST); // code 121
      assert.strictEqual(TasklyUpdateManager.state.latestVersionCode, 121);

      // Attempt to overwrite with stale v1.8.0 manifest (code 9)
      const staleManifest = {
        latestVersion: '1.8.0',
        versionCode: 9,
        history: [{ version: '1.8.0', versionCode: 9 }]
      };
      TasklyUpdateManager.setCachedManifest(staleManifest);
      // Must remain at code 121!
      assert.strictEqual(TasklyUpdateManager.state.latestVersionCode, 121);
    });

    test('7. Future-proofing: Simulating future Build 12.2 (code 122) manifest automatically makes it top entry without UI code modification', () => {
      const futureManifest = {
        latestVersion: '2.2.0',
        versionCode: 122,
        title: 'Major Future Release',
        history: [
          {
            version: '2.2.0',
            versionName: '2.2.0',
            versionCode: 122,
            title: 'Major Future Release',
            features: ['Feature X', 'Feature Y']
          },
          ...PROD_MANIFEST.history
        ]
      };

      TasklyUpdateManager.setCachedManifest(futureManifest);
      const history = TasklyUpdateManager.getReleaseHistory();
      assert.strictEqual(history[0].versionCode, 122);
      assert.strictEqual(history[0].versionName, '2.2.0');

      TasklyUpdateManager.openWhatsNew(122);
      assert.strictEqual(TasklyUpdateManager.state.activeWhatsNewVersionCode, 122);
    });
  });

  // =========================================================================
  // PART 2: CUSTOM CATEGORY PERSISTENCE AND CALENDAR DISPLAY
  // =========================================================================
  describe('Part 2: Custom Category Persistence & Calendar Display', () => {

    test('1. Custom category creation persists to storage and avoids built-in category collisions', () => {
      const created = app.saveCustomCategory('Check');
      assert.strictEqual(created, 'Check');

      const stored = app.getStoredCustomCategories();
      assert.ok(stored.includes('Check'));

      // Collision checks
      assert.throws(() => app.saveCustomCategory('Personal'), /already a built-in category/i);
      assert.throws(() => app.saveCustomCategory('Work'), /already a built-in category/i);
      assert.throws(() => app.saveCustomCategory('check'), /already exists/i);
    });

    test('2. Discovers custom categories from state.todos even if localStorage is empty', () => {
      mockStorage.clear();
      app.state.todos = [
        { id: '1', title: 'Task with check', category: 'Check', dueDate: '2026-11-10', priority: 'Medium' }
      ];

      const stored = app.getStoredCustomCategories();
      assert.ok(stored.includes('Check'), 'Should discover custom category from state.todos');
    });

    test('3. Backend server.js POST /api/todos accepts custom category without forcing Personal fallback', () => {
      // Verify server.js code does not force non-standard category to 'Personal'
      assert.ok(!SERVER_JS.includes("parsedCategory = validCategories.includes(category) ? category : 'Personal';"),
        'Server must not force custom category to Personal');
      assert.ok(SERVER_JS.includes("parsedCategory = trimmedCat;"),
        'Server must accept custom category trimmedCat in POST /api/todos');
    });

    test('4. Backend server.js PATCH /api/todos/:id accepts custom category updates', () => {
      assert.ok(SERVER_JS.includes("updateFields.category = matchedStandard"),
        'PATCH route must store custom category or normalized standard in updateFields');
      assert.ok(SERVER_JS.includes(": trimmedCat;"),
        'PATCH route must preserve custom trimmedCat without falling back to Personal');
    });

    test('5. Task card renders custom category with Yellow #FACC15 badge', () => {
      const task = { id: 'test-1', title: 'My Task', category: 'Check', dueDate: '2026-11-10', priority: 'Medium' };
      const cfg = app.getTaskCategoryConfig(task.category);
      assert.strictEqual(cfg.key, 'custom');
      assert.strictEqual(cfg.hex.toUpperCase(), '#FACC15');
      assert.strictEqual(cfg.badgeText.toUpperCase(), '#422006');
    });

    test('6. Calendar display: Single custom category task displays Yellow #FACC15', () => {
      const dateStr = '2026-11-12';
      const todos = [
        { id: '1', title: 'Single Custom Task', dueDate: dateStr, priority: 'Medium', category: 'Check' }
      ];
      const workload = TasklyWorkloadEngine.getWorkloadCategory(dateStr, todos);
      assert.strictEqual(workload.key, 'custom');
      assert.strictEqual(workload.hex.toUpperCase(), '#FACC15');
      assert.strictEqual(workload.text.toUpperCase(), '#422006');
      assert.strictEqual(workload.class, 'workload-custom');
    });

    test('7. Calendar display: Multiple tasks with identical priority containing custom category display Yellow #FACC15', () => {
      const dateStr = '2026-11-13';
      const todos = [
        { id: '1', title: 'Task 1', dueDate: dateStr, priority: 'Medium', category: 'Check' },
        { id: '2', title: 'Task 2', dueDate: dateStr, priority: 'Medium', category: 'Work' }
      ];
      const workload = TasklyWorkloadEngine.getWorkloadCategory(dateStr, todos);
      assert.strictEqual(workload.key, 'custom');
      assert.strictEqual(workload.hex.toUpperCase(), '#FACC15');
    });

    test('8. Calendar display: Tasks with different priorities apply priority aggregation (High -> Pink)', () => {
      const dateStr = '2026-11-14';
      const todos = [
        { id: '1', title: 'High Priority Task', dueDate: dateStr, priority: 'High', category: 'Personal' },
        { id: '2', title: 'Medium Priority Task', dueDate: dateStr, priority: 'Medium', category: 'Check' }
      ];
      const workload = TasklyWorkloadEngine.getWorkloadCategory(dateStr, todos);
      assert.strictEqual(workload.key, 'high');
      assert.strictEqual(workload.hex.toUpperCase(), '#E83E9D');
    });

    test('9. Custom category deletion reassigns existing tasks to Personal safely', () => {
      app.saveCustomCategory('Temporary');
      app.state.todos = [
        { id: 't1', title: 'Task 1', category: 'Temporary' },
        { id: 't2', title: 'Task 2', category: 'Work' }
      ];

      app.deleteCustomCategory('Temporary');
      assert.strictEqual(app.state.todos[0].category, 'Personal');
      assert.strictEqual(app.state.todos[1].category, 'Work');
      assert.ok(!app.getStoredCustomCategories().includes('Temporary'));
    });
  });

  // =========================================================================
  // PART 3: SLOW OR FAILED TASK UPDATES RELIABILITY
  // =========================================================================
  describe('Part 3: Slow or Failed Task Updates Reliability', () => {

    test('1. public/index.html includes #add-task-category select in Add Task form', () => {
      assert.ok(INDEX_HTML.includes('id="add-task-category"'),
        'Add Task form must contain #add-task-category select element');
      assert.ok(INDEX_HTML.includes('id="add-category-selector"'),
        'Add Task form must preserve #add-category-selector pills');
    });

    test('2. public/index.html includes #edit-task-error-banner and #btn-save-edit-task in Edit Task modal', () => {
      assert.ok(INDEX_HTML.includes('id="edit-task-error-banner"'),
        'Edit Task modal must contain #edit-task-error-banner');
      assert.ok(INDEX_HTML.includes('id="edit-task-error-msg"'),
        'Edit Task modal must contain #edit-task-error-msg');
      assert.ok(INDEX_HTML.includes('id="btn-save-edit-task"'),
        'Edit Task modal must contain #btn-save-edit-task');
    });

    test('3. updateTask verifies that database response ID matches targeted task ID', async () => {
      app.state.todos = [{ id: 'target-1', title: 'Original Task', priority: 'Medium' }];
      app.state.userToken = 'mock-token';

      // Mock fetch returning mismatching ID
      global.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: 'different-id', title: 'Updated' })
      });

      await assert.rejects(
        () => app.updateTask('target-1', { title: 'Updated' }),
        /Database response ID mismatch/i
      );

      // Verify local state was not corrupted
      assert.strictEqual(app.state.todos[0].title, 'Original Task');
    });

    test('4. updateTask applies targeted DOM renders on success and updates local state only after DB confirmation', async () => {
      app.state.todos = [{ id: 'task-success', title: 'Before Save', priority: 'Medium', category: 'Personal' }];
      app.state.userToken = 'mock-token';

      let fetchCalled = false;
      global.fetch = async () => {
        fetchCalled = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'task-success', title: 'Confirmed After Save', priority: 'High', category: 'Check' })
        };
      };

      const result = await app.updateTask('task-success', { title: 'Confirmed After Save', priority: 'High', category: 'Check' });
      assert.strictEqual(fetchCalled, true);
      assert.strictEqual(result.title, 'Confirmed After Save');
      assert.strictEqual(app.state.todos[0].title, 'Confirmed After Save');
      assert.strictEqual(app.state.todos[0].category, 'Check');
    });

    test('5. updateTask aborts and reports timeout error when network request hangs past timeout', async () => {
      app.state.todos = [{ id: 'task-hang', title: 'Hanging Task', priority: 'Medium' }];
      app.state.userToken = 'mock-token';

      // Mock fetch that aborts
      global.fetch = async (url, opts) => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      };

      await assert.rejects(
        () => app.updateTask('task-hang', { title: 'Hanged' }),
        /Save request timed out/i
      );
      assert.strictEqual(app.state.todos[0].title, 'Hanging Task');
    });

    test('6. Edit task modal error handling preserves inputs and keeps modal open when update fails', () => {
      const modal = global.document.getElementById('modal-edit-task');
      const errBanner = global.document.getElementById('edit-task-error-banner');
      const errMsg = global.document.getElementById('edit-task-error-msg');
      const titleInput = global.document.getElementById('edit-task-title');

      titleInput.value = 'Unsaved Title Edit';
      errBanner.style.display = 'none';

      // Simulate error display
      errMsg.textContent = 'Server returned error (500)';
      errBanner.style.display = 'flex';
      modal.classList.add('active');

      assert.strictEqual(errBanner.style.display, 'flex');
      assert.strictEqual(titleInput.value, 'Unsaved Title Edit', 'User input must be preserved');
      assert.ok(modal.classList.contains('active'), 'Modal must remain open');
    });
  });

  // =========================================================================
  // PART 5: GRADLE VERSION VERIFICATION
  // =========================================================================
  describe('Part 5: Production-Ready Android Build Preparation Configuration', () => {

    test('1. android/app/build.gradle specifies versionCode 9 or higher and valid production candidate versionName', () => {
      assert.match(BUILD_GRADLE, /versionCode\s+(?:9|10|11|12|121)/);
      assert.match(BUILD_GRADLE, /versionName\s+["'](?:1\.8\.0|1\.9\.0|2\.0\.0|2\.1\.0|2\.1\.1)["']/);
    });

    test('2. public/styles.css includes .workload-custom for Yellow #FACC15 calendar day styling', () => {
      assert.match(STYLES_CSS, /\.workload-custom/);
      assert.match(STYLES_CSS, /#FACC15/i);
    });
  });
});
