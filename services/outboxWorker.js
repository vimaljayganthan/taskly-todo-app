/**
 * Taskly Customer Support — Outbox Worker Daemon
 * Version: 2.2.0 (Build 14)
 * 
 * Background processor for transactional email outbox:
 * - Batched claiming using SKIP LOCKED / atomic leases
 * - Resend API dispatch with idempotency keys
 * - Exponential backoff with jitter on transient failures
 * - Permanent failure dead-lettering
 * - Ambiguous delivery timeout tracking (strict 23h 45m safety cutoff)
 * - Structured JSON logging & operational metrics
 */

const crypto = require('crypto');
const { getOutboxConfig, getMaskedConfig } = require('../config/outboxConfig');
const { getOutboxStore } = require('./outboxStore');
const { getEmailProvider } = require('./emailProvider');
const { calculateBackoff, classifyError, isExceedingSafetyCutoff } = require('./retryStrategy');

class OutboxWorker {
  constructor(options = {}) {
    this.config = options.config || getOutboxConfig();
    this.outboxStore = options.outboxStore || getOutboxStore();
    this.emailProvider = options.emailProvider || getEmailProvider();
    
    // Unique worker identity: worker_<pid>_<uuid>
    this.workerId = options.workerId || `worker_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
    
    // Concurrency and operational limits
    this.batchSize = options.batchSize || this.config.batchSize;
    this.leaseSeconds = options.leaseSeconds || this.config.leaseSeconds;
    this.pollIntervalMs = options.pollIntervalMs || this.config.pollIntervalMs;
    this.maxRetries = options.maxRetries || this.config.maxRetries;
    this.baseDelaySeconds = options.baseDelaySeconds || this.config.baseDelaySeconds;
    this.maxDelaySeconds = options.maxDelaySeconds || this.config.maxDelaySeconds;
    
    // Sender configuration
    this.senderEmail = options.senderEmail || this.config.senderEmail;

    // Worker state
    this.isRunning = false;
    this.isProcessing = false;
    this.pollTimer = null;
    this.sweepTimer = null;
    this.metrics = {
      batchesProcessed: 0,
      emailsSent: 0,
      transientFailures: 0,
      permanentFailures: 0,
      ambiguousDispatches: 0,
      timeoutsSwept: 0,
      lastRunAt: null,
      lastError: null
    };

    this.logger = options.logger || this._defaultLogger();
  }

  _defaultLogger() {
    return {
      info: (msg, meta = {}) => {
        if (process.env.NODE_ENV !== 'test' || process.env.VERBOSE_LOGS) {
          console.log(JSON.stringify({ level: 'INFO', timestamp: new Date().toISOString(), workerId: this.workerId, message: msg, ...meta }));
        }
      },
      warn: (msg, meta = {}) => {
        if (process.env.NODE_ENV !== 'test' || process.env.VERBOSE_LOGS) {
          console.warn(JSON.stringify({ level: 'WARN', timestamp: new Date().toISOString(), workerId: this.workerId, message: msg, ...meta }));
        }
      },
      error: (msg, meta = {}) => {
        console.error(JSON.stringify({ level: 'ERROR', timestamp: new Date().toISOString(), workerId: this.workerId, message: msg, ...meta }));
      }
    };
  }

  /**
   * Executes a single processing batch across claimed outbox jobs.
   * Ideal for deterministic unit tests, scheduled serverless crons, and daemon iterations.
   * 
   * @returns {Promise<{ processed: number, successes: number, failures: number, ambiguous: number }>}
   */
  async processBatch() {
    if (this.isProcessing) {
      return { processed: 0, successes: 0, failures: 0, ambiguous: 0, skipped: true };
    }

    this.isProcessing = true;
    this.metrics.lastRunAt = new Date().toISOString();

    const summary = {
      processed: 0,
      successes: 0,
      failures: 0,
      ambiguous: 0
    };

    try {
      // 1. Claim batch of eligible jobs
      const jobs = await this.outboxStore.claimBatch(
        this.workerId,
        this.batchSize,
        this.leaseSeconds
      );

      if (!jobs || jobs.length === 0) {
        return summary;
      }

      summary.processed = jobs.length;
      this.metrics.batchesProcessed += 1;

      // 2. Process each claimed job
      for (const job of jobs) {
        await this._processJob(job, summary);
      }

    } catch (err) {
      this.metrics.lastError = err.message;
      this.logger.error('Unexpected error during outbox batch execution', { error: err.message, stack: err.stack });
      throw err;
    } finally {
      this.isProcessing = false;
    }

    return summary;
  }

  /**
   * Processes an individual outbox job through its lifecycle
   */
  async _processJob(job, summary) {
    const startTime = Date.now();

    // 1. Mark attempt start (advances status to 'sending' and checks 23h 45m safety cutoff)
    const canProceed = await this.outboxStore.markAttemptStart(job.id, this.workerId);
    if (!canProceed) {
      this.logger.warn('Job attempt start aborted (lease lost or 23h 45m safety cutoff exceeded)', {
        jobId: job.id,
        ticketId: job.ticket_id
      });
      summary.failures += 1;
      return;
    }

    try {
      // 2. Dispatch via Email Provider with Idempotency-Key
      const sendResult = await this.emailProvider.sendEmail({
        from: this.senderEmail,
        to: job.recipient_email,
        replyTo: job.reply_to_address,
        subject: job.subject,
        html: job.body_html,
        text: job.body_text,
        idempotencyKey: job.deduplication_key
      });

      // 3. Mark success
      const successMarked = await this.outboxStore.markSuccess(
        job.id,
        this.workerId,
        sendResult.messageId
      );

      if (successMarked) {
        summary.successes += 1;
        this.metrics.emailsSent += 1;
        const latencyMs = Date.now() - startTime;
        this.logger.info('Outbox email sent successfully', {
          jobId: job.id,
          ticketId: job.ticket_id,
          providerMessageId: sendResult.messageId,
          recipient: job.recipient_email,
          latencyMs
        });
      }

    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const classification = classifyError(err);

      // Branch A: Ambiguous outcome (timeout after dispatch)
      if (classification.isAmbiguous) {
        summary.ambiguous += 1;
        this.metrics.ambiguousDispatches += 1;

        const delay = calculateBackoff({
          retryCount: job.retry_count,
          baseDelaySeconds: this.baseDelaySeconds,
          maxDelaySeconds: this.maxDelaySeconds,
          jitter: true
        });

        await this.outboxStore.markAmbiguous(
          job.id,
          this.workerId,
          classification.message,
          delay
        );

        this.logger.warn('Email dispatch resulted in ambiguous status (timeout after request); retry scheduled', {
          jobId: job.id,
          ticketId: job.ticket_id,
          retryCount: job.retry_count + 1,
          nextDelaySeconds: delay,
          error: classification.message,
          latencyMs
        });
        return;
      }

      // Branch B: Permanent rejection (HTTP 4xx client errors, invalid email, etc.)
      if (!classification.isRetryable) {
        summary.failures += 1;
        this.metrics.permanentFailures += 1;

        await this.outboxStore.markFailure(
          job.id,
          this.workerId,
          `Permanent rejection: ${classification.message}`,
          0,
          true // isPermanent = true -> immediate dead-letter
        );

        this.logger.error('Outbox email permanently rejected; moved to dead-letter (failed)', {
          jobId: job.id,
          ticketId: job.ticket_id,
          statusCode: classification.statusCode,
          error: classification.message,
          latencyMs
        });
        return;
      }

      // Branch C: Transient failure (HTTP 429, HTTP 5xx, transport disconnect)
      summary.failures += 1;
      this.metrics.transientFailures += 1;

      const delay = classification.retryAfterSeconds || calculateBackoff({
        retryCount: job.retry_count,
        baseDelaySeconds: this.baseDelaySeconds,
        maxDelaySeconds: this.maxDelaySeconds,
        jitter: true
      });

      await this.outboxStore.markFailure(
        job.id,
        this.workerId,
        classification.message,
        delay
      );

      this.logger.warn('Transient failure sending outbox email; retry scheduled', {
        jobId: job.id,
        ticketId: job.ticket_id,
        retryCount: job.retry_count + 1,
        maxRetries: job.max_retries,
        nextDelaySeconds: delay,
        error: classification.message,
        latencyMs
      });
    }
  }

  /**
   * Sweeps unleased jobs that exceeded the 23h 45m safety cutoff
   */
  async sweepTimeouts() {
    try {
      const count = await this.outboxStore.sweepAmbiguousTimeouts();
      if (count > 0) {
        this.metrics.timeoutsSwept += count;
        this.logger.warn(`Swept ${count} outbox jobs exceeding 23h 45m Resend idempotency window into dead-letter (ambiguous_delivery_timeout)`);
      }
      return count;
    } catch (err) {
      this.logger.error('Error sweeping outbox ambiguous timeouts', { error: err.message });
      throw err;
    }
  }

  /**
   * Starts the worker background loop
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    this.logger.info('Starting Outbox Worker daemon', {
      config: getMaskedConfig(this.config)
    });

    const runPoll = async () => {
      if (!this.isRunning) return;
      try {
        await this.processBatch();
      } catch (err) {
        this.logger.error('Unhandled error in worker poll iteration', { error: err.message });
      } finally {
        if (this.isRunning) {
          this.pollTimer = setTimeout(runPoll, this.pollIntervalMs);
        }
      }
    };

    // Initial immediate execution followed by polling loop
    runPoll();

    // Schedule periodic ambiguous timeout sweeper (every 5 minutes)
    this.sweepTimer = setInterval(() => {
      this.sweepTimeouts().catch(err => {
        this.logger.error('Sweeper timer error', { error: err.message });
      });
    }, 5 * 60 * 1000);
  }

  /**
   * Stops the worker gracefully
   */
  async stop() {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }

    // Wait if a batch is currently executing
    let waitCount = 0;
    while (this.isProcessing && waitCount < 50) {
      await new Promise(r => setTimeout(r, 100));
      waitCount += 1;
    }

    this.logger.info('Outbox Worker daemon stopped');
  }

  /**
   * Returns current operational metrics
   */
  async getMetrics() {
    const storeMetrics = await this.outboxStore.getMetrics();
    return {
      workerId: this.workerId,
      isRunning: this.isRunning,
      isProcessing: this.isProcessing,
      workerStats: { ...this.metrics },
      storeQueueStats: storeMetrics
    };
  }
}

module.exports = {
  OutboxWorker
};
