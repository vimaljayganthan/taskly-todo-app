const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Setup minimal DOM environment for node:test
function setupMockDOM() {
  const elements = new Map();
  const attributes = new Map();
  const styles = new Map();

  const mockElement = (id = '') => {
    const elAttrs = new Map();
    const elStyles = new Map();
    const classList = new Set();
    const children = [];

    const obj = {
      id,
      tagName: 'DIV',
      style: {
        setProperty(prop, val) { elStyles.set(prop, String(val)); },
        removeProperty(prop) { elStyles.delete(prop); },
        getPropertyValue(prop) { return elStyles.get(prop) || ''; },
        display: 'block'
      },
      classList: {
        add(cls) { classList.add(cls); },
        remove(cls) { classList.delete(cls); },
        toggle(cls, force) {
          if (force !== undefined) {
            if (force) classList.add(cls);
            else classList.delete(cls);
            return force;
          }
          if (classList.has(cls)) { classList.delete(cls); return false; }
          classList.add(cls); return true;
        },
        contains(cls) { return classList.has(cls); }
      },
      setAttribute(name, val) { elAttrs.set(name, String(val)); },
      getAttribute(name) { return elAttrs.get(name) || null; },
      removeAttribute(name) { elAttrs.delete(name); },
      appendChild(child) { children.push(child); return child; },
      addEventListener(evt, fn) {},
      removeEventListener(evt, fn) {},
      children,
      innerHTML: '',
      textContent: ''
    };
    return obj;
  };

  const docEl = mockElement('html');
  const bodyEl = mockElement('body');

  const listeners = new Map();

  global.window = {
    location: {
      protocol: 'http:',
      host: 'localhost:3000',
      hostname: 'localhost',
      port: '3000',
      origin: 'http://localhost:3000',
      pathname: '/',
      hash: '',
      href: 'http://localhost:3000/'
    },
    innerWidth: 390,
    innerHeight: 844,
    devicePixelRatio: 2.0,
    screen: { width: 390, height: 844 },
    addEventListener(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, []);
      listeners.get(evt).push(fn);
    },
    removeEventListener(evt, fn) {
      if (!listeners.has(evt)) return;
      const arr = listeners.get(evt).filter(f => f !== fn);
      listeners.set(evt, arr);
    },
    getComputedStyle(el) {
      return {
        fontSize: '16px',
        getPropertyValue: (p) => el?.style?.getPropertyValue(p) || ''
      };
    },
    visualViewport: {
      width: 390,
      height: 844,
      addEventListener(evt, fn) {}
    },
    Capacitor: {
      Plugins: {
        DeviceCompat: {
          getDeviceProfile: async () => ({
            manufacturer: 'OnePlus',
            brand: 'OnePlus',
            model: 'CPH2413',
            product: 'taskly',
            androidVersion: '14',
            sdkInt: 34,
            platform: 'android',
            density: 2.625,
            densityDpi: 420
          })
        }
      }
    }
  };

  global.document = {
    documentElement: docEl,
    body: bodyEl,
    getElementById(id) {
      if (id === 'html') return docEl;
      if (id === 'body') return bodyEl;
      if (!elements.has(id)) {
        elements.set(id, mockElement(id));
      }
      return elements.get(id);
    },
    createElement(tag) {
      return mockElement(tag);
    },
    addEventListener(evt, fn) {}
  };

  global.navigator = {
    userAgent: 'Mozilla/5.0 (Linux; Android 14; CPH2413 Build/UKQ1.230924.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
    platform: 'Linux armv8l',
    userAgentData: { platform: 'Android' }
  };

  global.localStorage = {
    store: new Map(),
    getItem(k) { return this.store.get(k) || null; },
    setItem(k, v) { this.store.set(k, String(v)); },
    removeItem(k) { this.store.delete(k); },
    clear() { this.store.clear(); }
  };
}

// Load app.js exports
setupMockDOM();
const app = require('../public/app.js');
const {
  DeviceInfoService,
  ResponsiveLayoutManager,
  OEMCompatibilityManager,
  ThemeManager,
  SmartListsManager,
  state
} = app;

describe('Taskly Universal Android Device-Adaptive UI Compatibility Suite', () => {

  beforeEach(() => {
    setupMockDOM();
    DeviceInfoService.clearCache();
  });

  // ==========================================================================
  // Section 1: DeviceInfoService Detection & Normalization
  // ==========================================================================
  describe('1. DeviceInfoService: Hardware & OEM Detection', () => {

    test('1.1. Native Bridge: OnePlus device returns normalized "oneplus" profile', async () => {
      DeviceInfoService.setMockNativeProfile({
        manufacturer: 'OnePlus',
        brand: 'OnePlus',
        model: 'CPH2413',
        product: 'OnePlus11',
        androidVersion: '14',
        sdkInt: 34,
        platform: 'android',
        density: 2.75,
        screenWidthPixels: 1080,
        screenHeightPixels: 2412
      });

      const profile = await DeviceInfoService.getProfile(true);
      assert.equal(profile.manufacturer, 'oneplus');
      assert.equal(profile.brand, 'OnePlus');
      assert.equal(profile.model, 'CPH2413');
      assert.equal(profile.androidVersion, '14');
      assert.equal(profile.sdkInt, 34);
      assert.equal(profile.platform, 'native_android');
      assert.equal(profile.os, 'android');
    });

    test('1.2. Native Bridge: Samsung Galaxy device returns normalized "samsung" profile', async () => {
      DeviceInfoService.setMockNativeProfile({
        manufacturer: 'samsung',
        brand: 'samsung',
        model: 'SM-S918B',
        product: 'dm3q',
        androidVersion: '14',
        sdkInt: 34,
        platform: 'android',
        density: 3.0
      });

      const profile = await DeviceInfoService.getProfile(true);
      assert.equal(profile.manufacturer, 'samsung');
      assert.equal(profile.model, 'SM-S918B');
      assert.equal(profile.platform, 'native_android');
    });

    test('1.3. Native Bridge: Xiaomi device returns normalized "xiaomi" profile', async () => {
      DeviceInfoService.setMockNativeProfile({
        manufacturer: 'Xiaomi',
        brand: 'Xiaomi',
        model: '2210132G',
        product: 'nuwa',
        androidVersion: '13',
        sdkInt: 33,
        platform: 'android'
      });

      const profile = await DeviceInfoService.getProfile(true);
      assert.equal(profile.manufacturer, 'xiaomi');
    });

    test('1.4. Native Bridge: POCO device returns normalized "poco" profile', async () => {
      DeviceInfoService.setMockNativeProfile({
        manufacturer: 'Xiaomi',
        brand: 'POCO',
        model: '23049PCD8G',
        product: 'marble',
        androidVersion: '13',
        sdkInt: 33,
        platform: 'android'
      });

      const profile = await DeviceInfoService.getProfile(true);
      assert.equal(profile.manufacturer, 'poco');
    });

    test('1.5. Native Bridge: Redmi device returns normalized "redmi" profile', async () => {
      DeviceInfoService.setMockNativeProfile({
        manufacturer: 'Xiaomi',
        brand: 'Redmi',
        model: '2201117TY',
        product: 'spes',
        androidVersion: '12',
        sdkInt: 31,
        platform: 'android'
      });

      const profile = await DeviceInfoService.getProfile(true);
      assert.equal(profile.manufacturer, 'redmi');
    });

    test('1.6. Native Bridge: realme device returns normalized "realme" profile', async () => {
      DeviceInfoService.setMockNativeProfile({
        manufacturer: 'realme',
        brand: 'realme',
        model: 'RMX3301',
        product: 'RMX3301',
        androidVersion: '13',
        sdkInt: 33,
        platform: 'android'
      });

      const profile = await DeviceInfoService.getProfile(true);
      assert.equal(profile.manufacturer, 'realme');
    });

    test('1.7. Native Bridge: Vivo device returns normalized "vivo" profile', async () => {
      DeviceInfoService.setMockNativeProfile({
        manufacturer: 'vivo',
        brand: 'vivo',
        model: 'V2250',
        product: 'V2250',
        androidVersion: '14',
        sdkInt: 34,
        platform: 'android'
      });

      const profile = await DeviceInfoService.getProfile(true);
      assert.equal(profile.manufacturer, 'vivo');
    });

    test('1.8. Native Bridge: OPPO device returns normalized "oppo" profile', async () => {
      DeviceInfoService.setMockNativeProfile({
        manufacturer: 'OPPO',
        brand: 'OPPO',
        model: 'CPH2437',
        product: 'CPH2437',
        androidVersion: '13',
        sdkInt: 33,
        platform: 'android'
      });

      const profile = await DeviceInfoService.getProfile(true);
      assert.equal(profile.manufacturer, 'oppo');
    });

    test('1.9. Native Bridge: Motorola device returns normalized "motorola" profile', async () => {
      DeviceInfoService.setMockNativeProfile({
        manufacturer: 'motorola',
        brand: 'motorola',
        model: 'moto g84 5G',
        product: 'penangf',
        androidVersion: '13',
        sdkInt: 33,
        platform: 'android'
      });

      const profile = await DeviceInfoService.getProfile(true);
      assert.equal(profile.manufacturer, 'motorola');
    });

    test('1.10. Browser/UA Fallback: correctly parses and normalizes user agents when native is absent', () => {
      const testCases = [
        { ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro Build/UD1A.230803.041)', expectedOEM: 'google' },
        { ua: 'Mozilla/5.0 (Linux; Android 13; SM-G998B Build/TP1A.220624.014)', expectedOEM: 'samsung' },
        { ua: 'Mozilla/5.0 (Linux; Android 12; OnePlus 9 Pro Build/SKQ1.210216.001)', expectedOEM: 'oneplus' },
        { ua: 'Mozilla/5.0 (Linux; Android 13; 2210132G Build/TKQ1.220829.002; Xiaomi)', expectedOEM: 'xiaomi' },
        { ua: 'Mozilla/5.0 (Linux; Android 12; POCO F4 Build/SKQ1.211006.001)', expectedOEM: 'poco' },
        { ua: 'Mozilla/5.0 (Linux; Android 13; RMX3301 Build/TP1A.220905.001; realme)', expectedOEM: 'realme' },
        { ua: 'Mozilla/5.0 (Linux; Android 13; V2250 Build/TP1A.220624.014; vivo)', expectedOEM: 'vivo' },
        { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', expectedOEM: 'generic' }
      ];

      for (const tc of testCases) {
        const raw = DeviceInfoService.detectManufacturerFromUA(tc.ua);
        const oem = DeviceInfoService.normalizeOEM(raw, raw, tc.ua);
        assert.equal(oem, tc.expectedOEM, `Failed to normalize UA: ${tc.ua}`);
      }
    });

    test('1.11. Session caching: multiple calls reuse cached profile without performance degradation', async () => {
      DeviceInfoService.setMockNativeProfile({
        manufacturer: 'OnePlus',
        model: 'CPH2413',
        platform: 'android'
      });

      const first = await DeviceInfoService.getProfile();
      assert.equal(first.manufacturer, 'oneplus');

      // Mutate mock; without forceRefresh it must return the cached instance
      DeviceInfoService._mockNativeProfile = { manufacturer: 'Samsung', model: 'SM-S918B', platform: 'android' };
      const second = await DeviceInfoService.getProfile();
      assert.equal(second.manufacturer, 'oneplus');

      // With forceRefresh, it picks up new profile
      const third = await DeviceInfoService.getProfile(true);
      assert.equal(third.manufacturer, 'samsung');
    });
  });

  // ==========================================================================
  // Section 2: ResponsiveLayoutManager Viewport & Orientation Engine
  // ==========================================================================
  describe('2. ResponsiveLayoutManager: Dynamic Fluid Viewport & Orientation', () => {

    test('2.1. Width category classification matches all 11 required test widths', () => {
      const widthTests = [
        { width: 320, expected: 'compact' },
        { width: 340, expected: 'compact' },
        { width: 360, expected: 'standard' },
        { width: 375, expected: 'standard' },
        { width: 390, expected: 'standard' },
        { width: 412, expected: 'standard' },
        { width: 430, expected: 'standard' },
        { width: 480, expected: 'standard' },
        { width: 600, expected: 'tablet' },
        { width: 768, expected: 'tablet' },
        { width: 800, expected: 'desktop' }
      ];

      for (const t of widthTests) {
        const cat = ResponsiveLayoutManager.calculateViewportCategory(t.width);
        assert.equal(cat, t.expected, `Width ${t.width} should be classified as "${t.expected}", got "${cat}"`);
      }
    });

    test('2.2. Font scale categorization matches all 6 required scale levels', () => {
      const scaleTests = [
        { scale: 1.0, expected: 'normal' },
        { scale: 1.15, expected: 'normal' },
        { scale: 1.30, expected: 'medium' },
        { scale: 1.50, expected: 'large' },
        { scale: 1.80, expected: 'xlarge' },
        { scale: 2.00, expected: 'xlarge' }
      ];

      for (const t of scaleTests) {
        const cat = ResponsiveLayoutManager.calculateFontScaleCategory(t.scale);
        assert.equal(cat, t.expected, `Scale ${t.scale} should be "${t.expected}", got "${cat}"`);
      }
    });

    test('2.3. ResponsiveLayoutManager.applyLayout updates root attributes and CSS variables', () => {
      const mockProfile = {
        manufacturer: 'oneplus',
        platform: 'native_android',
        viewportWidth: 412,
        viewportHeight: 915,
        fontScale: 1.3,
        orientation: 'portrait'
      };

      ResponsiveLayoutManager.applyLayout(mockProfile);

      const root = document.documentElement;
      assert.equal(root.getAttribute('data-device-oem'), 'oneplus');
      assert.equal(root.getAttribute('data-device-platform'), 'native_android');
      assert.equal(root.getAttribute('data-viewport-category'), 'standard');
      assert.equal(root.getAttribute('data-orientation'), 'portrait');
      assert.equal(root.getAttribute('data-font-scale'), 'medium');

      assert.equal(root.style.getPropertyValue('--app-height'), '915px');
      assert.equal(root.style.getPropertyValue('--vh'), '9.15px');
      assert.equal(root.style.getPropertyValue('--font-scale-factor'), '1.3');
    });

    test('2.4. Landscape orientation is correctly detected and applied', () => {
      const mockProfile = {
        manufacturer: 'samsung',
        platform: 'native_android',
        viewportWidth: 915,
        viewportHeight: 412,
        fontScale: 1.0,
        orientation: 'landscape'
      };

      ResponsiveLayoutManager.applyLayout(mockProfile);

      const root = document.documentElement;
      assert.equal(root.getAttribute('data-viewport-category'), 'desktop');
      assert.equal(root.getAttribute('data-orientation'), 'landscape');
      assert.equal(root.style.getPropertyValue('--app-height'), '412px');
    });
  });

  // ==========================================================================
  // Section 3: Centralized OEM Compatibility Layer
  // ==========================================================================
  describe('3. OEMCompatibilityManager: Verified Manufacturer Exceptions', () => {

    test('3.1. Registry defines configs for all target manufacturers', () => {
      const requiredOEMs = ['universal', 'oneplus', 'realme', 'xiaomi', 'redmi', 'poco', 'samsung', 'vivo', 'oppo', 'motorola', 'generic'];
      const verifiedList = OEMCompatibilityManager.getVerifiedOEMList();

      for (const oem of requiredOEMs) {
        if (oem === 'universal') continue;
        assert.ok(verifiedList.includes(oem), `Missing OEM in verified list: ${oem}`);
        const cfg = OEMCompatibilityManager.getOEMConfig(oem);
        assert.ok(cfg, `Missing config object for ${oem}`);
        assert.ok(cfg.name, `Missing name for ${oem}`);
      }
    });

    test('3.2. OnePlus/OPPO/realme config applies gesture safe area bottom extra', () => {
      const root = document.documentElement;
      const opProfile = { manufacturer: 'oneplus' };
      OEMCompatibilityManager.applyOEMAdjustments(opProfile);
      assert.equal(root.style.getPropertyValue('--oem-bottom-inset-extra'), '4px');

      const realmeProfile = { manufacturer: 'realme' };
      OEMCompatibilityManager.applyOEMAdjustments(realmeProfile);
      assert.equal(root.style.getPropertyValue('--oem-bottom-inset-extra'), '4px');
    });

    test('3.3. Generic and Samsung profiles do not apply redundant extra bottom insets', () => {
      const root = document.documentElement;
      const samsungProfile = { manufacturer: 'samsung' };
      OEMCompatibilityManager.applyOEMAdjustments(samsungProfile);
      assert.equal(root.style.getPropertyValue('--oem-bottom-inset-extra'), '');

      const genericProfile = { manufacturer: 'generic' };
      OEMCompatibilityManager.applyOEMAdjustments(genericProfile);
      assert.equal(root.style.getPropertyValue('--oem-bottom-inset-extra'), '');
    });
  });

  // ==========================================================================
  // Section 4: Theme Consistency & Strict Decoupling
  // ==========================================================================
  describe('4. ThemeManager: Theme Consistency & Strict Decoupling', () => {

    test('4.1. Supported themes: light, day, dark, pet, pastel are all preserved', () => {
      const themes = ThemeManager.getAvailableThemes();
      assert.deepEqual(themes, ['light', 'day', 'dark', 'pet', 'pastel']);
    });

    test('4.2. Switching themes updates state and documentElement correctly', () => {
      ThemeManager.setTheme('dark');
      assert.equal(ThemeManager.getTheme(), 'dark');
      assert.equal(document.documentElement.getAttribute('data-theme'), 'dark');

      ThemeManager.setTheme('pastel');
      assert.equal(ThemeManager.getTheme(), 'pastel');
      assert.equal(document.documentElement.getAttribute('data-theme'), 'pastel');

      ThemeManager.setTheme('day');
      assert.equal(ThemeManager.getTheme(), 'day');
      assert.equal(document.documentElement.getAttribute('data-theme'), 'day');
    });

    test('4.3. Device detection switching NEVER mutates or overrides user theme', async () => {
      // User sets Pastel theme
      ThemeManager.setTheme('pastel');
      assert.equal(ThemeManager.getTheme(), 'pastel');

      // OnePlus device detected
      DeviceInfoService.setMockNativeProfile({ manufacturer: 'OnePlus', model: 'CPH2413', platform: 'android' });
      const opProfile = await DeviceInfoService.getProfile(true);
      ResponsiveLayoutManager.applyLayout(opProfile);

      assert.equal(document.documentElement.getAttribute('data-device-oem'), 'oneplus');
      assert.equal(document.documentElement.getAttribute('data-theme'), 'pastel', 'OnePlus detection must not change theme');
      assert.ok(ThemeManager.assertThemeIntegrity('pastel'));

      // Xiaomi device detected
      DeviceInfoService.setMockNativeProfile({ manufacturer: 'Xiaomi', model: '2210132G', platform: 'android' });
      const miProfile = await DeviceInfoService.getProfile(true);
      ResponsiveLayoutManager.applyLayout(miProfile);

      assert.equal(document.documentElement.getAttribute('data-device-oem'), 'xiaomi');
      assert.equal(document.documentElement.getAttribute('data-theme'), 'pastel', 'Xiaomi detection must not change theme');
      assert.ok(ThemeManager.assertThemeIntegrity('pastel'));

      // Samsung device detected
      DeviceInfoService.setMockNativeProfile({ manufacturer: 'samsung', model: 'SM-S918B', platform: 'android' });
      const samProfile = await DeviceInfoService.getProfile(true);
      ResponsiveLayoutManager.applyLayout(samProfile);

      assert.equal(document.documentElement.getAttribute('data-device-oem'), 'samsung');
      assert.equal(document.documentElement.getAttribute('data-theme'), 'pastel', 'Samsung detection must not change theme');
      assert.ok(ThemeManager.assertThemeIntegrity('pastel'));
    });
  });

  // ==========================================================================
  // Section 5: Smart Lists 12 UI Areas & Functional Integrity
  // ==========================================================================
  describe('5. Smart Lists UI & Functional Regression Integrity', () => {

    test('5.1. Smart Lists empty state vs routine list: no duplicate Add Routine action', () => {
      SmartListsManager.state.routines = [];
      SmartListsManager.state.activeDate = '2026-11-18';
      SmartListsManager.state.isLoadingRoutines = false;
      SmartListsManager.state.loadError = null;

      SmartListsManager.renderRoutines();

      const emptyState = document.getElementById('smart-empty-state');
      const addBox = document.getElementById('smart-add-routine-box');

      assert.equal(emptyState.style.display, 'flex', 'Empty state should be visible when 0 routines exist');
      assert.equal(addBox.style.display, 'none', 'Duplicate add routine button above empty state must be hidden');
    });

    test('5.2. When routine exists, routine card renders cleanly with actions and status pill', () => {
      SmartListsManager.state.routines = [
        { id: 'routine-1', title: 'Hii', createdAt: '2026-11-18T00:00:00Z' }
      ];
      SmartListsManager.state.activeDate = '2026-11-18';
      SmartListsManager.state.completions = {};
      SmartListsManager.state.isLoadingRoutines = false;

      SmartListsManager.renderRoutines();

      const emptyState = document.getElementById('smart-empty-state');
      const addBox = document.getElementById('smart-add-routine-box');
      const list = document.getElementById('smart-routines-list');

      assert.equal(emptyState.style.display, 'none', 'Empty state should be hidden when routines exist');
      assert.equal(addBox.style.display, 'block', 'Add routine button should be visible when routines exist');
      assert.ok(list.children.length >= 1, 'Routine card should be added to list');
    });

    test('5.3. Tomorrow routines section updates count and renders correctly', () => {
      SmartListsManager.state.tomorrowRoutines = [
        { id: 'tom-1', title: 'Plan weekly goals', routineId: 'routine-1' }
      ];
      SmartListsManager.state.activeDate = '2026-11-18';
      SmartListsManager.renderTomorrowRoutines();

      const badge = document.getElementById('smart-tomorrow-count-badge');
      assert.ok(badge.textContent.includes('1 routine'), `Tomorrow badge should reflect 1 routine, got "${badge.textContent}"`);
    });
  });

  // ==========================================================================
  // Section 6: CSS Integrity & Safe-Area Insets Validation
  // ==========================================================================
  describe('6. CSS Architecture & Safe-Area Inset Handling', () => {

    test('6.1. styles.css declares dynamic viewport variables and OEM layer rules', () => {
      const cssPath = path.join(__dirname, '../public/styles.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      // Viewport variables
      assert.ok(css.includes('--app-height: 100vh;'), 'Missing --app-height in styles.css');
      assert.ok(css.includes('--vh: 1vh;'), 'Missing --vh in styles.css');
      assert.ok(css.includes('--oem-bottom-inset-extra'), 'Missing --oem-bottom-inset-extra in styles.css');

      // Safe area and clearance
      assert.ok(css.includes('#tab-smart-lists'), 'Missing #tab-smart-lists in styles.css');
      assert.ok(css.includes('env(safe-area-inset-top, 0px)'), 'Missing safe-area-inset-top support');
      assert.ok(css.includes('env(safe-area-inset-bottom, 0px)'), 'Missing safe-area-inset-bottom support');

      // OEM specific blocks
      assert.ok(css.includes('[data-device-oem="oneplus"]'), 'Missing OnePlus styles');
      assert.ok(css.includes('[data-device-oem="xiaomi"]'), 'Missing Xiaomi styles');
      assert.ok(css.includes('[data-device-oem="samsung"]'), 'Missing Samsung styles');
      assert.ok(css.includes('[data-device-oem="vivo"]'), 'Missing Vivo styles');
      assert.ok(css.includes('[data-device-oem="motorola"]'), 'Missing Motorola styles');

      // Fluid categories and font scaling
      assert.ok(css.includes('[data-viewport-category="compact"]'), 'Missing compact category styles');
      assert.ok(css.includes('[data-font-scale="large"]'), 'Missing large font scale styles');
      assert.ok(css.includes('[data-font-scale="xlarge"]'), 'Missing xlarge font scale styles');
    });

    test('6.2. Native Android Java Plugin DeviceCompatPlugin is registered in MainActivity.java', () => {
      const mainActivityPath = path.join(__dirname, '../android/app/src/main/java/com/taskly/app/MainActivity.java');
      const mainJava = fs.readFileSync(mainActivityPath, 'utf8');

      assert.ok(mainJava.includes('registerPlugin(DeviceCompatPlugin.class);'), 'DeviceCompatPlugin not registered in MainActivity.java');

      const pluginPath = path.join(__dirname, '../android/app/src/main/java/com/taskly/app/DeviceCompatPlugin.java');
      assert.ok(fs.existsSync(pluginPath), 'DeviceCompatPlugin.java does not exist');
      const pluginJava = fs.readFileSync(pluginPath, 'utf8');
      assert.ok(pluginJava.includes('@CapacitorPlugin(name = "DeviceCompat")'), 'CapacitorPlugin annotation missing in DeviceCompatPlugin.java');
      assert.ok(pluginJava.includes('Build.MANUFACTURER'), 'Build.MANUFACTURER not queried in DeviceCompatPlugin.java');
    });
  });

  // ==============================================================================
  // 7. Universal Android Vertical Scrolling & Touch Compatibility Suite
  // ==============================================================================
  describe('7. Universal Android Vertical Scrolling & Touch Compatibility Suite', () => {
    test('7.1. #tab-smart-lists has smooth vertical scrolling and touch-action pan-y without overscroll containment', () => {
      const cssPath = path.join(__dirname, '../public/styles.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      const smartListsMatch = css.match(/#tab-smart-lists\s*\{([^}]+)\}/);
      assert.ok(smartListsMatch, '#tab-smart-lists rule must exist in styles.css');
      const block = smartListsMatch[1];

      assert.ok(block.includes('overflow-y: auto;'), '#tab-smart-lists must have overflow-y: auto');
      assert.ok(block.includes('overflow-x: hidden;'), '#tab-smart-lists must have overflow-x: hidden');
      assert.ok(block.includes('touch-action: pan-y;'), '#tab-smart-lists must declare touch-action: pan-y for compositor scrolling');
      assert.ok(block.includes('-webkit-overflow-scrolling: touch;'), '#tab-smart-lists must support momentum touch scrolling');
      assert.ok(!block.includes('overscroll-behavior-y: contain;'), '#tab-smart-lists must NOT contain overscroll-behavior-y: contain which locks document scrolling');
    });

    test('7.2. .smart-lists-wrapper and OEM blocks declare touch-action pan-y without trapping scrolling gestures', () => {
      const cssPath = path.join(__dirname, '../public/styles.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      // Check wrapper base
      const wrapperMatch = css.match(/\.smart-lists-wrapper\s*\{([^}]+)\}/);
      assert.ok(wrapperMatch, '.smart-lists-wrapper rule must exist');
      assert.ok(wrapperMatch[1].includes('touch-action: pan-y;'), '.smart-lists-wrapper must have touch-action: pan-y');

      // Check OEM block does not trap gestures
      const oemBlockMatch = css.match(/\[data-device-oem="oneplus"\]\s*\.smart-lists-wrapper[^\{]*\{([^}]+)\}/);
      assert.ok(oemBlockMatch, 'OEM wrapper rule must exist');
      assert.ok(oemBlockMatch[1].includes('touch-action: pan-y;'), 'OEM block must declare touch-action: pan-y');
      assert.ok(!oemBlockMatch[1].includes('overscroll-behavior-y: contain;'), 'OEM block must NOT trap gestures with contain');
    });

    test('7.3. Modal dialogs retain overscroll-behavior-y: contain for modal scroll isolation', () => {
      const cssPath = path.join(__dirname, '../public/styles.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      assert.ok(css.includes('overscroll-behavior-y: contain;'), 'styles.css must contain overscroll-behavior-y: contain for modals');
      const modalMatch = css.match(/\.modal-card\s*\{([^}]+)\}/);
      assert.ok(modalMatch, '.modal-card rule must exist');
      assert.ok(modalMatch[1].includes('overscroll-behavior-y: contain;'), '.modal-card must retain overscroll-behavior-y: contain');
    });

    test('7.4. Bottom navigation clearance ensures complete Daily Routine Summary accessibility', () => {
      const cssPath = path.join(__dirname, '../public/styles.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      assert.ok(css.includes('calc(110px + env(safe-area-inset-bottom, 0px))'), 'Smart lists must have 110px base clearance');
      assert.ok(css.includes('calc(66px + env(safe-area-inset-bottom))'), 'Bottom nav height must match 66px base');
    });

    test('7.5. Tab transitions reset scroll offset to prevent midway scroll traps', () => {
      const appJsPath = path.join(__dirname, '../public/app.js');
      const appJs = fs.readFileSync(appJsPath, 'utf8');

      assert.ok(appJs.includes('window.scrollTo(0, 0)'), 'showMainFlow must reset window scroll offset on tab switch');
      assert.ok(appJs.includes('targetTabEl.scrollTop = 0'), 'showMainFlow must reset container scrollTop');
    });
  });
});
