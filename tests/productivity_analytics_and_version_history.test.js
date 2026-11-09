/**
 * Taskly v2.0.0 Build 11 — Productivity Analytics & Version History Integration Test Suite
 *
 * Verifies:
 * 1. Task productivity metrics: daily/weekly/monthly tasks, overdue tasks, on-time rate, category insights.
 * 2. Habit streaks & 4-state routine analytics integration.
 * 3. Overall Productivity Score transparent formula, edge cases, and empty data handling.
 * 4. Version History: v2.0.0 Build 11 entry, preservation of all 8 previous releases.
 * 5. In-App Update Announcement System: modal presentation, "Install Now", "Later" dismissal persistence, and duplicate prevention.
 * 6. UI accessibility and 4-theme CSS declarations.
 */

const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const clientApp = require('../public/app.js');
const HabitStreakService = require('../services/habitStreakService');

const MANIFEST_JSON = JSON.parse(fs.readFileSync(path.join(__dirname, '../releases/version-manifest.json'), 'utf8'));

// Mock browser DOM environment if needed
function setupMockDOM() {
  const elements = {};

  const makeElement = (id, tag = 'div') => {
    const el = {
      id,
      tagName: tag.toUpperCase(),
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        contains(c) { return this.classes.has(c); },
        toggle(c) { if (this.contains(c)) this.remove(c); else this.add(c); }
      },
      style: {},
      attributes: {},
      children: [],
      setAttribute(k, v) { this.attributes[k] = v; },
      getAttribute(k) { return this.attributes[k] || null; },
      appendChild(child) { this.children.push(child); return child; },
      querySelectorAll() { return []; },
      querySelector() { return null; },
      addEventListener() {},
      innerHTML: '',
      textContent: '',
      value: ''
    };
    elements[id] = el;
    return el;
  };

  // Required progress screen elements
  [
    'tab-progress', 'section-productivity-overview', 'productivity-score-card',
    'analytics-ring-fill', 'analytics-percent', 'analytics-hero-tier', 'analytics-tasks-summary',
    'analytics-trend-badge', 'analytics-score-formula-note',
    'section-task-analytics', 'overview-completed-val', 'overview-pending-val',
    'overview-overdue-val', 'overview-ontime-val', 'task-ratio-bar-wrap',
    'section-habit-analytics', 'analytics-habit-current-val', 'analytics-habit-longest-val',
    'analytics-habit-today-val', 'analytics-habit-week-val', 'analytics-habit-month-val',
    'habit-chip-done', 'habit-chip-pending', 'habit-chip-postponed', 'habit-chip-cancelled',
    'section-weekly-performance', 'barchart-bars', 'streak-7days-row', 'streak-days-display',
    'section-monthly-performance', 'monthly-weeks-list', 'monthly-summary-stat',
    'section-category-insights', 'progress-category-list', 'radar-polygon',
    'modal-update-announcement', 'announcement-installed-version', 'announcement-available-version',
    'announcement-highlights-list', 'btn-announcement-later', 'btn-announcement-install',
    'btn-close-update-announcement', 'modal-version', 'profile-version-badge'
  ].forEach(id => makeElement(id));

  global.document = {
    getElementById: (id) => elements[id] || makeElement(id),
    createElement: (tag) => makeElement(`elem_${Math.random().toString(36).substr(2, 6)}`, tag),
    querySelectorAll: (sel) => [],
    querySelector: (sel) => null
  };

  global.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] !== undefined ? this._data[k] : null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
  };

  return { elements };
}

describe('Taskly v2.0.0 Build 11 — Productivity Analytics & Version History Suite', () => {

  // ==========================================================================
  // PART 1: Task Productivity Metrics & Calculation Engine
  // ==========================================================================
  describe('1. Task Productivity Metrics & Calculations', () => {
    test('calculateOverallProductivityScore handles balanced completed and pending tasks', () => {
      const today = new Date();
      const todayStr = HabitStreakService.toYmdString(today);

      const todos = [
        { id: '1', title: 'Task 1', completed: true, dueDate: todayStr, completedAt: today.toISOString() },
        { id: '2', title: 'Task 2', completed: true, dueDate: todayStr, completedAt: today.toISOString() },
        { id: '3', title: 'Task 3', completed: false, dueDate: todayStr },
        { id: '4', title: 'Task 4', completed: false, dueDate: todayStr }
      ];

      const score = clientApp.calculateOverallProductivityScore({
        todos,
        timeframe: 'all',
        routineConsistency: { totalDays: 7, qualifyingDays: 7, percentage: 100 }
      });

      assert.ok(score.hasData);
      assert.strictEqual(score.taskCompletionRate, 50);
      assert.strictEqual(score.onTimeRate, 100);
      // taskPerformance = Math.round(0.7 * 50 + 0.3 * 100) = 65
      assert.strictEqual(score.taskPerformanceScore, 65);
      // routineScore = 100
      assert.strictEqual(score.routineScore, 100);
      // overall = Math.round(0.5 * 65 + 0.5 * 100) = 83
      assert.strictEqual(score.overallScore, 83);
      assert.strictEqual(score.statusTier, 'Exceptional');
    });

    test('calculateOverallProductivityScore correctly handles overdue tasks reducing on-time rate', () => {
      const pastDate = '2026-11-01';
      const completedLate = '2026-11-05T12:00:00Z';

      const todos = [
        { id: '1', title: 'Late Task', completed: true, dueDate: pastDate, completedAt: completedLate },
        { id: '2', title: 'Pending Overdue', completed: false, dueDate: pastDate }
      ];

      const score = clientApp.calculateOverallProductivityScore({
        todos,
        timeframe: 'all',
        routineConsistency: null
      });

      assert.ok(score.hasData);
      assert.strictEqual(score.taskCompletionRate, 50);
      assert.strictEqual(score.onTimeRate, 0); // 0 out of 1 completed on time
      // taskPerformance = 0.7 * 50 + 0.3 * 0 = 35
      assert.strictEqual(score.overallScore, 35);
      assert.strictEqual(score.statusTier, 'Needs Focus');
    });

    test('calculateOverallProductivityScore returns clean empty state with null when data is empty', () => {
      const score = clientApp.calculateOverallProductivityScore({
        todos: [],
        timeframe: 'all',
        routineConsistency: null
      });

      assert.strictEqual(score.hasData, false);
      assert.strictEqual(score.overallScore, null);
      assert.strictEqual(score.statusTier, 'No Data');
      assert.strictEqual(score.tierBadge, 'No Activity');
    });

    test('getMonthlyProductivityTrends groups tasks into 4 weekly progression buckets', () => {
      const refDate = new Date('2026-11-08');
      const todos = [
        { id: '1', title: 'W1 Done', dueDate: '2026-11-03', completed: true },
        { id: '2', title: 'W1 Pending', dueDate: '2026-11-05', completed: false },
        { id: '3', title: 'W2 Done', dueDate: '2026-11-10', completed: true },
        { id: '4', title: 'W3 Done', dueDate: '2026-11-18', completed: true },
        { id: '5', title: 'W4 Done', dueDate: '2026-11-25', completed: true }
      ];

      const trends = clientApp.getMonthlyProductivityTrends(todos, refDate);

      assert.ok(trends.monthName.includes('November'));
      assert.strictEqual(trends.totalMonthTasks, 5);
      assert.strictEqual(trends.completedMonthTasks, 4);
      assert.strictEqual(trends.monthCompletionRate, 80);
      assert.strictEqual(trends.weeks.length, 4);
      assert.strictEqual(trends.weeks[0].total, 2);
      assert.strictEqual(trends.weeks[0].completed, 1);
      assert.strictEqual(trends.weeks[0].rate, 50);
      assert.strictEqual(trends.weeks[1].total, 1);
      assert.strictEqual(trends.weeks[1].rate, 100);
    });
  });

  // ==========================================================================
  // PART 2: Habit Streaks Integration into Productivity Analytics
  // ==========================================================================
  describe('2. Habit Streaks & 4-State Routine Integration', () => {
    test('80% qualifying threshold calculates current and longest streaks reliably', () => {
      const routines = [
        { id: 'r1', title: 'Morning Exercise' },
        { id: 'r2', title: 'Read Book' },
        { id: 'r3', title: 'Hydration' },
        { id: 'r4', title: 'Review Tasks' },
        { id: 'r5', title: 'Evening Journal' }
      ];

      // 4 completed out of 5 = 80% (qualifies)
      const completionsDay1 = [
        { routineId: 'r1', date: '2026-11-06', status: 'completed' },
        { routineId: 'r2', date: '2026-11-06', status: 'completed' },
        { routineId: 'r3', date: '2026-11-06', status: 'completed' },
        { routineId: 'r4', date: '2026-11-06', status: 'completed' },
        { routineId: 'r5', date: '2026-11-06', status: 'pending' }
      ];

      // 5 completed out of 5 = 100% (qualifies)
      const completionsDay2 = [
        { routineId: 'r1', date: '2026-11-07', status: 'completed' },
        { routineId: 'r2', date: '2026-11-07', status: 'completed' },
        { routineId: 'r3', date: '2026-11-07', status: 'completed' },
        { routineId: 'r4', date: '2026-11-07', status: 'completed' },
        { routineId: 'r5', date: '2026-11-07', status: 'completed' }
      ];

      // 1 cancelled (excluded from denominator), 3 completed out of 4 remaining = 75% (< 80%, does not qualify)
      const completionsDay3 = [
        { routineId: 'r1', date: '2026-11-08', status: 'completed' },
        { routineId: 'r2', date: '2026-11-08', status: 'completed' },
        { routineId: 'r3', date: '2026-11-08', status: 'completed' },
        { routineId: 'r4', date: '2026-11-08', status: 'pending' },
        { routineId: 'r5', date: '2026-11-08', status: 'cancelled' }
      ];

      const allCompletions = [...completionsDay1, ...completionsDay2, ...completionsDay3];

      // Verify Day 3 day statistics
      const statsDay3 = HabitStreakService.calculateDayStatistics({
        routines,
        completions: completionsDay3,
        date: '2026-11-08'
      });
      assert.strictEqual(statsDay3.eligibleCount, 4); // 5 minus 1 cancelled
      assert.strictEqual(statsDay3.completedCount, 3);
      assert.strictEqual(statsDay3.completionRate, 75);
      assert.strictEqual(statsDay3.isQualified, false); // 75% < 80%

      // Verify streaks up to 2026-11-07
      const streaksDay2 = HabitStreakService.calculateStreaks({
        routines,
        completions: [...completionsDay1, ...completionsDay2],
        refDate: '2026-11-07'
      });
      assert.strictEqual(streaksDay2.currentStreak, 2);
    });

    test('Postponed routine remains incomplete on original date without qualifying credit', () => {
      const routines = [{ id: 'r1', title: 'Stretch' }, { id: 'r2', title: 'Meditate' }];
      const completions = [
        { routineId: 'r1', date: '2026-11-08', status: 'completed' },
        { routineId: 'r2', date: '2026-11-08', status: 'postponed', postponedToDate: '2026-11-09' }
      ];

      const stats = HabitStreakService.calculateDayStatistics({
        routines,
        completions,
        date: '2026-11-08'
      });

      assert.strictEqual(stats.completedCount, 1);
      assert.strictEqual(stats.postponedCount, 1);
      assert.strictEqual(stats.eligibleCount, 2);
      assert.strictEqual(stats.completionRate, 50); // 50% < 80%
      assert.strictEqual(stats.isQualified, false);
    });
  });

  // ==========================================================================
  // PART 3: Version History & Release Decoupling
  // ==========================================================================
  describe('3. Version History & Update Architecture (v2.1.1 Build 12.1)', () => {
    beforeEach(() => {
      clientApp.TasklyUpdateManager.state.manifest = MANIFEST_JSON;
    });

    test('TasklyUpdateManager.localInstalledRelease is configured for v2.1.1 Build 12.1 (code 121) and preserves Build 12 & 11 references', () => {
      const updateMgr = clientApp.TasklyUpdateManager;
      assert.ok(updateMgr.localInstalledRelease);
      assert.strictEqual(updateMgr.localInstalledRelease.versionName, '2.1.1');
      assert.strictEqual(updateMgr.localInstalledRelease.versionCode, 121);
      assert.strictEqual(updateMgr.localInstalledRelease.displayBuild, '12.1');
      assert.strictEqual(updateMgr.localInstalledRelease.releaseDate, '2026-11-10');
      assert.ok(updateMgr.localInstalledRelease.title.includes('Taskly v2.1.1 (Build 12.1)'));

      assert.ok(updateMgr.build12Release, 'Must preserve build12Release reference');
      assert.strictEqual(updateMgr.build12Release.versionCode, 12);
      assert.ok(updateMgr.build11Release, 'Must preserve build11Release reference');
      assert.strictEqual(updateMgr.build11Release.versionCode, 11);

      const requiredBuild121Highlights = [
        'Safe and idempotent routine deletion preventing foreign key constraint violations',
        'Instant removal of deleted routines from tomorrow\'s list and routine counts without restarting',
        'Automatic cleanup of orphaned completion records when parent routines are removed'
      ];
      requiredBuild121Highlights.forEach(h => {
        assert.ok(
          updateMgr.localInstalledRelease.features.some(f => f.includes(h.slice(0, 30))),
          `Missing Build 12.1 feature highlight: ${h}`
        );
      });
    });

    test('getApprovedReleaseHistory strictly preserves all approved production releases including Build 12.1 (code 121)', () => {
      const updateMgr = clientApp.TasklyUpdateManager;
      const approved = updateMgr.getApprovedReleaseHistory();
      assert.strictEqual(approved.length, 11, 'Must preserve Build 12.1 + Build 12 + Build 11 + all 8 previous releases');

      const expectedVersionCodes = [121, 12, 11, 10, 9, 8, 7, 6, 5, 3, 1];
      const actualCodes = approved.map(r => parseInt(r.versionCode, 10));
      assert.deepStrictEqual(actualCodes, expectedVersionCodes);
    });

    test('getReleaseHistory cleanly prepends v2.1.1 Build 12.1 when installed is 121 without duplicating', () => {
      const updateMgr = clientApp.TasklyUpdateManager;
      updateMgr.state.installedVersionCode = 121;
      updateMgr.state.installedVersionName = '2.1.1';

      const history = updateMgr.getReleaseHistory();
      assert.strictEqual(history.length, 11, 'History includes Build 12.1 + Build 12 + Build 11 + 8 previous releases');
      assert.strictEqual(history[0].versionCode, 121);
      assert.strictEqual(history[1].versionCode, 12);
      assert.strictEqual(history[2].versionCode, 11);
    });
  });

  // ==========================================================================
  // PART 4: In-App Update Announcement System
  // ==========================================================================
  describe('4. In-App Update Announcement System', () => {
    let domMock;
    beforeEach(() => {
      domMock = setupMockDOM();
    });

    test('showUpdateAnnouncement populates installed vs available diff and highlights', () => {
      const updateMgr = clientApp.TasklyUpdateManager;
      updateMgr.state.installedVersionName = '1.9.0';
      updateMgr.state.installedVersionCode = 10;

      const candidateRelease = {
        versionName: '2.0.0',
        versionCode: 11,
        title: 'Habit Streaks & Productivity Analytics',
        features: ['Feature A', 'Feature B', 'Feature C']
      };

      updateMgr.showUpdateAnnouncement(candidateRelease, true);

      const modal = domMock.elements['modal-update-announcement'];
      const elInstalled = domMock.elements['announcement-installed-version'];
      const elAvailable = domMock.elements['announcement-available-version'];
      const highlightsList = domMock.elements['announcement-highlights-list'];

      assert.ok(modal.classList.contains('active'));
      assert.strictEqual(elInstalled.textContent, 'v1.9.0 (Build 10)');
      assert.strictEqual(elAvailable.textContent, 'v2.0.0 (Build 11)');
      assert.strictEqual(highlightsList.children.length, 3);
    });

    test('dismissUpdateAnnouncement records dismissal in localStorage and closes modal', () => {
      const updateMgr = clientApp.TasklyUpdateManager;
      const candidateRelease = { versionName: '2.0.0', versionCode: 11, features: ['Test'] };

      updateMgr.showUpdateAnnouncement(candidateRelease, false);
      updateMgr.dismissUpdateAnnouncement();

      const modal = domMock.elements['modal-update-announcement'];
      assert.strictEqual(modal.classList.contains('active'), false);
      assert.strictEqual(global.localStorage.getItem('taskly_dismissed_update_announcement'), '11');
    });

    test('checkUpdateAnnouncementOnStartup respects dismissed state and prevents duplicate popup', () => {
      const updateMgr = clientApp.TasklyUpdateManager;
      updateMgr.state.installedVersionCode = 10;
      updateMgr.state.installedVersionName = '1.9.0';

      // Simulate approved release in manifest is Build 11
      updateMgr.state.manifest = {
        latestVersion: '2.0.0',
        versionCode: 11,
        history: [{ versionName: '2.0.0', versionCode: 11 }]
      };

      // Set already dismissed
      global.localStorage.setItem('taskly_dismissed_update_announcement', '11');

      updateMgr.checkUpdateAnnouncementOnStartup();
      const modal = domMock.elements['modal-update-announcement'];
      assert.strictEqual(modal.classList.contains('active'), false, 'Should not popup when dismissed');
    });

    test('Native notification architecture prevents notifications for debug or local builds', async () => {
      const updateMgr = clientApp.TasklyUpdateManager;
      let scheduled = false;

      global.window = {
        location: { hostname: 'localhost' },
        Capacitor: {
          isNativePlatform: () => true,
          Plugins: {
            LocalNotifications: {
              schedule: async () => { scheduled = true; }
            }
          }
        }
      };

      await updateMgr.scheduleUpdateNotification({ versionName: '2.0.0', isLocalInstalled: true });
      assert.strictEqual(scheduled, false, 'Notification must NOT be scheduled for debug or local builds');
    });
  });

  // ==========================================================================
  // PART 5: UI & 4-Theme Styling Parity Verification
  // ==========================================================================
  describe('5. UI & 4-Theme Styling Parity', () => {
    test('public/index.html includes all 6 structured analytics sections and update announcement modal', () => {
      const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

      // 6 Progress Sections
      assert.ok(html.includes('id="section-productivity-overview"'));
      assert.ok(html.includes('id="section-task-analytics"'));
      assert.ok(html.includes('id="section-habit-analytics"'));
      assert.ok(html.includes('id="section-weekly-performance"'));
      assert.ok(html.includes('id="section-monthly-performance"'));
      assert.ok(html.includes('id="section-category-insights"'));

      // In-App Update Announcement Modal
      assert.ok(html.includes('id="modal-update-announcement"'));
      assert.ok(html.includes('id="announcement-installed-version"'));
      assert.ok(html.includes('id="announcement-available-version"'));
      assert.ok(html.includes('id="announcement-highlights-list"'));
      assert.ok(html.includes('id="btn-announcement-later"'));
      assert.ok(html.includes('id="btn-announcement-install"'));
    });

    test('public/styles.css provides dedicated styles for all 4 themes', () => {
      const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');

      // Card & metric styles
      assert.ok(css.includes('.analytics-section-card'));
      assert.ok(css.includes('.task-metrics-4grid'));
      assert.ok(css.includes('.habit-consistency-3grid'));
      assert.ok(css.includes('.modal-card-update-announcement'));

      // 4-Theme definitions
      assert.ok(css.includes('[data-theme="light"]') || css.includes(':root'));
      assert.ok(css.includes('[data-theme="dark"]'));
      assert.ok(css.includes('[data-theme="pet"]'));
      assert.ok(css.includes('[data-theme="pastel"]'));
    });

    test('Touch targets on interactive buttons maintain minimum 44px height', () => {
      const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
      assert.ok(css.includes('min-height: 44px') || css.includes('min-height: 48px'));
    });
  });
});
