/**
 * Taskly Two-Way Push Notification System — Core Notification Service & Worker
 * File: services/notificationService.js
 * Version: 2.2.0 (Build 14)
 * 
 * Provides:
 * 1. FCM Error Classification (Transient vs Confirmed Invalid Token vs Fatal Configuration)
 * 2. Safe Keyset Token Pagination & Delivery Log Keyset Pagination
 * 3. Atomic Inbox Expansion (customer_all, customer_single, developer_all)
 * 4. Partial Batch Recovery (Exclusion of already-accepted or invalid tokens on retry)
 * 5. Outbox Lease State Machine & Distributed Crash Recovery
 * 6. Strict Persistence Failure Propagation (Guarantees durable logs before outbox completion)
 * 7. Native Android Notification Channel Sound Preservation (No explicit payload sound overrides)
 * 8. Explicit Test-Mode Gate for Mock FCM Delivery (Fails visibly on missing production Firebase config)
 */

const crypto = require('crypto');
const { listEligibleCustomerUsers } = require('./customerEligibility');

// ==============================================================================
// 1. FCM Error Classification Strategy
// ==============================================================================

/**
 * Confirmed token-specific invalidation error codes from Firebase Cloud Messaging.
 * When encountering these errors, the token is confirmed invalid/unregistered.
 * It must be marked is_active = false and logged as status = 'invalid_token'.
 * This is a terminal outcome for that device, and does NOT fail the parent outbox job.
 * 
 * NOTE: 'messaging/mismatched-credential' and 'MismatchSenderId' are deliberately
 * EXCLUDED: they represent project/credential mismatches on the server, NEVER invalid device tokens!
 */
const CONFIRMED_INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'UNREGISTERED',
  'NotRegistered',
  'InvalidRegistration'
]);

/**
 * Fatal configuration, authentication, and payload errors.
 * These errors indicate project credential mismatch, authentication failures, missing project,
 * or malformed payloads. They must NEVER deactivate device tokens!
 * These errors cause the parent outbox job to fail permanently / dead-letter.
 */
const FATAL_CONFIG_ERROR_CODES = new Set([
  'messaging/mismatched-credential',
  'MismatchSenderId',
  'messaging/invalid-payload',
  'messaging/invalid-recipient',
  'messaging/project-not-found',
  'messaging/authentication-error',
  'messaging/missing-credentials',
  'app/invalid-credential',
  'app/invalid-credential-provider',
  'auth/invalid-credential',
  'invalid_grant',
  'invalid-grant'
]);

/**
 * Known transient FCM error codes that warrant exponential backoff retry.
 * The token remains active, the delivery log records status = 'fcm_failed',
 * and the outbox job is rescheduled for retry without marking completed.
 */
const TRANSIENT_FCM_ERROR_CODES = new Set([
  'messaging/server-unavailable',
  'messaging/internal-error',
  'messaging/quota-exceeded',
  'messaging/device-message-rate-exceeded',
  'messaging/unknown-error',
  'Unavailable',
  'InternalServerError',
  'DeviceMessageRateExceeded',
  'TopicsMessageRateExceeded'
]);

/**
 * Classifies an error encountered during FCM dispatch.
 * 
 * Rules:
 * - Never classify 'messaging/mismatched-credential' as an invalid device token.
 * - Do not treat every generic INVALID_ARGUMENT as an invalid token.
 * - Only deactivate tokens for confirmed token-specific invalidation.
 * - Handle fatal configuration and payload errors separately from transient failures.
 * 
 * @param {Error|Object} err
 * @returns {{
 *   isTransient: boolean,
 *   isPermanentInvalidToken: boolean,
 *   isFatal: boolean,
 *   category: 'invalid_token' | 'transient' | 'fatal' | 'unknown',
 *   statusCode: number|null,
 *   message: string
 * }}
 */
function classifyFcmError(err) {
  if (!err) {
    return {
      isTransient: false,
      isPermanentInvalidToken: false,
      isFatal: false,
      category: 'unknown',
      statusCode: null,
      message: 'Unknown error'
    };
  }

  const code = err.code || (err.errorInfo && err.errorInfo.code) || '';
  const message = err.message || String(err);
  const statusCode = err.statusCode || (err.response && err.response.status) || null;
  const msgLower = message.toLowerCase();

  // 1. Explicit Check: Project/Sender Credential Mismatches and Firebase Auth/Credential errors are FATAL CONFIGURATION ERRORS.
  // Must NEVER deactivate user device tokens!
  if (
    code === 'messaging/mismatched-credential' ||
    code === 'MismatchSenderId' ||
    code === 'app/invalid-credential' ||
    code === 'auth/invalid-credential' ||
    code === 'app/invalid-credential-provider' ||
    msgLower.includes('mismatched-credential') ||
    msgLower.includes('mismatchsenderid') ||
    msgLower.includes('invalid_grant') ||
    msgLower.includes('invalid grant') ||
    msgLower.includes('account not found') ||
    msgLower.includes('invalid jwt signature')
  ) {
    return {
      isTransient: false,
      isPermanentInvalidToken: false,
      isFatal: true,
      category: 'fatal',
      statusCode: statusCode || 401,
      message: `Fatal Firebase authentication/service account credential error: [${code}] ${message}`
    };
  }

  // 2. Confirmed Token-Specific Invalidation Check
  const isConfirmedCode = CONFIRMED_INVALID_TOKEN_CODES.has(code);
  const isConfirmedMsg = 
    msgLower.includes('registration-token-not-registered') ||
    msgLower.includes('the registration token is not a valid fcm registration token') ||
    msgLower.includes('invalid registration token') ||
    msgLower.includes('notregistered') ||
    msgLower.includes('invalidregistration');

  // Generic INVALID_ARGUMENT is ONLY treated as invalid token if details specifically identify the registration token!
  const isInvalidArgumentToken = (code === 'INVALID_ARGUMENT' || code === 'messaging/invalid-argument') &&
    msgLower.includes('token') &&
    (msgLower.includes('not a valid') || msgLower.includes('invalid') || msgLower.includes('malformed') || msgLower.includes('unregistered'));

  if (isConfirmedCode || isConfirmedMsg || isInvalidArgumentToken) {
    return {
      isTransient: false,
      isPermanentInvalidToken: true,
      isFatal: false,
      category: 'invalid_token',
      statusCode: statusCode || 404,
      message: `Permanent invalid FCM token: [${code}] ${message}`
    };
  }

  // 3. Fatal Configuration & Payload Errors
  if (FATAL_CONFIG_ERROR_CODES.has(code) || 
      statusCode === 401 || statusCode === 403 ||
      code === 'INVALID_ARGUMENT' || code === 'messaging/invalid-argument' ||
      code === 'messaging/invalid-payload' || code === 'messaging/invalid-recipient') {
    return {
      isTransient: false,
      isPermanentInvalidToken: false,
      isFatal: true,
      category: 'fatal',
      statusCode: statusCode || 400,
      message: `Fatal payload or configuration error: [${code}] ${message}`
    };
  }

  // 4. HTTP 429 Too Many Requests or 5xx Server Errors
  if (statusCode === 429 || (statusCode >= 500 && statusCode < 600)) {
    return {
      isTransient: true,
      isPermanentInvalidToken: false,
      isFatal: false,
      category: 'transient',
      statusCode,
      message: `Transient HTTP ${statusCode} from FCM: ${message}`
    };
  }

  // 5. Transient FCM Service Errors
  if (TRANSIENT_FCM_ERROR_CODES.has(code) || msgLower.includes('server-unavailable') || msgLower.includes('internal-error') || msgLower.includes('quota-exceeded')) {
    return {
      isTransient: true,
      isPermanentInvalidToken: false,
      isFatal: false,
      category: 'transient',
      statusCode: statusCode || 503,
      message: `Transient FCM error: [${code}] ${message}`
    };
  }

  // 6. Network and Connection Timeouts
  const netCodes = new Set(['ECONNRESET', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN']);
  if (netCodes.has(code) || err.name === 'TimeoutError' || msgLower.includes('timeout')) {
    return {
      isTransient: true,
      isPermanentInvalidToken: false,
      isFatal: false,
      category: 'transient',
      statusCode: statusCode || 408,
      message: `Network timeout / connectivity failure: [${code}] ${message}`
    };
  }

  // Default to transient retry for safety (fail-open on network uncertainty)
  return {
    isTransient: true,
    isPermanentInvalidToken: false,
    isFatal: false,
    category: 'unknown',
    statusCode,
    message: `Unclassified error treated as transient: [${code}] ${message}`
  };
}

// ==============================================================================
// 2. NotificationService Worker Class
// ==============================================================================

class NotificationService {
  /**
   * @param {Object} options
   * @param {Object} options.supabaseClient - Supabase client with service_role privileges
   * @param {Object} [options.messagingProvider] - FCM messaging provider (e.g. admin.messaging() or mock)
   * @param {string} [options.workerId] - Unique worker process identity
   * @param {Object} [options.logger] - Structured logger
   * @param {number} [options.batchSize=10] - Outbox jobs to claim per batch
   * @param {number} [options.leaseSeconds=60] - Atomic lease lock duration in seconds
   * @param {number} [options.tokenPageSize=500] - Keyset pagination batch size for device tokens
   * @param {boolean} [options.allowMockDelivery=false] - Explicit flag allowing mock FCM delivery. Default FALSE.
   */
  constructor(options = {}) {
    this.supabase = options.supabaseClient || null;
    this.customerSupabase = options.customerSupabaseClient || options.supabaseClient || null;
    this.messaging = options.messagingProvider || null;
    this.workerId = options.workerId || `worker_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
    this.batchSize = Math.max(1, Math.min(50, options.batchSize || 10));
    this.leaseSeconds = Math.max(10, Math.min(300, options.leaseSeconds || 60));
    this.tokenPageSize = Math.max(50, Math.min(1000, options.tokenPageSize || 500));
    this.allowMockDelivery = options.allowMockDelivery === true;
    this.logger = options.logger || this._defaultLogger();
  }

  _defaultLogger() {
    return {
      info: (msg, meta) => console.log(`[NotificationService:INFO] ${msg}`, meta ? JSON.stringify(meta) : ''),
      warn: (msg, meta) => console.warn(`[NotificationService:WARN] ${msg}`, meta ? JSON.stringify(meta) : ''),
      error: (msg, meta) => console.error(`[NotificationService:ERROR] ${msg}`, meta ? JSON.stringify(meta) : '')
    };
  }

  /**
   * Claims a batch of ready or expired-lease outbox jobs via atomic stored procedure.
   * Uses FOR UPDATE SKIP LOCKED and automatically sweeps exhausted jobs into dead_letter.
   * 
   * @param {number} [batchSize]
   * @param {number} [leaseSeconds]
   * @returns {Promise<Array<Object>>}
   */
  async claimBatch(batchSize, leaseSeconds) {
    if (!this.supabase) {
      throw new Error('Supabase client is required to claim outbox batch');
    }

    const { data, error } = await this.supabase.rpc('claim_notification_outbox_batch', {
      p_worker_id: this.workerId,
      p_batch_size: batchSize || this.batchSize,
      p_lease_seconds: leaseSeconds || this.leaseSeconds
    });

    if (error) {
      this.logger.error('Failed to claim outbox batch', { error: error.message });
      throw new Error(`claim_notification_outbox_batch failed: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Ensures the master notification row exists in a target Supabase client's
   * public.notifications table using the outbox job's deduplication_key as idempotency_key.
   * 
   * @param {Object} job - notification_outbox row
   * @param {Object} client - Target Supabase client (Developer or Customer)
   * @returns {Promise<string>} notification_id (UUID)
   */
  async ensureMasterNotificationInClient(job, client) {
    if (!client) {
      throw new Error('Supabase client is required to ensure master notification');
    }

    const dedupKey = job.deduplication_key || `job_dedup_${job.id}`;

    // 1. Try to fetch existing notification by idempotency key
    const { data: existing, error: fetchErr } = await client
      .from('notifications')
      .select('id')
      .eq('idempotency_key', dedupKey)
      .maybeSingle();

    if (fetchErr) {
      throw new Error(`Failed to check existing master notification: ${fetchErr.message}`);
    }

    if (existing && existing.id) {
      return existing.id;
    }

    // 2. Insert master notification row idempotently with constraint-safe type mapping
    const validNotificationTypes = new Set([
      'new_ticket',
      'ticket_reply',
      'status_changed',
      'priority_changed',
      'ticket_resolved',
      'ticket_closed',
      'ticket_reopened',
      'admin_custom_broadcast',
      'admin_custom_direct'
    ]);

    let safeNotifType = job.event_type;
    if (!validNotificationTypes.has(safeNotifType)) {
      if (job.target_audience === 'developer_all') safeNotifType = 'new_ticket';
      else if (job.target_audience === 'customer_single') safeNotifType = 'ticket_reply';
      else safeNotifType = 'admin_custom_broadcast';
    }

    const { data: inserted, error: insertErr } = await client
      .from('notifications')
      .insert({
        idempotency_key: dedupKey,
        notification_type: safeNotifType,
        title: job.title,
        body: job.body,
        data: job.data || {},
        sender_email: job.recipient_email === 'tasklypets@gmail.com' ? 'tasklypets@gmail.com' : 'support@taskly.app',
        target_audience: job.target_audience
      })
      .select('id')
      .single();

    if (insertErr) {
      // Handle race condition where another worker inserted concurrently
      if (insertErr.code === '23505') { // unique violation
        const { data: retryFetch } = await client
          .from('notifications')
          .select('id')
          .eq('idempotency_key', dedupKey)
          .single();
        if (retryFetch && retryFetch.id) return retryFetch.id;
      }
      throw new Error(`Failed to insert master notification: ${insertErr.message}`);
    }

    return inserted.id;
  }

  /**
   * Ensures the master notification row exists in Developer database public.notifications
   * using the outbox job's deduplication_key as the idempotency_key.
   *
   * @param {Object} job - notification_outbox row
   * @returns {Promise<string>} notification_id (UUID)
   */
  async ensureMasterNotification(job) {
    return await this.ensureMasterNotificationInClient(job, this.supabase);
  }

  /**
   * Expands recipient inbox entries idempotently based on target_audience across dual databases.
   * Guarantees:
   * - customer_all: Resolves eligible customers and inserts into Customer DB public.user_notification_inbox
   *   referencing customerNotificationId. Does NOT write to Developer DB.
   * - developer_all: Resolves authorized developer IDs via get_authorized_developer_user_ids()
   *   and inserts into Developer DB public.user_notification_inbox referencing devNotificationId.
   * - customer_single: Inserts single inbox entry for recipient_user_id in Customer DB
   *   referencing customerNotificationId. Does NOT write to Developer DB.
   * 
   * Retries never duplicate inbox records due to UNIQUE(user_id, notification_id).
   * 
   * @param {Object} job - notification_outbox row
   * @param {string|Object} notificationIds - notification UUID or { devNotificationId, customerNotificationId }
   */
  async expandInbox(job, notificationIds) {
    const devNotificationId = typeof notificationIds === 'object' && notificationIds !== null
      ? (notificationIds.devNotificationId || notificationIds.notificationId)
      : notificationIds;
    const customerNotificationId = typeof notificationIds === 'object' && notificationIds !== null
      ? (notificationIds.customerNotificationId || notificationIds.notificationId || devNotificationId)
      : notificationIds;

    const targetCustomerClient = this.customerSupabase || this.supabase;

    if (job.target_audience === 'customer_all') {
      let insertedCount = 0;
      if (targetCustomerClient.auth && targetCustomerClient.auth.admin && typeof targetCustomerClient.auth.admin.listUsers === 'function') {
        const eligibleCustomers = await listEligibleCustomerUsers(targetCustomerClient);
        if (eligibleCustomers.length > 0) {
          const inboxRows = eligibleCustomers.map(c => ({
            notification_id: customerNotificationId,
            user_id: c.id
          }));

          // Batch insert in chunks of 200 to prevent payload limits
          for (let i = 0; i < inboxRows.length; i += 200) {
            const chunk = inboxRows.slice(i, i + 200);
            const { error: insErr } = await targetCustomerClient
              .from('user_notification_inbox')
              .upsert(chunk, { onConflict: 'user_id,notification_id', ignoreDuplicates: true });
            if (insErr) {
              throw new Error(`Failed to insert broadcast customer inbox rows: ${insErr.message}`);
            }
          }
          insertedCount = eligibleCustomers.length;
        }
      } else {
        const { data: count, error } = await targetCustomerClient.rpc('expand_broadcast_inbox_atomic', {
          p_notification_id: customerNotificationId
        });
        if (error) {
          throw new Error(`expand_broadcast_inbox_atomic failed: ${error.message}`);
        }
        insertedCount = count;
      }
      this.logger.info(`Broadcast inbox expanded for customer accounts in Customer DB`, { customerNotificationId, insertedCount });
      return;
    }

    if (job.target_audience === 'developer_all') {
      const { data: devs, error: devErr } = await this.supabase.rpc('get_authorized_developer_user_ids');
      if (devErr) {
        throw new Error(`get_authorized_developer_user_ids failed: ${devErr.message}`);
      }

      if (devs && devs.length > 0) {
        const inboxRows = devs.map(d => ({
          notification_id: devNotificationId,
          user_id: d.user_id
        }));

        const { error: insErr } = await this.supabase
          .from('user_notification_inbox')
          .upsert(inboxRows, { onConflict: 'user_id,notification_id', ignoreDuplicates: true });

        if (insErr) {
          throw new Error(`Failed to insert developer inbox rows: ${insErr.message}`);
        }
      }
      return;
    }

    if (job.target_audience === 'customer_single') {
      if (!job.recipient_user_id) {
        this.logger.warn(`customer_single job missing recipient_user_id; skipping inbox row`, { jobId: job.id });
        return;
      }

      const { error: insErr } = await targetCustomerClient
        .from('user_notification_inbox')
        .upsert({
          notification_id: customerNotificationId,
          user_id: job.recipient_user_id
        }, { onConflict: 'user_id,notification_id', ignoreDuplicates: true });

      if (insErr) {
        throw new Error(`Failed to insert customer inbox row: ${insErr.message}`);
      }
    }
  }

  /**
   * Retrieves prior delivery attempts for this notification from public.notification_delivery_logs.
   * Paginated using keyset queries over (id ASC) to safely handle large broadcasts
   * without exceeding Supabase response row limits.
   * 
   * Categorizes outcomes into:
   * - terminalTokenIds: Tokens with status 'fcm_accepted' or 'invalid_token' (never retry)
   * - failedTokenIds: Tokens with status 'fcm_failed' (unresolved, eligible for retry)
   * 
   * @param {string} notificationId - public.notifications UUID
   * @returns {Promise<{
   *   terminalTokenIds: Set<string>,
   *   acceptedTokenIds: Set<string>,
   *   invalidTokenIds: Set<string>,
   *   failedTokenIds: Set<string>
   * }>}
   */
  async getPriorDeliveryLogs(notificationId) {
    const terminalTokenIds = new Set();
    const acceptedTokenIds = new Set();
    const invalidTokenIds = new Set();
    const failedTokenIds = new Set();

    const pageSize = this.tokenPageSize || 500;
    let lastSeenId = '00000000-0000-0000-0000-000000000000';

    while (true) {
      const { data: logs, error } = await this.supabase
        .from('notification_delivery_logs')
        .select('id, device_token_id, status')
        .eq('notification_id', notificationId)
        .gt('id', lastSeenId)
        .order('id', { ascending: true })
        .limit(pageSize);

      if (error) {
        throw new Error(`Failed to query prior delivery logs: ${error.message}`);
      }

      if (!logs || logs.length === 0) break;

      for (const log of logs) {
        if (!log.device_token_id) continue;
        if (log.status === 'fcm_accepted') {
          terminalTokenIds.add(log.device_token_id);
          acceptedTokenIds.add(log.device_token_id);
        } else if (log.status === 'invalid_token') {
          terminalTokenIds.add(log.device_token_id);
          invalidTokenIds.add(log.device_token_id);
        } else if (log.status === 'fcm_failed') {
          failedTokenIds.add(log.device_token_id);
        }
      }

      lastSeenId = logs[logs.length - 1].id;
      if (logs.length < pageSize) break;
    }

    return { terminalTokenIds, acceptedTokenIds, invalidTokenIds, failedTokenIds };
  }

  /**
   * Fetches active device tokens matching the job audience using Keyset Pagination.
   * Keyset pagination on (id ASC) guarantees:
   * 1. In-flight deactivations (is_active = false) do NOT shift offsets or skip tokens.
   * 2. Scales safely across large recipient volumes.
   * 
   * @param {Object} job - notification_outbox row
   * @returns {Promise<Array<Object>>} Array of device token rows
   */
  async fetchAllTargetTokens(job) {
    const allTokens = [];
    const targetCustomerClient = this.customerSupabase || this.supabase;

    if (job.target_audience === 'customer_single') {
      let query = targetCustomerClient
        .from('user_device_tokens')
        .select('id, user_id, fcm_token, device_platform, app_type')
        .eq('app_type', 'customer')
        .eq('is_active', true);

      if (job.recipient_user_id) {
        query = query.eq('user_id', job.recipient_user_id);
      } else if (job.recipient_email) {
        query = query.eq('user_email', job.recipient_email.toLowerCase().trim());
      } else {
        return [];
      }

      const { data, error } = await query;
      if (error) throw new Error(`Failed to fetch customer tokens: ${error.message}`);
      return data || [];
    }

    if (job.target_audience === 'developer_all') {
      const { data, error } = await this.supabase
        .from('user_device_tokens')
        .select('id, user_id, fcm_token, device_platform, app_type')
        .eq('app_type', 'developer')
        .eq('is_active', true);

      if (error) throw new Error(`Failed to fetch developer tokens: ${error.message}`);
      return data || [];
    }

    if (job.target_audience === 'customer_all') {
      let eligibleUserIds = null;
      if (targetCustomerClient.auth && targetCustomerClient.auth.admin && typeof targetCustomerClient.auth.admin.listUsers === 'function') {
        const eligibleCustomers = await listEligibleCustomerUsers(targetCustomerClient);
        eligibleUserIds = new Set(eligibleCustomers.map(c => c.id));
      }

      // Keyset pagination over (id ASC) WHERE is_active = true AND app_type = 'customer'
      let lastSeenId = '00000000-0000-0000-0000-000000000000';
      while (true) {
        const { data, error } = await targetCustomerClient
          .from('user_device_tokens')
          .select('id, user_id, fcm_token, device_platform, app_type')
          .eq('app_type', 'customer')
          .eq('is_active', true)
          .gt('id', lastSeenId)
          .order('id', { ascending: true })
          .limit(this.tokenPageSize);

        if (error) throw new Error(`Keyset token query failed: ${error.message}`);
        if (!data || data.length === 0) break;

        for (const token of data) {
          if (!eligibleUserIds || eligibleUserIds.has(token.user_id)) {
            allTokens.push(token);
          }
        }

        lastSeenId = data[data.length - 1].id;
        if (data.length < this.tokenPageSize) break;
      }
      return allTokens;
    }

    return [];
  }

  /**
   * Filters out tokens that have already reached a terminal outcome (fcm_accepted or invalid_token).
   * Ensures partial retries dispatch ONLY to unresolved tokens.
   * 
   * @param {Array<Object>} tokens
   * @param {Set<string>} terminalTokenIds
   * @returns {Array<Object>}
   */
  filterUnresolvedTokens(tokens, terminalTokenIds) {
    return tokens.filter(t => !terminalTokenIds.has(t.id));
  }

  /**
   * Dispatches push payloads to individual device tokens.
   * Handles per-device outcomes independently:
   * - Success: records status = 'fcm_accepted', stores fcm_message_id (propagating persistence failure)
   * - Confirmed invalid token: deactivates token in DB (checking errors), records status = 'invalid_token'
   * - Fatal configuration error: records error without deactivating tokens, flags fatal job failure
   * - Transient failure: records status = 'fcm_failed', leaves token active for retry
   * 
   * Sound & Channel:
   * - Channel IDs: 'taskly-support-tickets-v1' or 'taskly-developer-tickets-v1'.
   * - No explicit sound override in payload: preserves native channel sound configuration ('taskly_meow').
   * 
   * @param {string} notificationId - notification UUID for push payload
   * @param {Object} job - outbox job row
   * @param {Array<Object>} tokensToDispatch - array of device tokens to send
   * @param {string} [logNotificationId] - notification UUID for Developer DB delivery logs (defaults to notificationId)
   * @returns {Promise<{
   *   accepted: Array<string>,
   *   invalid: Array<string>,
   *   transientFailed: Array<string>,
   *   fatalErrors: Array<{ tokenId: string, error: string }>
   * }>}
   */
  async dispatchToTokens(notificationId, job, tokensToDispatch, logNotificationId = null) {
    const deliveryLogNotifId = logNotificationId || notificationId;
    const results = {
      accepted: [],
      invalid: [],
      transientFailed: [],
      fatalErrors: []
    };

    if (!tokensToDispatch || tokensToDispatch.length === 0) {
      return results;
    }

    // Determine Android notification channel
    // Customer tickets: 'taskly-support-tickets-v1'
    // Developer alerts: 'taskly-developer-tickets-v1'
    const channelId = job.target_audience === 'developer_all' 
      ? 'taskly-developer-tickets-v1' 
      : 'taskly-support-tickets-v1';

    for (const tokenRow of tokensToDispatch) {
      // NOTE: Explicit sound and defaultSound overrides are deliberately removed.
      // Sound playback is fully managed by the native Android NotificationChannel configuration.
      const payload = {
        token: tokenRow.fcm_token,
        notification: {
          title: job.title,
          body: job.body
        },
        data: {
          notification_id: String(notificationId),
          outbox_id: String(job.id),
          event_type: String(job.event_type),
          channel_id: channelId,
          ...(job.data || {})
        },
        android: {
          priority: job.priority === 'high' ? 'high' : 'normal',
          notification: {
            channelId: channelId,
            tag: `taskly_${notificationId}`, // Deduplicates notification tray alert on retry
            notificationCount: 1
          }
        }
      };

      try {
        let fcmResponse;
        if (!this.messaging || typeof this.messaging.send !== 'function') {
          if (this.allowMockDelivery) {
            fcmResponse = `mock_msg_${crypto.randomBytes(6).toString('hex')}`;
          } else {
            const missingConfigErr = new Error('FCM messaging provider is not configured. Missing Firebase credentials in production environment.');
            missingConfigErr.code = 'messaging/missing-credentials';
            throw missingConfigErr;
          }
        } else {
          fcmResponse = await this.messaging.send(payload);
        }

        // 1. Success Outcome: Must durably record outcome BEFORE counting as accepted!
        // Propagates persistence failure if logging fails.
        await this._logDeliveryOutcome({
          notificationId: deliveryLogNotifId,
          deviceTokenId: tokenRow.id,
          status: 'fcm_accepted',
          fcmMessageId: typeof fcmResponse === 'string' ? fcmResponse : (fcmResponse && fcmResponse.name) || 'accepted',
          fcmAcceptedAt: new Date().toISOString()
        });

        results.accepted.push(tokenRow.id);

      } catch (err) {
        // If this error is a persistence failure from _logDeliveryOutcome, propagate it immediately!
        if (err.message && err.message.startsWith('Failed to persist delivery log')) {
          throw err;
        }

        const classified = classifyFcmError(err);

        if (classified.isPermanentInvalidToken) {
          // 2. Confirmed Invalid Token: Deactivate token in DB with strict error checking
          const targetDeactClient = (tokenRow.app_type === 'customer' && this.customerSupabase) ? this.customerSupabase : this.supabase;
          const { error: deactErr } = await targetDeactClient
            .from('user_device_tokens')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq('id', tokenRow.id);

          if (deactErr) {
            this.logger.error('Failed to deactivate invalid token in user_device_tokens', { tokenId: tokenRow.id, error: deactErr.message });
            throw new Error(`Failed to deactivate invalid token ${tokenRow.id}: ${deactErr.message}`);
          }

          // Durably log outcome (propagates on error)
          await this._logDeliveryOutcome({
            notificationId: deliveryLogNotifId,
            deviceTokenId: tokenRow.id,
            status: 'invalid_token',
            errorMessage: classified.message
          });

          results.invalid.push(tokenRow.id);
          this.logger.warn(`Deactivated invalid FCM device token`, { tokenId: tokenRow.id, error: classified.message });

        } else if (classified.isFatal) {
          // 3. Fatal Configuration or Payload Error (Never deactivate user tokens!)
          results.fatalErrors.push({ tokenId: tokenRow.id, error: classified.message });

          // Attempt to log delivery failure
          await this._logDeliveryOutcome({
            notificationId: deliveryLogNotifId,
            deviceTokenId: tokenRow.id,
            status: 'fcm_failed',
            errorMessage: classified.message
          });

          this.logger.error(`Fatal FCM dispatch error (tokens preserved)`, { tokenId: tokenRow.id, error: classified.message });

        } else {
          // 4. Transient Failure: Keep token active, log failure for retry
          results.transientFailed.push(tokenRow.id);

          await this._logDeliveryOutcome({
            notificationId: deliveryLogNotifId,
            deviceTokenId: tokenRow.id,
            status: 'fcm_failed',
            errorMessage: classified.message
          });

          this.logger.warn(`Transient FCM dispatch failure for token`, { tokenId: tokenRow.id, error: classified.message });
        }
      }
    }

    return results;
  }

  /**
   * Helper to write or upsert delivery log record into public.notification_delivery_logs.
   * Strictly propagates database errors: never swallows persistence failures.
   */
  async _logDeliveryOutcome({ notificationId, deviceTokenId, status, fcmMessageId, errorMessage, fcmAcceptedAt }) {
    const { error } = await this.supabase
      .from('notification_delivery_logs')
      .upsert({
        notification_id: notificationId,
        device_token_id: deviceTokenId,
        status,
        fcm_message_id: fcmMessageId || null,
        error_message: errorMessage || null,
        fcm_accepted_at: fcmAcceptedAt || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'notification_id,device_token_id' });

    if (error) {
      this.logger.error(`Failed to persist notification delivery log`, { notificationId, deviceTokenId, status, error: error.message });
      throw new Error(`Failed to persist delivery log for token ${deviceTokenId}: ${error.message}`);
    }
  }

  /**
   * Processes a single claimed outbox job end-to-end:
   * 1. Ensures master notification exists
   * 2. Expands inbox atomically
   * 3. Keyset-fetches target tokens
   * 4. Queries prior logs with pagination and filters already-terminal tokens
   * 5. Dispatches remaining tokens to FCM
   * 6. Deactivates confirmed invalid tokens with error verification
   * 7. Marks job completed ONLY when every eligible device has a terminal outcome
   * 
   * @param {Object} job - notification_outbox row
   * @returns {Promise<{ success: boolean, completed: boolean, retryScheduled: boolean, isDeadLetter?: boolean }>}
   */
  async processJob(job) {
    this.logger.info(`Processing outbox notification job`, { jobId: job.id, eventType: job.event_type, audience: job.target_audience });

    try {
      // 1. Dual Supabase Master Notification Persistence
      // - Developer DB (this.supabase) master record satisfies foreign key for notification_delivery_logs
      // - Customer DB (this.customerSupabase) master record satisfies foreign key for user_notification_inbox
      const isCustomerAudience = job.target_audience === 'customer_single' || job.target_audience === 'customer_all';
      const devNotificationId = await this.ensureMasterNotification(job);
      let customerNotificationId = devNotificationId;

      if (isCustomerAudience && this.customerSupabase && this.customerSupabase !== this.supabase) {
        customerNotificationId = await this.ensureMasterNotificationInClient(job, this.customerSupabase);
      }

      // 2. Expand inbox atomically across dual databases
      await this.expandInbox(job, { devNotificationId, customerNotificationId });

      // 3. Keyset fetch all target device tokens from appropriate database
      const allTargetTokens = await this.fetchAllTargetTokens(job);

      // 4. Query prior delivery logs with pagination using devNotificationId
      const priorLogs = await this.getPriorDeliveryLogs(devNotificationId);

      // 5. Exclude already-terminal tokens (accepted or invalid)
      const tokensToDispatch = this.filterUnresolvedTokens(allTargetTokens, priorLogs.terminalTokenIds);

      // 6. Dispatch to unresolved tokens with dual notification ID routing
      const targetNotifIdForPayload = isCustomerAudience ? customerNotificationId : devNotificationId;
      const dispatchSummary = await this.dispatchToTokens(targetNotifIdForPayload, job, tokensToDispatch, devNotificationId);

      // 7. Check for fatal configuration / payload errors
      if (dispatchSummary.fatalErrors.length > 0) {
        const fatalMsg = `Fatal FCM dispatch error on ${dispatchSummary.fatalErrors.length} devices: ${dispatchSummary.fatalErrors[0].error}`;
        this.logger.error(`Dead-lettering outbox job due to fatal configuration/payload error`, { jobId: job.id, fatalMsg });

        await this.supabase.rpc('mark_outbox_job_failed', {
          p_job_id: job.id,
          p_worker_id: this.workerId,
          p_error_message: fatalMsg,
          p_is_permanent: true // Dead-letter immediately
        });

        return { success: false, completed: false, retryScheduled: false, isDeadLetter: true };
      }

      // 8. Evaluate whether all target tokens have reached terminal outcomes
      const totalTerminal = priorLogs.terminalTokenIds.size + dispatchSummary.accepted.length + dispatchSummary.invalid.length;
      const totalEligible = allTargetTokens.length;

      const hasTransientFailures = dispatchSummary.transientFailed.length > 0;
      const isAllTerminal = totalEligible === 0 || totalTerminal >= totalEligible;

      if (!hasTransientFailures && isAllTerminal) {
        // Complete outbox job lease safely
        const { data: completed, error: compErr } = await this.supabase.rpc('mark_outbox_job_completed', {
          p_job_id: job.id,
          p_worker_id: this.workerId
        });

        if (compErr || !completed) {
          this.logger.warn(`Could not mark outbox job completed (lease may have expired)`, { jobId: job.id, compErr });
          return { success: false, completed: false, retryScheduled: true };
        }

        this.logger.info(`Outbox notification job completed successfully`, { jobId: job.id, devNotificationId, customerNotificationId, totalTerminal });
        return { success: true, completed: true, retryScheduled: false };
      } else {
        // Transient failures remain unresolved -> reschedule outbox job with exponential backoff
        const errorMsg = `Transient FCM dispatch failures on ${dispatchSummary.transientFailed.length} device tokens. Rescheduled for retry.`;
        
        await this.supabase.rpc('mark_outbox_job_failed', {
          p_job_id: job.id,
          p_worker_id: this.workerId,
          p_error_message: errorMsg,
          p_is_permanent: false
        });

        this.logger.warn(`Outbox notification job rescheduled due to transient failure`, { jobId: job.id, failedCount: dispatchSummary.transientFailed.length });
        return { success: true, completed: false, retryScheduled: true };
      }

    } catch (err) {
      this.logger.error(`Unhandled error processing notification job`, { jobId: job.id, error: err.message, stack: err.stack });

      // Mark job failed with backoff (e.g. on persistence or unhandled exception)
      try {
        await this.supabase.rpc('mark_outbox_job_failed', {
          p_job_id: job.id,
          p_worker_id: this.workerId,
          p_error_message: `Unhandled worker error: ${err.message}`,
          p_is_permanent: false
        });
      } catch (markErr) {
        this.logger.error(`Failed to mark outbox job failed after crash`, { jobId: job.id, markError: markErr.message });
      }

      return { success: false, completed: false, retryScheduled: true };
    }
  }

  /**
   * Processes a complete claimed batch of outbox jobs.
   * 
   * @returns {Promise<{ claimed: number, completed: number, retried: number, errors: number }>}
   */
  async processBatch() {
    const jobs = await this.claimBatch();
    const stats = { claimed: jobs.length, completed: 0, retried: 0, errors: 0 };

    for (const job of jobs) {
      try {
        const res = await this.processJob(job);
        if (res.completed) {
          stats.completed++;
        } else if (res.retryScheduled) {
          stats.retried++;
        }
      } catch (err) {
        stats.errors++;
      }
    }

    return stats;
  }
}

module.exports = {
  NotificationService,
  classifyFcmError,
  CONFIRMED_INVALID_TOKEN_CODES,
  FATAL_CONFIG_ERROR_CODES,
  TRANSIENT_FCM_ERROR_CODES
};
