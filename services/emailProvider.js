/**
 * Taskly Customer Support — Email Provider Abstraction & Resend Client
 * Version: 2.2.0 (Build 14)
 * 
 * Implements a testable email provider abstraction with:
 * - Native fetch-based Resend API integration (zero external dependencies)
 * - Idempotency-Key forwarding
 * - Network timeout handling & ambiguous status tagging
 * - Fully isolated in-memory MockEmailProvider for tests and offline development
 */

const crypto = require('crypto');
const { getOutboxConfig } = require('../config/outboxConfig');

class EmailProvider {
  /**
   * @param {Object} payload
   * @param {string} payload.from
   * @param {string|string[]} payload.to
   * @param {string} payload.subject
   * @param {string} payload.html
   * @param {string} payload.text
   * @param {string} [payload.replyTo]
   * @param {Object} [payload.headers]
   * @param {string} [payload.idempotencyKey]
   * @returns {Promise<{ success: boolean, messageId: string, provider: string }>}
   */
  async sendEmail(payload) {
    throw new Error('sendEmail() must be implemented by subclass');
  }
}

/**
 * Resend Email Provider
 * Uses standard Node.js fetch to call https://api.resend.com/emails
 */
class ResendEmailProvider extends EmailProvider {
  constructor({
    apiKey = null,
    apiUrl = null,
    timeoutMs = 15000,
    fetchFn = null
  } = {}) {
    super();
    const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
    const isProduction = process.env.NODE_ENV === 'production' || isVercel;
    const config = getOutboxConfig();
    this.apiKey = apiKey || config.resendApiKey;
    this.apiUrl = apiUrl || config.resendApiUrl;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchFn || (typeof fetch === 'function' ? fetch : null);

    if (isProduction) {
      if (!this.apiKey) {
        throw new Error('Missing Resend API key in production (RESEND_API_KEY is required).');
      }
      if (this.apiKey.startsWith('re_mock_') || this.apiKey === 'mock' || this.apiKey.startsWith('mock_')) {
        throw new Error('Mock Resend API key is prohibited in production.');
      }
    }

    if (!this.fetch) {
      throw new Error('Global fetch is not available in the current Node.js runtime.');
    }
  }

  async sendEmail({
    from,
    to,
    subject,
    html,
    text,
    replyTo,
    headers = {},
    idempotencyKey = null
  }) {
    const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
    const isProduction = process.env.NODE_ENV === 'production' || isVercel;

    if (!this.apiKey || (isProduction && (this.apiKey.startsWith('re_mock_') || this.apiKey === 'mock' || this.apiKey.startsWith('mock_')))) {
      const err = new Error('Resend API key is missing or invalid. Set a valid RESEND_API_KEY in environment.');
      err.statusCode = 401;
      err.isRetryable = false;
      throw err;
    }

    if (!to || (Array.isArray(to) && to.length === 0)) {
      const err = new Error('Recipient email is required.');
      err.statusCode = 400;
      err.isRetryable = false;
      throw err;
    }

    const recipients = Array.isArray(to) ? to : [to];
    const payload = {
      from,
      to: recipients,
      subject,
      html,
      text
    };

    if (replyTo) {
      payload.reply_to = replyTo;
    }
    if (headers && Object.keys(headers).length > 0) {
      payload.headers = headers;
    }

    const requestHeaders = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    };

    if (idempotencyKey) {
      requestHeaders['Idempotency-Key'] = idempotencyKey;
    }

    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), this.timeoutMs);
    let requestDispatched = false;

    try {
      requestDispatched = true;
      const response = await this.fetch(this.apiUrl, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutTimer);

      const status = response.status;
      let responseBody;
      try {
        responseBody = await response.json();
      } catch (_) {
        responseBody = { message: response.statusText || 'Unknown response' };
      }

      if (status >= 200 && status < 300) {
        return {
          success: true,
          messageId: responseBody.id || `resend_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
          provider: 'resend'
        };
      }

      // 429 Rate Limit
      if (status === 429) {
        const retryAfterHeader = response.headers ? response.headers.get('retry-after') : null;
        const err = new Error(`Resend API rate limit exceeded (HTTP 429): ${responseBody.message || 'Rate limit'}`);
        err.statusCode = 429;
        err.isRetryable = true;
        err.retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60;
        throw err;
      }

      // 5xx Server Error
      if (status >= 500) {
        const err = new Error(`Resend API server error (HTTP ${status}): ${responseBody.message || response.statusText}`);
        err.statusCode = status;
        err.isRetryable = true;
        throw err;
      }

      // 4xx Client Error (Permanent failure)
      const err = new Error(`Resend API rejected request (HTTP ${status}): ${responseBody.message || 'Client error'}`);
      err.statusCode = status;
      err.isRetryable = false;
      throw err;

    } catch (err) {
      clearTimeout(timeoutTimer);

      if (err.name === 'AbortError' || err.code === 'ETIMEDOUT') {
        const timeoutErr = new Error(`Resend API request timed out after ${this.timeoutMs}ms`);
        timeoutErr.statusCode = 408;
        timeoutErr.isRetryable = true;
        // If the request was already sent across the network, the remote server may have processed it!
        timeoutErr.isAmbiguous = requestDispatched;
        throw timeoutErr;
      }

      // Preserve existing classified flags if already set
      if (typeof err.isRetryable === 'boolean') {
        throw err;
      }

      // Network transport errors
      const networkErr = new Error(`Network failure connecting to Resend API: ${err.message}`);
      networkErr.isRetryable = true;
      networkErr.isAmbiguous = false;
      throw networkErr;
    }
  }
}

/**
 * Mock Email Provider
 * Stores sent emails in memory for offline development, automated tests, and verification.
 */
class MockEmailProvider extends EmailProvider {
  constructor() {
    super();
    const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
    const isProduction = process.env.NODE_ENV === 'production' || isVercel;
    if (isProduction) {
      throw new Error('MockEmailProvider cannot be used in production or Vercel deployments.');
    }
    this.sentEmails = [];
    this.mockErrorQueue = [];
    this.delayMs = 0;
  }

  async sendEmail(payload) {
    if (this.delayMs > 0) {
      await new Promise(r => setTimeout(r, this.delayMs));
    }

    if (this.mockErrorQueue.length > 0) {
      const err = this.mockErrorQueue.shift();
      if (typeof err === 'function') {
        throw err(payload);
      }
      throw err;
    }

    const messageId = `mock_msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const sentRecord = {
      ...payload,
      id: messageId,
      timestamp: new Date().toISOString()
    };

    this.sentEmails.push(sentRecord);

    return {
      success: true,
      messageId,
      provider: 'mock'
    };
  }

  simulateErrorOnce(err) {
    this.mockErrorQueue.push(err);
  }

  simulateFailureSequence(errors) {
    this.mockErrorQueue.push(...errors);
  }

  setDelay(ms) {
    this.delayMs = ms;
  }

  getSentEmails() {
    return [...this.sentEmails];
  }

  clear() {
    this.sentEmails = [];
    this.mockErrorQueue = [];
  }
}

// Global active provider singleton for test overrides
let activeProvider = null;

function getEmailProvider(options = {}) {
  const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  const isProduction = process.env.NODE_ENV === 'production' || isVercel;

  if (isProduction) {
    if (options.forceMock) {
      throw new Error('forceMock is strictly prohibited in production.');
    }
    if (activeProvider) {
      if (activeProvider instanceof MockEmailProvider) {
        throw new Error('MockEmailProvider is strictly prohibited in production.');
      }
      return activeProvider;
    }

    const config = getOutboxConfig();
    const apiKey = options.apiKey || config.resendApiKey;

    if (!apiKey) {
      throw new Error('Missing Resend API key in production (RESEND_API_KEY is required).');
    }
    if (apiKey.startsWith('re_mock_') || apiKey === 'mock' || apiKey.startsWith('mock_')) {
      throw new Error('Mock Resend API key is prohibited in production.');
    }

    return new ResendEmailProvider(options);
  }

  // Development and test environments:
  if (activeProvider) {
    return activeProvider;
  }

  const config = getOutboxConfig();
  const forceMock = options.forceMock || 
                    process.env.NODE_ENV === 'test' || 
                    !config.resendApiKey || 
                    config.resendApiKey.startsWith('re_mock_');

  if (forceMock) {
    return new MockEmailProvider();
  }

  return new ResendEmailProvider(options);
}

function setEmailProvider(provider) {
  activeProvider = provider;
}

function resetEmailProvider() {
  activeProvider = null;
}

module.exports = {
  EmailProvider,
  ResendEmailProvider,
  MockEmailProvider,
  getEmailProvider,
  setEmailProvider,
  resetEmailProvider
};

