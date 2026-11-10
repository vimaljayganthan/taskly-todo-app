/**
 * Taskly Customer Support — Outbox Store Adapter
 * Version: 2.2.0 (Build 14)
 * 
 * Provides database abstraction for the Transactional Email Outbox.
 * Supports:
 * - SupabaseOutboxStore: Calls PostgreSQL Migration 007 atomic stored procedures
 * - FileOutboxStore: Local JSON file-based implementation matching identical transactional semantics
 */

const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { isExceedingSafetyCutoff } = require('./retryStrategy');

const DATA_DIR = path.join(__dirname, '..', 'data');
function getDataFile() {
  return process.env.SUPPORT_TICKETS_DATA_FILE || path.join(DATA_DIR, 'support_tickets.json');
}

// ==============================================================================
// 1. File-Based Outbox Store (Local Development & Offline Testing)
// ==============================================================================
class FileOutboxStore {
  constructor(filePath) {
    const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
    const isProduction = process.env.NODE_ENV === 'production' || isVercel;
    if (isProduction) {
      throw new Error('FileOutboxStore cannot be used in production or Vercel deployments.');
    }
    this.filePath = filePath || getDataFile();
    this._lock = Promise.resolve();
    this.init();
  }

  async _withLock(fn) {
    const nextLock = this._lock.then(async () => {
      return await fn();
    });
    this._lock = nextLock.catch(() => {});
    return nextLock;
  }

  init() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (!fs.existsSync(this.filePath)) {
        const initial = { tickets: [], messages: [], idempotency: [], events: [], outbox: [] };
        fs.writeFileSync(this.filePath, JSON.stringify(initial, null, 2), 'utf8');
      }
    } catch (err) {
      console.warn(`[FileOutboxStore] Warning: Could not initialize data file (${err.message}).`);
    }
  }

  async _readData() {
    try {
      const raw = await fsPromises.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        tickets: Array.isArray(parsed.tickets) ? parsed.tickets : [],
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        idempotency: Array.isArray(parsed.idempotency) ? parsed.idempotency : [],
        events: Array.isArray(parsed.events) ? parsed.events : [],
        outbox: Array.isArray(parsed.outbox) ? parsed.outbox : []
      };
    } catch (err) {
      if (err.code === 'ENOENT') {
        return { tickets: [], messages: [], idempotency: [], events: [], outbox: [] };
      }
      return { tickets: [], messages: [], idempotency: [], events: [], outbox: [] };
    }
  }

  async _writeData(data) {
    const tempPath = `${this.filePath}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fsPromises.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
    await fsPromises.rename(tempPath, this.filePath);
  }

  async enqueue({
    ticketId,
    recipientEmail,
    recipientType = 'developer',
    replyToAddress,
    subject,
    bodyHtml,
    bodyText,
    deduplicationKey,
    maxRetries = 5
  }) {
    return this._withLock(async () => {
      const data = await this._readData();
      const existing = data.outbox.find(o => o.deduplication_key === deduplicationKey);
      if (existing) {
        return { ...existing, is_replay: true };
      }

      const now = new Date().toISOString();
      const record = {
        id: crypto.randomUUID(),
        ticket_id: ticketId,
        recipient_email: recipientEmail,
        recipient_type: recipientType,
        reply_to_address: replyToAddress,
        subject,
        body_html: bodyHtml,
        body_text: bodyText,
        deduplication_key: deduplicationKey,
        status: 'pending',
        retry_count: 0,
        max_retries: maxRetries,
        next_attempt_at: now,
        first_attempt_started_at: null,
        last_attempt_started_at: null,
        locked_by: null,
        locked_until: null,
        last_error: null,
        outbox_provider_message_id: null,
        created_at: now,
        updated_at: now
      };

      data.outbox.push(record);
      await this._writeData(data);
      return { ...record, is_replay: false };
    });
  }

  async claimBatch(workerId, batchSize = 10, leaseSeconds = 60) {
    if (!workerId || workerId.trim().length < 3) {
      throw new Error('Invalid worker_id');
    }

    return this._withLock(async () => {
      const data = await this._readData();
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const leaseUntilIso = new Date(nowMs + leaseSeconds * 1000).toISOString();
      let timedOutCount = 0;

      // 1. Timeout jobs exceeding 23h 45m safety cutoff
      for (const job of data.outbox) {
        if (['ambiguous_processing', 'sending', 'processing'].includes(job.status)) {
          if (job.first_attempt_started_at && isExceedingSafetyCutoff(job.first_attempt_started_at)) {
            job.status = 'ambiguous_delivery_timeout';
            job.locked_by = null;
            job.locked_until = null;
            job.last_error = 'Automated retries halted: Job exceeded Resend 24-hour idempotency retention window (23h 45m safety cutoff).';
            job.updated_at = nowIso;
            timedOutCount += 1;
          }
        }
      }

      // 2. Filter eligible jobs
      const eligible = [];
      for (const job of data.outbox) {
        if (eligible.length >= batchSize) break;

        const nextAttemptMs = new Date(job.next_attempt_at).getTime();
        const lockedUntilMs = job.locked_until ? new Date(job.locked_until).getTime() : 0;
        const isLockExpired = lockedUntilMs < nowMs;

        // Branch 1: Pending jobs (fresh or retry elapsed within 23h 45m cutoff)
        if (job.status === 'pending' && nextAttemptMs <= nowMs && job.retry_count < job.max_retries && (!job.first_attempt_started_at || !isExceedingSafetyCutoff(job.first_attempt_started_at))) {
          eligible.push(job);
        }
        // Branch 2: Expired processing lease where worker crashed before send
        else if (job.status === 'processing' && isLockExpired && job.retry_count < job.max_retries && !job.first_attempt_started_at) {
          eligible.push(job);
        }
        // Branch 3: Ambiguous retry backoff elapsed
        else if (job.status === 'ambiguous_processing' && nextAttemptMs <= nowMs && job.retry_count < job.max_retries && (!job.locked_until || isLockExpired)) {
          if (!isExceedingSafetyCutoff(job.first_attempt_started_at)) {
            eligible.push(job);
          }
        }
        // Branch 4: Expired sending lease crash recovery
        else if (job.status === 'sending' && isLockExpired && job.retry_count < job.max_retries) {
          if (!isExceedingSafetyCutoff(job.first_attempt_started_at)) {
            eligible.push(job);
          }
        }
      }

      // Lock eligible jobs
      const claimed = [];
      for (const job of eligible) {
        job.target_status = job.first_attempt_started_at ? 'ambiguous_processing' : 'processing';
        job.status = job.target_status;
        job.locked_by = workerId;
        job.locked_until = leaseUntilIso;
        job.updated_at = nowIso;
        claimed.push({ ...job });
      }

      if (claimed.length > 0 || timedOutCount > 0) {
        await this._writeData(data);
      }

      return claimed;
    });
  }

  async markAttemptStart(outboxId, workerId) {
    return this._withLock(async () => {
      const data = await this._readData();
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      const job = data.outbox.find(o => o.id === outboxId && o.locked_by === workerId);
      if (!job) return false;

      const lockedUntilMs = job.locked_until ? new Date(job.locked_until).getTime() : 0;
      if (lockedUntilMs < nowMs) return false;
      if (!['processing', 'ambiguous_processing'].includes(job.status)) return false;

      // Safety cutoff verification
      if (job.first_attempt_started_at && isExceedingSafetyCutoff(job.first_attempt_started_at)) {
        job.status = 'ambiguous_delivery_timeout';
        job.locked_by = null;
        job.locked_until = null;
        job.last_error = 'Attempt aborted: Job exceeded 24-hour Resend idempotency retention window (23h 45m cutoff).';
        job.updated_at = nowIso;
        await this._writeData(data);
        return false;
      }

      job.status = 'sending';
      job.first_attempt_started_at = job.first_attempt_started_at || nowIso;
      job.last_attempt_started_at = nowIso;
      job.updated_at = nowIso;

      await this._writeData(data);
      return true;
    });
  }

  async markSuccess(outboxId, workerId, providerMessageId) {
    if (!providerMessageId || providerMessageId.trim().length < 3) {
      throw new Error('Invalid provider_message_id');
    }

    return this._withLock(async () => {
      const data = await this._readData();
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      const job = data.outbox.find(o => o.id === outboxId && o.locked_by === workerId);
      if (!job) return false;

      const lockedUntilMs = job.locked_until ? new Date(job.locked_until).getTime() : 0;
      if (lockedUntilMs < nowMs || job.status !== 'sending') return false;

      job.status = 'sent';
      job.outbox_provider_message_id = providerMessageId;
      job.locked_by = null;
      job.locked_until = null;
      job.last_error = null;
      job.updated_at = nowIso;

      // Record audit event
      data.events.push({
        id: crypto.randomUUID(),
        ticket_id: job.ticket_id,
        event_type: 'email_notification_sent',
        actor_id: null,
        actor_type: 'system',
        new_state: {
          outbox_id: outboxId,
          provider_message_id: providerMessageId,
          recipient: job.recipient_email
        },
        created_at: nowIso
      });

      await this._writeData(data);
      return true;
    });
  }

  async markFailure(outboxId, workerId, errorMessage, retryDelaySeconds = 60, isPermanent = false) {
    return this._withLock(async () => {
      const data = await this._readData();
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const delaySec = Math.max(10, Math.min(86400, retryDelaySeconds || 60));

      const job = data.outbox.find(o => o.id === outboxId && o.locked_by === workerId);
      if (!job) return false;

      const lockedUntilMs = job.locked_until ? new Date(job.locked_until).getTime() : 0;
      if (lockedUntilMs < nowMs) return false;

      job.retry_count += 1;
      job.locked_by = null;
      job.locked_until = null;
      job.last_error = errorMessage;
      job.updated_at = nowIso;

      if (isPermanent || job.retry_count >= job.max_retries) {
        job.status = 'failed';
      } else {
        job.status = 'pending';
        job.next_attempt_at = new Date(nowMs + delaySec * 1000).toISOString();
      }

      await this._writeData(data);
      return true;
    });
  }

  async markAmbiguous(outboxId, workerId, errorMessage, retryDelaySeconds = 60) {
    return this._withLock(async () => {
      const data = await this._readData();
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const delaySec = Math.max(10, Math.min(86400, retryDelaySeconds || 60));

      const job = data.outbox.find(o => o.id === outboxId && o.locked_by === workerId);
      if (!job) return false;

      const lockedUntilMs = job.locked_until ? new Date(job.locked_until).getTime() : 0;
      if (lockedUntilMs < nowMs || job.status !== 'sending') return false;

      job.retry_count += 1;
      job.locked_by = null;
      job.locked_until = null;
      job.last_error = errorMessage;
      job.updated_at = nowIso;

      if (job.first_attempt_started_at && isExceedingSafetyCutoff(job.first_attempt_started_at)) {
        job.status = 'ambiguous_delivery_timeout';
        job.last_error = 'Ambiguous outcome exceeded 24-hour Resend idempotency window (23h 45m cutoff). Automated retries halted.';
      } else if (job.retry_count >= job.max_retries) {
        job.status = 'failed';
        job.last_error = `Max retries exceeded on ambiguous send: ${errorMessage}`;
      } else {
        job.status = 'ambiguous_processing';
        job.next_attempt_at = new Date(nowMs + delaySec * 1000).toISOString();
      }

      await this._writeData(data);
      return true;
    });
  }

  async markAmbiguousTimeout(outboxId, workerId) {
    return this._withLock(async () => {
      const data = await this._readData();
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      const job = data.outbox.find(o => o.id === outboxId && o.locked_by === workerId);
      if (!job) return false;

      job.status = 'ambiguous_delivery_timeout';
      job.locked_by = null;
      job.locked_until = null;
      job.last_error = 'Worker timed out job: Resend 24-hour idempotency retention window expired (23h 45m cutoff).';
      job.updated_at = nowIso;

      await this._writeData(data);
      return true;
    });
  }

  async sweepAmbiguousTimeouts() {
    return this._withLock(async () => {
      const data = await this._readData();
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      let count = 0;

      for (const job of data.outbox) {
        if (['sending', 'ambiguous_processing', 'processing'].includes(job.status)) {
          const lockedUntilMs = job.locked_until ? new Date(job.locked_until).getTime() : 0;
          if (!job.locked_until || lockedUntilMs < nowMs) {
            if (job.first_attempt_started_at && isExceedingSafetyCutoff(job.first_attempt_started_at)) {
              job.status = 'ambiguous_delivery_timeout';
              job.locked_by = null;
              job.locked_until = null;
              job.last_error = 'Sweeper timed out job: Resend 24-hour idempotency retention window expired (23h 45m cutoff).';
              job.updated_at = nowIso;
              count += 1;
            }
          }
        }
      }

      if (count > 0) {
        await this._writeData(data);
      }
      return count;
    });
  }

  async getMetrics() {
    const data = await this._readData();
    const counts = {
      pending: 0,
      processing: 0,
      sending: 0,
      ambiguous_processing: 0,
      sent: 0,
      failed: 0,
      ambiguous_delivery_timeout: 0,
      total: data.outbox.length
    };

    for (const job of data.outbox) {
      if (counts[job.status] !== undefined) {
        counts[job.status] += 1;
      }
    }

    return counts;
  }

  async getRecord(outboxId) {
    const data = await this._readData();
    return data.outbox.find(o => o.id === outboxId) || null;
  }
}

// ==============================================================================
// 2. Supabase Outbox Store (PostgreSQL Stored Procedures via Service Role)
// ==============================================================================
class SupabaseOutboxStore {
  constructor(supabaseClient) {
    if (!supabaseClient) {
      throw new Error('Supabase client is required for SupabaseOutboxStore');
    }
    this.client = supabaseClient;
  }

  async claimBatch(workerId, batchSize = 10, leaseSeconds = 60) {
    const { data, error } = await this.client.rpc('claim_support_email_outbox_batch', {
      p_worker_id: workerId,
      p_batch_size: batchSize,
      p_lease_seconds: leaseSeconds
    });

    if (error) {
      throw new Error(`Database error claiming outbox batch: ${error.message}`);
    }

    return data || [];
  }

  async markAttemptStart(outboxId, workerId) {
    const { data, error } = await this.client.rpc('mark_outbox_attempt_start', {
      p_outbox_id: outboxId,
      p_worker_id: workerId
    });

    if (error) {
      throw new Error(`Database error marking attempt start: ${error.message}`);
    }

    return Boolean(data);
  }

  async markSuccess(outboxId, workerId, providerMessageId) {
    const { data, error } = await this.client.rpc('mark_outbox_success', {
      p_outbox_id: outboxId,
      p_worker_id: workerId,
      p_provider_message_id: providerMessageId
    });

    if (error) {
      throw new Error(`Database error marking outbox success: ${error.message}`);
    }

    return Boolean(data);
  }

  async markFailure(outboxId, workerId, errorMessage, retryDelaySeconds = 60, isPermanent = false) {
    const { data, error } = await this.client.rpc('mark_outbox_failure', {
      p_outbox_id: outboxId,
      p_worker_id: workerId,
      p_error_message: errorMessage,
      p_retry_delay_seconds: retryDelaySeconds,
      p_is_permanent: Boolean(isPermanent)
    });

    if (error) {
      throw new Error(`Database error marking outbox failure: ${error.message}`);
    }

    return Boolean(data);
  }

  async markAmbiguous(outboxId, workerId, errorMessage, retryDelaySeconds = 60) {
    const { data, error } = await this.client.rpc('mark_outbox_ambiguous', {
      p_outbox_id: outboxId,
      p_worker_id: workerId,
      p_error_message: errorMessage,
      p_retry_delay_seconds: retryDelaySeconds
    });

    if (error) {
      throw new Error(`Database error marking outbox ambiguous: ${error.message}`);
    }

    return Boolean(data);
  }

  async markAmbiguousTimeout(outboxId, workerId) {
    const { data, error } = await this.client.rpc('mark_outbox_ambiguous_timeout', {
      p_outbox_id: outboxId,
      p_worker_id: workerId
    });

    if (error) {
      throw new Error(`Database error marking ambiguous timeout: ${error.message}`);
    }

    return Boolean(data);
  }

  async sweepAmbiguousTimeouts() {
    const { data, error } = await this.client.rpc('sweep_outbox_ambiguous_timeouts');

    if (error) {
      throw new Error(`Database error sweeping ambiguous timeouts: ${error.message}`);
    }

    return typeof data === 'number' ? data : 0;
  }

  async enqueue({
    ticketId,
    recipientEmail,
    recipientType = 'developer',
    replyToAddress,
    subject,
    bodyHtml,
    bodyText,
    deduplicationKey,
    maxRetries = 5
  }) {
    const { data, error } = await this.client
      .from('support_email_outbox')
      .insert({
        ticket_id: ticketId,
        recipient_email: recipientEmail,
        recipient_type: recipientType,
        reply_to_address: replyToAddress,
        subject,
        body_html: bodyHtml,
        body_text: bodyText,
        deduplication_key: deduplicationKey,
        max_retries: maxRetries
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') { // Unique constraint violation on deduplication_key
        const { data: existing } = await this.client
          .from('support_email_outbox')
          .select()
          .eq('deduplication_key', deduplicationKey)
          .single();
        return { ...existing, is_replay: true };
      }
      throw new Error(`Database error enqueuing outbox record: ${error.message}`);
    }

    return { ...data, is_replay: false };
  }

  async getRecord(outboxId) {
    const { data, error } = await this.client
      .from('support_email_outbox')
      .select('*')
      .eq('id', outboxId)
      .maybeSingle();

    if (error) {
      throw new Error(`Database error fetching outbox record: ${error.message}`);
    }

    return data;
  }

  async getMetrics() {
    const { data, error } = await this.client
      .from('support_email_outbox')
      .select('status');

    if (error) {
      throw new Error(`Database error fetching outbox metrics: ${error.message}`);
    }

    const counts = {
      pending: 0,
      processing: 0,
      sending: 0,
      ambiguous_processing: 0,
      sent: 0,
      failed: 0,
      ambiguous_delivery_timeout: 0,
      total: (data || []).length
    };

    for (const row of data || []) {
      if (counts[row.status] !== undefined) {
        counts[row.status] += 1;
      }
    }

    return counts;
  }
}

// Global active outbox store
let activeOutboxStore = null;

function getOutboxStore() {
  const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  const isProduction = process.env.NODE_ENV === 'production' || isVercel;

  // In production or Vercel deployments:
  if (isProduction) {
    if (activeOutboxStore) {
      if (activeOutboxStore instanceof FileOutboxStore) {
        throw new Error('FileOutboxStore is strictly prohibited in production.');
      }
      return activeOutboxStore;
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl && !serviceKey) {
      throw new Error('Missing Supabase configuration in production (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required).');
    }
    if (!supabaseUrl) {
      throw new Error('Missing Supabase configuration in production (SUPABASE_URL is required).');
    }
    if (!serviceKey) {
      throw new Error('Missing Supabase configuration in production (SUPABASE_SERVICE_ROLE_KEY is required).');
    }

    const { createClient } = require('@supabase/supabase-js');
    const serviceClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false }
    });
    return new SupabaseOutboxStore(serviceClient);
  }

  // Development and test environments:
  if (activeOutboxStore) {
    return activeOutboxStore;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceKey && !serviceKey.startsWith('mock-')) {
    const { createClient } = require('@supabase/supabase-js');
    const serviceClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false }
    });
    return new SupabaseOutboxStore(serviceClient);
  }

  return new FileOutboxStore();
}

function setOutboxStore(store) {
  activeOutboxStore = store;
}

function resetOutboxStore() {
  activeOutboxStore = null;
}

module.exports = {
  FileOutboxStore,
  SupabaseOutboxStore,
  getOutboxStore,
  setOutboxStore,
  resetOutboxStore
};
