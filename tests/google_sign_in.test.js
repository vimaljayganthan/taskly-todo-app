/**
 * Taskly — Google Sign-In Test Suite
 *
 * Verifies:
 * 1. UI Components & Visual Integrity (Divider, Button, Google SVG Logo, Styling tokens)
 * 2. Environment-Aware Redirect URL Resolution (Web vs Android Capacitor)
 * 3. Successful Google Sign-In Flow (Web & Android)
 * 4. Duplicate Request Prevention & In-Progress Loading States
 * 5. Cancelled Google Sign-In Handling
 * 6. Authentication Failure & Network Error Handling
 * 7. Existing Google-Linked Account Login & Data Retention
 * 8. New Google Account Registration & Profile Name Mapping
 * 9. Multi-User Account Data Isolation
 * 10. Existing Email/Password Login & Signup Preservation
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const indexHtmlPath = path.join(__dirname, '../public/index.html');
const stylesCssPath = path.join(__dirname, '../public/styles.css');
const appJsPath = path.join(__dirname, '../public/app.js');

const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
const stylesCss = fs.readFileSync(stylesCssPath, 'utf8');

test('Taskly Google Sign-In Verification Suite', async (t) => {

  // =========================================================================
  // PART 1: UI Requirements & Visual Styling Reference Verification
  // =========================================================================
  await t.test('1. UI Requirements & Visual Structure', (t) => {
    t.test('Subtle divider with "or continue with" exists inside auth form', () => {
      assert.ok(indexHtml.includes('id="auth-divider"'), 'auth-divider ID must be present in index.html');
      assert.ok(indexHtml.includes('class="auth-divider"'), 'auth-divider class must be present');
      assert.ok(indexHtml.includes('or continue with'), 'Divider must contain exact text "or continue with"');
    });

    t.test('Full-width "Continue with Google" button exists with correct attributes', () => {
      assert.ok(indexHtml.includes('id="btn-google-signin"'), 'Button must have id="btn-google-signin"');
      assert.ok(indexHtml.includes('class="btn-google-auth"'), 'Button must have class="btn-google-auth"');
      assert.ok(indexHtml.includes('type="button"'), 'Button must have type="button" to prevent form submission');
      assert.ok(indexHtml.includes('aria-label="Continue with Google"'), 'Button must have accessible aria-label');
      assert.ok(indexHtml.includes('Continue with Google'), 'Button text must be "Continue with Google"');
    });

    t.test('Google logo SVG is present with official brand colors', () => {
      assert.ok(indexHtml.includes('class="google-icon"'), 'Google icon SVG must be present');
      assert.ok(indexHtml.includes('#4285F4'), 'Google Blue (#4285F4) must be in SVG');
      assert.ok(indexHtml.includes('#34A853'), 'Google Green (#34A853) must be in SVG');
      assert.ok(indexHtml.includes('#FBBC05'), 'Google Yellow (#FBBC05) must be in SVG');
      assert.ok(indexHtml.includes('#EA4335'), 'Google Red (#EA4335) must be in SVG');
    });

    t.test('styles.css defines .auth-divider with horizontal divider lines', () => {
      assert.ok(stylesCss.includes('.auth-divider'), 'styles.css must style .auth-divider');
      assert.ok(stylesCss.includes('.auth-divider::before'), 'Divider must use ::before pseudo-element');
      assert.ok(stylesCss.includes('.auth-divider::after'), 'Divider must use ::after pseudo-element');
    });

    t.test('styles.css defines .btn-google-auth with 14px rounded corners and subtle border', () => {
      assert.ok(stylesCss.includes('.btn-google-auth'), 'styles.css must style .btn-google-auth');
      assert.ok(stylesCss.includes('border-radius: 14px'), 'Button must have 14px border-radius');
      assert.ok(stylesCss.includes('width: 100%'), 'Button must be full-width');
      assert.ok(stylesCss.includes('min-height: 48px'), 'Button must meet accessible 48px touch target');
    });

    t.test('styles.css defines dark theme overrides matching reference screenshot', () => {
      assert.ok(stylesCss.includes('[data-theme="dark"] .auth-divider'), 'Dark theme divider style must be defined');
      assert.ok(stylesCss.includes('[data-theme="dark"] .btn-google-auth'), 'Dark theme button style must be defined');
      assert.ok(stylesCss.includes('rgba(255, 255, 255, 0.04)') || stylesCss.includes('rgba(255, 255, 255, 0.05)'), 'Dark theme button must use subtle background');
      assert.ok(stylesCss.includes('rgba(255, 255, 255, 0.15)'), 'Dark theme button must use subtle 0.15 opacity border');
    });

    t.test('Auth mode switch prompt matches reference screenshot ("Don\'t have an account? Sign Up")', () => {
      assert.ok(indexHtml.includes('id="auth-switch-prompt-text"'), 'Prompt text element must exist');
      assert.ok(indexHtml.includes("Don't have an account?"), 'Prompt text must say "Don\'t have an account?"');
      assert.ok(indexHtml.includes('id="btn-switch-auth"'), 'Switch auth button must exist');
      assert.ok(stylesCss.includes('.auth-switch-prompt'), 'styles.css must style .auth-switch-prompt');
      assert.ok(stylesCss.includes('.btn-auth-switch-link'), 'styles.css must style .btn-auth-switch-link');
    });
  });

  // =========================================================================
  // PART 2: Environment-Aware Redirect URL Resolution
  // =========================================================================
  await t.test('2. Environment-Aware Redirect URL Resolution', (t) => {
    // Setup isolated test DOM & global mocks
    const domMocks = setupMockEnvironment();
    const app = require(appJsPath);

    t.test('Local Web environment returns localhost root/origin URL', () => {
      global.window = {
        location: {
          origin: 'http://localhost:3000',
          protocol: 'http:',
          hostname: 'localhost',
          port: '3000'
        }
      };
      app.state.config = { appUrl: 'http://localhost:3000' };

      const url = app.getOAuthRedirectUrl();
      assert.strictEqual(url, 'http://localhost:3000');
    });

    t.test('Deployed Web environment returns production canonical URL', () => {
      global.window = {
        location: {
          origin: 'https://taskly-todo-app-4z1c.vercel.app',
          protocol: 'https:',
          hostname: 'taskly-todo-app-4z1c.vercel.app',
          port: ''
        }
      };
      app.state.config = { appUrl: 'https://taskly-todo-app-4z1c.vercel.app' };

      const url = app.getOAuthRedirectUrl();
      assert.strictEqual(url, 'https://taskly-todo-app-4z1c.vercel.app');
    });

    t.test('Capacitor Android native app returns custom scheme com.taskly.app://auth/callback', () => {
      global.window = {
        location: {
          origin: 'https://localhost',
          protocol: 'https:',
          hostname: 'localhost',
          port: ''
        },
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => 'android',
          Plugins: {}
        }
      };
      app.state.config = { appUrl: 'https://taskly-todo-app-4z1c.vercel.app' };

      const url = app.getOAuthRedirectUrl();
      assert.strictEqual(url, 'com.taskly.app://auth/callback');
    });

    t.test('Capacitor iOS native app returns custom scheme com.taskly.app://auth/callback', () => {
      global.window = {
        location: {
          origin: 'capacitor://localhost',
          protocol: 'capacitor:',
          hostname: 'localhost',
          port: ''
        },
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => 'ios',
          Plugins: {}
        }
      };
      app.state.config = { appUrl: 'https://taskly-todo-app-4z1c.vercel.app' };

      const url = app.getOAuthRedirectUrl();
      assert.strictEqual(url, 'com.taskly.app://auth/callback');
    });
  });

  // =========================================================================
  // PART 3: Functional Google OAuth Execution & Redirection
  // =========================================================================
  await t.test('3. Functional Google OAuth Execution & Redirection', async (t) => {
    const domMocks = setupMockEnvironment();
    const app = require(appJsPath);

    await t.test('Web Google Sign-In initiates OAuth with provider: google and redirect URL', async () => {
      global.window = {
        location: {
          origin: 'https://taskly-todo-app-4z1c.vercel.app',
          protocol: 'https:',
          href: ''
        }
      };
      app.state.config = { appUrl: 'https://taskly-todo-app-4z1c.vercel.app' };

      let oauthParams = null;
      app.setSupabaseClient({
        auth: {
          signInWithOAuth: async (params) => {
            oauthParams = params;
            return {
              data: { url: 'https://accounts.google.com/o/oauth2/v2/auth?test=1', provider: 'google' },
              error: null
            };
          }
        }
      });

      await app.handleGoogleSignIn();

      assert.ok(oauthParams, 'signInWithOAuth must be called');
      assert.strictEqual(oauthParams.provider, 'google');
      assert.strictEqual(oauthParams.options.redirectTo, 'https://taskly-todo-app-4z1c.vercel.app');
      assert.strictEqual(oauthParams.options.skipBrowserRedirect, false);
      assert.strictEqual(global.window.location.href, 'https://accounts.google.com/o/oauth2/v2/auth?test=1');
      app.resetGoogleSignInButton();
    });

    await t.test('Android Capacitor Google Sign-In launches external browser via Capacitor Browser plugin', async () => {
      let openedUrl = null;
      let browserClosed = false;
      global.window = {
        location: { origin: 'https://localhost', protocol: 'https:' },
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => 'android',
          Plugins: {
            Browser: {
              open: async ({ url }) => {
                openedUrl = url;
                return {};
              },
              close: async () => {
                browserClosed = true;
              },
              addListener: (event, cb) => {}
            },
            App: {
              addListener: () => {}
            }
          }
        },
        addEventListener: () => {}
      };

      let oauthParams = null;
      app.setSupabaseClient({
        auth: {
          signInWithOAuth: async (params) => {
            oauthParams = params;
            return {
              data: { url: 'https://accounts.google.com/o/oauth2/v2/auth?android=1', provider: 'google' },
              error: null
            };
          }
        }
      });

      await app.handleGoogleSignIn();

      assert.strictEqual(oauthParams.provider, 'google');
      assert.strictEqual(oauthParams.options.redirectTo, 'com.taskly.app://auth/callback');
      assert.strictEqual(oauthParams.options.skipBrowserRedirect, true);
      assert.strictEqual(openedUrl, 'https://accounts.google.com/o/oauth2/v2/auth?android=1');
      app.resetGoogleSignInButton();

      // Verify handleAuthDeepLink closes browser
      await app.handleAuthDeepLink('com.taskly.app://auth/callback?code=test-code');
      assert.strictEqual(browserClosed, true);
    });

    await t.test('Android Capacitor falls back to DeviceCompat.openUrl if Browser is unavailable', async () => {
      let openedUrl = null;
      global.window = {
        location: { origin: 'https://localhost', protocol: 'https:' },
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => 'android',
          Plugins: {
            DeviceCompat: {
              openUrl: async ({ url }) => {
                openedUrl = url;
                return { opened: true };
              }
            },
            App: {
              addListener: () => {}
            }
          }
        },
        addEventListener: () => {}
      };

      app.setSupabaseClient({
        auth: {
          signInWithOAuth: async () => ({
            data: { url: 'https://accounts.google.com/fallback', provider: 'google' },
            error: null
          })
        }
      });

      await app.handleGoogleSignIn();
      assert.strictEqual(openedUrl, 'https://accounts.google.com/fallback');
      app.resetGoogleSignInButton();
    });
  });

  // =========================================================================
  // PART 4: Duplicate Request Prevention & Button State Handling
  // =========================================================================
  await t.test('4. Duplicate Request Prevention & Button States', async (t) => {
    const domMocks = setupMockEnvironment();
    const app = require(appJsPath);

    let callCount = 0;
    let resolveOAuth;
    const oauthPromise = new Promise((resolve) => { resolveOAuth = resolve; });

    app.setSupabaseClient({
      auth: {
        signInWithOAuth: async () => {
          callCount++;
          await oauthPromise;
          return { data: { url: 'https://auth.google.com' }, error: null };
        }
      }
    });

    // Start first click
    const firstCall = app.handleGoogleSignIn();

    // Verify button is disabled and in-progress flag is active
    assert.strictEqual(app.isGoogleAuthInProgress(), true);
    const btn = document.getElementById('btn-google-signin');
    const btnText = document.getElementById('btn-google-text');
    assert.strictEqual(btn.disabled, true);
    assert.strictEqual(btnText.textContent, 'Connecting to Google...');

    // Attempt concurrent duplicate click
    await app.handleGoogleSignIn();
    assert.strictEqual(callCount, 1, 'Duplicate tap must not initiate a second OAuth request');

    // Complete the first call
    resolveOAuth();
    await firstCall;
    app.resetGoogleSignInButton();
    assert.strictEqual(app.isGoogleAuthInProgress(), false);
    assert.strictEqual(btn.disabled, false);
    assert.strictEqual(btnText.textContent, 'Continue with Google');
  });

  // =========================================================================
  // PART 5: Cancelled Login & Error Handling
  // =========================================================================
  await t.test('5. Cancelled Login & Error Handling', async (t) => {
    const domMocks = setupMockEnvironment();
    const app = require(appJsPath);

    await t.test('Cancelled Google Sign-In displays user-friendly cancellation notice', async () => {
      const cancelUrl = 'com.taskly.app://auth/callback?error=access_denied&error_code=access_denied&error_description=The+user+denied+the+request';
      await app.handleAuthDeepLink(cancelUrl);

      const errorEl = document.getElementById('auth-error-msg');
      assert.strictEqual(errorEl.style.display, 'flex');
      assert.strictEqual(errorEl.textContent, 'Google Sign-In was cancelled.');
      assert.strictEqual(app.isGoogleAuthInProgress(), false);
    });

    await t.test('Network or provider failure displays graceful error message and resets button', async () => {
      app.setSupabaseClient({
        auth: {
          signInWithOAuth: async () => {
            return { data: null, error: new Error('Network timeout contacting Google authentication server') };
          }
        }
      });

      await app.handleGoogleSignIn();

      const errorEl = document.getElementById('auth-error-msg');
      assert.strictEqual(errorEl.style.display, 'flex');
      assert.strictEqual(errorEl.textContent, 'Network timeout contacting Google authentication server');
      assert.strictEqual(app.isGoogleAuthInProgress(), false);
      const btn = document.getElementById('btn-google-signin');
      assert.strictEqual(btn.disabled, false);
    });
  });

  // =========================================================================
  // PART 6: Existing Account Login & New Account Registration
  // =========================================================================
  await t.test('6. Existing User Login & New User Registration', async (t) => {
    const domMocks = setupMockEnvironment();
    const app = require(appJsPath);

    await t.test('Existing Google account login restores session and routes to home', async () => {
      app.setOnboardingCompleted(true);
      app.setSupabaseClient({
        auth: {
          exchangeCodeForSession: async () => {
            return {
              data: {
                session: {
                  access_token: 'valid-google-jwt-token',
                  user: {
                    id: 'existing-google-user-id-789',
                    email: 'alex@example.com',
                    app_metadata: { provider: 'google' },
                    user_metadata: { full_name: 'Alex Johnson' }
                  }
                }
              },
              error: null
            };
          }
        }
      });

      const callbackUrl = 'com.taskly.app://auth/callback?code=google-oauth-code-456';
      await app.handleAuthDeepLink(callbackUrl);

      assert.strictEqual(app.state.user.id, 'existing-google-user-id-789');
      assert.strictEqual(app.state.user.email, 'alex@example.com');
      assert.strictEqual(app.state.user.name, 'Alex Johnson');
      assert.strictEqual(app.state.user.isEmailVerified, true);
      assert.strictEqual(app.state.flow, 'main');
      assert.strictEqual(app.state.activeTab, 'home');
    });

    await t.test('New Google user registration maps profile name and auto-verifies', async () => {
      app.setOnboardingCompleted(false);
      app.setSupabaseClient({
        auth: {
          setSession: async () => {
            return {
              data: {
                session: {
                  access_token: 'new-google-jwt-token',
                  user: {
                    id: 'new-google-user-id-101',
                    email: 'newuser@gmail.com',
                    app_metadata: { provider: 'google' },
                    user_metadata: { name: 'Sarah Connor' }
                  }
                }
              },
              error: null
            };
          }
        }
      });

      const tokenUrl = 'https://taskly-todo-app-4z1c.vercel.app/#access_token=new-token&refresh_token=new-refresh';
      await app.handleAuthDeepLink(tokenUrl);

      assert.strictEqual(app.state.user.id, 'new-google-user-id-101');
      assert.strictEqual(app.state.user.email, 'newuser@gmail.com');
      assert.strictEqual(app.state.user.name, 'Sarah Connor');
      assert.strictEqual(app.state.user.isEmailVerified, true);
    });
  });

  // =========================================================================
  // PART 7: User-Specific Data Isolation
  // =========================================================================
  await t.test('7. User-Specific Data Isolation', async (t) => {
    const domMocks = setupMockEnvironment();
    const app = require(appJsPath);

    // Simulate User A (Google user)
    app.syncAuthSession({
      access_token: 'token-a',
      user: {
        id: 'user-google-aaa',
        email: 'userA@gmail.com',
        app_metadata: { provider: 'google' },
        user_metadata: { name: 'User A' }
      }
    });

    assert.strictEqual(app.state.user.id, 'user-google-aaa');
    assert.strictEqual(app.state.user.email, 'userA@gmail.com');

    // Sign out User A
    app.syncAuthSignOut();
    assert.strictEqual(app.state.user.id, null);
    assert.strictEqual(app.state.userToken, null);

    // Simulate User B (Email user)
    app.syncAuthSession({
      access_token: 'token-b',
      user: {
        id: 'user-email-bbb',
        email: 'userB@example.com',
        app_metadata: { provider: 'email' },
        email_confirmed_at: '2026-11-20T00:00:00Z',
        user_metadata: { name: 'User B' }
      }
    });

    assert.strictEqual(app.state.user.id, 'user-email-bbb');
    assert.strictEqual(app.state.user.email, 'userB@example.com');
    assert.notStrictEqual(app.state.user.id, 'user-google-aaa');
  });

  // =========================================================================
  // PART 8: Existing Email/Password Login & Signup Preservation
  // =========================================================================
  await t.test('8. Existing Email/Password Form Preservation', (t) => {
    t.test('Form profile setup retains all original email, password, name, and age fields', () => {
      assert.ok(indexHtml.includes('id="setup-email"'), 'Email input must remain intact');
      assert.ok(indexHtml.includes('id="setup-password"'), 'Password input must remain intact');
      assert.ok(indexHtml.includes('id="setup-name"'), 'Name input must remain intact');
      assert.ok(indexHtml.includes('id="setup-age"'), 'Age input must remain intact');
      assert.ok(indexHtml.includes('id="btn-auth-submit"'), 'Primary submit button must remain intact');
      assert.ok(indexHtml.includes('id="btn-toggle-login"'), 'Sign In toggle button must remain intact');
      assert.ok(indexHtml.includes('id="btn-toggle-signup"'), 'Create Account toggle button must remain intact');
    });

    t.test('setAuthMode toggles smoothly between login and signup without affecting Google button', () => {
      const domMocks = setupMockEnvironment();
      const app = require(appJsPath);

      app.setAuthMode('signup');
      assert.strictEqual(app.state.authMode, 'signup');
      const submitText = document.getElementById('btn-auth-text');
      assert.strictEqual(submitText.textContent, 'Create Account');

      app.setAuthMode('login');
      assert.strictEqual(app.state.authMode, 'login');
      assert.strictEqual(submitText.textContent, 'Sign In');

      // Google button text remains unchanged
      const googleText = document.getElementById('btn-google-text');
      assert.strictEqual(googleText.textContent, 'Continue with Google');
    });
  });

  // =========================================================================
  // PART 9: Android Deep Link Return & Universal Web Bridge
  // =========================================================================
  await t.test('9. Android Deep Link Return & Universal Web Bridge', async (t) => {
    const domMocks = setupMockEnvironment();
    const app = require(appJsPath);

    await t.test('isNativeApp accurately distinguishes Android Capacitor vs browser', () => {
      global.window = {
        location: { origin: 'https://localhost', protocol: 'https:', hostname: 'localhost', port: '' },
        Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' }
      };
      assert.strictEqual(app.isNativeApp(), true);

      global.window = {
        location: { origin: 'https://taskly-todo-app-4z1c.vercel.app', protocol: 'https:', hostname: 'taskly-todo-app-4z1c.vercel.app', port: '' },
        Capacitor: undefined
      };
      assert.strictEqual(app.isNativeApp(), false);
    });

    await t.test('handleAuthDeepLink restores session and routes to home for native custom scheme', async () => {
      let setSessionCalled = false;
      app.setSupabaseClient({
        auth: {
          setSession: async ({ access_token, refresh_token }) => {
            setSessionCalled = true;
            return {
              data: {
                session: {
                  access_token,
                  refresh_token,
                  user: {
                    id: 'usr-native-123',
                    email: 'native@taskly.app',
                    email_confirmed_at: '2026-11-26T00:00:00.000Z',
                    app_metadata: { provider: 'google' }
                  }
                }
              },
              error: null
            };
          }
        }
      });

      await app.handleAuthDeepLink('com.taskly.app://auth/callback#access_token=token_native_abc&refresh_token=refresh_native_xyz');

      assert.strictEqual(setSessionCalled, true);
      assert.strictEqual(app.state.user.id, 'usr-native-123');
      assert.strictEqual(app.state.activeTab, 'home');
    });

    await t.test('Web-to-native bridge attempts redirect when mobile browser receives OAuth callback', async () => {
      let redirectedUrl = null;
      global.window = {
        location: {
          origin: 'https://taskly-todo-app-4z1c.vercel.app',
          protocol: 'https:',
          hostname: 'taskly-todo-app-4z1c.vercel.app',
          pathname: '/',
          search: '',
          hash: '#access_token=token_web_bridge&refresh_token=refresh_web_bridge',
          set href(val) { redirectedUrl = val; },
          get href() { return 'https://taskly-todo-app-4z1c.vercel.app/#access_token=token_web_bridge&refresh_token=refresh_web_bridge'; }
        },
        history: { replaceState: () => {} }
      };
      Object.defineProperty(global.navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
        configurable: true
      });

      app.setSupabaseClient({
        auth: {
          setSession: async () => ({
            data: { session: { access_token: 'token_web_bridge', user: { id: 'bridge-1' } } },
            error: null
          })
        }
      });

      await app.handleAuthDeepLink(global.window.location.href);

      assert.ok(redirectedUrl && redirectedUrl.startsWith('com.taskly.app://auth/callback'), 'Mobile browser must bounce to native custom scheme');
    });
  });

  // =========================================================================
  // PART 10: iOS Native Application Configuration & OAuth Verification
  // =========================================================================
  await t.test('10. iOS Native Platform Configuration & Deep Link Integrity', (t) => {
    const infoPlistPath = path.join(__dirname, '../ios/App/App/Info.plist');
    const projectPbxprojPath = path.join(__dirname, '../ios/App/App.xcodeproj/project.pbxproj');
    const packageSwiftPath = path.join(__dirname, '../ios/App/CapApp-SPM/Package.swift');
    const appDelegatePath = path.join(__dirname, '../ios/App/App/AppDelegate.swift');

    const infoPlist = fs.readFileSync(infoPlistPath, 'utf8');
    const projectPbxproj = fs.readFileSync(projectPbxprojPath, 'utf8');
    const packageSwift = fs.readFileSync(packageSwiftPath, 'utf8');
    const appDelegate = fs.readFileSync(appDelegatePath, 'utf8');

    t.test('Info.plist registers CFBundleURLTypes with custom scheme com.taskly.app', () => {
      assert.ok(infoPlist.includes('<key>CFBundleURLTypes</key>'), 'Info.plist must declare CFBundleURLTypes');
      assert.ok(infoPlist.includes('<string>com.taskly.app</string>'), 'Info.plist must register com.taskly.app scheme');
    });

    t.test('project.pbxproj defines com.taskly.app, version 2.4.0, and build 160', () => {
      assert.ok(projectPbxproj.includes('PRODUCT_BUNDLE_IDENTIFIER = com.taskly.app;'), 'Bundle ID must be com.taskly.app');
      assert.ok(projectPbxproj.includes('MARKETING_VERSION = 2.4.0;'), 'Marketing version must be 2.4.0');
      assert.ok(projectPbxproj.includes('CURRENT_PROJECT_VERSION = 160;'), 'Build version must be 160');
    });

    t.test('Package.swift includes CapacitorBrowser plugin for iOS OAuth support', () => {
      assert.ok(packageSwift.includes('CapacitorBrowser'), 'Package.swift must declare CapacitorBrowser');
    });

    t.test('AppDelegate.swift forwards URL open and Universal Link events via ApplicationDelegateProxy', () => {
      assert.ok(appDelegate.includes('ApplicationDelegateProxy.shared.application(app, open: url, options: options)'), 'AppDelegate must forward open url');
      assert.ok(appDelegate.includes('ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)'), 'AppDelegate must forward continue userActivity');
    });
  });

});

/**
 * Setup mock DOM environment for headless Node.js tests
 */
function setupMockEnvironment() {
  const elements = {};

  function createElement(tag) {
    return {
      tagName: tag.toUpperCase(),
      style: {},
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        contains(c) { return this.classes.has(c); },
        toggle(c, force) {
          if (force === undefined) {
            if (this.classes.has(c)) this.classes.delete(c);
            else this.classes.add(c);
          } else if (force) {
            this.classes.add(c);
          } else {
            this.classes.delete(c);
          }
        }
      },
      attributes: {},
      setAttribute(k, v) { this.attributes[k] = v; },
      getAttribute(k) { return this.attributes[k]; },
      addEventListener() {},
      removeEventListener() {},
      textContent: '',
      innerHTML: '',
      value: '',
      disabled: false,
      children: [],
      appendChild(ch) { this.children.push(ch); return ch; },
      querySelector() { return null; },
      querySelectorAll() { return []; }
    };
  }

  // Pre-populate elements expected by Taskly app
  const ids = [
    'auth-divider', 'btn-google-signin', 'btn-google-text', 'btn-auth-submit', 'btn-auth-text',
    'auth-error-msg', 'setup-email', 'setup-password', 'setup-name', 'setup-age',
    'btn-toggle-login', 'btn-toggle-signup', 'field-wrap-name', 'field-wrap-age',
    'auth-title', 'auth-subtitle', 'auth-pet-img', 'form-profile-setup',
    'screen-launch', 'screen-carousel', 'screen-profile-setup', 'screen-welcome',
    'onboarding-flow', 'main-flow', 'tab-home', 'tab-calendar', 'tab-progress',
    'tab-profile', 'tab-add', 'tab-smart-lists', 'profile-name', 'profile-email',
    'profile-age', 'user-name-display', 'preview-helper-wrap', 'btn-preview-skip-to-app'
  ];

  ids.forEach(id => {
    elements[id] = createElement('div');
    elements[id].id = id;
  });
  elements['btn-google-text'].textContent = 'Continue with Google';

  global.document = {
    getElementById: (id) => elements[id] || null,
    createElement,
    querySelectorAll: () => [],
    querySelector: () => null,
    documentElement: createElement('html'),
    body: createElement('body'),
    addEventListener: () => {}
  };

  global.localStorage = {
    store: {},
    getItem(k) { return this.store[k] || null; },
    setItem(k, v) { this.store[k] = String(v); },
    removeItem(k) { delete this.store[k]; },
    clear() { this.store = {}; }
  };

  global.window = {
    location: { origin: 'http://localhost:3000', protocol: 'http:', pathname: '/' },
    addEventListener: () => {},
    history: { replaceState: () => {} }
  };

  return { elements };
}
