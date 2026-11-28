/**
 * Taskly — Progressive Web App (PWA) & iOS Standalone Suite
 *
 * Verifies:
 * 1. Web App Manifest specifications and icon definitions (manifest.webmanifest & manifest.json)
 * 2. Branding asset integrity (192x192, 512x512, apple-touch-icon.png)
 * 3. iOS-specific metadata and meta tags in public/index.html
 * 4. Service Worker conservative caching and strict security exclusion rules
 * 5. Safe Service Worker registration (bypassed on native Capacitor, enabled on web/PWA)
 * 6. Native Android/Capacitor configuration preservation
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '../public');
const manifestWebPath = path.join(publicDir, 'manifest.webmanifest');
const manifestJsonPath = path.join(publicDir, 'manifest.json');
const indexHtmlPath = path.join(publicDir, 'index.html');
const swJsPath = path.join(publicDir, 'sw.js');
const appJsPath = path.join(publicDir, 'app.js');

test('Taskly iOS PWA Verification Suite', async (t) => {

  // =========================================================================
  // PART 1: Web App Manifest Integrity
  // =========================================================================
  await t.test('1. Web App Manifest Integrity', (t) => {
    t.test('manifest.webmanifest exists and is valid JSON', () => {
      assert.ok(fs.existsSync(manifestWebPath), 'manifest.webmanifest must exist in public/');
      const content = fs.readFileSync(manifestWebPath, 'utf8');
      const manifest = JSON.parse(content);
      
      assert.strictEqual(manifest.name, 'Taskly');
      assert.strictEqual(manifest.short_name, 'Taskly');
      assert.strictEqual(manifest.display, 'standalone');
      assert.strictEqual(manifest.start_url, '/');
      assert.strictEqual(manifest.scope, '/');
      assert.strictEqual(manifest.theme_color, '#38BDF8');
      assert.strictEqual(manifest.background_color, '#F0F9FF');
      assert.ok(Array.isArray(manifest.icons), 'icons must be an array');
      assert.ok(manifest.icons.length >= 2, 'manifest must declare at least 192 and 512 icons');
    });

    t.test('manifest.json is synchronized with manifest.webmanifest for legacy browsers', () => {
      assert.ok(fs.existsSync(manifestJsonPath), 'manifest.json must exist in public/');
      const webManifest = JSON.parse(fs.readFileSync(manifestWebPath, 'utf8'));
      const jsonManifest = JSON.parse(fs.readFileSync(manifestJsonPath, 'utf8'));
      assert.deepStrictEqual(webManifest, jsonManifest, 'manifest.json must mirror manifest.webmanifest');
    });

    t.test('manifest declares standard 192x192 and 512x512 icons with purpose any and maskable', () => {
      const manifest = JSON.parse(fs.readFileSync(manifestWebPath, 'utf8'));
      const icon192 = manifest.icons.find(i => i.sizes === '192x192');
      const icon512 = manifest.icons.find(i => i.sizes === '512x512');
      const maskable512 = manifest.icons.find(i => i.sizes === '512x512' && i.purpose === 'maskable');

      assert.ok(icon192, '192x192 icon must be declared');
      assert.ok(icon512, '512x512 icon must be declared');
      assert.ok(maskable512, '512x512 maskable icon must be declared');
      assert.strictEqual(icon192.src, '/icon-192.png');
      assert.strictEqual(icon512.src, '/icon-512.png');
    });
  });

  // =========================================================================
  // PART 2: PWA Icon Assets Existence and PNG Header Validation
  // =========================================================================
  await t.test('2. Branding Assets & Icon Integrity', (t) => {
    const pngMagicHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    t.test('icon-192.png exists and is a valid PNG', () => {
      const p = path.join(publicDir, 'icon-192.png');
      assert.ok(fs.existsSync(p));
      const buffer = fs.readFileSync(p);
      assert.ok(buffer.subarray(0, 8).equals(pngMagicHeader), 'icon-192.png must have valid PNG magic header');
    });

    t.test('icon-512.png exists and is a valid PNG', () => {
      const p = path.join(publicDir, 'icon-512.png');
      assert.ok(fs.existsSync(p));
      const buffer = fs.readFileSync(p);
      assert.ok(buffer.subarray(0, 8).equals(pngMagicHeader), 'icon-512.png must have valid PNG magic header');
    });

    t.test('apple-touch-icon.png exists, is valid PNG, and has 180x180 px dimensions', () => {
      const p = path.join(publicDir, 'apple-touch-icon.png');
      assert.ok(fs.existsSync(p));
      const buffer = fs.readFileSync(p);
      assert.ok(buffer.subarray(0, 8).equals(pngMagicHeader), 'apple-touch-icon.png must have valid PNG magic header');
      
      // Read width and height from PNG IHDR chunk (bytes 16..24)
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      assert.strictEqual(width, 180, 'apple-touch-icon.png width must be exactly 180px');
      assert.strictEqual(height, 180, 'apple-touch-icon.png height must be exactly 180px');
    });
  });

  // =========================================================================
  // PART 3: iOS Safari Standalone Metadata in public/index.html
  // =========================================================================
  await t.test('3. iOS Safari Standalone Metadata in index.html', (t) => {
    const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

    t.test('Declares apple-mobile-web-app-capable and mobile-web-app-capable', () => {
      assert.ok(
        indexHtml.includes('<meta name="apple-mobile-web-app-capable" content="yes">'),
        'apple-mobile-web-app-capable meta tag must be present'
      );
      assert.ok(
        indexHtml.includes('<meta name="mobile-web-app-capable" content="yes">'),
        'mobile-web-app-capable meta tag must be present'
      );
    });

    t.test('Declares apple-mobile-web-app-status-bar-style', () => {
      assert.ok(
        indexHtml.includes('<meta name="apple-mobile-web-app-status-bar-style" content="default">'),
        'apple-mobile-web-app-status-bar-style meta tag must be present'
      );
    });

    t.test('Declares apple-mobile-web-app-title with Taskly', () => {
      assert.ok(
        indexHtml.includes('<meta name="apple-mobile-web-app-title" content="Taskly">'),
        'apple-mobile-web-app-title must be "Taskly"'
      );
    });

    t.test('Declares apple-touch-icon link pointing to apple-touch-icon.png', () => {
      assert.ok(
        indexHtml.includes('<link rel="apple-touch-icon" href="/apple-touch-icon.png">') ||
        indexHtml.includes('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">'),
        'apple-touch-icon link must reference apple-touch-icon.png'
      );
    });

    t.test('Links to manifest.webmanifest', () => {
      assert.ok(
        indexHtml.includes('<link rel="manifest" href="/manifest.webmanifest">'),
        'manifest.webmanifest link must be in head'
      );
    });

    t.test('Viewport configures viewport-fit=cover for iPhone notch and home bar', () => {
      assert.ok(
        indexHtml.includes('viewport-fit=cover'),
        'viewport meta must specify viewport-fit=cover'
      );
    });
  });

  // =========================================================================
  // PART 4: Service Worker Security, Conservative Caching & Exclusions
  // =========================================================================
  await t.test('4. Service Worker Conservative Caching Rules', (t) => {
    assert.ok(fs.existsSync(swJsPath), 'sw.js must exist in public/');
    const swSource = fs.readFileSync(swJsPath, 'utf8');

    t.test('Every URL in PRECACHE_STATIC_ASSETS physically exists in public/ directory', () => {
      const match = swSource.match(/const PRECACHE_STATIC_ASSETS = \[([\s\S]*?)\];/);
      assert.ok(match, 'PRECACHE_STATIC_ASSETS array must be defined');
      const rawEntries = match[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
      assert.ok(rawEntries.length > 5, 'Should have multiple precache entries');

      rawEntries.forEach(entry => {
        // Strip query parameters for disk existence check (e.g. /styles.css?v=2.7 -> /styles.css)
        const cleanPath = entry.split('?')[0];
        const localPath = cleanPath === '/' ? path.join(publicDir, 'index.html') : path.join(publicDir, cleanPath);
        assert.ok(fs.existsSync(localPath), `Precached asset ${entry} must exist on disk at ${localPath}`);
        const stat = fs.statSync(localPath);
        assert.ok(stat.size > 0, `Precached asset ${entry} must not be empty (size: ${stat.size})`);
      });
    });

    t.test('Purges obsolete cache versions on activate', () => {
      assert.ok(swSource.includes("caches.delete(key)"), 'Service worker must purge obsolete cache keys on activate');
      assert.ok(swSource.includes("key !== CACHE_NAME"), 'Purging must preserve only current CACHE_NAME');
      assert.ok(swSource.includes("self.clients.claim()"), 'Service worker must call clients.claim()');
    });

    t.test('Strictly bypasses all non-GET requests', () => {
      assert.ok(
        swSource.includes("request.method !== 'GET'") || swSource.includes("event.request.method !== 'GET'"),
        'Service worker must skip all non-GET requests'
      );
    });

    t.test('Strictly bypasses all authenticated /api/* endpoints (no cached user data)', () => {
      assert.ok(
        swSource.includes("url.pathname.startsWith('/api/')"),
        'Service worker must bypass all /api/ requests'
      );
    });

    t.test('Strictly bypasses Supabase authentication and database requests', () => {
      assert.ok(swSource.includes("supabase.co"), 'Service worker must exclude supabase.co requests');
      assert.ok(swSource.includes("/auth/v1/"), 'Service worker must exclude /auth/v1/ endpoints');
      assert.ok(swSource.includes("/rest/v1/"), 'Service worker must exclude /rest/v1/ endpoints');
    });

    t.test('Strictly bypasses OAuth callback parameters (code=, access_token=, refresh_token=)', () => {
      assert.ok(swSource.includes("code="), 'Service worker must bypass URLs containing code=');
      assert.ok(swSource.includes("access_token="), 'Service worker must bypass URLs containing access_token=');
      assert.ok(swSource.includes("refresh_token="), 'Service worker must bypass URLs containing refresh_token=');
    });

    t.test('Provides offline navigation fallback for static shell', () => {
      assert.ok(
        swSource.includes("request.mode === 'navigate'"),
        'Service worker must handle navigation requests'
      );
      assert.ok(
        swSource.includes("caches.match('/index.html')") || swSource.includes("caches.match(request)"),
        'Navigation request must fallback to cached app shell'
      );
    });
  });

  // =========================================================================
  // PART 5: Service Worker Registration Guard in public/app.js
  // =========================================================================
  await t.test('5. Service Worker Safe Registration Logic', (t) => {
    const app = require(appJsPath);

    t.test('registerServiceWorker function is exported', () => {
      assert.strictEqual(typeof app.registerServiceWorker, 'function');
    });

    t.test('Service worker is NEVER registered when running inside native Capacitor app', () => {
      let swRegistered = false;
      global.window = {
        location: { origin: 'http://localhost:3000', protocol: 'http:', hostname: 'localhost' },
        addEventListener: (event, cb) => { if (event === 'load') cb(); }
      };
      global.document = { readyState: 'complete' };
      Object.defineProperty(global.navigator, 'serviceWorker', {
        value: { register: async () => { swRegistered = true; } },
        configurable: true,
        writable: true
      });
      global.window.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'android'
      };

      app.registerServiceWorker();
      assert.strictEqual(swRegistered, false, 'Service worker must NOT register on native Android Capacitor');

      global.window.Capacitor.getPlatform = () => 'ios';
      app.registerServiceWorker();
      assert.strictEqual(swRegistered, false, 'Service worker must NOT register on native iOS Capacitor');
    });

    t.test('Service worker registers successfully and calls registration.update() to prevent stale code', async () => {
      let registeredScript = null;
      let registeredScope = null;
      let updateCalled = false;
      global.window = {
        location: { origin: 'https://taskly-todo-app-4z1c.vercel.app', protocol: 'https:', hostname: 'taskly-todo-app-4z1c.vercel.app' },
        addEventListener: (event, cb) => { if (event === 'load') cb(); }
      };
      global.document = { readyState: 'complete' };
      Object.defineProperty(global.navigator, 'serviceWorker', {
        value: {
          register: async (script, opts) => {
            registeredScript = script;
            registeredScope = opts?.scope;
            return {
              scope: opts?.scope || '/',
              update: async () => { updateCalled = true; }
            };
          }
        },
        configurable: true,
        writable: true
      });
      global.window.Capacitor = undefined;

      app.registerServiceWorker();
      assert.strictEqual(registeredScript, '/sw.js');
      assert.strictEqual(registeredScope, '/');
      await new Promise(r => setTimeout(r, 10));
      assert.strictEqual(updateCalled, true, 'registration.update() must be called to ensure fresh assets');
    });
  });

  // =========================================================================
  // PART 6: Native Android Configuration Preservation
  // =========================================================================
  await t.test('6. Native Android Capacitor Configuration Preservation', (t) => {
    const capConfigPath = path.join(__dirname, '../capacitor.config.json');
    const capConfig = JSON.parse(fs.readFileSync(capConfigPath, 'utf8'));

    assert.strictEqual(capConfig.appId, 'com.taskly.app');
    assert.strictEqual(capConfig.appName, 'Taskly');
    assert.strictEqual(capConfig.webDir, 'public');
    assert.strictEqual(capConfig.server.androidScheme, 'https');
  });

});
