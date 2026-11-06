const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Mock browser DOM environment
function createMockElement(id, tagName = 'div', type = '') {
  const listeners = {};
  const attributes = {};
  const style = {};
  let classListSet = new Set();

  return {
    id,
    tagName: tagName.toUpperCase(),
    type,
    value: '',
    style,
    textContent: '',
    innerHTML: '',
    title: '',
    classList: {
      add: (cls) => classListSet.add(cls),
      remove: (cls) => classListSet.delete(cls),
      contains: (cls) => classListSet.has(cls)
    },
    addEventListener: (evt, fn) => {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(fn);
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
        ...extra
      };
      for (const fn of fns) fn(eventObj);
      return eventObj;
    },
    setAttribute: (name, val) => { attributes[name] = val; },
    getAttribute: (name) => attributes[name] || null,
    querySelector: (sel) => {
      if (sel === '.icon-eye') {
        if (!createMockElement._eye) {
          createMockElement._eye = { style: { display: 'block' } };
        }
        return createMockElement._eye;
      }
      if (sel === '.icon-eye-off') {
        if (!createMockElement._eyeOff) {
          createMockElement._eyeOff = { style: { display: 'none' } };
        }
        return createMockElement._eyeOff;
      }
      return null;
    }
  };
}

describe('Password Visibility Toggle Suite for Sign In & Create Account', () => {
  let clientApp;
  let elements;

  beforeEach(() => {
    elements = {};
    createMockElement._eye = { style: { display: 'block' } };
    createMockElement._eyeOff = { style: { display: 'none' } };

    const elemIds = [
      ['setup-password', 'input', 'password'],
      ['btn-toggle-password', 'button', 'button'],
      ['btn-toggle-login', 'button', 'button'],
      ['btn-toggle-signup', 'button', 'button'],
      ['input-signin-pass', 'input', 'password'],
      ['btn-toggle-signin-pass', 'button', 'button'],
      ['input-signup-pass', 'input', 'password'],
      ['btn-toggle-signup-pass', 'button', 'button'],
      ['form-profile-setup', 'form', ''],
      ['setup-email', 'input', 'email'],
      ['setup-name', 'input', 'text'],
      ['setup-age', 'input', 'number'],
      ['btn-auth-submit', 'button', 'submit'],
      ['field-wrap-name', 'div', ''],
      ['field-wrap-age', 'div', ''],
      ['auth-title', 'h2', ''],
      ['auth-subtitle', 'p', ''],
      ['btn-auth-text', 'span', ''],
      ['auth-error-msg', 'div', ''],
      ['auth-pet-img', 'img', '']
    ];

    for (const [id, tag, type] of elemIds) {
      elements[id] = createMockElement(id, tag, type);
    }

    elements['btn-toggle-password'].setAttribute('aria-label', 'Show password');
    elements['btn-toggle-password'].setAttribute('title', 'Show password');
    elements['btn-toggle-signin-pass'].setAttribute('aria-label', 'Show password');
    elements['btn-toggle-signin-pass'].setAttribute('title', 'Show password');
    elements['btn-toggle-signup-pass'].setAttribute('aria-label', 'Show password');
    elements['btn-toggle-signup-pass'].setAttribute('title', 'Show password');

    global.document = {
      getElementById: (id) => elements[id] || null,
      querySelector: (sel) => {
        if (sel && sel.startsWith('#')) return elements[sel.slice(1)] || null;
        return null;
      },
      querySelectorAll: () => [],
      documentElement: createMockElement('html', 'html'),
      body: createMockElement('body', 'body'),
      addEventListener: () => {},
      removeEventListener: () => {}
    };
    global.window = {
      addEventListener: () => {},
      removeEventListener: () => {},
      location: { hostname: 'localhost', port: '3000', origin: 'http://localhost:3000', protocol: 'http:' },
      localStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
      }
    };

    delete require.cache[require.resolve('../public/app.js')];
    clientApp = require('../public/app.js');
    clientApp.setupEventListeners();
  });

  test('1. Password input starts hidden with type="password" and accessible label', () => {
    const input = elements['setup-password'];
    const btn = elements['btn-toggle-password'];

    assert.strictEqual(input.type, 'password');
    assert.strictEqual(btn.getAttribute('aria-label'), 'Show password');
    assert.strictEqual(btn.getAttribute('title'), 'Show password');
  });

  test('2. Tapping eye toggle reveals password (type="text", label="Hide password", eye-off displayed)', () => {
    const input = elements['setup-password'];
    const btn = elements['btn-toggle-password'];
    input.value = 'MySecretPass123!';

    const clickEvent = btn.trigger('click');

    assert.strictEqual(input.type, 'text', 'Input type must change to text');
    assert.strictEqual(input.value, 'MySecretPass123!', 'Value must remain intact');
    assert.strictEqual(btn.getAttribute('aria-label'), 'Hide password');
    assert.strictEqual(btn.getAttribute('title'), 'Hide password');
    assert.strictEqual(createMockElement._eye.style.display, 'none');
    assert.strictEqual(createMockElement._eyeOff.style.display, 'block');
    assert.strictEqual(clickEvent.defaultPrevented, true, 'Click must prevent default form submit');
  });

  test('3. Tapping eye-off toggle re-hides password (type="password", label="Show password", eye displayed)', () => {
    const input = elements['setup-password'];
    const btn = elements['btn-toggle-password'];
    input.value = 'MySecretPass123!';

    // Reveal
    btn.trigger('click');
    assert.strictEqual(input.type, 'text');

    // Hide again
    const secondClick = btn.trigger('click');
    assert.strictEqual(input.type, 'password');
    assert.strictEqual(input.value, 'MySecretPass123!', 'Value must remain intact');
    assert.strictEqual(btn.getAttribute('aria-label'), 'Show password');
    assert.strictEqual(btn.getAttribute('title'), 'Show password');
    assert.strictEqual(createMockElement._eye.style.display, 'block');
    assert.strictEqual(createMockElement._eyeOff.style.display, 'none');
    assert.strictEqual(secondClick.defaultPrevented, true);
  });

  test('4. Password value remains 100% intact through multiple toggle cycles', () => {
    const input = elements['setup-password'];
    const btn = elements['btn-toggle-password'];
    const specialPass = 'P@$$w0rd!#%^&*()_+=1234567890~';
    input.value = specialPass;

    for (let i = 0; i < 6; i++) {
      btn.trigger('click');
      assert.strictEqual(input.value, specialPass, `Value must not mutate on cycle ${i + 1}`);
      const expectedType = (i % 2 === 0) ? 'text' : 'password';
      assert.strictEqual(input.type, expectedType);
    }
  });

  test('5. Independent visibility behavior between Sign In and Create Account modes', () => {
    const input = elements['setup-password'];
    const btn = elements['btn-toggle-password'];
    input.value = 'UserSecret2026!';

    // Start in Sign In (login) mode
    clientApp.setAuthMode('login');
    assert.strictEqual(input.type, 'password');

    // Reveal password in Sign In mode
    btn.trigger('click');
    assert.strictEqual(input.type, 'text');
    assert.strictEqual(clientApp.state.passwordVisibility.login, true);
    assert.strictEqual(clientApp.state.passwordVisibility.signup, false);

    // Switch to Create Account (signup) mode: should be hidden according to signup's independent state
    clientApp.setAuthMode('signup');
    assert.strictEqual(input.type, 'password', 'Create Account must start/remain hidden independently');
    assert.strictEqual(btn.getAttribute('aria-label'), 'Show password');

    // Switch back to Sign In mode: should restore its revealed state
    clientApp.setAuthMode('login');
    assert.strictEqual(input.type, 'text', 'Sign In mode should preserve its revealed state');
    assert.strictEqual(btn.getAttribute('aria-label'), 'Hide password');

    // Re-hide in Sign In mode
    btn.trigger('click');
    assert.strictEqual(input.type, 'password');
    assert.strictEqual(clientApp.state.passwordVisibility.login, false);
  });

  test('6. Independent separate inputs for Sign In and Create Account forms', () => {
    const signinInput = elements['input-signin-pass'];
    const signinBtn = elements['btn-toggle-signin-pass'];
    const signupInput = elements['input-signup-pass'];
    const signupBtn = elements['btn-toggle-signup-pass'];

    signinInput.value = 'SignInPass789!';
    signupInput.value = 'SignUpPass456!';

    assert.strictEqual(signinInput.type, 'password');
    assert.strictEqual(signupInput.type, 'password');

    // Toggle Sign In only
    signinBtn.trigger('click');
    assert.strictEqual(signinInput.type, 'text');
    assert.strictEqual(signupInput.type, 'password', 'Sign Up password must remain unchanged');
    assert.strictEqual(signinInput.value, 'SignInPass789!');

    // Toggle Sign Up only
    signupBtn.trigger('click');
    assert.strictEqual(signinInput.type, 'text');
    assert.strictEqual(signupInput.type, 'text');
    assert.strictEqual(signupInput.value, 'SignUpPass456!');

    // Re-hide Sign In
    signinBtn.trigger('click');
    assert.strictEqual(signinInput.type, 'password');
    assert.strictEqual(signupInput.type, 'text', 'Sign Up password remains visible');
  });

  test('7. Toggle button does not trigger form submission', () => {
    const form = elements['form-profile-setup'];
    const btn = elements['btn-toggle-password'];
    let formSubmitted = false;

    form.addEventListener('submit', () => {
      formSubmitted = true;
    });

    const clickEvt = btn.trigger('click');

    assert.strictEqual(clickEvt.defaultPrevented, true);
    assert.strictEqual(formSubmitted, false, 'Toggling password must not submit the form');
  });

  test('8. Form submission still works properly with revealed password', async () => {
    const form = elements['form-profile-setup'];
    const emailInput = elements['setup-email'];
    const passInput = elements['setup-password'];
    const btn = elements['btn-toggle-password'];
    const errorMsg = elements['auth-error-msg'];

    emailInput.value = 'test@example.com';
    passInput.value = 'ValidPass123!';

    // Reveal password
    btn.trigger('click');
    assert.strictEqual(passInput.type, 'text');

    let prevented = false;
    await form.trigger('submit', {
      preventDefault: () => { prevented = true; }
    });

    assert.strictEqual(prevented, true, 'Form submit prevented browser default page reload');
    // Error message is not 'Please provide both email and password'
    assert.notStrictEqual(errorMsg.textContent, 'Please provide both email and password.');
  });

  test('9. HTML structure verification: index.html has button inside input-card aligned right', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

    // Confirm button exists inside #field-wrap-password
    assert.ok(html.includes('id="btn-toggle-password"'), 'index.html must contain #btn-toggle-password');
    assert.ok(html.includes('aria-label="Show password"'), 'Button must have initial aria-label="Show password"');
    assert.ok(html.includes('type="button"'), 'Button must have type="button" to avoid form submission');
    assert.ok(html.includes('class="icon-eye"'), 'Button must contain eye icon');
    assert.ok(html.includes('class="icon-eye-off"'), 'Button must contain eye-off icon');
  });

  test('10. CSS verification: styles.css contains Pet Theme styled touch-friendly toggle', () => {
    const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');

    assert.ok(css.includes('.btn-password-toggle'), 'styles.css must style .btn-password-toggle');
    assert.ok(css.includes('touch-action: manipulation'), 'styles.css must have touch-action: manipulation for mobile');
    assert.ok(css.includes('min-width: 36px'), 'styles.css must have comfortable touch target size');
    assert.ok(css.includes('outline: none') || css.includes('-webkit-tap-highlight-color'), 'styles.css must configure tap highlight');
  });

  test('11. Pet Theme Preview verification: pet-theme-preview.html includes independent eye toggles and accessible labels', () => {
    const previewHtml = fs.readFileSync(path.join(__dirname, '../public/pet-theme-preview.html'), 'utf8');

    assert.ok(previewHtml.includes('input-signin-pass'), 'Preview must have input-signin-pass');
    assert.ok(previewHtml.includes('input-signup-pass'), 'Preview must have input-signup-pass');
    assert.ok(previewHtml.includes('togglePassVisibility(\'input-signin-pass\''), 'Preview must have signin toggle call');
    assert.ok(previewHtml.includes('togglePassVisibility(\'input-signup-pass\''), 'Preview must have signup toggle call');
    assert.ok(previewHtml.includes('aria-label="Show password"'), 'Preview must include aria-label');
  });
});
