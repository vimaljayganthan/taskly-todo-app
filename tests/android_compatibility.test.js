const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('Android Device Compatibility & Responsive Layout Suite', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const stylesCss = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
  const stylesXml = fs.readFileSync(path.join(__dirname, '../android/app/src/main/res/values/styles.xml'), 'utf8');
  const mainActivityJava = fs.readFileSync(path.join(__dirname, '../android/app/src/main/java/com/taskly/app/MainActivity.java'), 'utf8');
  const androidManifestXml = fs.readFileSync(path.join(__dirname, '../android/app/src/main/AndroidManifest.xml'), 'utf8');

  // --------------------------------------------------------------------------
  // 1. Force Dark & Color Scheme Protection
  // --------------------------------------------------------------------------
  describe('1. WebView Force Dark Prevention', () => {
    test('public/index.html declares color-scheme: light', () => {
      assert.ok(
        indexHtml.includes('<meta name="color-scheme" content="light">'),
        'index.html must declare light color-scheme to instruct Chromium WebView not to auto-darken'
      );
    });

    test('public/index.html defaults data-theme to "pastel"', () => {
      assert.ok(
        indexHtml.includes('data-theme="pastel"'),
        'index.html default data-theme must be pastel'
      );
    });

    test('public/styles.css enforces color-scheme: light on root', () => {
      assert.ok(
        stylesCss.includes('color-scheme: light;'),
        'styles.css must declare color-scheme: light on root'
      );
    });

    test('styles.xml disables forceDarkAllowed and uses Light theme', () => {
      assert.ok(
        stylesXml.includes('android:forceDarkAllowed" tools:targetApi="q">false'),
        'styles.xml must set android:forceDarkAllowed="false" for Android Q+'
      );
      assert.ok(
        stylesXml.includes('Theme.AppCompat.Light.NoActionBar'),
        'styles.xml must use Light theme rather than DayNight'
      );
    });

    test('MainActivity.java explicitly disables FORCE_DARK in WebSettings', () => {
      assert.ok(
        mainActivityJava.includes('FORCE_DARK_OFF'),
        'MainActivity.java must configure WebSettings.FORCE_DARK_OFF'
      );
    });

    test('AndroidManifest.xml declares deep link intent-filters for custom scheme and auth callback', () => {
      assert.ok(
        androidManifestXml.includes('android:scheme="@string/custom_url_scheme"'),
        'AndroidManifest.xml must declare intent-filter for @string/custom_url_scheme (com.taskly.app)'
      );
      assert.ok(
        androidManifestXml.includes('android:host="auth"') && androidManifestXml.includes('android:pathPrefix="/callback"'),
        'AndroidManifest.xml must declare auth/callback deep link path'
      );
      assert.ok(
        androidManifestXml.includes('android:scheme="taskly"'),
        'AndroidManifest.xml must declare intent-filter for taskly scheme'
      );
    });
  });

  // --------------------------------------------------------------------------
  // 2. Font Scaling & Fixed-Height Clipping Fixes
  // --------------------------------------------------------------------------
  describe('2. Accessibility Font Scaling & No-Clipping Layout', () => {
    test('.btn-primary-wide uses flexible min-height instead of fixed height: 48px', () => {
      // Must have min-height: 48px; height: auto;
      assert.ok(
        stylesCss.includes('min-height: 48px;') && stylesCss.includes('height: auto;'),
        '.btn-primary-wide must allow text to expand without clipping'
      );
    });

    test('.btn-back uses flexible min-dimensions and flex-shrink: 0', () => {
      assert.ok(
        stylesCss.includes('min-width: 36px;') && stylesCss.includes('min-height: 36px;'),
        '.btn-back must have min-width and min-height'
      );
      assert.ok(
        stylesCss.includes('flex-shrink: 0;'),
        '.btn-back must prevent shrinking when title text scales'
      );
    });

    test('Native date picker is normalized while preserving OS dialog picker', () => {
      assert.ok(
        stylesCss.includes('input[type="date"].row-input-field'),
        'styles.css must have dedicated date input normalization'
      );
      assert.ok(
        stylesCss.includes('-webkit-date-and-time-value'),
        'styles.css must normalize -webkit-date-and-time-value'
      );
      assert.ok(
        stylesCss.includes('-webkit-calendar-picker-indicator'),
        'styles.css must style -webkit-calendar-picker-indicator'
      );
    });
  });

  // --------------------------------------------------------------------------
  // 3. Responsive Priority & Category Selectors (320px - 412px)
  // --------------------------------------------------------------------------
  describe('3. Responsive Priority & Category Grid Selectors', () => {
    test('public/index.html uses form-row-pill-card and flex-between-pill', () => {
      assert.ok(
        indexHtml.includes('form-row-pill-card'),
        'index.html must use form-row-pill-card for pill containers'
      );
      assert.ok(
        indexHtml.includes('flex-between-pill'),
        'index.html must use flex-between-pill'
      );
    });

    test('Priority selector uses 3-column responsive grid', () => {
      assert.ok(
        stylesCss.includes('#add-priority-selector {\n  grid-template-columns: repeat(3, 1fr);') ||
        stylesCss.includes('#add-priority-selector {\n  grid-template-columns: repeat(3, 1fr);'),
        'Priority selector must use a 3-column grid'
      );
    });

    test('Category selector uses 4-column grid with 2-column fallback for compact screens (<= 380px)', () => {
      assert.ok(
        stylesCss.includes('#add-category-selector {\n  grid-template-columns: repeat(4, 1fr);'),
        'Category selector must default to 4 columns'
      );
      assert.ok(
        stylesCss.includes('@media (max-width: 380px)') && stylesCss.includes('grid-template-columns: repeat(2, 1fr);'),
        'Category selector must collapse to a 2x2 grid on compact screens (<= 380px)'
      );
    });

    test('.pill-opt has min-height, border-box sizing, and width: 100%', () => {
      assert.ok(
        stylesCss.includes('.pill-opt {') && stylesCss.includes('min-height: 34px;') && stylesCss.includes('box-sizing: border-box;'),
        '.pill-opt must have min-height and box-sizing: border-box'
      );
    });
  });

  // --------------------------------------------------------------------------
  // 4. Day Theme Consistency & Banner Styling on Add Task Screen
  // --------------------------------------------------------------------------
  describe('4. Day Theme Banner & Container Consistency', () => {
    test('Day Theme styles Add Task green banner with Sky Blue palette', () => {
      assert.ok(
        stylesCss.includes('[data-theme="day"] #tab-add .banner-theme-green'),
        'Day Theme must have dedicated styling for Add Task green banner'
      );
      assert.ok(
        stylesCss.includes('[data-theme="day"] #tab-add .pill-green'),
        'Day Theme must style the pill badge on Add Task banner'
      );
      assert.ok(
        stylesCss.includes('[data-theme="day"] #tab-add .banner-subtext'),
        'Day Theme must style the banner subtext on Add Task'
      );
    });

    test('Day Theme gives .add-task-form mobile padding and border-radius', () => {
      assert.ok(
        stylesCss.includes('[data-theme="day"] #tab-add .add-task-form') &&
        stylesCss.includes('padding: 18px 16px !important;') &&
        stylesCss.includes('border-radius: var(--radius-xl) !important;'),
        'Day Theme Add Task form must have proper padding on mobile'
      );
    });
  });
});

