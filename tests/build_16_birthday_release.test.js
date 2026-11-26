const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
const BUILD_GRADLE = fs.readFileSync(path.join(ROOT_DIR, 'android', 'app', 'build.gradle'), 'utf8');
const PROD_MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'releases', 'version-manifest.json'), 'utf8'));
const PUBLIC_MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'public', 'version-manifest.json'), 'utf8'));
const STYLES_CSS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), 'utf8');

// Mock DOM Setup
const domCache = new Map();
function getMockElement(id, tag = 'div') {
  if (!domCache.has(id)) {
    const classListSet = new Set();
    const children = [];
    const el = {
      id,
      tagName: tag.toUpperCase(),
      children,
      classList: {
        add: (...cs) => cs.forEach(c => classListSet.add(c)),
        remove: (...cs) => cs.forEach(c => classListSet.delete(c)),
        contains: (c) => classListSet.has(c),
        toggle: (c, force) => {
          if (force === undefined) {
            if (classListSet.has(c)) { classListSet.delete(c); return false; }
            else { classListSet.add(c); return true; }
          } else if (force) {
            classListSet.add(c); return true;
          } else {
            classListSet.delete(c); return false;
          }
        }
      },
      get className() { return Array.from(classListSet).join(' '); },
      set className(val) {
        classListSet.clear();
        if (val) val.split(/\s+/).filter(Boolean).forEach(c => classListSet.add(c));
      },
      style: {},
      dataset: {},
      value: '',
      _innerHTML: '',
      get innerHTML() { return this._innerHTML; },
      set innerHTML(val) { this._innerHTML = val; },
      _textContent: '',
      get textContent() {
        if (this._textContent) return this._textContent;
        return children.map(c => c.textContent || '').join(' ').trim();
      },
      set textContent(val) { this._textContent = String(val); },
      appendChild(child) { children.push(child); return child; }
    };
    domCache.set(id, el);
  }
  return domCache.get(id);
}

global.document = {
  getElementById: (id) => getMockElement(id),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  createElement: (tag) => {
    const classListSet = new Set();
    const children = [];
    return {
      tagName: tag.toUpperCase(),
      children,
      addEventListener: () => {},
      removeEventListener: () => {},
      classList: {
        add: (...cs) => cs.forEach(c => classListSet.add(c)),
        remove: (...cs) => cs.forEach(c => classListSet.delete(c)),
        contains: (c) => classListSet.has(c),
        toggle: (c, force) => {
          if (force === undefined) {
            if (classListSet.has(c)) { classListSet.delete(c); return false; }
            else { classListSet.add(c); return true; }
          } else if (force) {
            classListSet.add(c); return true;
          } else {
            classListSet.delete(c); return false;
          }
        }
      },
      get className() { return Array.from(classListSet).join(' '); },
      set className(val) {
        classListSet.clear();
        if (val) val.split(/\s+/).filter(Boolean).forEach(c => classListSet.add(c));
      },
      style: {},
      dataset: {},
      value: '',
      _innerHTML: '',
      get innerHTML() { return this._innerHTML; },
      set innerHTML(val) { this._innerHTML = val; },
      _textContent: '',
      get textContent() {
        if (this._textContent) return this._textContent;
        return children.map(c => c.textContent || '').join(' ').trim();
      },
      set textContent(val) { this._textContent = String(val); },
      appendChild(child) { children.push(child); return child; }
    };
  }
};

global.window = {
  Capacitor: undefined,
  location: { hostname: 'localhost' }
};

const app = require('../public/app');
const updateMgr = app.TasklyUpdateManager;

describe('Taskly Build 16: The Birthday Update Verification Suite', () => {

  beforeEach(() => {
    domCache.clear();
    updateMgr.state.manifest = null;
    updateMgr.state.latestVersionCode = null;
    updateMgr.state.latestVersionName = null;
    updateMgr.setCachedManifest(PROD_MANIFEST);
    updateMgr.state.installedVersionName = '2.4.0';
    updateMgr.state.installedVersionCode = 160;
    updateMgr.state.activeWhatsNewVersionCode = null;
    updateMgr.state.updateStatus = 'idle';
    app.state.userToken = 'mock-auth-token';
    app.state.flow = 'main';
    app.state.activeTab = 'home';
  });

  // --------------------------------------------------------------------------
  // 1. Official Build Identity & Version Metadata
  // --------------------------------------------------------------------------
  describe('1. Official Build Identity & Version Configuration', () => {
    test('package.json specifies version 2.4.0', () => {
      assert.strictEqual(PACKAGE_JSON.version, '2.4.0');
    });

    test('android/app/build.gradle configures versionCode 160 and versionName "2.4.0"', () => {
      assert.match(BUILD_GRADLE, /versionCode\s+160\b/);
      assert.match(BUILD_GRADLE, /versionName\s+["']2\.4\.0["']/);
      assert.match(BUILD_GRADLE, /applicationId\s+["']com\.taskly\.app["']/);
    });

    test('releases/version-manifest.json and public/version-manifest.json define Build 16 metadata identically', () => {
      assert.strictEqual(PROD_MANIFEST.latestVersion, '2.4.0');
      assert.strictEqual(PROD_MANIFEST.versionCode, 160);
      assert.strictEqual(PROD_MANIFEST.displayBuild, '16');
      assert.strictEqual(PROD_MANIFEST.buildLabel, 'Build 16');
      assert.strictEqual(PROD_MANIFEST.releaseDate, '2026-11-25');
      assert.strictEqual(PROD_MANIFEST.title, 'Taskly v2.4.0 (Build 16) – The BIRTHDAY Update 🎂');
      assert.strictEqual(PUBLIC_MANIFEST.latestVersion, '2.4.0');
      assert.strictEqual(PUBLIC_MANIFEST.versionCode, 160);
      assert.deepStrictEqual(PROD_MANIFEST, PUBLIC_MANIFEST, 'Production and public manifests must remain byte-identical');
    });

    test('Build 16 history entry preserves all required identity keys and flags', () => {
      const b16 = PROD_MANIFEST.history[0];
      assert.strictEqual(b16.version, '2.4.0');
      assert.strictEqual(b16.versionName, '2.4.0');
      assert.strictEqual(b16.versionCode, 160);
      assert.strictEqual(b16.displayBuild, '16');
      assert.strictEqual(b16.buildLabel, 'Build 16');
      assert.strictEqual(b16.releaseName, 'THE BIRTHDAY UPDATE');
      assert.strictEqual(b16.isBirthdayRelease, true);
      assert.strictEqual(b16.releaseDate, '2026-11-25');
      assert.ok(Array.isArray(b16.sections));
      assert.strictEqual(b16.sections.length, 6);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Release History Preservation (Append-Only)
  // --------------------------------------------------------------------------
  describe('2. Permanent Release History Preservation (Append-Only)', () => {
    test('Manifest contains 17 published releases ordered strictly descending by versionCode', () => {
      assert.strictEqual(PROD_MANIFEST.history.length, 17);
      const expectedCodes = [160, 153, 152, 151, 150, 140, 121, 12, 11, 10, 9, 8, 7, 6, 5, 3, 1];
      const actualCodes = PROD_MANIFEST.history.map(r => r.versionCode);
      assert.deepStrictEqual(actualCodes, expectedCodes);
    });

    test('All historical releases (Build 15.3, 15.2, 15.1, etc.) remain intact with original dates', () => {
      const b153 = PROD_MANIFEST.history[1];
      assert.strictEqual(b153.versionCode, 153);
      assert.strictEqual(b153.versionName, '2.3.3');
      assert.strictEqual(b153.releaseDate, '2026-11-18');

      const b152 = PROD_MANIFEST.history[2];
      assert.strictEqual(b152.versionCode, 152);
      assert.strictEqual(b152.versionName, '2.3.2');

      const b1 = PROD_MANIFEST.history[PROD_MANIFEST.history.length - 1];
      assert.strictEqual(b1.versionCode, 1);
      assert.strictEqual(b1.version, '1.0.0');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Dropdown Selector & Installed Diff Banner
  // --------------------------------------------------------------------------
  describe('3. Version Selector & Installed Diff Banner', () => {
    test('populateWhatsNewVersionSelect labels Build 16 as "v2.4.0 (Build 16) — The BIRTHDAY Update 🎂"', () => {
      const select = getMockElement('select-whats-new-version');
      updateMgr.populateWhatsNewVersionSelect();

      assert.strictEqual(select.children.length, 17);
      const topOption = select.children[0];
      assert.strictEqual(topOption.value, '160');
      assert.strictEqual(topOption.textContent, 'v2.4.0 (Build 16) — The BIRTHDAY Update 🎂');
    });

    test('diff banner displays exact installed version text when running Build 16', () => {
      updateMgr.state.installedVersionCode = 160;
      updateMgr.state.installedVersionName = '2.4.0';
      updateMgr.renderWhatsNew(160);

      const diffBanner = getMockElement('whats-new-diff-banner');
      const diffIcon = getMockElement('whats-new-diff-icon');
      const diffText = getMockElement('whats-new-diff-text');

      assert.ok(diffBanner.classList.contains('diff-current-installed'));
      assert.strictEqual(diffIcon.textContent, '✓');
      assert.strictEqual(
        diffText.innerHTML,
        '<strong>Installed Version:</strong> You are running <strong>v2.4.0 (Build 16)</strong>. All features below are active on your device.'
      );
    });
  });

  // --------------------------------------------------------------------------
  // 4. Birthday Update History Design & 6 Categorized Sections
  // --------------------------------------------------------------------------
  describe('4. Birthday Update History Design & Categorized Sections', () => {
    test('renderWhatsNew(160) renders custom birthday card and hides classic hero card', () => {
      updateMgr.renderWhatsNew(160);

      const heroCard = getMockElement('whats-new-hero-card');
      assert.strictEqual(heroCard.style.display, 'none', 'Classic hero card must be hidden for Build 16');

      const container = getMockElement('whats-new-categories-container');
      assert.strictEqual(container.children.length, 1, 'Container contains the birthday card element');

      const bdayCard = container.children[0];
      assert.ok(bdayCard.classList.contains('whats-new-birthday-card'));
    });

    test('birthday card renders hero banner with Build 16 pill, date, crown, wordmark, ribbon and celebration elements', () => {
      updateMgr.renderWhatsNew(160);
      const container = getMockElement('whats-new-categories-container');
      const bdayCard = container.children[0];
      const text = bdayCard.textContent;

      assert.ok(text.includes('Build 16'), 'Hero banner includes Build 16 badge');
      assert.ok(text.includes('2026-11-25'), 'Hero banner includes release date 2026-11-25');
      assert.ok(text.includes('The'), 'Hero banner includes "The"');
      assert.ok(text.includes('BIRTHDAY'), 'Hero banner includes "BIRTHDAY"');
      assert.ok(text.includes('Update'), 'Hero banner includes "Update"');
      assert.ok(text.includes('v2.4.0 (Build 16)'), 'Ribbon banner includes "v2.4.0 (Build 16)"');
    });

    test('birthday card body includes all 6 categories matching the authoritative reference', () => {
      updateMgr.renderWhatsNew(160);
      const container = getMockElement('whats-new-categories-container');
      const bdayCard = container.children[0];
      const text = bdayCard.textContent;

      // 1. Application Stability
      assert.ok(text.includes('Application Stability'));
      assert.ok(text.includes('Comprehensive application-wide stability improvements.'));
      assert.ok(text.includes('Fixed seven identified bugs across application functionality.'));
      assert.ok(text.includes('Improved error handling and state consistency.'));
      assert.ok(text.includes('Improved user data isolation and session cleanup.'));

      // 2. Task Management
      assert.ok(text.includes('Task Management'));
      assert.ok(text.includes('Improved task synchronization and rollback handling.'));
      assert.ok(text.includes('Better reliability during task updates and deletion.'));

      // 3. Smart Lists
      assert.ok(text.includes('Smart Lists'));
      assert.ok(text.includes('Improved routine completion data normalization.'));
      assert.ok(text.includes('Preserved independent daily routine occurrences.'));
      assert.ok(text.includes('Simplified routine deletion with two clear options.'));
      assert.ok(text.includes('Improved daily history reliability and retention.'));

      // 4. Navigation and Compatibility
      assert.ok(text.includes('Navigation and Compatibility'));
      assert.ok(text.includes('Improved Android hardware back-button handling.'));
      assert.ok(text.includes('Improved modal dismissal and navigation behavior.'));
      assert.ok(text.includes('Additional defensive handling for date operations.'));

      // 5. Performance and Reliability
      assert.ok(text.includes('Performance and Reliability'));
      assert.ok(text.includes('Improved application responsiveness.'));
      assert.ok(text.includes('Atomic file persistence improvements.'));
      assert.ok(text.includes('Expanded automated regression coverage.'));

      // 6. Quality Verification
      assert.ok(text.includes('Quality Verification'));
      assert.ok(text.includes('1,073 automated tests passed in the reported test run.'));
      assert.ok(text.includes('Seven identified bugs fixed.'));
    });
  });

  // --------------------------------------------------------------------------
  // 5. Styling Exclusivity & Backward Compatibility
  // --------------------------------------------------------------------------
  describe('5. Styling Exclusivity & Backward Compatibility', () => {
    test('public/styles.css includes scoped birthday card rules with zero impact on base themes', () => {
      assert.match(STYLES_CSS, /\.whats-new-birthday-card/);
      assert.match(STYLES_CSS, /\.birthday-hero-banner/);
      assert.match(STYLES_CSS, /\.birthday-pill-build/);
      assert.match(STYLES_CSS, /\.birthday-ribbon/);
      assert.match(STYLES_CSS, /\.birthday-section-icon/);
      assert.match(STYLES_CSS, /\.birthday-cloud-divider/);
    });

    test('selecting an older release (Build 15.3) restores classic hero card and standard 5 category buckets', () => {
      // First view Build 16
      updateMgr.renderWhatsNew(160);
      assert.strictEqual(getMockElement('whats-new-hero-card').style.display, 'none');

      // Now switch to Build 15.3
      updateMgr.renderWhatsNew(153);
      const heroCard = getMockElement('whats-new-hero-card');
      assert.strictEqual(heroCard.style.display, '', 'Classic hero card is restored for Build 15.3');

      const container = getMockElement('whats-new-categories-container');
      const catCards = container.children.filter(c => c.classList && c.classList.contains('whats-new-cat-card'));
      assert.ok(catCards.length > 0, 'Standard category cards are rendered for Build 15.3');
    });
  });

  // --------------------------------------------------------------------------
  // 6. Version Modal & Release History Correction (Build 16 Fix)
  // --------------------------------------------------------------------------
  describe('6. Version Modal & Release History Correction', () => {
    test('public/index.html static version placeholders match Build 16', () => {
      const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');
      assert.ok(indexHtml.includes('<span class="version-meta-value" id="val-installed-version">v2.4.0 (Build 16)</span>'));
      assert.ok(indexHtml.includes('<span class="version-meta-value" id="val-latest-version">v2.4.0 (Build 16)</span>'));
      assert.ok(indexHtml.includes('<p class="whats-new-banner-sub" id="whats-new-banner-subtitle">🎂 THE BIRTHDAY UPDATE — Taskly v2.4.0 (Build 16)</p>'));
    });

    test('renderUI renders Installed Version and Latest Approved as v2.4.0 (Build 16)', () => {
      updateMgr.state.installedVersionCode = 160;
      updateMgr.state.installedVersionName = '2.4.0';
      global.window.location = { hostname: 'app.taskly.com' }; // production_web or native_android
      global.window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };

      updateMgr.renderUI();

      const valInstalled = getMockElement('val-installed-version');
      const valLatest = getMockElement('val-latest-version');
      const whatsNewBannerSub = getMockElement('whats-new-banner-subtitle');

      assert.strictEqual(valInstalled.textContent, 'v2.4.0 (Build 16)');
      assert.strictEqual(valLatest.textContent, 'v2.4.0 (Build 16)');
      assert.strictEqual(whatsNewBannerSub.textContent, '🎂 THE BIRTHDAY UPDATE — Taskly v2.4.0 (Build 16)');
    });

    test('Anti-downgrade prevents older remote manifest (code 153) from downgrading latestApproved', () => {
      updateMgr.state.installedVersionCode = 160;
      updateMgr.state.installedVersionName = '2.4.0';

      // Simulate receiving older remote manifest (Build 15.3)
      const staleManifest = {
        latestVersion: '2.3.3',
        versionCode: 153,
        history: PROD_MANIFEST.history.filter(r => r.versionCode <= 153)
      };

      updateMgr.setCachedManifest(staleManifest);

      // Latest approved must remain Build 16
      const latestApproved = updateMgr.getLatestApprovedRelease();
      assert.strictEqual(latestApproved.versionCode, 160);
      assert.strictEqual(latestApproved.versionName, '2.4.0');

      const approvedHistory = updateMgr.getApprovedReleaseHistory();
      assert.strictEqual(approvedHistory[0].versionCode, 160, 'Build 16 must remain top of approved history');
    });

    test('History timeline renders Build 16 at top with "🌟 Latest & Installed" badge and preserves all 17 releases', () => {
      updateMgr.state.installedVersionCode = 160;
      updateMgr.state.installedVersionName = '2.4.0';
      updateMgr.setCachedManifest(PROD_MANIFEST);
      updateMgr.renderUI();

      const history = updateMgr.getReleaseHistory();
      assert.strictEqual(history.length, 17);
      assert.strictEqual(history[0].versionCode, 160);
      assert.strictEqual(history[1].versionCode, 153);

      const historyList = getMockElement('version-history-list');
      assert.strictEqual(historyList.children.length, 17);

      const topItem = historyList.children[0];
      assert.ok(topItem.textContent.includes('v2.4.0 (Build 16)'));
      assert.ok(topItem.textContent.includes('🌟 Latest & Installed'));
      assert.ok(topItem.textContent.includes('2026-11-25'));
    });
  });

  // --------------------------------------------------------------------------
  // 7. Professional Back to Updates Button Design & Integration
  // --------------------------------------------------------------------------
  describe('7. Professional Back to Updates Button Design & Integration', () => {
    test('public/index.html includes professionally styled Back to Updates button with left-arrow SVG', () => {
      const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');
      assert.match(indexHtml, /id="btn-whats-new-back-version"/);
      assert.match(indexHtml, /class="[^"]*btn-whats-new-back[^"]*"/);
      assert.match(indexHtml, /<svg[^>]*viewBox="0 0 24 24"[^>]*>[\s\S]*?<line[\s\S]*?<polyline/);
      assert.match(indexHtml, /<span>Back to Updates<\/span>/);
      // Ensure Got It button is preserved
      assert.match(indexHtml, /<button type="button" class="btn-primary-compact" id="btn-whats-new-dismiss">Got It<\/button>/);
    });

    test('public/styles.css defines scoped professional styles for Back to Updates button', () => {
      const stylesCss = fs.readFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), 'utf8');
      assert.match(stylesCss, /#modal-whats-new\s+#btn-whats-new-back-version/);
      assert.match(stylesCss, /border:\s*1\.5px\s+solid\s+#bae6fd/i);
      assert.match(stylesCss, /color:\s*#0369a1/i);
      assert.match(stylesCss, /font-weight:\s*600/);
      assert.match(stylesCss, /border-radius:\s*12px/);
      assert.match(stylesCss, /text-decoration:\s*none\s*!important/);
      assert.match(stylesCss, /box-shadow:\s*0\s+1px\s+2px\s+rgba\(3,\s*105,\s*161,\s*0\.08\)/);
      assert.match(stylesCss, /min-height:\s*40px/);
    });

    test('public/styles.css defines interactive hover and dark-theme states', () => {
      const stylesCss = fs.readFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), 'utf8');
      assert.match(stylesCss, /#btn-whats-new-back-version:hover[\s\S]*?background:\s*#f0f9ff/i);
      assert.match(stylesCss, /#btn-whats-new-back-version:hover[\s\S]*?border-color:\s*#7dd3fc/i);
      assert.match(stylesCss, /#btn-whats-new-back-version:hover\s+svg[\s\S]*?transform:\s*translateX\(-2px\)/);
      assert.match(stylesCss, /\[data-theme="dark"\][\s\S]*?#btn-whats-new-back-version/);
    });
  });

  // --------------------------------------------------------------------------
  // 8. Notification Navigation & Smart Lists UI Refinement
  // --------------------------------------------------------------------------
  describe('8. Notification Navigation & Smart Lists UI Refinement', () => {
    test('renderTaskItemHtml outputs data-task-id matching task id alongside data-id', () => {
      const sampleTask = {
        id: 'task-test-uuid-999',
        title: 'Review Project Launch',
        completed: false,
        priority: 'High',
        category: 'Work',
        dueDate: '2026-11-26',
        time: '14:30'
      };

      const html = app.renderTaskItemHtml(sampleTask);
      assert.match(html, /data-id="task-test-uuid-999"/);
      assert.match(html, /data-task-id="task-test-uuid-999"/);
    });

    test('TasklyNotifications.navigateToTask handles deleted/missing tasks gracefully', async () => {
      let alertMessage = null;
      global.alert = (msg) => { alertMessage = msg; };

      app.state.todos = [
        { id: 'task-1', title: 'Buy milk', completed: false }
      ];

      const res = await app.TasklyNotifications.navigateToTask('non-existent-task-id');
      assert.strictEqual(res, false);
      assert.strictEqual(alertMessage, 'This task is no longer available or was deleted.');
    });

    test('TasklyNotifications.navigateToTask handles completed tasks and resets filter if needed', async () => {
      let alertMessage = null;
      global.alert = (msg) => { alertMessage = msg; };

      app.state.todos = [
        { id: 'task-comp-1', title: 'Submit report', completed: true }
      ];
      app.state.dashboardFilter = 'today';

      const res = await app.TasklyNotifications.navigateToTask('task-comp-1');
      assert.strictEqual(res, true);
      assert.strictEqual(app.state.dashboardFilter, 'all');
      assert.strictEqual(alertMessage, '"Submit report" has already been completed.');
      assert.strictEqual(app.state.activeTab, 'home');
    });

    test('TasklyNotifications.navigateToTask differentiates tasks with duplicate titles by ID', async () => {
      app.state.todos = [
        { id: 'task-dup-1', title: 'Gym Workout', completed: false },
        { id: 'task-dup-2', title: 'Gym Workout', completed: false }
      ];
      app.state.dashboardFilter = 'all';

      const res1 = await app.TasklyNotifications.navigateToTask('task-dup-2');
      assert.strictEqual(res1, true);
      assert.strictEqual(app.state.activeTab, 'home');
    });

    test('public/styles.css defines taskHighlightPulse keyframes and animation', () => {
      const stylesCss = fs.readFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), 'utf8');
      assert.match(stylesCss, /@keyframes\s+taskHighlightPulse/);
      assert.match(stylesCss, /\.task-item\.task-highlight-pulse/);
      assert.match(stylesCss, /#F88438/);
    });

    test('Smart Lists header controls have refined horizontal flex layout and touch targets', () => {
      const stylesCss = fs.readFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), 'utf8');
      assert.match(stylesCss, /\.smart-lists-header-bar\s*\{[\s\S]*?justify-content:\s*space-between/);
      assert.match(stylesCss, /\.smart-lists-header-bar\s*\{[\s\S]*?margin-bottom:\s*12px/);
      assert.match(stylesCss, /\.smart-lists-top-actions\s*\{[\s\S]*?gap:\s*10px/);
      assert.match(stylesCss, /\.btn-back-smart\s*\{[\s\S]*?width:\s*42px/);
      assert.match(stylesCss, /\.btn-back-smart\s*\{[\s\S]*?height:\s*42px/);
      assert.match(stylesCss, /\.btn-smart-action\s*\{[\s\S]*?min-height:\s*40px/);
      assert.match(stylesCss, /\.btn-smart-icon-only\s*\{[\s\S]*?min-height:\s*40px/);
    });

    test('Smart Lists streak reset button has compact dimensions, padding, font size, and centered alignment', () => {
      const stylesCss = fs.readFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), 'utf8');
      assert.match(stylesCss, /\.btn-reset-streak\s*\{[\s\S]*?align-items:\s*center/);
      assert.match(stylesCss, /\.btn-reset-streak\s*\{[\s\S]*?justify-content:\s*center/);
      assert.match(stylesCss, /\.btn-reset-streak\s*\{[\s\S]*?padding:\s*4px\s+9px/);
      assert.match(stylesCss, /\.btn-reset-streak\s*\{[\s\S]*?font-size:\s*0\.75rem/);
      assert.match(stylesCss, /\.btn-reset-streak\s*\{[\s\S]*?line-height:\s*1/);
      assert.match(stylesCss, /\.btn-reset-streak\s*\{[\s\S]*?min-height:\s*44px/);
      assert.match(stylesCss, /\.btn-reset-streak\s*\{[\s\S]*?min-width:\s*44px/);
      assert.match(stylesCss, /\.reset-streak-icon\s*\{[\s\S]*?font-size:\s*0\.8125rem/);
      assert.match(stylesCss, /\.reset-streak-icon\s*\{[\s\S]*?display:\s*inline-flex/);
      assert.match(stylesCss, /\.reset-streak-label\s*\{[\s\S]*?display:\s*inline-flex/);
      assert.match(stylesCss, /\.reset-streak-label\s*\{[\s\S]*?line-height:\s*1/);
    });
  });
});
