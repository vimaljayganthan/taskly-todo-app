/**
 * Taskly Customer Support — Svix Webhook Signature Verifier
 * Version: 2.2.0 (Build 14)
 * 
 * Verifies standard Svix cryptographic webhook signatures:
 * - Validates svix-id, svix-timestamp, and svix-signature headers
 * - Enforces timestamp tolerance (anti-replay attack protection)
 * - Computes HMAC-SHA256 signature using timing-safe comparison
 * - Zero third-party dependencies (Node.js native crypto)
 */

const crypto = require('crypto');

/**
 * Decodes the webhook secret bytes.
 * Svix secrets are typically prefixed with "whsec_" followed by base64-encoded secret bytes.
 */
function getSecretBytes(secret) {
  if (!secret || typeof secret !== 'string') {
    throw new Error('Webhook secret is required');
  }
  const clean = secret.trim();
  if (clean.startsWith('whsec_')) {
    return Buffer.from(clean.slice(6), 'base64');
  }
  return Buffer.from(clean, 'utf8');
}

/**
 * Verifies inbound Svix webhook request headers.
 * 
 * @param {Object} options
 * @param {string|Buffer} options.rawBody - Raw unparsed HTTP request body
 * @param {Object} options.headers - HTTP request headers
 * @param {string} [options.secret] - Webhook secret (defaults to process.env.RESEND_WEBHOOK_SECRET)
 * @param {number} [options.toleranceSeconds=300] - Maximum timestamp drift in seconds (default 5 min)
 * @returns {{ valid: boolean, error?: string, msgId?: string, timestamp?: number }}
 */
function verifySvixHeaders({
  rawBody,
  headers = {},
  secret = process.env.RESEND_WEBHOOK_SECRET,
  toleranceSeconds = 300
} = {}) {
  // Normalize header names (lowercase)
  const normHeaders = {};
  for (const [k, v] of Object.entries(headers || {})) {
    normHeaders[k.toLowerCase()] = v;
  }

  const msgId = normHeaders['svix-id'];
  const msgTimestamp = normHeaders['svix-timestamp'];
  const msgSignature = normHeaders['svix-signature'];

  if (!msgId || !msgTimestamp || !msgSignature) {
    return {
      valid: false,
      error: 'Missing required Svix webhook headers (svix-id, svix-timestamp, svix-signature)'
    };
  }

  if (!secret) {
    return {
      valid: false,
      error: 'Webhook secret is not configured in server environment'
    };
  }

  // 1. Timestamp Verification (Replay Attack Protection)
  const ts = parseInt(msgTimestamp, 10);
  if (isNaN(ts) || ts <= 0) {
    return {
      valid: false,
      error: 'Invalid svix-timestamp header'
    };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > toleranceSeconds) {
    return {
      valid: false,
      error: `Webhook timestamp expired or drifted outside ${toleranceSeconds}s tolerance window`
    };
  }

  // 2. Prepare payload to sign: "${msgId}.${msgTimestamp}.${rawBody}"
  const bodyStr = typeof rawBody === 'string' ? rawBody : (rawBody ? rawBody.toString('utf8') : '');
  const toSign = `${msgId}.${msgTimestamp}.${bodyStr}`;

  // 3. Compute expected signature
  let secretBytes;
  try {
    secretBytes = getSecretBytes(secret);
  } catch (err) {
    return { valid: false, error: `Invalid webhook secret format: ${err.message}` };
  }

  const computedSig = crypto
    .createHmac('sha256', secretBytes)
    .update(toSign)
    .digest('base64');

  // 4. Check against provided signatures (format: "v1,<base64> v1,<base64>")
  const passedSigs = msgSignature.split(' ').map(s => s.trim()).filter(Boolean);
  let hasMatchingSig = false;

  for (const sig of passedSigs) {
    const parts = sig.split(',');
    if (parts.length === 2 && parts[0] === 'v1') {
      const candidateHash = parts[1];
      try {
        const computedBuf = Buffer.from(computedSig, 'base64');
        const candidateBuf = Buffer.from(candidateHash, 'base64');
        if (computedBuf.length === candidateBuf.length && crypto.timingSafeEqual(computedBuf, candidateBuf)) {
          hasMatchingSig = true;
          break;
        }
      } catch (_) {}
    }
  }

  if (!hasMatchingSig) {
    return {
      valid: false,
      error: 'Cryptographic signature mismatch'
    };
  }

  return {
    valid: true,
    msgId,
    timestamp: ts
  };
}

/**
 * Test helper to generate valid Svix signature headers.
 */
function signSvixPayload({
  rawBody,
  msgId = `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
  timestamp = Math.floor(Date.now() / 1000),
  secret = 'whsec_test_secret_1234567890abcdefghijklmnopqrstuv'
}) {
  const secretBytes = getSecretBytes(secret);
  const bodyStr = typeof rawBody === 'string' ? rawBody : (rawBody ? JSON.stringify(rawBody) : '');
  const toSign = `${msgId}.${timestamp}.${bodyStr}`;

  const sigBase64 = crypto
    .createHmac('sha256', secretBytes)
    .update(toSign)
    .digest('base64');

  return {
    'svix-id': msgId,
    'svix-timestamp': String(timestamp),
    'svix-signature': `v1,${sigBase64}`
  };
}

module.exports = {
  verifySvixHeaders,
  signSvixPayload,
  getSecretBytes
};

