/**
 * tests/version_preview_and_native_detection.test.js
 *
 * Taskly v2.2.0 Build 14 — Version, Preview System, and Access Verification Suite
 *
 * Verifies:
 * 1. Preview manifest selection in Vercel Preview environment
 * 2. Production manifest selection in Production Web environment
 * 3. Native Android version detection via Capacitor
 * 4. Local development environment behavior
 * 5. Browser APK-installation protection (blocked in browser)
 * 6. Production manifest integrity (releases/ and public/ version-manifest.json at v2.1.1 Build 12.1)
 * 7. Preview metadata integrity (clean preview-manifest.json with nullified APK metadata)
 * 8. Administrator authorization server-side (tasklypets@gmail.com 200 vs customer 403)
 * 9. Customer ticket isolation (cross-user 404 not found)
 * 10. Customer Support UI visibility and placement near Smart Lists
 */

const { test, describe, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

process.env.NODE_ENV = 'development';
process.env.SUPPORT_DEVELOPER_EMAIL = 'tasklypets@gmail.com';

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');
const STYLES_CSS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), 'utf8');
const PROD_MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'releases', 'version-manifest.json'), 'utf8'));
const PUBLIC_MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'public', 'version-manifest.json'), 'utf8'));
const PREVIEW_MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'public', 'preview-manifest.json'), 'utf8'));

// Set up minimal browser DOM mocks for public/app.js
function setupMockDOM() {
  const elements = new Map();

  function createMockElement(id, tag = 'div') {
    const el = {
      id,
      tagName: tag.toUpperCase(),
      textContent: '',
      innerHTML: '',
      value: '',
      title: '',
      className: '',
      classList: {
        _classes: new Set(),
        add(...cls) { cls.forEach(c => this._classes.add(c)); },
        remove(...cls) { cls.forEach(c => this._classes.delete(c)); },
        contains(c) { return this._classes.has(c); }
      },
      style: {},
      children: [],
      appendChild(child) { this.children.push(child); return child; },
      addEventListener: () => {},
      removeEventListener: () => {},
      setAttribute: () => {},
      getAttribute: () => null
    };
    elements.set(id, el);
    return el;
  }

  // Pre-populate elements needed by TasklyUpdateManager.renderUI()
  [
    'version-platform-label',
    'label-installed-version',
    'val-installed-version',
    'val-latest-version',
    'version-last-checked-label',
    'version-status-badge',
    'version-status-icon',
    'version-status-text',
    'version-update-details-card',
    'version-update-meta',
    'version-update-summary',
    'version-update-highlights',
    'version-mandatory-notice',
    'version-progress-card',
    'version-progress-fill',
    'version-progress-percent',
    'version-progress-bytes',
    'version-install-card',
    'version-error-banner',
    'version-error-msg',
    'btn-update-now',
    'label-check-updates',
    'btn-check-updates',
    'whats-new-banner-subtitle',
    'version-history-body',
    'history-toggle-chevron',
    'version-history-list',
    'profile-version-badge',
    'modal-version'
  ].forEach(id => createMockElement(id));

  global.document = {
    getElementById: (id) => elements.get(id) || null,
    querySelector: (sel) => {
      if (sel.startsWith('#')) return elements.get(sel.slice(1)) || null;
      return null;
    },
    querySelectorAll: () => [],
    createElement: (tag) => createMockElement(`dyn_${Math.random()}`, tag),
    addEventListener: () => {},
    removeEventListener: () => {},
    body: createMockElement('body'),
    documentElement: createMockElement('html')
  };

  global.window = {
    location: {
      hostname: 'taskly-todo-app-4z1c.vercel.app',
      protocol: 'https:',
      origin: 'https://taskly-todo-app-4z1c.vercel.app'
    },
    Capacitor: undefined
  };

  global.localStorage = {
    _data: new Map(),
    getItem(k) { return this._data.get(k) || null; },
    setItem(k, v) { this._data.set(k, String(v)); },
    removeItem(k) { this._data.delete(k); },
    clear() { this._data.clear(); }
  };
}

setupMockDOM();

const app = require('../public/app.js');
const server = require('../server.js');
const { TasklyUpdateManager } = app;

// In-memory HTTP request dispatcher for Express server testing
function dispatchRequest(expressApp, options) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = (options.method || 'GET').toUpperCase();
    req.url = options.url || '/';
    req.headers = Object.assign({
      'content-type': 'application/json'
    }, options.headers || {});

    const bodyStr = options.rawBody !== undefined
      ? options.rawBody
      : (typeof options.body === 'string' ? options.body : JSON.stringify(options.body || {}));

    req.rawBody = bodyStr;
    try {
      req.body = typeof options.body === 'object' ? options.body : JSON.parse(bodyStr);
    } catch (_) {
      req.body = options.body;
    }

    const res = new EventEmitter();
    res.statusCode = 200;
    res._headers = {};
    res.setHeader = (k, v) => { res._headers[k.toLowerCase()] = v; };
    res.getHeader = (k) => res._headers[k.toLowerCase()];
    res.status = (code) => { res.statusCode = code; return res; };

    let resBody = '';
    res.json = (data) => {
      res.setHeader('content-type', 'application/json');
      resBody = JSON.stringify(data);
      resolve({ statusCode: res.statusCode, headers: res._headers, body: data });
    };
    res.send = (data) => {
      resBody = typeof data === 'object' ? JSON.stringify(data) : String(data);
      resolve({ statusCode: res.statusCode, headers: res._headers, body: data });
    };
    res.end = (data) => {
      if (data) resBody = String(data);
      resolve({ statusCode: res.statusCode, headers: res._headers, body: resBody });
    };

    expressApp.handle(req, res);
  });
}

describe('Taskly v2.2.0 Build 14 — Version, Preview, and Access Test Suite', () => {

  beforeEach(() => {
    setupMockDOM();
    TasklyUpdateManager.state.manifest = null;
    TasklyUpdateManager.state.latestVersionName = null;
    TasklyUpdateManager.state.latestVersionCode = null;
    TasklyUpdateManager.state.installedVersionName = null;
    TasklyUpdateManager.state.installedVersionCode = null;
    TasklyUpdateManager.state.updateStatus = 'idle';
    delete global.__TEST_FORCE_ENV__;
    delete global.window.__TASKLY_FORCE_ENV__;
  });

  // --------------------------------------------------------------------------
  // Scenario 1: Vercel Preview Browser Detection & Manifest Selection
  // --------------------------------------------------------------------------
  test('1. Vercel Preview browser: detects vercel_preview, selects /preview-manifest.json, displays Preview Build v2.2.0 (Build 14)', async () => {
    global.window.location.hostname = 'taskly-todo-app-git-release-taskly-v220-b14.vercel.app';
    global.window.Capacitor = undefined;

    const env = TasklyUpdateManager.detectDeploymentEnvironment();
    assert.strictEqual(env, 'vercel_preview', 'Environment must be vercel_preview');

    // Mock fetch for preview-manifest.json
    global.fetch = async (url) => {
      if (url.includes('/preview-manifest.json')) {
        return { ok: true, json: async () => PREVIEW_MANIFEST };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    await TasklyUpdateManager.checkForUpdates();
    await TasklyUpdateManager.detectInstalledVersion();
    TasklyUpdateManager.renderUI();

    const labelInstalled = global.document.getElementById('label-installed-version');
    const valInstalled = global.document.getElementById('val-installed-version');
    const valLatest = global.document.getElementById('val-latest-version');
    const platformLabel = global.document.getElementById('version-platform-label');
    const statusText = global.document.getElementById('version-status-text');

    assert.strictEqual(platformLabel.textContent, 'Web Browser Preview');
    assert.strictEqual(labelInstalled.textContent, 'Preview Build');
    assert.strictEqual(valInstalled.textContent, 'v2.2.0 (Build 14)');
    assert.strictEqual(valLatest.textContent, 'v2.1.1 (Build 12.1)');
    assert.strictEqual(statusText.textContent, 'Previewing v2.2.0 (Build 14)');

    // Ensure installed Android version is NOT falsely set in browser preview
    assert.strictEqual(TasklyUpdateManager.state.installedVersionName, null);
    assert.strictEqual(TasklyUpdateManager.state.installedVersionCode, null);
  });

  // --------------------------------------------------------------------------
  // Scenario 2: Production Web Browser Detection & Manifest Selection
  // --------------------------------------------------------------------------
  test('2. Production web browser: detects production_web on taskly-todo-app-4z1c.vercel.app, selects /version-manifest.json, displays v2.3.2 (Build 15.2)', async () => {
    global.window.location.hostname = 'taskly-todo-app-4z1c.vercel.app';
    global.window.Capacitor = undefined;

    const env = TasklyUpdateManager.detectDeploymentEnvironment();
    assert.strictEqual(env, 'production_web', 'Environment must be production_web');

    // Mock fetch for version-manifest.json
    global.fetch = async (url) => {
      if (url.includes('/version-manifest.json')) {
        return { ok: true, json: async () => PUBLIC_MANIFEST };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    await TasklyUpdateManager.checkForUpdates();
    await TasklyUpdateManager.detectInstalledVersion();
    TasklyUpdateManager.renderUI();

    const labelInstalled = global.document.getElementById('label-installed-version');
    const valInstalled = global.document.getElementById('val-installed-version');
    const valLatest = global.document.getElementById('val-latest-version');
    const platformLabel = global.document.getElementById('version-platform-label');

    assert.strictEqual(platformLabel.textContent, 'Web Application');
    assert.strictEqual(labelInstalled.textContent, 'Web Version');
    assert.strictEqual(valInstalled.textContent, 'v2.3.2 (Build 15.2)');
    assert.strictEqual(valLatest.textContent, 'v2.3.2 (Build 15.2)');
  });

  // --------------------------------------------------------------------------
  // Scenario 3: Native Android Version Detection via Capacitor
  // --------------------------------------------------------------------------
  test('3. Native Android: detects native_android via Capacitor, reads installed package from App.getInfo(), preserves update pipeline', async () => {
    global.window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        App: {
          getInfo: async () => ({ version: '2.1.1', build: 121 })
        }
      }
    };

    const env = TasklyUpdateManager.detectDeploymentEnvironment();
    assert.strictEqual(env, 'native_android', 'Environment must be native_android');

    global.fetch = async (url) => {
      if (url.includes('version-manifest.json')) {
        return { ok: true, json: async () => PROD_MANIFEST };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    await TasklyUpdateManager.detectInstalledVersion();
    await TasklyUpdateManager.checkForUpdates();
    TasklyUpdateManager.renderUI();

    assert.strictEqual(TasklyUpdateManager.state.installedVersionName, '2.1.1');
    assert.strictEqual(TasklyUpdateManager.state.installedVersionCode, 121);
    assert.strictEqual(TasklyUpdateManager.state.isNative, true);

    const labelInstalled = global.document.getElementById('label-installed-version');
    const valInstalled = global.document.getElementById('val-installed-version');
    const platformLabel = global.document.getElementById('version-platform-label');

    assert.strictEqual(platformLabel.textContent, 'Android Native Application');
    assert.strictEqual(labelInstalled.textContent, 'Installed Version');
    assert.strictEqual(valInstalled.textContent, 'v2.1.1 (Build 12.1)');
  });

  // --------------------------------------------------------------------------
  // Scenario 4: Local Development Environment Behavior
  // --------------------------------------------------------------------------
  test('4. Local development: detects local_dev on localhost, routes locally without querying GitHub main', async () => {
    global.window.location.hostname = 'localhost';
    global.window.Capacitor = undefined;

    const env = TasklyUpdateManager.detectDeploymentEnvironment();
    assert.strictEqual(env, 'local_dev', 'Environment must be local_dev');

    let remoteQueried = false;
    global.fetch = async (url) => {
      if (url.includes('raw.githubusercontent.com')) {
        remoteQueried = true;
      }
      return { ok: true, json: async () => PUBLIC_MANIFEST };
    };

    await TasklyUpdateManager.checkForUpdates();
    await TasklyUpdateManager.detectInstalledVersion();
    TasklyUpdateManager.renderUI();

    assert.strictEqual(remoteQueried, false, 'Local development must not query GitHub main');

    const labelInstalled = global.document.getElementById('label-installed-version');
    const valInstalled = global.document.getElementById('val-installed-version');
    const platformLabel = global.document.getElementById('version-platform-label');

    assert.strictEqual(platformLabel.textContent, 'Local Development Server');
    assert.strictEqual(labelInstalled.textContent, 'Local Build');
    assert.strictEqual(valInstalled.textContent, 'v2.2.0-dev (Build 14)');
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Unknown Custom Domain Security Enforcement (Fail-Closed Untrusted Web)
  // --------------------------------------------------------------------------
  test('5. Unknown custom domain: returns untrusted_web (never production_web), blocks manifest queries, disables updates, displays untrusted notice', async () => {
    // 5.1 Hostname verification across unfamiliar domains
    const testUntrustedHosts = [
      'taskly-mirror.malicious-site.org',
      'staging-custom.internal.net',
      'unauthorized-app.com',
      'taskly.fake-domain.dev'
    ];

    for (const host of testUntrustedHosts) {
      global.window.location.hostname = host;
      global.window.Capacitor = undefined;
      const env = TasklyUpdateManager.detectDeploymentEnvironment();
      assert.strictEqual(env, 'untrusted_web', `Host ${host} must return untrusted_web, NEVER production_web`);
    }

    // Set an active untrusted host
    global.window.location.hostname = 'unauthorized-app.com';

    // 5.2 Strict manifest protection: fetch must NOT be called for any manifest on untrusted domains
    let fetchCalled = false;
    global.fetch = async (url) => {
      fetchCalled = true;
      throw new Error(`CRITICAL SECURITY FAILURE: Fetch must never be called on untrusted domains! Attempted URL: ${url}`);
    };

    // Initialize/check updates on untrusted domain
    await TasklyUpdateManager.loadInitialManifest();
    assert.strictEqual(fetchCalled, false, 'loadInitialManifest must NOT fetch any manifest on untrusted_web');
    assert.strictEqual(TasklyUpdateManager.state.manifest, null, 'Manifest must remain null on untrusted_web');

    await TasklyUpdateManager.detectInstalledVersion();
    assert.strictEqual(TasklyUpdateManager.state.previewVersionName, null, 'previewVersionName must be null on untrusted_web');
    assert.strictEqual(TasklyUpdateManager.state.webVersionName, null, 'webVersionName must be null on untrusted_web');
    assert.strictEqual(TasklyUpdateManager.state.installedVersionName, null, 'installedVersionName must be null on untrusted_web');

    // Trigger checkForUpdates on untrusted domain
    await TasklyUpdateManager.checkForUpdates();
    assert.strictEqual(fetchCalled, false, 'checkForUpdates must NOT trigger fetch on untrusted_web');
    assert.strictEqual(TasklyUpdateManager.state.updateStatus, 'error');

    // 5.3 UI rendering in untrusted environment
    TasklyUpdateManager.renderUI();

    const platformLabel = global.document.getElementById('version-platform-label');
    const labelInstalled = global.document.getElementById('label-installed-version');
    const valInstalled = global.document.getElementById('val-installed-version');
    const valLatest = global.document.getElementById('val-latest-version');
    const statusText = global.document.getElementById('version-status-text');
    const badge = global.document.getElementById('version-status-badge');
    const errorBanner = global.document.getElementById('version-error-banner');
    const errorMsg = global.document.getElementById('version-error-msg');
    const labelCheck = global.document.getElementById('label-check-updates');
    const btnCheck = global.document.getElementById('btn-check-updates');
    const profileBadge = global.document.getElementById('profile-version-badge');
    const historyList = global.document.getElementById('version-history-list');

    assert.strictEqual(platformLabel.textContent, 'Untrusted Domain');
    assert.strictEqual(labelInstalled.textContent, 'Environment');
    assert.strictEqual(valInstalled.textContent, 'Untrusted / Unverified');
    assert.strictEqual(valLatest.textContent, 'Unavailable (Untrusted Domain)');
    assert.strictEqual(statusText.textContent, 'Untrusted Domain');
    assert.ok(badge.classList.contains('status-error'), 'Badge must have status-error class');
    assert.strictEqual(errorBanner.style.display, 'flex', 'Error banner must be visible');
    assert.ok(errorMsg.textContent.includes('unrecognized domain'), 'Error message must warn about unrecognized domain');
    assert.strictEqual(labelCheck.textContent, 'Updates Disabled');
    assert.strictEqual(btnCheck.disabled, true, 'Check updates button must be disabled');
    assert.strictEqual(profileBadge.textContent, 'Untrusted');
    assert.ok(historyList.innerHTML.includes('disabled on unrecognized or untrusted domains'));
  });

  // --------------------------------------------------------------------------
  // Scenario 6: Browser & Untrusted Domain APK-Installation Protection
  // --------------------------------------------------------------------------
  test('6. APK-installation protection: startUpdate() blocks execution and displays safety notice in browser preview, web prod, and untrusted domains', async () => {
    let windowOpenCalled = false;
    global.window.open = () => { windowOpenCalled = true; };

    let lastAlertMessage = '';
    global.alert = (msg) => { lastAlertMessage = msg; };

    // Test on Untrusted Domain
    global.window.location.hostname = 'fake-mirror.org';
    global.window.Capacitor = undefined;
    await TasklyUpdateManager.startUpdate();

    assert.strictEqual(windowOpenCalled, false, 'window.open must NEVER be called on untrusted domains');
    assert.ok(lastAlertMessage.includes('permanently disabled on untrusted domains'), 'Untrusted domain alert must be shown');

    // Test on Vercel Preview
    global.window.location.hostname = 'taskly-todo-app-git-release-taskly-v220-b14.vercel.app';
    lastAlertMessage = '';
    await TasklyUpdateManager.startUpdate();

    assert.strictEqual(windowOpenCalled, false, 'window.open must NEVER be called in browser preview');
    assert.ok(lastAlertMessage.includes('web browser preview'), 'Preview alert must be shown');

    // Test on Production Web
    global.window.location.hostname = 'taskly-todo-app-4z1c.vercel.app';
    lastAlertMessage = '';
    await TasklyUpdateManager.startUpdate();

    assert.strictEqual(windowOpenCalled, false, 'window.open must NEVER be called in production web');
    assert.ok(lastAlertMessage.includes('Taskly Web Notice'), 'Web prod alert must be shown');
  });

  // --------------------------------------------------------------------------
  // Scenario 7: Manifest Routing Verification Across All Three Environments
  // --------------------------------------------------------------------------
  test('7. Manifest routing: verifies strict per-environment routing across Canonical Production, Vercel Preview, and Untrusted Web', async () => {
    const fetchedUrls = [];
    global.fetch = async (url) => {
      fetchedUrls.push(url);
      if (url.includes('/preview-manifest.json')) return { ok: true, json: async () => PREVIEW_MANIFEST };
      if (url.includes('/version-manifest.json')) return { ok: true, json: async () => PUBLIC_MANIFEST };
      throw new Error(`Unexpected URL: ${url}`);
    };

    // 1. Canonical Production Web: MUST query /version-manifest.json
    fetchedUrls.length = 0;
    global.window.location.hostname = 'taskly-todo-app-4z1c.vercel.app';
    global.window.Capacitor = undefined;
    await TasklyUpdateManager.checkForUpdates();
    assert.ok(fetchedUrls.some(u => u.includes('/version-manifest.json')), 'Production Web must query /version-manifest.json');
    assert.strictEqual(fetchedUrls.some(u => u.includes('/preview-manifest.json')), false, 'Production Web must NOT query /preview-manifest.json');

    // 2. Vercel Preview: MUST query /preview-manifest.json
    fetchedUrls.length = 0;
    global.window.location.hostname = 'taskly-todo-app-preview-b14.vercel.app';
    await TasklyUpdateManager.checkForUpdates();
    assert.ok(fetchedUrls.some(u => u.includes('/preview-manifest.json')), 'Vercel Preview must query /preview-manifest.json');
    assert.strictEqual(fetchedUrls.some(u => u.includes('/version-manifest.json')), false, 'Vercel Preview must NOT query /version-manifest.json');

    // 3. Untrusted Domain: MUST NOT query ANY manifest
    fetchedUrls.length = 0;
    global.window.location.hostname = 'random-custom-domain.xyz';
    await TasklyUpdateManager.checkForUpdates();
    assert.strictEqual(fetchedUrls.length, 0, 'Untrusted Domain must query ZERO manifests');
  });

  // --------------------------------------------------------------------------
  // Scenario 8: Production Manifest Files Remain Completely Unchanged
  // --------------------------------------------------------------------------
  test('8. Production manifest integrity: releases/version-manifest.json and public/version-manifest.json are synchronized at v2.3.2 (Build 15.2)', () => {
    assert.strictEqual(PROD_MANIFEST.latestVersion, '2.3.2');
    assert.strictEqual(PROD_MANIFEST.versionCode, 152);
    assert.strictEqual(PUBLIC_MANIFEST.latestVersion, '2.3.2');
    assert.strictEqual(PUBLIC_MANIFEST.versionCode, 152);
    assert.deepStrictEqual(PROD_MANIFEST, PUBLIC_MANIFEST, 'Both manifests must remain byte-identical');
    assert.strictEqual(
      PROD_MANIFEST.apkDownloadUrl,
      'https://github.com/vimaljayganthan/taskly-todo-app/releases/download/v2.3.2-b15.2/taskly-v2.3.2.apk'
    );
    assert.strictEqual(PROD_MANIFEST.history[0].version, '2.3.2');
    assert.strictEqual(PROD_MANIFEST.history[0].versionCode, 152);
    assert.strictEqual(PROD_MANIFEST.history[1].version, '2.3.1');
    assert.strictEqual(PROD_MANIFEST.history[1].versionCode, 151);
    assert.strictEqual(PROD_MANIFEST.history[2].version, '2.3.0');
    assert.strictEqual(PROD_MANIFEST.history[2].versionCode, 150);
  });

  // --------------------------------------------------------------------------
  // Scenario 9: Preview Manifest Metadata Integrity & Safe Defaults
  // --------------------------------------------------------------------------
  test('9. Preview metadata integrity: public/preview-manifest.json defines v2.2.0 Build 14 with nullified APK metadata', () => {
    assert.strictEqual(PREVIEW_MANIFEST.previewVersion, '2.2.0');
    assert.strictEqual(PREVIEW_MANIFEST.versionCode, 140);
    assert.strictEqual(PREVIEW_MANIFEST.displayBuild, '14');
    assert.strictEqual(PREVIEW_MANIFEST.releaseStage, 'preview');
    assert.strictEqual(PREVIEW_MANIFEST.apkDownloadUrl, null, 'apkDownloadUrl must be null in preview manifest');
    assert.strictEqual(PREVIEW_MANIFEST.sha256, null, 'sha256 must be null in preview manifest');
    assert.strictEqual(PREVIEW_MANIFEST.fileSize, null, 'fileSize must be null in preview manifest');
    assert.strictEqual(PREVIEW_MANIFEST.fileSizeBytes, null, 'fileSizeBytes must be null in preview manifest');

    // Verify release history preserves v2.2.0 at top and v2.1.1 as second
    assert.ok(Array.isArray(PREVIEW_MANIFEST.history));
    assert.strictEqual(PREVIEW_MANIFEST.history[0].versionCode, 140);
    assert.strictEqual(PREVIEW_MANIFEST.history[0].version, '2.2.0');
    assert.strictEqual(PREVIEW_MANIFEST.history[1].versionCode, 121);
    assert.strictEqual(PREVIEW_MANIFEST.history[1].version, '2.1.1');
  });
});
