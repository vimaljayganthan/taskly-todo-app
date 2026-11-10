/**
 * Taskly Customer Support — Email Outbox Configuration
 * Version: 2.2.0 (Build 14)
 * 
 * Provides secure, environment-based configuration for Resend API delivery,
 * outbox worker polling, retry backoff, and dead-letter safety cutoffs.
 */

function getOutboxConfig() {
  const isProd = process.env.NODE_ENV === 'production';

  return {
    // Resend API Credentials
    resendApiKey: process.env.RESEND_API_KEY || (isProd ? null : 're_mock_test_key_12345'),
    resendApiUrl: process.env.RESEND_API_URL || 'https://api.resend.com/emails',
    
    // Email Routing & Addresses
    senderEmail: process.env.RESEND_SENDER_EMAIL || (isProd ? 'Taskly Support <support@taskly.app>' : 'Taskly Support <onboarding@resend.dev>'),
    receivingDomain: process.env.RESEND_RECEIVING_DOMAIN || 'd893f1.resend.app',
    developerEmail: process.env.SUPPORT_DEVELOPER_EMAIL || 'tasklypets@gmail.com',

    // Worker Polling & Concurrency
    pollIntervalMs: Math.max(500, parseInt(process.env.OUTBOX_POLL_INTERVAL_MS, 10) || 5000),
    batchSize: Math.max(1, Math.min(50, parseInt(process.env.OUTBOX_BATCH_SIZE, 10) || 10)),
    leaseSeconds: Math.max(10, Math.min(300, parseInt(process.env.OUTBOX_LEASE_SECONDS, 10) || 60)),

    // Retry & Backoff Parameters
    maxRetries: Math.max(1, Math.min(10, parseInt(process.env.OUTBOX_MAX_RETRIES, 10) || 5)),
    baseDelaySeconds: Math.max(10, parseInt(process.env.OUTBOX_BASE_DELAY_SECONDS, 10) || 60),
    maxDelaySeconds: Math.max(60, parseInt(process.env.OUTBOX_MAX_DELAY_SECONDS, 10) || 3600),

    // Safety Cutoff: Resend 24-Hour Idempotency Retention Limit
    // Enforces 23 hours 45 minutes safety cutoff to eliminate duplicate email delivery
    idempotencyCutoffMinutes: 23 * 60 + 45, // 1425 minutes

    // Environment Flags
    isProduction: isProd,
    isTest: process.env.NODE_ENV === 'test'
  };
}

/**
 * Validates configuration and returns validation errors if any
 */
function validateOutboxConfig(cfg = getOutboxConfig()) {
  const errors = [];

  if (cfg.isProduction) {
    if (!cfg.resendApiKey || cfg.resendApiKey.startsWith('re_mock_')) {
      errors.push('RESEND_API_KEY is required in production and must not be a mock key.');
    }
    if (!cfg.senderEmail || !cfg.senderEmail.includes('@')) {
      errors.push('RESEND_SENDER_EMAIL must be a valid email address.');
    }
    if (!cfg.receivingDomain || cfg.receivingDomain.length < 4) {
      errors.push('RESEND_RECEIVING_DOMAIN is required in production.');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Masks sensitive configuration for safe operational logging
 */
function getMaskedConfig(cfg = getOutboxConfig()) {
  let maskedKey = 'none';
  if (cfg.resendApiKey) {
    if (cfg.resendApiKey.length > 8) {
      maskedKey = `${cfg.resendApiKey.substring(0, 5)}...${cfg.resendApiKey.substring(cfg.resendApiKey.length - 3)}`;
    } else {
      maskedKey = '***';
    }
  }

  return {
    resendApiKey: maskedKey,
    resendApiUrl: cfg.resendApiUrl,
    senderEmail: cfg.senderEmail,
    receivingDomain: cfg.receivingDomain,
    developerEmail: cfg.developerEmail,
    pollIntervalMs: cfg.pollIntervalMs,
    batchSize: cfg.batchSize,
    leaseSeconds: cfg.leaseSeconds,
    maxRetries: cfg.maxRetries,
    baseDelaySeconds: cfg.baseDelaySeconds,
    maxDelaySeconds: cfg.maxDelaySeconds,
    idempotencyCutoffMinutes: cfg.idempotencyCutoffMinutes,
    isProduction: cfg.isProduction,
    isTest: cfg.isTest
  };
}

module.exports = {
  getOutboxConfig,
  validateOutboxConfig,
  getMaskedConfig
};

