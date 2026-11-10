/**
 * Taskly Customer Support — Outbox Retry & Backoff Strategy
 * Version: 2.2.0 (Build 14)
 * 
 * Implements exponential backoff with jitter, error classification (transient vs permanent),
 * ambiguous in-flight request detection, and the strict 23h 45m Resend idempotency safety cutoff.
 */

/**
 * Calculates exponential backoff delay in seconds.
 * Formula: delay = min(maxDelay, baseDelay * 2^retryCount) * jitterFactor
 * 
 * @param {Object} options
 * @param {number} options.retryCount - Number of previous attempts (0-indexed)
 * @param {number} [options.baseDelaySeconds=60] - Base delay in seconds
 * @param {number} [options.maxDelaySeconds=3600] - Cap on maximum delay (default 1 hr)
 * @param {boolean} [options.jitter=true] - Whether to apply full/randomized jitter
 * @returns {number} Delay in seconds
 */
function calculateBackoff({
  retryCount = 0,
  baseDelaySeconds = 60,
  maxDelaySeconds = 3600,
  jitter = true
} = {}) {
  const safeCount = Math.max(0, parseInt(retryCount, 10) || 0);
  const base = Math.max(10, parseInt(baseDelaySeconds, 10) || 60);
  const max = Math.max(base, parseInt(maxDelaySeconds, 10) || 3600);

  // Exponential backoff: base * 2^safeCount
  // Guard against overflow with 2^safeCount when safeCount is large
  const expFactor = safeCount >= 10 ? Math.pow(2, 10) : Math.pow(2, safeCount);
  let delay = Math.min(max, base * expFactor);

  if (jitter) {
    // Add 10-20% random jitter to avoid thundering herd problem
    const jitterFactor = 0.8 + Math.random() * 0.4; // 0.8 to 1.2
    delay = Math.round(delay * jitterFactor);
  }

  // Ensure bounded between 10 seconds and maxDelaySeconds
  return Math.max(10, Math.min(max, Math.round(delay)));
}

/**
 * Checks if a job has exceeded the Resend 24-hour idempotency retention window.
 * Enforces a strict 23h 45m safety cutoff to guarantee zero duplicate emails.
 * 
 * @param {string|Date} firstAttemptStartedAt
 * @param {number} [cutoffMinutes=1425] - Default 23 hours 45 minutes
 * @returns {boolean} True if the cutoff window has elapsed
 */
function isExceedingSafetyCutoff(firstAttemptStartedAt, cutoffMinutes = 1425) {
  if (!firstAttemptStartedAt) return false;
  const startedTime = new Date(firstAttemptStartedAt).getTime();
  if (isNaN(startedTime)) return false;

  const elapsedMs = Date.now() - startedTime;
  const cutoffMs = cutoffMinutes * 60 * 1000;
  return elapsedMs >= cutoffMs;
}

/**
 * Classifies an error encountered during email delivery.
 * Categorizes errors as:
 * - transient: retryable after backoff (e.g. rate limit, 5xx server error, temporary network disconnect)
 * - permanent: not retryable, immediate dead-letter (e.g. 400 Bad Request, invalid email address, auth failure)
 * - ambiguous: request dispatched but response timed out; remote provider may or may not have sent the email
 * 
 * @param {Error|Object} err
 * @returns {{ isRetryable: boolean, isAmbiguous: boolean, statusCode: number|null, message: string, retryAfterSeconds: number|null }}
 */
function classifyError(err) {
  if (!err) {
    return {
      isRetryable: false,
      isAmbiguous: false,
      statusCode: null,
      message: 'Unknown error',
      retryAfterSeconds: null
    };
  }

  const statusCode = err.statusCode || (err.response && err.response.status) || null;
  const msg = err.message || String(err);
  const code = err.code || '';

  // 1. Timeout or abort after dispatch: AMBIGUOUS
  // Remote server might have processed the request before connection broke
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || err.name === 'TimeoutError' || msg.includes('timeout') || err.isAmbiguous) {
    return {
      isRetryable: true,
      isAmbiguous: true,
      statusCode: statusCode || 408,
      message: `Request timeout / ambiguous outcome: ${msg}`,
      retryAfterSeconds: 60
    };
  }

  // 2. HTTP 429 Too Many Requests: Transient Rate Limit
  if (statusCode === 429) {
    let retryAfter = null;
    if (err.retryAfter) {
      retryAfter = parseInt(err.retryAfter, 10) || null;
    }
    return {
      isRetryable: true,
      isAmbiguous: false,
      statusCode: 429,
      message: `Rate limited by email provider (HTTP 429): ${msg}`,
      retryAfterSeconds: retryAfter
    };
  }

  // 3. HTTP 5xx Server Errors: Transient Provider Outage
  if (statusCode >= 500 && statusCode < 600) {
    return {
      isRetryable: true,
      isAmbiguous: false,
      statusCode,
      message: `Provider server error (HTTP ${statusCode}): ${msg}`,
      retryAfterSeconds: null
    };
  }

  // 4. Network disconnection before or during request
  if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ENOTFOUND' || msg.includes('fetch failed')) {
    return {
      isRetryable: true,
      isAmbiguous: err.isAmbiguous || false,
      statusCode: statusCode || 503,
      message: `Network transport failure: ${msg}`,
      retryAfterSeconds: null
    };
  }

  // 5. HTTP 4xx Client Errors: Permanent Failures (Dead-Letter)
  // 400 Bad Request, 401 Unauthorized, 403 Forbidden, 422 Unprocessable Entity
  if (statusCode >= 400 && statusCode < 500) {
    return {
      isRetryable: false,
      isAmbiguous: false,
      statusCode,
      message: `Permanent delivery rejection (HTTP ${statusCode}): ${msg}`,
      retryAfterSeconds: null
    };
  }

  // 6. Explicit retryable flag on error object
  if (typeof err.isRetryable === 'boolean') {
    return {
      isRetryable: err.isRetryable,
      isAmbiguous: Boolean(err.isAmbiguous),
      statusCode,
      message: msg,
      retryAfterSeconds: null
    };
  }

  // Default: treat unknown application errors as permanent to prevent retry storms
  return {
    isRetryable: false,
    isAmbiguous: false,
    statusCode,
    message: msg,
    retryAfterSeconds: null
  };
}

module.exports = {
  calculateBackoff,
  isExceedingSafetyCutoff,
  classifyError
};

