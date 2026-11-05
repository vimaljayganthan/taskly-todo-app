const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const app = require('../server');

function mockRequest(app, options) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = (options.method || 'GET').toUpperCase();
    req.url = options.url || '/auth/confirmed';
    req.headers = Object.assign({
      'content-type': 'text/html'
    }, options.headers || {});
    req.body = options.body;
    req.app = app;

    const res = new EventEmitter();
    res.statusCode = 200;
    res._headers = {};
    res.setHeader = (k, v) => { res._headers[k.toLowerCase()] = v; };
    res.getHeader = (k) => res._headers[k.toLowerCase()];
    res.status = (code) => { res.statusCode = code; return res; };

    let resBody = '';
    res.write = (chunk) => {
      if (chunk) resBody += chunk.toString();
      return true;
    };
    res.writeHead = (status, headers) => {
      res.statusCode = status;
      if (headers) Object.assign(res._headers, headers);
      return res;
    };
    res.json = (data) => {
      res.emit('finish');
      resolve({ status: res.statusCode, headers: res._headers, body: data });
    };
    res.send = (data) => {
      res.emit('finish');
      resolve({ status: res.statusCode, headers: res._headers, body: data });
    };
    res.sendFile = (filePath) => {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        res._headers['content-type'] = 'text/html; charset=UTF-8';
        res.emit('finish');
        resolve({ status: 200, headers: res._headers, body: fileContent });
      } catch (err) {
        reject(err);
      }
    };
    res.end = (data) => {
      if (data) resBody += data.toString();
      res.emit('finish');
      resolve({ status: res.statusCode, headers: res._headers, body: resBody });
    };

    app.handle(req, res, reject);
  });
}

describe('Dedicated Email Confirmation Success Page (/auth/confirmed)', () => {
  const htmlPath = path.join(__dirname, '../public/auth/confirmed.html');

  test('public/auth/confirmed.html file exists and contains expected structure', () => {
    assert.strictEqual(fs.existsSync(htmlPath), true);
    const content = fs.readFileSync(htmlPath, 'utf8');

    // Requirement 5: Exactly contains "✓ Your email has been confirmed!!!" and "You can now sign in to Taskly."
    assert.match(content, /✓ Your email has been confirmed!!!/);
    assert.match(content, /You can now sign in to Taskly\./);

    // Requirement 4: Does not unconditionally show success; has state panels
    assert.match(content, /id="panel-loading"/);
    assert.match(content, /id="panel-success"/);
    assert.match(content, /id="panel-expired"/);
    assert.match(content, /id="panel-error"/);

    // Requirement 6 & 10: Supports verifyOtp with token_hash for cross-context APK -> Chrome confirmation
    assert.match(content, /verifyOtp/);
    assert.match(content, /token_hash/);
    assert.match(content, /otp_expired/);

    // Rejection on missing tokens
    assert.match(content, /No confirmation token or code was provided/);
  });

  test('Express server handles GET /auth/confirmed with HTTP 200 and HTML content', async () => {
    const res = await mockRequest(app, { url: '/auth/confirmed' });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers['content-type'] || '', /text\/html/);
    assert.match(res.body, /✓ Your email has been confirmed!!!/);
    assert.match(res.body, /You can now sign in to Taskly\./);
  });

  test('vercel.json includes rewrite for /auth/confirmed to /auth/confirmed.html', () => {
    const vercelConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8'));
    const rewrites = vercelConfig.rewrites || [];
    const confirmedRewrite = rewrites.find(r => r.source === '/auth/confirmed');
    assert.ok(confirmedRewrite, 'vercel.json must rewrite /auth/confirmed');
    assert.strictEqual(confirmedRewrite.destination, '/auth/confirmed.html');
  });
});
