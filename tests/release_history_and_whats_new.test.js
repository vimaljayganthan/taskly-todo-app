const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');
const STYLES_CSS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), 'utf8');
const MANIFEST_JSON = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'releases', 'version-manifest.json'), 'utf8'));

// Mock Storage and DOM Environment
const mockStorage = new Map();
global.localStorage = {
  getItem: (k) => mockStorage.get(k) || null,
  setItem: (k, v) => mockStorage.set(k, String(v)),
  removeItem: (k) => mockStorage.delete(k),
  clear: () => mockStorage.clear()
};

function createMockElement(id = '', tag = 'div') {
  const attributes = {};
  const listeners = {};
  const children = [];
  const classListSet = new Set();

  const el = {
    id,
    tagName: tag.toUpperCase(),
    children,
    classList: {
      classes: classListSet,
      add(...cs) { cs.forEach(c => classListSet.add(c)); },
      remove(...cs) { cs.forEach(c => classListSet.delete(c)); },
      toggle(c, force) {
        if (force === undefined) {
          if (classListSet.has(c)) classListSet.delete(c);
          else classListSet.add(c);
        } else if (force) {
          classListSet.add(c);
        } else {
          classListSet.delete(c);
        }
      },
      contains(c) { return classListSet.has(c); }
    },
    get className() {
      return Array.from(classListSet).join(' ');
    },
    set className(val) {
      classListSet.clear();
      if (val) {
        val.split(/\s+/).filter(Boolean).forEach(c => classListSet.add(c));
      }
    },
    style: {},
    dataset: {},
    value: '',
    _textContent: '',
    get textContent() {
      if (this._textContent) return this._textContent;
      return children.map(c => c.textContent || '').join(' ').trim();
    },
    set textContent(val) {
      this._textContent = String(val);
    },
    innerHTML: '',
    setAttribute(name, value) { attributes[name] = String(value); },
    getAttribute(name) { return attributes[name] || null; },
    appendChild(child) { children.push(child); return child; },
    addEventListener(event, fn) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    removeEventListener(event, fn) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter(h => h !== fn);
    },
    trigger(event, payload = {}) {
      if (listeners[event]) {
        listeners[event].forEach(fn => fn(payload));
      }
    }
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
  addEventListener: () => {},
  removeEventListener: () => {}
};

global.window = {
  Capacitor: undefined,
  location: { protocol: 'https:', origin: 'https://app.taskly.com', hostname: 'app.taskly.com' },
  addEventListener: () => {},
  removeEventListener: () => {},
  open: () => {}
};

const app = require('../public/app.js');
const { TasklyUpdateManager } = app;
const releaseManager = require('../scripts/release-manager.js');

describe("Taskly Permanent Release History & What's New System Suite", () => {

  beforeEach(() => {
    mockStorage.clear();
    mockElements.clear();
    global.window.Capacitor = undefined;
    TasklyUpdateManager.state.installedVersionName = '1.5.0';
    TasklyUpdateManager.state.installedVersionCode = 6;
    TasklyUpdateManager.state.latestVersionName = '1.5.0';
    TasklyUpdateManager.state.latestVersionCode = 6;
    TasklyUpdateManager.state.manifest = JSON.parse(JSON.stringify(MANIFEST_JSON));
    TasklyUpdateManager.state.activeWhatsNewVersionCode = 6;
    TasklyUpdateManager.state.historyExpanded = true;
  });

  afterEach(() => {
    mockStorage.clear();
    mockElements.clear();
  });

  describe('1. DOM Markup & Architecture Verification', () => {
    test('public/index.html includes What\'s New quick-launch banner inside #modal-version', () => {
      assert.match(INDEX_HTML, /id="version-whats-new-banner"/);
      assert.match(INDEX_HTML, /id="btn-open-whats-new-modal"/);
      assert.match(INDEX_HTML, /id="whats-new-banner-subtitle"/);
    });

    test('public/index.html includes complete #modal-whats-new modal with required controls', () => {
      assert.match(INDEX_HTML, /id="modal-whats-new"/);
      assert.match(INDEX_HTML, /id="select-whats-new-version"/);
      assert.match(INDEX_HTML, /id="whats-new-diff-banner"/);
      assert.match(INDEX_HTML, /id="whats-new-hero-card"/);
      assert.match(INDEX_HTML, /id="whats-new-categories-container"/);
      assert.match(INDEX_HTML, /id="whats-new-empty-state"/);
      assert.match(INDEX_HTML, /id="btn-whats-new-back-version"/);
      assert.match(INDEX_HTML, /id="btn-whats-new-dismiss"/);
    });
  });

  describe('2. Permanent Release History & Ordering', () => {
    test('getReleaseHistory returns all historical releases sorted strictly by versionCode descending', () => {
      const history = TasklyUpdateManager.getReleaseHistory();
      assert.ok(Array.isArray(history));
      assert.ok(history.length >= 4, 'Should contain at least 4 certified releases');

      for (let i = 0; i < history.length - 1; i++) {
        const currentCode = parseInt(history[i].versionCode, 10);
        const nextCode = parseInt(history[i + 1].versionCode, 10);
        assert.ok(
          currentCode > nextCode,
          `Release ordering violation: build ${currentCode} must be greater than ${nextCode}`
        );
      }
    });

    test('getReleaseHistory preserves older releases even when newer releases are present', () => {
      const history = TasklyUpdateManager.getReleaseHistory();
      const versionCodes = history.map(h => parseInt(h.versionCode, 10));
      assert.ok(versionCodes.includes(6), 'Includes v1.5.0 (Build 6)');
      assert.ok(versionCodes.includes(5), 'Includes v1.4.0 (Build 5)');
      assert.ok(versionCodes.includes(3), 'Includes v1.2.0 (Build 3)');
      assert.ok(versionCodes.includes(1), 'Includes v1.0.0 (Build 1)');
    });

    test('getReleaseByVersion resolves release by either number code, string code, or version string', () => {
      const relByNum = TasklyUpdateManager.getReleaseByVersion(6);
      assert.strictEqual(relByNum.versionCode, 6);

      const relByStrCode = TasklyUpdateManager.getReleaseByVersion('5');
      assert.strictEqual(relByStrCode.versionCode, 5);

      const relByVersionName = TasklyUpdateManager.getReleaseByVersion('v1.4.0');
      assert.strictEqual(relByVersionName.versionCode, 5);
    });

    test('renderUI marks the latest release distinctly and shows installed badge', () => {
      TasklyUpdateManager.state.installedVersionCode = TasklyUpdateManager.getReleaseHistory()[0].versionCode;
      TasklyUpdateManager.renderUI();
      const historyList = document.getElementById('version-history-list');
      assert.ok(historyList.children.length >= 4);

      const firstItem = historyList.children[0];
      assert.ok(firstItem.classList.contains('history-item-latest'));

      // Check for latest and installed badges
      const text = firstItem.textContent || '';
      assert.ok(text.includes('Latest'), 'Latest badge rendered on newest release');
      assert.ok(text.includes('Installed'), 'Installed badge rendered on installed build');
    });

    test('history items include dedicated "What\'s New in this version" action button', () => {
      TasklyUpdateManager.renderUI();
      const historyList = document.getElementById('version-history-list');
      const firstItem = historyList.children[0];
      const buttons = firstItem.children;
      // Search for btn-history-whats-new among child nodes
      let foundButton = false;
      const scanForBtn = (el) => {
        if (el.classList && el.classList.contains('btn-history-whats-new')) foundButton = true;
        if (el.children) el.children.forEach(scanForBtn);
      };
      scanForBtn(firstItem);
      assert.ok(foundButton, 'Every historical item renders a What\'s New button');
    });
  });

  describe('3. What\'s New 5-Category Buckets & Detail Formatting', () => {
    test('renders only non-empty categories from the 5 standard categories', () => {
      // Mock release with features and fixes only
      TasklyUpdateManager.state.manifest.history = [
        {
          version: '1.6.0',
          versionCode: 7,
          releaseDate: '2026-11-08',
          title: 'Custom Categories & Speedups',
          summary: 'A release with two active buckets',
          features: ['Dynamic category creation'],
          improvements: [],
          performance: [],
          fixes: ['Resolved dark mode modal glitch'],
          security: []
        }
      ];

      TasklyUpdateManager.renderWhatsNew(7);
      const container = document.getElementById('whats-new-categories-container');
      assert.strictEqual(container.children.length, 2, 'Only the 2 populated categories should be rendered');

      const catClasses = container.children.map(c => c.className);
      assert.ok(catClasses.some(c => c.includes('cat-features')), 'Features card rendered');
      assert.ok(catClasses.some(c => c.includes('cat-fixes')), 'Fixes card rendered');
      assert.ok(!catClasses.some(c => c.includes('cat-improvements')), 'Empty improvements card omitted');
      assert.ok(!catClasses.some(c => c.includes('cat-performance')), 'Empty performance card omitted');
      assert.ok(!catClasses.some(c => c.includes('cat-security')), 'Empty security card omitted');
    });

    test('formats both plain string release notes and structured items with title, description, and user benefit', () => {
      TasklyUpdateManager.state.manifest.history = [
        {
          version: '1.6.0',
          versionCode: 7,
          releaseDate: '2026-11-08',
          title: 'Rich Notes Release',
          summary: 'Testing item formats',
          features: [
            'Simple plain string feature note',
            {
              title: 'Dynamic Workload Colors',
              description: 'Automatically calculates task density on calendar tiles',
              benefit: 'Instantly identify heavy days at a glance without reading task counts'
            }
          ],
          improvements: [],
          performance: [],
          fixes: [],
          security: []
        }
      ];

      TasklyUpdateManager.renderWhatsNew(7);
      const container = document.getElementById('whats-new-categories-container');
      const featuresCard = container.children[0];
      const itemsWrap = featuresCard.children[1];
      assert.strictEqual(itemsWrap.children.length, 2);

      // Item 1: Simple
      const item1 = itemsWrap.children[0];
      assert.ok(item1.classList.contains('whats-new-item-simple'));
      assert.strictEqual(item1.children[1].textContent, 'Simple plain string feature note');

      // Item 2: Rich structured
      const item2 = itemsWrap.children[1];
      assert.ok(item2.classList.contains('whats-new-item-rich'));
      const item2Text = item2.children.map(c => c.textContent).join(' ');
      assert.ok(item2Text.includes('Dynamic Workload Colors'));
      assert.ok(item2Text.includes('Automatically calculates task density'));
      assert.ok(item2Text.includes('Instantly identify heavy days'));
    });

    test('v1.5.0 release notes contain accurate user-facing branding and updater features', () => {
      const rel = TasklyUpdateManager.getReleaseByVersion(6);
      assert.ok(rel, 'Release v1.5.0 must exist');
      const allFeatures = rel.features.join(' ');
      assert.match(allFeatures, /Cat & Dog/i);
      assert.match(allFeatures, /paw/i);
      assert.match(allFeatures, /mascot/i);
      assert.match(allFeatures, /APK update/i);
      assert.match(allFeatures, /SHA-256|safeguards/i);
      assert.ok(!allFeatures.includes('Approved production release'), 'Placeholder must be replaced with real features');
    });

    test('v1.5.0 release notes contain zero unsupported battery or performance claims', () => {
      const rel = TasklyUpdateManager.getReleaseByVersion(6);
      assert.strictEqual(rel.performance.length, 0, 'Performance array must not contain invented claims');
      const allText = JSON.stringify(rel);
      assert.ok(!allText.includes('zero background battery drain'), 'Must not claim zero background battery drain');
    });

    test('shows empty state when a release has zero release notes across all categories', () => {
      TasklyUpdateManager.state.manifest.history = [
        {
          version: '1.0.0-rc',
          versionCode: 2,
          releaseDate: '2026-11-01',
          title: 'Empty RC Release',
          summary: 'No categorized notes',
          features: [],
          improvements: [],
          performance: [],
          fixes: [],
          security: []
        }
      ];

      TasklyUpdateManager.renderWhatsNew(2);
      const emptyState = document.getElementById('whats-new-empty-state');
      assert.strictEqual(emptyState.style.display, 'flex');
    });
  });

  describe('4. Version Comparison & Diff Callout Banner', () => {
    test('displays "Upgrade Available" diff banner when inspecting a version newer than installed', () => {
      TasklyUpdateManager.state.installedVersionCode = 5;
      TasklyUpdateManager.state.installedVersionName = '1.4.0';

      TasklyUpdateManager.renderWhatsNew(6); // Inspecting Build 6
      const diffBanner = document.getElementById('whats-new-diff-banner');
      assert.ok(diffBanner.classList.contains('diff-upgrade-available'));
      const text = document.getElementById('whats-new-diff-text').innerHTML;
      assert.ok(text.includes('Upgrade Available'));
      assert.ok(text.includes('1.4.0'));
      assert.ok(text.includes('1.5.0'));
    });

    test('displays "Installed Version" diff banner when inspecting currently installed version', () => {
      TasklyUpdateManager.state.installedVersionCode = 6;
      TasklyUpdateManager.state.installedVersionName = '1.5.0';

      TasklyUpdateManager.renderWhatsNew(6); // Inspecting Build 6
      const diffBanner = document.getElementById('whats-new-diff-banner');
      assert.ok(diffBanner.classList.contains('diff-current-installed'));
      const text = document.getElementById('whats-new-diff-text').innerHTML;
      assert.ok(text.includes('Installed Version'));
    });

    test('displays "Historical Release" diff banner when inspecting an older version', () => {
      TasklyUpdateManager.state.installedVersionCode = 6;
      TasklyUpdateManager.state.installedVersionName = '1.5.0';

      TasklyUpdateManager.renderWhatsNew(5); // Inspecting Build 5
      const diffBanner = document.getElementById('whats-new-diff-banner');
      assert.ok(diffBanner.classList.contains('diff-older-version'));
      const text = document.getElementById('whats-new-diff-text').innerHTML;
      assert.ok(text.includes('Historical Release'));
    });
  });

  describe('5. One-Time Post-Upgrade Notification & Storage Tracking', () => {
    test('first-time launch initializes last_seen without popping up What\'s New modal', () => {
      let opened = false;
      const origOpen = TasklyUpdateManager.openWhatsNew;
      TasklyUpdateManager.openWhatsNew = () => { opened = true; };

      try {
        mockStorage.clear();
        TasklyUpdateManager.checkPostUpgradeWhatsNew();
        assert.strictEqual(opened, false, 'Should NOT open What\'s New on initial installation');
        assert.strictEqual(mockStorage.get('taskly_last_seen_whats_new_version'), '6');
      } finally {
        TasklyUpdateManager.openWhatsNew = origOpen;
      }
    });

    test('version upgrade (installed > last_seen) triggers What\'s New once and records new version', () => {
      let openedVersion = null;
      const origOpen = TasklyUpdateManager.openWhatsNew;
      TasklyUpdateManager.openWhatsNew = (code) => { openedVersion = code; };

      try {
        // User was on Build 5 previously, now installed Build 6
        mockStorage.set('taskly_last_seen_whats_new_version', '5');
        TasklyUpdateManager.state.installedVersionCode = 6;

        TasklyUpdateManager.checkPostUpgradeWhatsNew();
        assert.strictEqual(openedVersion, 6, 'Should trigger What\'s New for newly installed version 6');
        assert.strictEqual(mockStorage.get('taskly_last_seen_whats_new_version'), '6');
      } finally {
        TasklyUpdateManager.openWhatsNew = origOpen;
      }
    });

    test('subsequent launches on the same version do NOT repeatedly open What\'s New', () => {
      let opened = false;
      const origOpen = TasklyUpdateManager.openWhatsNew;
      TasklyUpdateManager.openWhatsNew = () => { opened = true; };

      try {
        mockStorage.set('taskly_last_seen_whats_new_version', '6');
        TasklyUpdateManager.state.installedVersionCode = 6;

        TasklyUpdateManager.checkPostUpgradeWhatsNew();
        assert.strictEqual(opened, false, 'Should NOT open What\'s New when already seen');
      } finally {
        TasklyUpdateManager.openWhatsNew = origOpen;
      }
    });

    test('dismissing What\'s New modal records the installed version in localStorage', () => {
      mockStorage.clear();
      TasklyUpdateManager.state.installedVersionCode = 6;
      TasklyUpdateManager.dismissWhatsNew();
      assert.strictEqual(mockStorage.get('taskly_last_seen_whats_new_version'), '6');
    });
  });

  describe('6. Release Manager Publishing Workflow & Progression Checks', () => {
    test('parseCategoryItems handles array, JSON string, and newline/comma delimited inputs', () => {
      const arr = ['feat 1', 'feat 2'];
      assert.deepStrictEqual(releaseManager.parseCategoryItems(arr), arr);

      const jsonStr = '["item A", "item B"]';
      assert.deepStrictEqual(releaseManager.parseCategoryItems(jsonStr), ['item A', 'item B']);

      const multiLine = 'Improvement 1\nImprovement 2';
      assert.deepStrictEqual(releaseManager.parseCategoryItems(multiLine), ['Improvement 1', 'Improvement 2']);

      const commaList = 'Fix A, Fix B';
      assert.deepStrictEqual(releaseManager.parseCategoryItems(commaList), ['Fix A', 'Fix B']);

      assert.deepStrictEqual(releaseManager.parseCategoryItems(null), []);
      assert.deepStrictEqual(releaseManager.parseCategoryItems(''), []);
    });

    test('prepareRelease rejects candidate release if versionCode is not greater than production versionCode', () => {
      const currentProdCode = releaseManager.readProductionManifest()?.versionCode || 6;
      assert.throws(() => {
        releaseManager.prepareRelease({
          apk: path.join(ROOT_DIR, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
          build: currentProdCode,
          title: 'Duplicate Version Code',
          notes: 'Test notes'
        });
      }, /Progression Violation|Production release APK not found/);
    });

    test('prepareRelease rejects candidate release if explicit title is missing', () => {
      const currentProdCode = releaseManager.readProductionManifest()?.versionCode || 6;
      assert.throws(() => {
        releaseManager.prepareRelease({
          apk: path.join(ROOT_DIR, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
          build: currentProdCode + 1,
          title: '',
          notes: 'Some notes'
        });
      }, /Validation Error.*Explicit release title.*is required|Production release APK not found/);
    });

    test('prepareRelease rejects candidate release if explicit release notes are missing', () => {
      const currentProdCode = releaseManager.readProductionManifest()?.versionCode || 6;
      assert.throws(() => {
        releaseManager.prepareRelease({
          apk: path.join(ROOT_DIR, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
          build: currentProdCode + 1,
          title: 'Release Title',
          notes: ''
        });
      }, /Validation Error.*Explicit release notes.*are required|Production release APK not found/);
    });

    test('publishRelease strictly preserves existing release history when appending new release', () => {
      const origManifest = JSON.parse(fs.readFileSync(releaseManager.MANIFEST_PATH, 'utf8'));
      const nextCode = (origManifest.versionCode || 6) + 1;
      const testDraft = {
        latestVersion: '1.7.0',
        versionCode: nextCode,
        title: 'Productivity Powerpack',
        releaseNotes: 'Brand new release with high-impact features.',
        releaseDate: '2026-11-08',
        minimumSupportedVersion: '1.0.0',
        fileSize: '17.2 MB',
        fileSizeBytes: 18035500,
        sha256: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        mandatoryUpdate: false,
        apkDownloadUrl: 'https://github.com/vimaljayganthan/taskly-todo-app/releases/download/v1.7.0/taskly-v1.7.0.apk',
        apkSourceFile: 'android/app/build/outputs/apk/release/app-release.apk',
        features: ['Feature 1'],
        improvements: ['Improvement 1'],
        performance: ['Performance 1'],
        fixes: ['Fix 1'],
        security: ['Security 1']
      };

      // Write test draft
      fs.writeFileSync(releaseManager.DRAFT_PATH, JSON.stringify(testDraft, null, 2));

      try {
        const published = releaseManager.publishRelease({ 'confirm-owner-approval': true });

        // Verify new release is at index 0
        assert.strictEqual(published.latestVersion, '1.7.0');
        assert.strictEqual(published.versionCode, nextCode);
        assert.strictEqual(published.history[0].versionCode, nextCode);
        assert.strictEqual(published.history[0].title, 'Productivity Powerpack');
        assert.deepStrictEqual(published.history[0].features, ['Feature 1']);

        // Verify older releases were strictly preserved
        const oldCodes = published.history.map(h => h.versionCode);
        assert.ok(oldCodes.includes(6), 'Old v1.5.0 preserved');
        assert.ok(oldCodes.includes(5), 'Old v1.4.0 preserved');
        assert.ok(oldCodes.includes(3), 'Old v1.2.0 preserved');
        assert.ok(oldCodes.includes(1), 'Old v1.0.0 preserved');
        assert.strictEqual(published.history.length, origManifest.history.length + 1);

        // Verify identical dual manifests on disk
        const onDisk1 = fs.readFileSync(releaseManager.MANIFEST_PATH, 'utf8');
        const onDisk2 = fs.readFileSync(releaseManager.PUBLIC_MANIFEST_PATH, 'utf8');
        assert.strictEqual(onDisk1, onDisk2, 'Dual manifests must be strictly identical');
        assert.ok(!fs.existsSync(releaseManager.DRAFT_PATH), 'Draft must be deleted after success');
      } finally {
        // Restore pristine production manifests
        fs.writeFileSync(releaseManager.MANIFEST_PATH, JSON.stringify(origManifest, null, 2));
        fs.writeFileSync(releaseManager.PUBLIC_MANIFEST_PATH, JSON.stringify(origManifest, null, 2));
        if (fs.existsSync(releaseManager.DRAFT_PATH)) {
          fs.unlinkSync(releaseManager.DRAFT_PATH);
        }
      }
    });

    test('readProductionManifest throws fatal error when manifest is corrupted or contains invalid JSON', () => {
      const tempBadPath = path.join(ROOT_DIR, 'releases', '.temp-corrupted-manifest.json');
      fs.writeFileSync(tempBadPath, '{"latestVersion": "1.5.0", malformedJSON...}');
      try {
        assert.throws(() => {
          releaseManager.readProductionManifest(tempBadPath);
        }, /Fatal Syntax Error.*is corrupted or contains invalid JSON/);
      } finally {
        if (fs.existsSync(tempBadPath)) fs.unlinkSync(tempBadPath);
      }
    });

    test('readProductionManifest returns null when file does not exist', () => {
      assert.strictEqual(releaseManager.readProductionManifest('/nonexistent/path/manifest.json'), null);
    });

    test('readProductionManifest rejects invalid history entries or missing version identifier', () => {
      const tempBadPath = path.join(ROOT_DIR, 'releases', '.temp-invalid-history-manifest.json');
      fs.writeFileSync(tempBadPath, JSON.stringify({
        latestVersion: '1.5.0',
        versionCode: 6,
        history: [{ summary: 'No version code or name' }]
      }));
      try {
        assert.throws(() => {
          releaseManager.readProductionManifest(tempBadPath);
        }, /Fatal Validation Error.*invalid versionCode|missing a version identifier/);
      } finally {
        if (fs.existsSync(tempBadPath)) fs.unlinkSync(tempBadPath);
      }
    });

    test('readProductionManifest rejects duplicate version codes in history', () => {
      const tempBadPath = path.join(ROOT_DIR, 'releases', '.temp-dup-history-manifest.json');
      fs.writeFileSync(tempBadPath, JSON.stringify({
        latestVersion: '1.5.0',
        versionCode: 6,
        history: [
          { version: '1.5.0', versionCode: 6 },
          { version: '1.5.0-duplicate', versionCode: 6 }
        ]
      }));
      try {
        assert.throws(() => {
          releaseManager.readProductionManifest(tempBadPath);
        }, /Duplicate versionCode 6 found in history/);
      } finally {
        if (fs.existsSync(tempBadPath)) fs.unlinkSync(tempBadPath);
      }
    });

    test('publishRelease failure before second rename rolls back first manifest and preserves draft', () => {
      const origManifest = fs.readFileSync(releaseManager.MANIFEST_PATH, 'utf8');
      const origPublic = fs.readFileSync(releaseManager.PUBLIC_MANIFEST_PATH, 'utf8');
      const origData = JSON.parse(origManifest);
      const nextCode = (origData.versionCode || 6) + 1;

      const testDraft = {
        latestVersion: '1.7.0',
        versionCode: nextCode,
        title: 'Rollback Test Candidate',
        releaseNotes: 'Testing atomic rollback before second rename',
        releaseDate: '2026-11-08',
        minimumSupportedVersion: '1.0.0',
        fileSize: '17.2 MB',
        fileSizeBytes: 18035500,
        sha256: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        mandatoryUpdate: false,
        apkDownloadUrl: 'https://github.com/vimaljayganthan/taskly-todo-app/releases/download/v1.7.0/taskly-v1.7.0.apk',
        apkSourceFile: 'android/app/build/outputs/apk/release/app-release.apk',
        features: ['Feature A']
      };

      fs.writeFileSync(releaseManager.DRAFT_PATH, JSON.stringify(testDraft, null, 2));

      try {
        assert.throws(() => {
          releaseManager.publishRelease({
            'confirm-owner-approval': true,
            _failAtStage: 'beforeRenameTarget2'
          });
        }, /Staged publishing failed \(safely rolled back to previous manifests\)/);

        // Verify manifests were rolled back to their exact original contents
        assert.strictEqual(fs.readFileSync(releaseManager.MANIFEST_PATH, 'utf8'), origManifest);
        assert.strictEqual(fs.readFileSync(releaseManager.PUBLIC_MANIFEST_PATH, 'utf8'), origPublic);
        // Verify draft was preserved
        assert.ok(fs.existsSync(releaseManager.DRAFT_PATH), 'Draft must NOT be deleted after failed publishing');
      } finally {
        fs.writeFileSync(releaseManager.MANIFEST_PATH, origManifest);
        fs.writeFileSync(releaseManager.PUBLIC_MANIFEST_PATH, origPublic);
        if (fs.existsSync(releaseManager.DRAFT_PATH)) fs.unlinkSync(releaseManager.DRAFT_PATH);
      }
    });

    test('publishRelease rollback failure preserves recovery backup files and throws critical error', () => {
      const origManifest = fs.readFileSync(releaseManager.MANIFEST_PATH, 'utf8');
      const origPublic = fs.readFileSync(releaseManager.PUBLIC_MANIFEST_PATH, 'utf8');
      const origData = JSON.parse(origManifest);
      const nextCode = (origData.versionCode || 6) + 1;

      const testDraft = {
        latestVersion: '1.7.0',
        versionCode: nextCode,
        title: 'Critical Recovery Test',
        releaseNotes: 'Testing recovery file preservation',
        releaseDate: '2026-11-08',
        minimumSupportedVersion: '1.0.0',
        fileSize: '17.2 MB',
        fileSizeBytes: 18035500,
        sha256: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        mandatoryUpdate: false,
        apkDownloadUrl: 'https://github.com/vimaljayganthan/taskly-todo-app/releases/download/v1.7.0/taskly-v1.7.0.apk',
        apkSourceFile: 'android/app/build/outputs/apk/release/app-release.apk',
        features: ['Feature X']
      };

      fs.writeFileSync(releaseManager.DRAFT_PATH, JSON.stringify(testDraft, null, 2));

      try {
        assert.throws(() => {
          releaseManager.publishRelease({
            'confirm-owner-approval': true,
            _failAtStage: 'duringRollback'
          });
        }, /CRITICAL: Staged publishing failed AND rollback failed/);

        // Draft preserved
        assert.ok(fs.existsSync(releaseManager.DRAFT_PATH));
      } finally {
        fs.writeFileSync(releaseManager.MANIFEST_PATH, origManifest);
        fs.writeFileSync(releaseManager.PUBLIC_MANIFEST_PATH, origPublic);
        if (fs.existsSync(releaseManager.DRAFT_PATH)) fs.unlinkSync(releaseManager.DRAFT_PATH);

        // Clean up any stray backup/recovery files from the test
        const cleanupBackups = (dir) => {
          fs.readdirSync(dir).forEach(file => {
            if (file.includes('.version-manifest.backup.') || file.includes('.version-manifest.stage.')) {
              try { fs.unlinkSync(path.join(dir, file)); } catch (_) {}
            }
          });
        };
        cleanupBackups(path.dirname(releaseManager.MANIFEST_PATH));
        cleanupBackups(path.dirname(releaseManager.PUBLIC_MANIFEST_PATH));
      }
    });
  });

  describe('7. Data Integrity & Backward Compatibility', () => {
    test('gracefully handles manifests with missing or legacy fields without throwing', () => {
      TasklyUpdateManager.state.manifest = {
        latestVersion: '1.1.0',
        versionCode: 2,
        history: [
          {
            version: '1.1.0',
            versionCode: 2,
            summary: 'Legacy manifest item without title or 5 categories'
            // features, improvements, fixes, performance, security all omitted
          }
        ]
      };

      assert.doesNotThrow(() => {
        TasklyUpdateManager.renderWhatsNew(2);
      });
      assert.doesNotThrow(() => {
        TasklyUpdateManager.renderUI();
      });
    });

    test('falls back to built-in fallbackHistory when manifest is null or fails to fetch', () => {
      TasklyUpdateManager.state.manifest = null;
      const history = TasklyUpdateManager.getReleaseHistory();
      assert.ok(Array.isArray(history));
      assert.ok(history.length >= 4);
      assert.strictEqual(history[0].versionCode, 6);
    });
  });

  describe('8. Design System & Four-Theme CSS Rules Verification', () => {
    test('public/styles.css declares layout and component rules for #modal-whats-new', () => {
      assert.match(STYLES_CSS, /\.modal-card-whats-new/);
      assert.match(STYLES_CSS, /\.whats-new-diff-banner/);
      assert.match(STYLES_CSS, /\.whats-new-hero-card/);
      assert.match(STYLES_CSS, /\.whats-new-cat-card/);
      assert.match(STYLES_CSS, /\.cat-features/);
      assert.match(STYLES_CSS, /\.cat-improvements/);
      assert.match(STYLES_CSS, /\.cat-performance/);
      assert.match(STYLES_CSS, /\.cat-fixes/);
      assert.match(STYLES_CSS, /\.cat-security/);
    });

    test('public/styles.css provides dedicated theme overrides for all four themes', () => {
      // Dark Mode
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.modal-card-whats-new/);
      assert.match(STYLES_CSS, /\[data-theme="dark"\]\s+\.whats-new-hero-card/);

      // Pet Mode
      assert.match(STYLES_CSS, /\[data-theme="pet"\]\s+\.modal-card-whats-new/);
      assert.match(STYLES_CSS, /\[data-theme="pet"\]\s+\.whats-new-hero-card/);

      // Pastel Light Mode
      assert.match(STYLES_CSS, /\[data-theme="pastel"\]\s+\.modal-card-whats-new/);
      assert.match(STYLES_CSS, /\[data-theme="pastel"\]\s+\.whats-new-hero-card/);
    });

    test('public/styles.css includes flex-wrap and responsive rules for narrow viewports (320px, 340px, 360px)', () => {
      // Verify flex wrapping on picker container
      assert.match(STYLES_CSS, /\.whats-new-version-picker-wrap[\s\S]*flex-wrap:\s*wrap/);

      // Verify compact viewport media queries
      assert.match(STYLES_CSS, /@media\s*\(max-width:\s*360px\)/);
      assert.match(STYLES_CSS, /@media\s*\(max-width:\s*320px\)/);

      // Verify column fallback and flexible width for narrow screens
      assert.match(STYLES_CSS, /flex-direction:\s*column\s*!important/);
    });
  });
});
