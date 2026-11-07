/**
 * Taskly - Dynamic Calendar Priority Workload & Task Category Colors Suite
 *
 * Verifies:
 * 1. Dynamic Task Priority Workload Colours:
 *    - High priority: Pink (#E83E9D)
 *    - Medium priority: Green (#83DF64)
 *    - Low priority: Cyan (#83DDE8)
 *    - All assigned tasks have the same priority: Grey (#EEEEEE)
 *    - Empty dates (0 tasks): Neutral empty-date appearance (no workload background)
 * 2. Combinatorial Priority Calculations:
 *    - High + Medium -> Pink (#E83E9D)
 *    - High + Low -> Pink (#E83E9D)
 *    - Medium + Low -> Green (#83DF64)
 *    - High + Medium + Low -> Pink (#E83E9D)
 *    - High + High -> Grey (#EEEEEE)
 *    - Medium + Medium -> Grey (#EEEEEE)
 *    - Low + Low -> Grey (#EEEEEE)
 * 3. Dynamic recalculation on task add, edit, priority change, complete toggle, and delete
 * 4. Independent Task Category Colours:
 *    - Project: Pink (#E83E9D)
 *    - Work: Green (#83DF64)
 *    - Study: Cyan (#83DDE8)
 *    - Personal: Grey (#EEEEEE)
 *    - Custom: Yellow (#FACC15)
 * 5. Multiple categories on the same date with independent category colors
 * 6. Legend displays: Pink – High, Green – Medium, Cyan – Low, Grey – Equal Priority
 * 7. Selected date retains workload background with orange border indicator (#F88438)
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');
const STYLES_CSS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), 'utf8');
const APP_JS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'app.js'), 'utf8');
const app = require(path.join(ROOT_DIR, 'public', 'app.js'));

describe('Taskly Dynamic Calendar Priority Workload & Category Color Suite', () => {

  describe('1. Task Priority Workload Engine & Priority Intelligence', () => {
    test('public/app.js defines TasklyWorkloadEngine with approved priority color mappings', () => {
      assert.match(APP_JS, /const\s+TasklyWorkloadEngine\s*=\s*\{/, 'Expected TasklyWorkloadEngine object in app.js');
      assert.match(APP_JS, /high:\s*\{[^}]*hex:\s*'#E83E9D'/i, 'Expected High Pink hex #E83E9D');
      assert.match(APP_JS, /medium:\s*\{[^}]*hex:\s*'#83DF64'/i, 'Expected Medium Green hex #83DF64');
      assert.match(APP_JS, /low:\s*\{[^}]*hex:\s*'#83DDE8'/i, 'Expected Low Cyan hex #83DDE8');
      assert.match(APP_JS, /equal:\s*\{[^}]*hex:\s*'#EEEEEE'/i, 'Expected Equal Priority Grey hex #EEEEEE');
    });

    test('Engine accurately calculates date cell color according to task priority intelligence table', () => {
      const engine = app.TasklyWorkloadEngine;
      assert.ok(engine, 'TasklyWorkloadEngine must be exported');

      const dHighMed = '2026-11-01';
      const dHighLow = '2026-11-02';
      const dMedLow = '2026-11-03';
      const dAllThree = '2026-11-04';
      const dHighHigh = '2026-11-05';
      const dMedMed = '2026-11-06';
      const dLowLow = '2026-11-07';
      const dEmpty = '2026-11-08';
      const dSingleHigh = '2026-11-09';
      const dSingleMed = '2026-11-10';
      const dSingleLow = '2026-11-11';

      const mockTodos = [
        // High + Medium -> Pink (#E83E9D)
        { id: 1, dueDate: dHighMed, priority: 'High', title: 'H1' },
        { id: 2, dueDate: dHighMed, priority: 'Medium', title: 'M1' },

        // High + Low -> Pink (#E83E9D)
        { id: 3, dueDate: dHighLow, priority: 'High', title: 'H2' },
        { id: 4, dueDate: dHighLow, priority: 'Low', title: 'L1' },

        // Medium + Low -> Green (#83DF64)
        { id: 5, dueDate: dMedLow, priority: 'Medium', title: 'M2' },
        { id: 6, dueDate: dMedLow, priority: 'Low', title: 'L2' },

        // High + Medium + Low -> Pink (#E83E9D)
        { id: 7, dueDate: dAllThree, priority: 'High', title: 'H3' },
        { id: 8, dueDate: dAllThree, priority: 'Medium', title: 'M3' },
        { id: 9, dueDate: dAllThree, priority: 'Low', title: 'L3' },

        // High + High -> Grey (#EEEEEE)
        { id: 10, dueDate: dHighHigh, priority: 'High', title: 'H4' },
        { id: 11, dueDate: dHighHigh, priority: 'High', title: 'H5' },

        // Medium + Medium -> Grey (#EEEEEE)
        { id: 12, dueDate: dMedMed, priority: 'Medium', title: 'M4' },
        { id: 13, dueDate: dMedMed, priority: 'Medium', title: 'M5' },

        // Low + Low -> Grey (#EEEEEE)
        { id: 14, dueDate: dLowLow, priority: 'Low', title: 'L4' },
        { id: 15, dueDate: dLowLow, priority: 'Low', title: 'L5' },

        // Single High -> Pink (#E83E9D)
        { id: 16, dueDate: dSingleHigh, priority: 'High', title: 'H6' },

        // Single Medium -> Green (#83DF64)
        { id: 17, dueDate: dSingleMed, priority: 'Medium', title: 'M6' },

        // Single Low -> Cyan (#83DDE8)
        { id: 18, dueDate: dSingleLow, priority: 'Low', title: 'L6' }
      ];

      // Verifications matching prompt table:
      assert.equal(engine.getWorkloadCategory(dHighMed, mockTodos).hex.toUpperCase(), '#E83E9D', 'High + Medium -> Pink');
      assert.equal(engine.getWorkloadCategory(dHighLow, mockTodos).hex.toUpperCase(), '#E83E9D', 'High + Low -> Pink');
      assert.equal(engine.getWorkloadCategory(dMedLow, mockTodos).hex.toUpperCase(), '#83DF64', 'Medium + Low -> Green');
      assert.equal(engine.getWorkloadCategory(dAllThree, mockTodos).hex.toUpperCase(), '#E83E9D', 'High + Medium + Low -> Pink');
      assert.equal(engine.getWorkloadCategory(dHighHigh, mockTodos).hex.toUpperCase(), '#EEEEEE', 'High + High -> Grey');
      assert.equal(engine.getWorkloadCategory(dMedMed, mockTodos).hex.toUpperCase(), '#EEEEEE', 'Medium + Medium -> Grey');
      assert.equal(engine.getWorkloadCategory(dLowLow, mockTodos).hex.toUpperCase(), '#EEEEEE', 'Low + Low -> Grey');

      // Single tasks reflect their priority:
      assert.equal(engine.getWorkloadCategory(dSingleHigh, mockTodos).hex.toUpperCase(), '#E83E9D', 'Single High -> Pink');
      assert.equal(engine.getWorkloadCategory(dSingleMed, mockTodos).hex.toUpperCase(), '#83DF64', 'Single Medium -> Green');
      assert.equal(engine.getWorkloadCategory(dSingleLow, mockTodos).hex.toUpperCase(), '#83DDE8', 'Single Low -> Cyan');

      // Empty date (0 tasks) -> Neutral empty appearance
      const emptyRes = engine.getWorkloadCategory(dEmpty, mockTodos);
      assert.equal(emptyRes.key, 'empty', 'Empty date key should be empty');
      assert.equal(emptyRes.count, 0, 'Empty date count should be 0');
    });

    test('Editing priority, changing date, completing or deleting dynamically updates date cell color', () => {
      const engine = app.TasklyWorkloadEngine;
      const d1 = '2026-11-20';
      const d2 = '2026-11-21';

      let todos = [
        { id: 't1', dueDate: d1, priority: 'High', completed: false },
        { id: 't2', dueDate: d1, priority: 'Medium', completed: false }
      ];

      // Initially d1 has High + Medium -> Pink
      assert.equal(engine.getWorkloadCategory(d1, todos).hex.toUpperCase(), '#E83E9D');

      // Edit t1 priority to Medium -> Now d1 has Medium + Medium -> Grey
      todos[0].priority = 'Medium';
      assert.equal(engine.getWorkloadCategory(d1, todos).hex.toUpperCase(), '#EEEEEE');

      // Move t2 to d2 -> d1 now has only t1 (Medium) -> Green, d2 has t2 (Medium) -> Green
      todos[1].dueDate = d2;
      assert.equal(engine.getWorkloadCategory(d1, todos).hex.toUpperCase(), '#83DF64');
      assert.equal(engine.getWorkloadCategory(d2, todos).hex.toUpperCase(), '#83DF64');

      // Delete t1 -> d1 now has 0 tasks -> Empty neutral
      todos = [todos[1]];
      assert.equal(engine.getWorkloadCategory(d1, todos).key, 'empty');
      assert.equal(engine.getWorkloadCategory(d2, todos).hex.toUpperCase(), '#83DF64');
    });
  });

  describe('2. Independent Task Category Colours in Calendar & Forms', () => {
    test('public/app.js defines TaskCategoryColors including Yellow Custom category', () => {
      const cats = app.TaskCategoryColors;
      assert.ok(cats, 'TaskCategoryColors must be defined');

      assert.equal(cats.Project.hex.toUpperCase(), '#E83E9D', 'Project must be Pink #E83E9D');
      assert.equal(cats.Work.hex.toUpperCase(), '#83DF64', 'Work must be Green #83DF64');
      assert.equal(cats.Study.hex.toUpperCase(), '#83DDE8', 'Study must be Cyan #83DDE8');
      assert.equal(cats.Personal.hex.toUpperCase(), '#EEEEEE', 'Personal must be Grey #EEEEEE');
      assert.equal(cats.Custom.hex.toUpperCase(), '#FACC15', 'Custom must be Yellow #FACC15');
    });

    test('getTaskCategoryConfig correctly resolves category configs case-insensitively with Custom support', () => {
      const getConfig = app.getTaskCategoryConfig;
      assert.ok(typeof getConfig === 'function', 'getTaskCategoryConfig must be a function');

      assert.equal(getConfig('Project').hex.toUpperCase(), '#E83E9D');
      assert.equal(getConfig('project').hex.toUpperCase(), '#E83E9D');
      assert.equal(getConfig('Work').hex.toUpperCase(), '#83DF64');
      assert.equal(getConfig('Study').hex.toUpperCase(), '#83DDE8');
      assert.equal(getConfig('Personal').hex.toUpperCase(), '#EEEEEE');
      assert.equal(getConfig('Custom').hex.toUpperCase(), '#FACC15');
      assert.equal(getConfig('Fitness').hex.toUpperCase(), '#FACC15', 'Custom category names resolve to Yellow #FACC15');
      assert.equal(getConfig(null).hex.toUpperCase(), '#EEEEEE', 'Default fallback to Personal');
    });

    test('Calendar timeline task cards and badges apply category colors independently of workload', () => {
      assert.match(STYLES_CSS, /\.tl-card-cat-project/i, 'Expected .tl-card-cat-project');
      assert.match(STYLES_CSS, /\.tl-card-cat-work/i, 'Expected .tl-card-cat-work');
      assert.match(STYLES_CSS, /\.tl-card-cat-study/i, 'Expected .tl-card-cat-study');
      assert.match(STYLES_CSS, /\.tl-card-cat-personal/i, 'Expected .tl-card-cat-personal');
      assert.match(STYLES_CSS, /\.tl-card-cat-custom/i, 'Expected .tl-card-cat-custom');

      assert.match(STYLES_CSS, /\.cat-badge-project/i, 'Expected .cat-badge-project in styles.css');
      assert.match(STYLES_CSS, /\.cat-badge-work/i, 'Expected .cat-badge-work in styles.css');
      assert.match(STYLES_CSS, /\.cat-badge-study/i, 'Expected .cat-badge-study in styles.css');
      assert.match(STYLES_CSS, /\.cat-badge-personal/i, 'Expected .cat-badge-personal in styles.css');
      assert.match(STYLES_CSS, /\.cat-badge-custom/i, 'Expected .cat-badge-custom in styles.css');
    });

    test('A date with Pink workload can hold tasks with Yellow Custom or Green Work categories independently', () => {
      const dateStr = '2026-11-25';
      const engine = app.TasklyWorkloadEngine;
      const getConfig = app.getTaskCategoryConfig;

      const tasksOnDate = [
        { id: 't1', title: 'Critical Task', dueDate: dateStr, priority: 'High', category: 'Fitness', completed: false },
        { id: 't2', title: 'Secondary Task', dueDate: dateStr, priority: 'Medium', category: 'Work', completed: false }
      ];

      // Workload for the date cell is Pink (#E83E9D) because High + Medium
      const dateWorkload = engine.getWorkloadCategory(dateStr, tasksOnDate);
      assert.equal(dateWorkload.hex.toUpperCase(), '#E83E9D', 'Date workload must be Pink #E83E9D');

      // But individual category colors are completely independent
      assert.equal(getConfig(tasksOnDate[0].category).hex.toUpperCase(), '#FACC15', 'Fitness (Custom) must be Yellow #FACC15');
      assert.equal(getConfig(tasksOnDate[1].category).hex.toUpperCase(), '#83DF64', 'Work must be Green #83DF64');
    });
  });

  describe('3. Calendar Workload Legend & Date Highlighting', () => {
    test('public/index.html includes all four legend items: Pink High, Green Medium, Cyan Low, Grey Equal Priority', () => {
      assert.match(INDEX_HTML, /class="[^"]*calendar-heatmap-legend[^"]*"/, 'Expected .calendar-heatmap-legend in index.html');
      assert.match(INDEX_HTML, /Pink\s*–\s*High/i, 'Expected Pink - High in legend');
      assert.match(INDEX_HTML, /Green\s*–\s*Medium/i, 'Expected Green - Medium in legend');
      assert.match(INDEX_HTML, /Cyan\s*–\s*Low/i, 'Expected Cyan - Low in legend');
      assert.match(INDEX_HTML, /Grey\s*–\s*Equal\s*Priority/i, 'Expected Grey - Equal Priority in legend');
    });

    test('public/styles.css styles heatmap legend swatches matching approved 4-color palette', () => {
      assert.match(STYLES_CSS, /\.heatmap-swatch\.swatch-pink\s*\{[^}]*background-color:\s*#E83E9D/i, 'Pink swatch #E83E9D');
      assert.match(STYLES_CSS, /\.heatmap-swatch\.swatch-green\s*\{[^}]*background-color:\s*#83DF64/i, 'Green swatch #83DF64');
      assert.match(STYLES_CSS, /\.heatmap-swatch\.swatch-cyan\s*\{[^}]*background-color:\s*#83DDE8/i, 'Cyan swatch #83DDE8');
      assert.match(STYLES_CSS, /\.heatmap-swatch\.swatch-grey\s*\{[^}]*background-color:\s*#EEEEEE/i, 'Grey swatch #EEEEEE');
    });

    test('Selected date (.selected) uses orange outline without overriding cell workload colour', () => {
      assert.match(STYLES_CSS, /\.cal-day-cell\.selected\s*\{[^}]*outline:\s*2\.5px\s+solid\s+#F88438/i,
        'Expected outline: 2.5px solid #F88438 for selected date cell');
      assert.doesNotMatch(STYLES_CSS, /\.cal-day-cell\.selected\s*\{[^}]*background:\s*#F04455/i,
        '.selected cell must NOT override the cell background to solid red/pink');
    });
  });

});
