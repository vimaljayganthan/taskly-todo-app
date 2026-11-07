const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');
const STYLES_CSS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'styles.css'), 'utf8');
const APP_JS = fs.readFileSync(path.join(ROOT_DIR, 'public', 'app.js'), 'utf8');

// DOM Mocking Helper
function createMockElement(id, tagName = 'div', type = '') {
  const listeners = {};
  const attributes = {};
  const style = {};
  const classListSet = new Set();
  const children = [];

  const el = {
    id,
    tagName: tagName.toUpperCase(),
    type,
    value: '',
    style,
    textContent: '',
    innerHTML: '',
    title: '',
    disabled: false,
    checked: false,
    classList: {
      add: (cls) => classListSet.add(cls),
      remove: (cls) => classListSet.delete(cls),
      contains: (cls) => classListSet.has(cls),
      toggle: (cls, force) => {
        if (typeof force !== 'undefined') {
          if (force) classListSet.add(cls);
          else classListSet.delete(cls);
          return force;
        }
        if (classListSet.has(cls)) {
          classListSet.delete(cls);
          return false;
        } else {
          classListSet.add(cls);
          return true;
        }
      }
    },
    addEventListener: (evt, fn) => {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(fn);
    },
    removeEventListener: (evt, fn) => {
      if (!listeners[evt]) return;
      listeners[evt] = listeners[evt].filter(f => f !== fn);
    },
    dispatchEvent: (evt) => {
      const fns = listeners[evt.type] || [];
      for (const fn of fns) fn(evt);
    },
    trigger: (evtType, extra = {}) => {
      const fns = listeners[evtType] || [];
      const eventObj = {
        type: evtType,
        defaultPrevented: false,
        preventDefault: () => { eventObj.defaultPrevented = true; },
        stopPropagation: () => {},
        target: el,
        ...extra
      };
      for (const fn of fns) fn(eventObj);
      return eventObj;
    },
    setAttribute: (name, val) => { attributes[name] = val; },
    getAttribute: (name) => attributes[name] || null,
    hasAttribute: (name) => Object.prototype.hasOwnProperty.call(attributes, name),
    removeAttribute: (name) => { delete attributes[name]; },
    querySelector: (sel) => {
      if (sel === '.icon-eye') {
        if (!el._eye) el._eye = { style: { display: 'block' } };
        return el._eye;
      }
      if (sel === '.icon-eye-off') {
        if (!el._eyeOff) el._eyeOff = { style: { display: 'none' } };
        return el._eyeOff;
      }
      return null;
    },
    querySelectorAll: () => []
  };

  return el;
}

// Mock Supabase Auth Harness for full verification
function createMockSupabaseAuth(initialUsers = {}) {
  // Store accounts as email -> { id, password, email, user_metadata }
  const users = { ...initialUsers };

  return {
    auth: {
      users,
      async signInWithPassword({ email, password }) {
        const user = users[email];
        if (!user || user.password !== password) {
          return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
        }
        const session = {
          access_token: `token-${user.id}-${Date.now()}`,
          user: {
            id: user.id,
            email: user.email,
            email_confirmed_at: '2026-01-01T00:00:00Z',
            user_metadata: user.user_metadata || { name: 'Test User', age: 25 }
          }
        };
        return { data: { user: session.user, session }, error: null };
      },
      async updateUser({ password }) {
        if (!password) {
          return { data: null, error: { message: 'Password is required' } };
        }
        // Find current authenticated user from mock
        const currentUserEmail = this._currentEmail;
        if (!currentUserEmail || !users[currentUserEmail]) {
          return { data: null, error: { message: 'User not authenticated' } };
        }
        users[currentUserEmail].password = password;
        return {
          data: {
            user: {
              id: users[currentUserEmail].id,
              email: currentUserEmail,
              user_metadata: users[currentUserEmail].user_metadata
            }
          },
          error: null
        };
      },
      async signOut() {
        this._currentEmail = null;
        return { error: null };
      },
      async getUser() {
        const email = this._currentEmail;
        if (!email || !users[email]) {
          return { data: { user: null }, error: { message: 'Not authenticated' } };
        }
        return { data: { user: { id: users[email].id, email } }, error: null };
      },
      _currentEmail: null,
      setCurrentUser(email) {
        this._currentEmail = email;
      }
    }
  };
}

describe('Taskly Profile Management, Logout Confirmation & Secure Password Change Suite', () => {
  let app;
  let domElements;
  let mockStorage;
  let mockSupabase;

  beforeEach(() => {
    domElements = new Map();
    mockStorage = new Map();

    const getElement = (id) => {
      if (!domElements.has(id)) {
        domElements.set(id, createMockElement(id));
      }
      return domElements.get(id);
    };

    global.window = {
      location: { origin: 'http://localhost:3000', pathname: '/', hash: '', search: '', protocol: 'http:' },
      Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    global.document = {
      documentElement: createMockElement('html'),
      body: createMockElement('body'),
      getElementById: (id) => getElement(id),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {}
    };

    global.localStorage = {
      getItem: (k) => mockStorage.get(k) || null,
      setItem: (k, v) => { mockStorage.set(k, String(v)); },
      removeItem: (k) => { mockStorage.delete(k); },
      clear: () => { mockStorage.clear(); }
    };

    global.history = {
      replaceState: () => {},
      pushState: () => {}
    };

    // Load fresh app
    delete require.cache[require.resolve('../public/app.js')];
    app = require('../public/app.js');

    // Create mock Supabase client
    mockSupabase = createMockSupabaseAuth({
      'alice@taskly.test': {
        id: 'user-alice-123',
        password: 'OriginalPassword1!',
        email: 'alice@taskly.test',
        user_metadata: { name: 'Alice Walker', age: 28 }
      },
      'bob@taskly.test': {
        id: 'user-bob-456',
        password: 'BobSecretPassword99!',
        email: 'bob@taskly.test',
        user_metadata: { name: 'Bob Smith', age: 34 }
      }
    });

    app.setSupabaseClient(mockSupabase);
  });

  // ==========================================================================
  // PART 1: DOM Markup and CSS Integrity
  // ==========================================================================
  describe('1. DOM Markup and CSS Specifications', () => {
    test('public/index.html includes #profile-display-email below profile name', () => {
      assert.ok(INDEX_HTML.includes('id="profile-display-email"'), 'Expected #profile-display-email in HTML');
      assert.ok(INDEX_HTML.includes('class="profile-email"'), 'Expected class="profile-email"');
    });

    test('public/index.html includes #edit-email as readonly & disabled in Edit Details modal', () => {
      assert.ok(INDEX_HTML.includes('id="edit-email"'), 'Expected #edit-email in Edit Details modal');
      assert.ok(INDEX_HTML.includes('readonly'), 'Expected readonly attribute on edit-email');
      assert.ok(INDEX_HTML.includes('disabled'), 'Expected disabled attribute on edit-email');
      assert.ok(INDEX_HTML.includes('class="form-input readonly-email-input"'), 'Expected readonly-email-input class');
    });

    test('public/index.html includes #menu-change-password in profile menu', () => {
      assert.ok(INDEX_HTML.includes('id="menu-change-password"'), 'Expected #menu-change-password in profile menu');
      assert.ok(INDEX_HTML.includes('Change Password'), 'Expected "Change Password" label');
    });

    test('public/index.html includes #modal-change-password with exact placeholders and visibility toggles', () => {
      assert.ok(INDEX_HTML.includes('id="modal-change-password"'), 'Expected #modal-change-password');
      assert.ok(INDEX_HTML.includes('id="input-current-password"'), 'Expected current password input');
      assert.ok(INDEX_HTML.includes('placeholder="Enter your current password"'), 'Expected current password placeholder');
      assert.ok(INDEX_HTML.includes('id="input-new-password"'), 'Expected new password input');
      assert.ok(INDEX_HTML.includes('placeholder="Enter your new password"'), 'Expected new password placeholder');
      assert.ok(INDEX_HTML.includes('id="input-confirm-password"'), 'Expected confirm password input');
      assert.ok(INDEX_HTML.includes('placeholder="Re-enter your new password"'), 'Expected confirm password placeholder');

      // Visibility toggles
      assert.ok(INDEX_HTML.includes('id="btn-toggle-current-password"'), 'Expected current password toggle');
      assert.ok(INDEX_HTML.includes('id="btn-toggle-new-password"'), 'Expected new password toggle');
      assert.ok(INDEX_HTML.includes('id="btn-toggle-confirm-password"'), 'Expected confirm password toggle');

      // Buttons
      assert.ok(INDEX_HTML.includes('id="btn-cancel-change-password"'), 'Expected cancel button');
      assert.ok(INDEX_HTML.includes('id="btn-submit-change-password"'), 'Expected submit button');
      assert.ok(INDEX_HTML.includes('Update Password'), 'Expected "Update Password" button text');
    });

    test('public/index.html includes #modal-logout-confirm with title, message and buttons', () => {
      assert.ok(INDEX_HTML.includes('id="modal-logout-confirm"'), 'Expected #modal-logout-confirm');
      assert.ok(INDEX_HTML.includes('Log out?'), 'Expected "Log out?" title');
      assert.ok(INDEX_HTML.includes('Are you sure you want to log out of your Taskly account?'), 'Expected logout confirmation message');
      assert.ok(INDEX_HTML.includes('id="btn-cancel-logout"'), 'Expected #btn-cancel-logout');
      assert.ok(INDEX_HTML.includes('id="btn-confirm-logout"'), 'Expected #btn-confirm-logout');
      assert.ok(INDEX_HTML.includes('Yes, Log Out'), 'Expected "Yes, Log Out" button text');
    });

    test('public/styles.css defines styling for password container, readonly input, and logout button', () => {
      assert.ok(STYLES_CSS.includes('.password-field-container'), 'Expected .password-field-container');
      assert.ok(STYLES_CSS.includes('.readonly-email-input'), 'Expected .readonly-email-input');
      assert.ok(STYLES_CSS.includes('.btn-logout-confirm'), 'Expected .btn-logout-confirm');
      assert.ok(STYLES_CSS.includes('.auth-success-msg'), 'Expected .auth-success-msg');
      assert.ok(STYLES_CSS.includes('.profile-email'), 'Expected .profile-email');
    });
  });

  // ==========================================================================
  // PART 2: Logout Confirmation
  // ==========================================================================
  describe('2. Logout Confirmation Modal Flow', () => {
    beforeEach(() => {
      app.setupEventListeners();
      // Setup authenticated state
      app.state.userToken = 'token-alice-123';
      app.state.user = { id: 'user-alice-123', email: 'alice@taskly.test', name: 'Alice Walker', age: 28, isEmailVerified: true };
    });

    test('Clicking #btn-logout opens #modal-logout-confirm without logging out immediately', () => {
      const btnLogout = document.getElementById('btn-logout');
      const modalLogout = document.getElementById('modal-logout-confirm');

      btnLogout.trigger('click');

      assert.ok(modalLogout.classList.contains('active'), 'Expected modal-logout-confirm to have active class');
      assert.strictEqual(app.state.userToken, 'token-alice-123', 'User must remain authenticated');
      assert.strictEqual(app.state.user.email, 'alice@taskly.test');
    });

    test('Clicking #btn-cancel-logout closes modal and keeps user logged in', () => {
      const modalLogout = document.getElementById('modal-logout-confirm');
      const btnCancel = document.getElementById('btn-cancel-logout');

      app.openLogoutModal();
      assert.ok(modalLogout.classList.contains('active'));

      btnCancel.trigger('click');
      assert.ok(!modalLogout.classList.contains('active'), 'Expected modal-logout-confirm to be closed');
      assert.strictEqual(app.state.userToken, 'token-alice-123', 'User must still be logged in');
      assert.strictEqual(app.state.user.id, 'user-alice-123');
    });

    test('Clicking #btn-confirm-logout performs logout, cleans up state and closes modal', async () => {
      const modalLogout = document.getElementById('modal-logout-confirm');
      const btnConfirm = document.getElementById('btn-confirm-logout');

      app.openLogoutModal();
      assert.ok(modalLogout.classList.contains('active'));

      await app.handleConfirmLogout();

      assert.ok(!modalLogout.classList.contains('active'), 'Modal must be closed after logout');
      assert.strictEqual(app.state.userToken, null, 'User token must be null');
      assert.strictEqual(app.state.user.id, null, 'User ID must be null');
      assert.strictEqual(app.state.user.email, '', 'User email must be empty string');
      assert.strictEqual(app.state.user.name, 'User', 'Name must reset to default');
    });

    test('Duplicate tap on #btn-confirm-logout is prevented while request is processing', async () => {
      let callCount = 0;
      const originalSignOut = mockSupabase.auth.signOut;
      mockSupabase.auth.signOut = async () => {
        callCount++;
        await new Promise(r => setTimeout(r, 20));
        return { error: null };
      };

      const p1 = app.handleConfirmLogout();
      const p2 = app.handleConfirmLogout();
      await Promise.all([p1, p2]);

      assert.strictEqual(callCount, 1, 'signOut must only be called once');
      mockSupabase.auth.signOut = originalSignOut;
    });
  });

  // ==========================================================================
  // PART 3: Authenticated Email Display & Readonly Verification
  // ==========================================================================
  describe('3. Authenticated Email Display and Readonly Protection', () => {
    test('renderProfile displays authenticated email in #profile-display-email', () => {
      app.state.userToken = 'token-alice-123';
      app.state.user = { id: 'user-alice-123', email: 'alice@taskly.test', name: 'Alice Walker', age: 28, isEmailVerified: true };

      app.renderProfile();

      const emailEl = document.getElementById('profile-display-email');
      assert.strictEqual(emailEl.textContent, 'alice@taskly.test');
      assert.strictEqual(emailEl.style.display, 'block');
    });

    test('renderProfile hides #profile-display-email when no authenticated email exists', () => {
      app.state.userToken = null;
      app.state.user = { id: null, email: '', name: 'User', age: 18 };

      app.renderProfile();

      const emailEl = document.getElementById('profile-display-email');
      assert.strictEqual(emailEl.textContent, '');
      assert.strictEqual(emailEl.style.display, 'none');
    });

    test('openEditModal populates readonly #edit-email with user email', () => {
      app.setupEventListeners();
      app.state.userToken = 'token-alice-123';
      app.state.user = { id: 'user-alice-123', email: 'alice@taskly.test', name: 'Alice Walker', age: 28 };

      const btnOpenEdit = document.getElementById('btn-open-edit-modal');
      btnOpenEdit.trigger('click');

      const editEmail = document.getElementById('edit-email');
      assert.strictEqual(editEmail.value, 'alice@taskly.test');
    });

    test('Editing name and age preserves email and cannot overwrite email', () => {
      app.setupEventListeners();
      app.state.userToken = 'token-alice-123';
      app.state.user = { id: 'user-alice-123', email: 'alice@taskly.test', name: 'Alice Walker', age: 28 };

      const formEdit = document.getElementById('form-edit-profile');
      const editName = document.getElementById('edit-name');
      const editAge = document.getElementById('edit-age');
      const editEmail = document.getElementById('edit-email');

      editName.value = 'Alice Cooper';
      editAge.value = '30';
      editEmail.value = 'hacker@malicious.test'; // attempt malicious overwrite

      formEdit.trigger('submit');

      assert.strictEqual(app.state.user.name, 'Alice Cooper');
      assert.strictEqual(app.state.user.age, 30);
      assert.strictEqual(app.state.user.email, 'alice@taskly.test', 'Email must remain intact and unmodified');
    });

    test('loadStoredPreferences purges email if user token is absent to prevent stale cache leaks', () => {
      mockStorage.set('taskly_user', JSON.stringify({
        id: 'old-user-999',
        email: 'leaked_previous_user@example.com',
        name: 'Old User'
      }));
      // Notice: taskly_user_token is NOT set in localStorage

      app.loadStoredPreferences();

      assert.strictEqual(app.state.user.email, '', 'Stale cached email must be purged when unauthenticated');
    });
  });

  // ==========================================================================
  // PART 4: Password Validation and Security
  // ==========================================================================
  describe('4. Change Password Validation & Server-Backed Flow', () => {
    beforeEach(() => {
      app.setupEventListeners();
      app.state.userToken = 'token-alice-123';
      app.state.user = { id: 'user-alice-123', email: 'alice@taskly.test', name: 'Alice Walker', age: 28, isEmailVerified: true };
      mockSupabase.auth.setCurrentUser('alice@taskly.test');
    });

    test('Missing password fields: requires all three fields and displays error', async () => {
      const currentPwd = document.getElementById('input-current-password');
      const newPwd = document.getElementById('input-new-password');
      const confirmPwd = document.getElementById('input-confirm-password');
      const errorBanner = document.getElementById('change-password-error');

      currentPwd.value = 'OriginalPassword1!';
      newPwd.value = '';
      confirmPwd.value = 'OriginalPassword1!';

      await app.handleChangePassword();

      assert.strictEqual(errorBanner.textContent, 'All three password fields are required.');
      assert.strictEqual(errorBanner.style.display, 'flex');
    });

    test('New password shorter than 8 characters: shows validation error', async () => {
      const currentPwd = document.getElementById('input-current-password');
      const newPwd = document.getElementById('input-new-password');
      const confirmPwd = document.getElementById('input-confirm-password');
      const errorBanner = document.getElementById('change-password-error');

      currentPwd.value = 'OriginalPassword1!';
      newPwd.value = 'short7!';
      confirmPwd.value = 'short7!';

      await app.handleChangePassword();

      assert.strictEqual(errorBanner.textContent, 'New password must be at least 8 characters.');
      assert.strictEqual(errorBanner.style.display, 'flex');
    });

    test('Mismatched new password and confirmation: shows validation error', async () => {
      const currentPwd = document.getElementById('input-current-password');
      const newPwd = document.getElementById('input-new-password');
      const confirmPwd = document.getElementById('input-confirm-password');
      const errorBanner = document.getElementById('change-password-error');

      currentPwd.value = 'OriginalPassword1!';
      newPwd.value = 'SuperNewPassword123!';
      confirmPwd.value = 'DifferentNewPassword123!';

      await app.handleChangePassword();

      assert.strictEqual(errorBanner.textContent, 'New password and confirmation do not match.');
      assert.strictEqual(errorBanner.style.display, 'flex');
    });

    test('Incorrect current password: fails reauthentication and shows specific error', async () => {
      const currentPwd = document.getElementById('input-current-password');
      const newPwd = document.getElementById('input-new-password');
      const confirmPwd = document.getElementById('input-confirm-password');
      const errorBanner = document.getElementById('change-password-error');

      currentPwd.value = 'WrongPassword999!';
      newPwd.value = 'BrandNewPassword2026!';
      confirmPwd.value = 'BrandNewPassword2026!';

      await app.handleChangePassword();

      assert.strictEqual(errorBanner.textContent, 'Your current password is incorrect.');
      assert.strictEqual(errorBanner.style.display, 'flex');
      assert.strictEqual(mockSupabase.auth.users['alice@taskly.test'].password, 'OriginalPassword1!', 'Password in DB must remain unchanged');
    });

    test('Successful password update: reauthenticates, updates via Supabase, clears fields & shows success', async () => {
      const currentPwd = document.getElementById('input-current-password');
      const newPwd = document.getElementById('input-new-password');
      const confirmPwd = document.getElementById('input-confirm-password');
      const successBanner = document.getElementById('change-password-success');
      const errorBanner = document.getElementById('change-password-error');

      currentPwd.value = 'OriginalPassword1!';
      newPwd.value = 'UpdatedPassword2026!';
      confirmPwd.value = 'UpdatedPassword2026!';

      await app.handleChangePassword();

      assert.strictEqual(errorBanner.style.display, 'none');
      assert.strictEqual(successBanner.textContent, 'Your password has been updated successfully.');
      assert.strictEqual(successBanner.style.display, 'flex');

      // Verify passwords are cleared immediately from input fields
      assert.strictEqual(currentPwd.value, '', 'Current password field must be cleared');
      assert.strictEqual(newPwd.value, '', 'New password field must be cleared');
      assert.strictEqual(confirmPwd.value, '', 'Confirm password field must be cleared');

      // Verify Supabase Auth credential was updated
      assert.strictEqual(mockSupabase.auth.users['alice@taskly.test'].password, 'UpdatedPassword2026!');
    });

    test('Loading state and duplicate submission prevention during password update', async () => {
      const currentPwd = document.getElementById('input-current-password');
      const newPwd = document.getElementById('input-new-password');
      const confirmPwd = document.getElementById('input-confirm-password');
      const submitBtn = document.getElementById('btn-submit-change-password');

      currentPwd.value = 'OriginalPassword1!';
      newPwd.value = 'UpdatedPassword2026!';
      confirmPwd.value = 'UpdatedPassword2026!';

      let updateUserCallCount = 0;
      const originalUpdateUser = mockSupabase.auth.updateUser;
      mockSupabase.auth.updateUser = async (args) => {
        updateUserCallCount++;
        assert.strictEqual(submitBtn.disabled, true, 'Submit button must be disabled during processing');
        assert.strictEqual(submitBtn.textContent, 'Updating...');
        await new Promise(r => setTimeout(r, 20));
        return originalUpdateUser.call(mockSupabase.auth, args);
      };

      const p1 = app.handleChangePassword();
      const p2 = app.handleChangePassword();
      await Promise.all([p1, p2]);

      assert.strictEqual(updateUserCallCount, 1, 'Only one updateUser call should execute');
      assert.strictEqual(submitBtn.disabled, false);
      assert.strictEqual(submitBtn.textContent, 'Update Password');

      mockSupabase.auth.updateUser = originalUpdateUser;
    });
  });

  // ==========================================================================
  // PART 5: Full E2E Verification of Old vs New Password
  // ==========================================================================
  describe('5. Full Authentication Credential Verification (Old vs New)', () => {
    test('Old password rejected after update, new password successfully authenticates', async () => {
      // 1. Initial login with original password
      const initialLogin = await mockSupabase.auth.signInWithPassword({
        email: 'alice@taskly.test',
        password: 'OriginalPassword1!'
      });
      assert.ok(initialLogin.data.session, 'Initial login with original password must succeed');
      app.syncAuthSession(initialLogin.data.session);
      assert.strictEqual(app.state.user.email, 'alice@taskly.test');
      mockSupabase.auth.setCurrentUser('alice@taskly.test');

      // 2. Change password to BrandNewPassword777!
      const currentPwd = document.getElementById('input-current-password');
      const newPwd = document.getElementById('input-new-password');
      const confirmPwd = document.getElementById('input-confirm-password');
      currentPwd.value = 'OriginalPassword1!';
      newPwd.value = 'BrandNewPassword777!';
      confirmPwd.value = 'BrandNewPassword777!';

      await app.handleChangePassword();
      assert.strictEqual(document.getElementById('change-password-success').textContent, 'Your password has been updated successfully.');

      // 3. User logs out
      await app.handleConfirmLogout();
      assert.strictEqual(app.state.userToken, null);
      assert.strictEqual(app.state.user.email, '');

      // 4. Attempt login with OLD password -> MUST FAIL
      const failLogin = await mockSupabase.auth.signInWithPassword({
        email: 'alice@taskly.test',
        password: 'OriginalPassword1!'
      });
      assert.strictEqual(failLogin.data.session, null, 'Old password must be rejected');
      assert.ok(failLogin.error, 'Must return authentication error for old password');

      // 5. Attempt login with NEW password -> MUST SUCCEED
      const successLogin = await mockSupabase.auth.signInWithPassword({
        email: 'alice@taskly.test',
        password: 'BrandNewPassword777!'
      });
      assert.ok(successLogin.data.session, 'Login with new password must succeed');
      assert.strictEqual(successLogin.data.session.user.email, 'alice@taskly.test');

      // 6. Verify profile displays correct email
      app.syncAuthSession(successLogin.data.session);
      assert.strictEqual(app.state.user.email, 'alice@taskly.test');
      app.renderProfile();
      assert.strictEqual(document.getElementById('profile-display-email').textContent, 'alice@taskly.test');
    });
  });

  // ==========================================================================
  // PART 6: Password Visibility Toggles
  // ==========================================================================
  describe('6. Password Visibility Toggles for All Three Fields', () => {
    test('wirePasswordToggle toggles type between password and text and switches eye icons', () => {
      app.wirePasswordToggle('btn-toggle-current-password', 'input-current-password');

      const btnToggle = document.getElementById('btn-toggle-current-password');
      const input = document.getElementById('input-current-password');
      input.type = 'password';

      // First click: show password
      btnToggle.trigger('click');
      assert.strictEqual(input.type, 'text');
      assert.strictEqual(btnToggle.getAttribute('aria-label'), 'Hide password');

      // Second click: hide password
      btnToggle.trigger('click');
      assert.strictEqual(input.type, 'password');
      assert.strictEqual(btnToggle.getAttribute('aria-label'), 'Show password');
    });

    test('All three password toggle buttons function independently', () => {
      app.setupEventListeners();

      const curInput = document.getElementById('input-current-password');
      const newInput = document.getElementById('input-new-password');
      const confInput = document.getElementById('input-confirm-password');

      curInput.type = 'password';
      newInput.type = 'password';
      confInput.type = 'password';

      // Toggle new password only
      document.getElementById('btn-toggle-new-password').trigger('click');
      assert.strictEqual(curInput.type, 'password');
      assert.strictEqual(newInput.type, 'text');
      assert.strictEqual(confInput.type, 'password');

      // Toggle confirm password only
      document.getElementById('btn-toggle-confirm-password').trigger('click');
      assert.strictEqual(curInput.type, 'password');
      assert.strictEqual(newInput.type, 'text');
      assert.strictEqual(confInput.type, 'text');
    });
  });

  // ==========================================================================
  // PART 7: Session Isolation Between Users
  // ==========================================================================
  describe('7. Account Isolation & Switching Accounts', () => {
    test('Switching from Alice to Bob updates email and never leaks previous email', async () => {
      // Alice logs in
      const aliceLogin = await mockSupabase.auth.signInWithPassword({
        email: 'alice@taskly.test',
        password: 'OriginalPassword1!'
      });
      app.syncAuthSession(aliceLogin.data.session);
      app.renderProfile();
      assert.strictEqual(document.getElementById('profile-display-email').textContent, 'alice@taskly.test');

      // Alice logs out
      await app.handleConfirmLogout();
      app.renderProfile();
      assert.strictEqual(document.getElementById('profile-display-email').textContent, '');
      assert.strictEqual(document.getElementById('profile-display-email').style.display, 'none');

      // Bob logs in
      const bobLogin = await mockSupabase.auth.signInWithPassword({
        email: 'bob@taskly.test',
        password: 'BobSecretPassword99!'
      });
      app.syncAuthSession(bobLogin.data.session);
      app.renderProfile();
      assert.strictEqual(document.getElementById('profile-display-email').textContent, 'bob@taskly.test');
    });
  });

  // ==========================================================================
  // PART 8: Android and Web Compatibility
  // ==========================================================================
  describe('8. Android Native and Web Compatibility', () => {
    test('Works seamlessly when running on Android native platform (Capacitor)', async () => {
      global.window.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'android'
      };

      app.state.userToken = 'token-alice-123';
      app.state.user = { id: 'user-alice-123', email: 'alice@taskly.test', name: 'Alice Walker', age: 28, isEmailVerified: true };
      mockSupabase.auth.setCurrentUser('alice@taskly.test');

      // Modal open / close works without browser dialogs
      app.openLogoutModal();
      assert.ok(document.getElementById('modal-logout-confirm').classList.contains('active'));
      app.closeLogoutModal();
      assert.ok(!document.getElementById('modal-logout-confirm').classList.contains('active'));

      // Change password works on Android
      const currentPwd = document.getElementById('input-current-password');
      const newPwd = document.getElementById('input-new-password');
      const confirmPwd = document.getElementById('input-confirm-password');
      currentPwd.value = 'OriginalPassword1!';
      newPwd.value = 'AndroidSecret2026!';
      confirmPwd.value = 'AndroidSecret2026!';

      await app.handleChangePassword();
      assert.strictEqual(document.getElementById('change-password-success').textContent, 'Your password has been updated successfully.');
      assert.strictEqual(mockSupabase.auth.users['alice@taskly.test'].password, 'AndroidSecret2026!');
    });
  });
});
