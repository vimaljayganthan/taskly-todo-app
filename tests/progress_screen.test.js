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

describe('Taskly Progress Screen & Dynamic Analytics Suite', () => {
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
      location: { origin: 'http://localhost:3000', pathname: '/', hash: '#progress' },
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    clientApp = require('../public/app.js');
    clientApp.state.todos = [];
    clientApp.state.analyticsTimeframe = 'week';
  });

  afterEach(() => {
    delete global.document;
    delete global.window;
  });

  // --------------------------------------------------------------------------
  // 1. Weekly Overview (Completed & Pending Tasks per Day)
  // --------------------------------------------------------------------------
  describe('1. Weekly Overview Requirements', () => {
    test('public/index.html includes dynamic weekly streak row container', () => {
      assert.match(indexHtml, /id="streak-7days-row"/, 'streak-7days-row ID must be present in index.html');
      assert.match(indexHtml, /id="streak-days-display"/, 'streak-days-display must be present');
      assert.match(indexHtml, /id="streak-current-stat"/, 'streak-current-stat must be present');
      assert.match(indexHtml, /id="streak-best-stat"/, 'streak-best-stat must be present');
    });

    test('getWeeklyOverview correctly groups tasks into Mon-Sun with completed & pending counts', () => {
      // Create a reference Wednesday: 2026-11-04
      const refDate = new Date(2026, 10, 4); // Nov 4, 2026 is Wed
      const sampleTodos = [
        { id: '1', title: 'Mon Task 1', dueDate: '2026-11-02', completed: true },
        { id: '2', title: 'Mon Task 2', dueDate: '2026-11-02', completed: false },
        { id: '3', title: 'Wed Task', dueDate: '2026-11-04', completed: true },
        { id: '4', title: 'Fri Task', dueDate: '2026-11-06', completed: false },
        { id: '5', title: 'Next Week Task', dueDate: '2026-11-12', completed: true }
      ];

      const overview = clientApp.getWeeklyOverview(sampleTodos, refDate);
      assert.strictEqual(overview.length, 7, 'Must return 7 days (Mon-Sun)');
      assert.strictEqual(overview[0].label, 'Mon');
      assert.strictEqual(overview[0].dateStr, '2026-11-02');
      assert.strictEqual(overview[0].completed, 1);
      assert.strictEqual(overview[0].pending, 1);
      assert.strictEqual(overview[0].isDone, true);

      // Tuesday (empty)
      assert.strictEqual(overview[1].label, 'Tue');
      assert.strictEqual(overview[1].completed, 0);
      assert.strictEqual(overview[1].pending, 0);
      assert.strictEqual(overview[1].isDone, false);

      // Wednesday
      assert.strictEqual(overview[2].label, 'Wed');
      assert.strictEqual(overview[2].completed, 1);
      assert.strictEqual(overview[2].pending, 0);
      assert.strictEqual(overview[2].isDone, true);

      // Friday
      assert.strictEqual(overview[4].label, 'Fri');
      assert.strictEqual(overview[4].completed, 0);
      assert.strictEqual(overview[4].pending, 1);
      assert.strictEqual(overview[4].isDone, false);

      // Sunday
      assert.strictEqual(overview[6].label, 'Sun');
      assert.strictEqual(overview[6].dateStr, '2026-11-08');
    });
  });

  // --------------------------------------------------------------------------
  // 2. Dynamic Streak Calculation (Real Completion History)
  // --------------------------------------------------------------------------
  describe('2. Dynamic Streak Calculation Requirements', () => {
    test('calculateStreaks handles empty task array with zero streak', () => {
      const { currentStreak, bestStreak } = clientApp.calculateStreaks([]);
      assert.strictEqual(currentStreak, 0);
      assert.strictEqual(bestStreak, 0);
    });

    test('calculateStreaks handles tasks with no completed items', () => {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const todos = [
        { id: '1', title: 'Pending Task', dueDate: todayStr, completed: false }
      ];
      const { currentStreak, bestStreak } = clientApp.calculateStreaks(todos);
      assert.strictEqual(currentStreak, 0);
      assert.strictEqual(bestStreak, 0);
    });

    test('calculateStreaks detects active streak when task is completed today', () => {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

      const todos = [
        { id: '1', title: 'Yesterday Task', dueDate: yesterdayStr, completed: true },
        { id: '2', title: 'Today Task', dueDate: todayStr, completed: true }
      ];

      const { currentStreak, bestStreak } = clientApp.calculateStreaks(todos);
      assert.strictEqual(currentStreak, 2, 'Should have 2 days active streak');
      assert.strictEqual(bestStreak, 2, 'Best streak should be 2');
    });

    test('calculateStreaks preserves streak if completed yesterday but not yet completed today', () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

      const dayBefore = new Date(today);
      dayBefore.setDate(today.getDate() - 2);
      const dayBeforeStr = `${dayBefore.getFullYear()}-${String(dayBefore.getMonth() + 1).padStart(2, '0')}-${String(dayBefore.getDate()).padStart(2, '0')}`;

      const todos = [
        { id: '1', title: 'Day Before Task', dueDate: dayBeforeStr, completed: true },
        { id: '2', title: 'Yesterday Task', dueDate: yesterdayStr, completed: true }
      ];

      const { currentStreak, bestStreak } = clientApp.calculateStreaks(todos);
      assert.strictEqual(currentStreak, 2, 'Streak is still alive waiting for today');
      assert.strictEqual(bestStreak, 2);
    });

    test('calculateStreaks calculates all-time best streak across past historical gaps', () => {
      // Historical 4-day streak in the past: 2026-05-01 to 2026-05-04
      // Then a gap
      // Then a 1-day task today
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      const todos = [
        { id: '1', dueDate: '2026-05-01', completed: true },
        { id: '2', dueDate: '2026-05-02', completed: true },
        { id: '3', dueDate: '2026-05-03', completed: true },
        { id: '4', dueDate: '2026-05-04', completed: true },
        { id: '5', dueDate: todayStr, completed: true }
      ];

      const { currentStreak, bestStreak } = clientApp.calculateStreaks(todos);
      assert.strictEqual(currentStreak, 1, 'Current streak is 1 for today');
      assert.strictEqual(bestStreak, 4, 'Best historical streak is 4');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Overall Productivity Statistics
  // --------------------------------------------------------------------------
  describe('3. Overall Productivity Statistics Requirements', () => {
    test('renderAnalytics updates progress ring, completion percentage, and summary', () => {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      clientApp.state.analyticsTimeframe = 'all';
      clientApp.state.todos = [
        { id: '1', title: 'Task 1', dueDate: todayStr, completed: true, category: 'Project' },
        { id: '2', title: 'Task 2', dueDate: todayStr, completed: true, category: 'Work' },
        { id: '3', title: 'Task 3', dueDate: todayStr, completed: false, category: 'Personal' },
        { id: '4', title: 'Task 4', dueDate: todayStr, completed: false, category: 'Study' }
      ];

      clientApp.renderAnalytics();

      const percentEl = elements['analytics-percent'];
      const summaryEl = elements['analytics-tasks-summary'];
      const ringFill = elements['analytics-ring-fill'];
      const compVal = elements['overview-completed-val'];
      const pendVal = elements['overview-pending-val'];

      assert.strictEqual(percentEl.textContent, '50%');
      assert.strictEqual(summaryEl.textContent, '2 of 4 tasks completed');
      assert.strictEqual(compVal.textContent, 2);
      assert.strictEqual(pendVal.textContent, 2);
      assert.strictEqual(ringFill.style.strokeDashoffset, 251.2 * 0.5);
    });

    test('filterTodosByTimeframe properly filters by week, month, and all', () => {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      
      const futureDate = new Date(today);
      futureDate.setDate(today.getDate() + 45); // Different month & week
      const futureDateStr = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;

      const todos = [
        { id: '1', dueDate: todayStr, completed: true },
        { id: '2', dueDate: futureDateStr, completed: false }
      ];

      const weekFiltered = clientApp.filterTodosByTimeframe(todos, 'week');
      assert.strictEqual(weekFiltered.length, 1);
      assert.strictEqual(weekFiltered[0].id, '1');

      const allFiltered = clientApp.filterTodosByTimeframe(todos, 'all');
      assert.strictEqual(allFiltered.length, 2);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Category-Wise Task Completion Breakdown
  // --------------------------------------------------------------------------
  describe('4. Category-Wise Breakdown Requirements', () => {
    test('public/index.html includes category breakdown container', () => {
      assert.match(indexHtml, /id="progress-category-list"/, 'progress-category-list ID must be present in index.html');
      assert.match(indexHtml, /id="radar-polygon"/, 'radar-polygon ID must be present for dynamic radar chart');
    });

    test('getCategoryBreakdown computes statistics for Project, Work, Study, and Personal', () => {
      const sampleTodos = [
        { id: '1', category: 'Project', completed: true },
        { id: '2', category: 'Project', completed: false },
        { id: '3', category: 'Work', completed: true },
        { id: '4', category: 'Work', completed: true },
        { id: '5', category: 'Study', completed: false },
        { id: '6', category: 'Personal', completed: true }
      ];

      const breakdown = clientApp.getCategoryBreakdown(sampleTodos);
      const proj = breakdown.find(c => c.category === 'Project');
      const work = breakdown.find(c => c.category === 'Work');
      const study = breakdown.find(c => c.category === 'Study');
      const pers = breakdown.find(c => c.category === 'Personal');

      assert.strictEqual(proj.total, 2);
      assert.strictEqual(proj.completed, 1);
      assert.strictEqual(proj.percent, 50);

      assert.strictEqual(work.total, 2);
      assert.strictEqual(work.completed, 2);
      assert.strictEqual(work.percent, 100);

      assert.strictEqual(study.total, 1);
      assert.strictEqual(study.completed, 0);
      assert.strictEqual(study.percent, 0);

      assert.strictEqual(pers.total, 1);
      assert.strictEqual(pers.completed, 1);
      assert.strictEqual(pers.percent, 100);
    });

    test('renderAnalytics renders learning-item-card elements for active categories', () => {
      clientApp.state.analyticsTimeframe = 'all';
      clientApp.state.todos = [
        { id: '1', category: 'Project', completed: true, title: 'Codebase' },
        { id: '2', category: 'Work', completed: false, title: 'Sprint Review' }
      ];

      clientApp.renderAnalytics();
      const catListEl = elements['progress-category-list'];
      assert.match(catListEl.innerHTML, /learning-item-card/, 'Should render category cards');
      assert.match(catListEl.innerHTML, /Project/, 'Should show Project category');
      assert.match(catListEl.innerHTML, /Work/, 'Should show Work category');
    });
  });

  // --------------------------------------------------------------------------
  // 5. Dynamic Radar Chart & Real-Time Auto-Updating
  // --------------------------------------------------------------------------
  describe('5. Progress Charts Dynamic Updates & Radar Geometry', () => {
    test('calculateRadarPoints generates 6 valid polygon vertices within bounds', () => {
      const breakdown = [
        { category: 'Project', percent: 80 },
        { category: 'Work', percent: 60 },
        { category: 'Study', percent: 40 },
        { category: 'Personal', percent: 100 }
      ];

      const pts = clientApp.calculateRadarPoints(70, breakdown, 90);
      assert.strictEqual(pts.length, 6, 'Radar chart must have exactly 6 vertices');

      pts.forEach((pt, i) => {
        assert.ok(typeof pt.x === 'number' && !isNaN(pt.x), `Vertex ${i} x must be a number`);
        assert.ok(typeof pt.y === 'number' && !isNaN(pt.y), `Vertex ${i} y must be a number`);
        assert.ok(pt.x >= 90 && pt.x <= 250, `Vertex ${i} x=${pt.x} must be within chart bounds [90, 250]`);
        assert.ok(pt.y >= 40 && pt.y <= 200, `Vertex ${i} y=${pt.y} must be within chart bounds [40, 200]`);
      });
    });

    test('getProductivityLast7Days populates dynamic bars', () => {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      clientApp.state.todos = [
        { id: '1', dueDate: todayStr, completed: true }
      ];

      clientApp.renderAnalytics();
      const barContainer = elements['barchart-bars'];
      assert.match(barContainer.innerHTML, /bar-col/, 'Must render bar-col elements');
      assert.match(barContainer.innerHTML, /bar-fill/, 'Must render bar-fill elements');
    });
  });

  // --------------------------------------------------------------------------
  // 6. Proper Empty States When Insufficient Task History
  // --------------------------------------------------------------------------
  describe('6. Empty States Handling Requirements', () => {
    test('renderAnalytics renders clean empty states when state.todos is empty', () => {
      clientApp.state.todos = [];
      clientApp.renderAnalytics();

      const streakDaysEl = elements['streak-days-display'];
      const summaryEl = elements['analytics-tasks-summary'];
      const percentEl = elements['analytics-percent'];
      const catListEl = elements['progress-category-list'];

      assert.strictEqual(streakDaysEl.textContent, '0 days', 'Streak should display 0 days on empty state');
      assert.strictEqual(percentEl.textContent, '0%', 'Percent should display 0% on empty state');
      assert.match(summaryEl.textContent, /No tasks/, 'Summary should display empty state message');
      assert.match(catListEl.innerHTML, /progress-empty-state/, 'Category list should render empty state container');
    });
  });
});
