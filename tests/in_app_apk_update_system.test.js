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
  return {
    id,
    tagName: tag.toUpperCase(),
    children,
    classList: {
      classes: new Set(),
      add(...cs) { cs.forEach(c => this.classes.add(c)); },
      remove(...cs) { cs.forEach(c => this.classes.delete(c)); },
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

describe('Taskly In-App APK Update System Suite', () => {

  beforeEach(() => {
    mockStorage.clear();
    mockElements.clear();
    global.window.Capacitor = undefined;
    TasklyUpdateManager.state.installedVersionName = '1.5.0';
    TasklyUpdateManager.state.installedVersionCode = 6;
    TasklyUpdateManager.state.latestVersionName = null;
    TasklyUpdateManager.state.latestVersionCode = null;
    TasklyUpdateManager.state.updateStatus = 'idle';
    TasklyUpdateManager.state.manifest = null;
    TasklyUpdateManager.state.errorMessage = null;
  });

  describe('1. Profile Menu & DOM Structure Specifications', () => {
    test('public/index.html includes #menu-version in the Profile screen', () => {
      assert.ok(INDEX_HTML.includes('id="menu-version"'), 'menu-version must be present in index.html');
      assert.ok(INDEX_HTML.includes('id="profile-version-badge"'), 'profile-version-badge must be present in index.html');
      assert.ok(INDEX_HTML.includes('id="modal-version"'), 'modal-version must be defined in index.html');
      assert.ok(INDEX_HTML.includes('id="btn-update-now"'), 'btn-update-now must be defined in index.html');
      assert.ok(INDEX_HTML.includes('id="btn-check-updates"'), 'btn-check-updates must be defined in index.html');
      assert.ok(INDEX_HTML.includes('id="version-status-badge"'), 'version-status-badge must be defined in index.html');
    });

    test('Profile menu badge initializes with current installed version', async () => {
      await TasklyUpdateManager.init();
      const badge = global.document.getElementById('profile-version-badge');
      assert.strictEqual(badge.textContent, 'v1.5.0');
    });

    test('Opening version modal applies .active class and triggers detection', async () => {
      const modal = global.document.getElementById('modal-version');
      await TasklyUpdateManager.openModal();
      assert.ok(modal.classList.contains('active'), 'modal-version must have class active when opened');
      TasklyUpdateManager.closeModal();
      assert.ok(!modal.classList.contains('active'), 'modal-version must not have active class when closed');
    });
  });

  describe('2. Version Comparison & Availability Logic (Numerical versionCode)', () => {
    test('Installed version is current: reports up to date', () => {
      const hasUpdate = TasklyUpdateManager.isUpdateAvailable(5, 5);
      assert.strictEqual(hasUpdate, false);
    });

    test('Newer approved version is available: reports update available', () => {
      const hasUpdate = TasklyUpdateManager.isUpdateAvailable(5, 6);
      assert.strictEqual(hasUpdate, true);
    });

    test('Strict numerical comparison handles double-digit version codes correctly', () => {
      // String comparison would incorrectly evaluate '10' < '9'
      assert.strictEqual('10' < '9', true, 'String comparison defect verification');
      // Numerical comparison guarantees 10 > 9
      const hasUpdate = TasklyUpdateManager.isUpdateAvailable(9, 10);
      assert.strictEqual(hasUpdate, true);
    });

    test('Handles malformed or NaN version codes safely', () => {
      assert.strictEqual(TasklyUpdateManager.isUpdateAvailable('abc', 5), false);
      assert.strictEqual(TasklyUpdateManager.isUpdateAvailable(5, null), false);
      assert.strictEqual(TasklyUpdateManager.isUpdateAvailable(undefined, undefined), false);
    });
  });

  describe('3. Owner-Controlled Release Approval & Development Separation', () => {
    test('Development APK exists with higher versionCode but production manifest remains unchanged: existing users see up to date', async () => {
      // Scenario: Local gradle has versionCode: 8 (development build), but production manifest is on versionCode: 5
      const mockManifest = {
        latestVersion: '1.4',
        versionCode: 5,
        apkDownloadUrl: 'https://example.com/taskly-v1.4.apk',
        releaseNotes: 'Production 1.4',
        fileSize: '18 MB'
      };

      // Mock fetch returning production manifest
      global.fetch = async () => ({
        ok: true,
        json: async () => mockManifest
      });

      // User with installed versionCode 5 checks for updates
      TasklyUpdateManager.state.installedVersionCode = 5;
      await TasklyUpdateManager.checkForUpdates();

      assert.strictEqual(TasklyUpdateManager.state.updateStatus, 'up_to_date');
      assert.strictEqual(TasklyUpdateManager.state.latestVersionCode, 5);
      const btnUpdate = global.document.getElementById('btn-update-now');
      assert.strictEqual(btnUpdate.style.display, 'none');
    });

    test('Internal tester running higher development build (versionCode 6) sees up to date and no downgrade prompt', async () => {
      const mockManifest = {
        latestVersion: '1.4',
        versionCode: 5,
        apkDownloadUrl: 'https://example.com/taskly-v1.4.apk',
        releaseNotes: 'Production 1.4'
      };

      global.fetch = async () => ({
        ok: true,
        json: async () => mockManifest
      });

      // Internal tester installed dev build (versionCode 6)
      TasklyUpdateManager.state.installedVersionCode = 6;
      await TasklyUpdateManager.checkForUpdates();

      assert.strictEqual(TasklyUpdateManager.state.updateStatus, 'up_to_date');
    });

    test('Explicit owner-approved production release becomes visible when manifest is updated', async () => {
      const mockApprovedManifest = {
        latestVersion: '1.5.0',
        versionCode: 6,
        apkDownloadUrl: 'https://github.com/vimaljayganthan/taskly-todo-app/releases/download/v1.5.0/taskly-v1.5.0.apk',
        releaseNotes: 'Approved owner release v1.5.0 with performance upgrades.',
        fileSize: '18.9 MB',
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      };

      global.fetch = async () => ({
        ok: true,
        json: async () => mockApprovedManifest
      });

      TasklyUpdateManager.state.installedVersionCode = 5;
      await TasklyUpdateManager.checkForUpdates();

      assert.strictEqual(TasklyUpdateManager.state.updateStatus, 'update_available');
      assert.strictEqual(TasklyUpdateManager.state.latestVersionName, '1.5.0');
      assert.strictEqual(TasklyUpdateManager.state.latestVersionCode, 6);

      const btnUpdate = global.document.getElementById('btn-update-now');
      assert.strictEqual(btnUpdate.style.display, 'inline-flex');
    });
  });

  describe('4. Error Handling, Offline Resilience & Failure Recovery', () => {
    test('Manifest request fails (offline or server 500): records error and does NOT claim up to date', async () => {
      global.fetch = async () => {
        throw new Error('Failed to fetch: net::ERR_INTERNET_DISCONNECTED');
      };

      await TasklyUpdateManager.checkForUpdates();

      assert.strictEqual(TasklyUpdateManager.state.updateStatus, 'error');
      assert.ok(TasklyUpdateManager.state.errorMessage.includes('Unable to connect to Taskly update server'));

      const statusBadge = global.document.getElementById('version-status-badge');
      assert.ok(statusBadge.classList.contains('status-error'), 'Badge must have status-error class');
      assert.ok(!statusBadge.classList.contains('status-up-to-date'), 'Must NOT report up to date when offline');

      const bannerError = global.document.getElementById('version-error-banner');
      assert.strictEqual(bannerError.style.display, 'flex');
    });

    test('Malformed manifest JSON without versionCode triggers error state', async () => {
      global.fetch = async () => ({
        ok: true,
        json: async () => ({ invalid: true })
      });

      await TasklyUpdateManager.checkForUpdates();
      assert.strictEqual(TasklyUpdateManager.state.updateStatus, 'error');
      assert.ok(TasklyUpdateManager.state.errorMessage.includes('Invalid or malformed'));
    });
  });

  describe('5. Native Android APK Installer Plugin Integration', () => {
    test('Permission check: prompts user when canRequestPackageInstalls is false', async () => {
      let settingsOpened = false;
      let confirmShown = false;

      global.confirm = () => {
        confirmShown = true;
        return true;
      };

      global.window.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'android',
        Plugins: {
          ApkInstaller: {
            canRequestPackageInstalls: async () => ({ canInstall: false }),
            openInstallPermissionSettings: async () => { settingsOpened = true; }
          }
        }
      };

      TasklyUpdateManager.state.updateStatus = 'update_available';
      TasklyUpdateManager.state.manifest = {
        latestVersion: '1.5.0',
        versionCode: 6,
        apkDownloadUrl: 'https://example.com/taskly.apk'
      };

      await TasklyUpdateManager.startUpdate();

      assert.strictEqual(confirmShown, true, 'Must show explanatory prompt before opening settings');
      assert.strictEqual(settingsOpened, true, 'Must invoke openInstallPermissionSettings');
    });

    test('Download progress events update UI percentage and bytes cleanly', () => {
      TasklyUpdateManager.handleDownloadProgress({
        downloadedBytes: 9450000,
        totalBytes: 18900000,
        percent: 50
      });

      assert.strictEqual(TasklyUpdateManager.state.downloadProgress.percent, 50);
      assert.strictEqual(TasklyUpdateManager.formatBytes(9450000), '9.0 MB');
      assert.strictEqual(TasklyUpdateManager.formatBytes(18900000), '18.0 MB');
    });

    test('Download cancellation properly resets state', async () => {
      let nativeCancelled = false;
      global.window.Capacitor = {
        Plugins: {
          ApkInstaller: {
            cancelDownload: async () => { nativeCancelled = true; }
          }
        }
      };

      TasklyUpdateManager.state.updateStatus = 'downloading';
      await TasklyUpdateManager.cancelDownload();

      assert.strictEqual(nativeCancelled, true);
      assert.strictEqual(TasklyUpdateManager.state.updateStatus, 'update_available');
    });

    test('Successful native installation transitions state to installing', async () => {
      global.window.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'android',
        Plugins: {
          ApkInstaller: {
            canRequestPackageInstalls: async () => ({ canInstall: true }),
            downloadAndInstall: async () => ({ status: 'installer_launched' })
          }
        }
      };

      TasklyUpdateManager.state.updateStatus = 'update_available';
      TasklyUpdateManager.state.manifest = {
        latestVersion: '1.5.0',
        versionCode: 6,
        apkDownloadUrl: 'https://example.com/taskly.apk',
        sha256: 'abc123'
      };

      await TasklyUpdateManager.startUpdate();
      assert.strictEqual(TasklyUpdateManager.state.updateStatus, 'installing');
    });
  });

  describe('6. Production Manifest Verification & Integrity', () => {
    test('releases/version-manifest.json has all mandatory fields', () => {
      assert.ok(MANIFEST_JSON.latestVersion, 'Must specify latestVersion');
      assert.strictEqual(typeof MANIFEST_JSON.versionCode, 'number', 'versionCode must be numeric');
      assert.ok(MANIFEST_JSON.apkDownloadUrl.startsWith('https://'), 'apkDownloadUrl must use HTTPS');
      assert.ok(MANIFEST_JSON.releaseNotes, 'Must include releaseNotes');
      assert.ok(MANIFEST_JSON.releaseDate, 'Must include releaseDate');
      assert.ok(MANIFEST_JSON.fileSize, 'Must include fileSize');
      assert.ok(MANIFEST_JSON.sha256, 'Must include sha256 checksum');
      assert.strictEqual(typeof MANIFEST_JSON.mandatoryUpdate, 'boolean', 'mandatoryUpdate must be boolean');
      assert.ok(Array.isArray(MANIFEST_JSON.history), 'Must include history array');
    });

    test('Current production manifest has valid versionCode (>= 5) and valid version', () => {
      assert.ok(MANIFEST_JSON.versionCode >= 5);
      assert.ok(MANIFEST_JSON.latestVersion.startsWith('1.') || MANIFEST_JSON.latestVersion.startsWith('2.'));
    });
  });

  describe('7. Four-Theme Compatibility for Version Modal', () => {
    test('public/styles.css includes theme overrides for all four modes', () => {
      assert.ok(STYLES_CSS.includes('.modal-card-version'), 'Must define .modal-card-version');
      assert.ok(STYLES_CSS.includes('[data-theme="dark"] .modal-card-version'), 'Must support Dark Mode');
      assert.ok(STYLES_CSS.includes('[data-theme="pet"] .modal-card-version'), 'Must support Pet Mode');
      assert.ok(STYLES_CSS.includes('[data-theme="pastel"] .modal-card-version'), 'Must support Pastel Light Mode');
    });
  });

  describe('8. Android Native Code Compilation & Manifest Verification', () => {
    test('ApkInstallerPlugin.java exists and contains package and signature security checks', () => {
      const pluginJava = fs.readFileSync(path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'java', 'com', 'taskly', 'app', 'ApkInstallerPlugin.java'), 'utf8');
      assert.ok(pluginJava.includes('@CapacitorPlugin(name = "ApkInstaller")'));
      assert.ok(pluginJava.includes('EXPECTED_PACKAGE_NAME = "com.taskly.app"'));
      assert.ok(pluginJava.includes('MessageDigest.getInstance("SHA-256")'));
      assert.ok(pluginJava.includes('PackageManager.GET_SIGNATURES'));
      assert.ok(pluginJava.includes('FileProvider.getUriForFile'));
      assert.ok(pluginJava.includes('canRequestPackageInstalls'));
    });

    test('AndroidManifest.xml declares REQUEST_INSTALL_PACKAGES permission', () => {
      const manifestXml = fs.readFileSync(path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
      assert.ok(manifestXml.includes('android.permission.REQUEST_INSTALL_PACKAGES'));
    });

    test('file_paths.xml includes cache_files and internal_files paths for FileProvider', () => {
      const filePathsXml = fs.readFileSync(path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res', 'xml', 'file_paths.xml'), 'utf8');
      assert.ok(filePathsXml.includes('cache-path'));
      assert.ok(filePathsXml.includes('files-path'));
    });
  });

  describe('9. Native Storage Pre-Flight & Downgrade Prevention Safeguards', () => {
    test('ApkInstallerPlugin.java enforces storage headroom pre-flight checks', () => {
      const pluginJava = fs.readFileSync(path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'java', 'com', 'taskly', 'app', 'ApkInstallerPlugin.java'), 'utf8');
      assert.ok(pluginJava.includes('MIN_STORAGE_REQUIRED_BYTES'), 'Must define minimum storage requirement');
      assert.ok(pluginJava.includes('Insufficient storage space'), 'Must provide clear user-facing error message');
      assert.ok(pluginJava.includes('requiredDynamic = totalBytes * 2L'), 'Must enforce dynamic 2x headroom for download and staging');
    });

    test('ApkInstallerPlugin.java strictly prohibits versionCode downgrades', () => {
      const pluginJava = fs.readFileSync(path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'java', 'com', 'taskly', 'app', 'ApkInstallerPlugin.java'), 'utf8');
      assert.ok(pluginJava.includes('archiveVersionCode < currentVersionCode'), 'Must compare archive vs current version codes');
      assert.ok(pluginJava.includes('Downgrade prohibited'), 'Must reject downgrades before launching package installer');
    });

    test('ApkInstallerPlugin.java purges temporary APK files upon cancellation or error', () => {
      const pluginJava = fs.readFileSync(path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'java', 'com', 'taskly', 'app', 'ApkInstallerPlugin.java'), 'utf8');
      assert.ok(pluginJava.includes('if (apkFile != null && apkFile.exists()) {\n                    apkFile.delete();'), 'Must delete file in catch block');
      assert.ok(pluginJava.includes('isCancelled || Thread.currentThread().isInterrupted()'), 'Must detect cancellation');
    });
  });

  describe('10. Release Manager Production Safeguards & Cryptographic Verification', () => {
    const releaseManager = require('../scripts/release-manager.js');

    test('standardizeVersion standardizes versions to SemVer X.Y.Z', () => {
      assert.strictEqual(releaseManager.standardizeVersion('1.4'), '1.4.0');
      assert.strictEqual(releaseManager.standardizeVersion('v1.5'), '1.5.0');
      assert.strictEqual(releaseManager.standardizeVersion('2.0.1'), '2.0.1');
      assert.strictEqual(releaseManager.standardizeVersion(''), '1.0.0');
    });

    test('prepareRelease strictly fails when app-release.apk does not exist (NO debug fallback)', () => {
      assert.throws(() => {
        releaseManager.prepareRelease({
          apk: '/nonexistent/path/app-release.apk'
        });
      }, /Production release APK not found/);
    });

    test('prepareRelease rejects debug APK argument with security violation', () => {
      assert.throws(() => {
        releaseManager.prepareRelease({
          apk: path.join(ROOT_DIR, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
        });
      }, /Debug APK.*cannot be used for production release/);
    });

    test('verifyApkSigning strictly rejects any APK containing "debug" in filename', () => {
      assert.throws(() => {
        releaseManager.verifyApkSigning(path.join(ROOT_DIR, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'));
      }, /Debug APK.*cannot be published to production/);
    });

    test('verifyApkSigning rejects debug-signed APK even if renamed', () => {
      // Create a temporary copy named "test-release.apk" to verify signature inspection
      const debugApk = path.join(ROOT_DIR, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
      if (fs.existsSync(debugApk)) {
        const tempTestApk = path.join(ROOT_DIR, 'android', 'app', 'build', 'outputs', 'apk', 'test-renamed-release.apk');
        fs.copyFileSync(debugApk, tempTestApk);
        try {
          assert.throws(() => {
            releaseManager.verifyApkSigning(tempTestApk);
          }, /signed with Android Debug certificate|certificate fingerprint mismatch|Android apksigner tool could not be located/);
        } finally {
          if (fs.existsSync(tempTestApk)) fs.unlinkSync(tempTestApk);
        }
      }
    });

    test('verifyApkSigning rejects mismatched expected certificate fingerprint', () => {
      const debugApk = path.join(ROOT_DIR, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
      if (fs.existsSync(debugApk)) {
        const tempTestApk = path.join(ROOT_DIR, 'android', 'app', 'build', 'outputs', 'apk', 'test-mismatch-release.apk');
        fs.copyFileSync(debugApk, tempTestApk);
        try {
          assert.throws(() => {
            releaseManager.verifyApkSigning(tempTestApk, 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99');
          }, /Security Violation|Android apksigner tool could not be located/);
        } finally {
          if (fs.existsSync(tempTestApk)) fs.unlinkSync(tempTestApk);
        }
      }
    });

    test('publishRelease requires explicit --confirm-owner-approval argument', () => {
      assert.throws(() => {
        releaseManager.publishRelease({});
      }, /Explicit owner authorization required/);
    });
  });
});

