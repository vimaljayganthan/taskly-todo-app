/**
 * Taskly Customer Support — Inbound Webhook Service & Reply Ingestion
 * Version: 2.2.0 (Build 14)
 * 
 * Secure Inbound Processing Architecture:
 * 1. Cryptographic Svix signature verification using raw request body
 * 2. Webhook event claiming & idempotency enforcement
 * 3. Inbound sender authorization check (only authorized developer email)
 * 4. SPF/DKIM verification check
 * 5. Cryptographic routing token extraction & validation
 * 6. Email quotation stripping & directive parsing (#status: <status>)
 * 7. Atomic database ingestion / quarantine isolation
 */

const { verifySvixHeaders } = require('./svixVerifier');
const { parseDeveloperReply, extractRoutingToken, extractSenderEmail } = require('./emailReplyParser');
const { getServiceStorage, canonicalHash } = require('../storage/supportStore');

/**
 * Validates SPF and DKIM headers if present.
 * Resend provides authentication headers in email.received events.
 * 
 * @param {Object} headers
 * @returns {boolean} true if checks passed or indeterminate, false if explicitly failed
 */
function checkAuthHeaders(headers = {}) {
  if (!headers || typeof headers !== 'object') return true;

  // Direct SPF/DKIM properties
  const spf = typeof headers.spf === 'string' ? headers.spf.toLowerCase() : '';
  const dkim = typeof headers.dkim === 'string' ? headers.dkim.toLowerCase() : '';

  if (spf === 'fail' || spf === 'softfail' || dkim === 'fail') {
    return false;
  }

  // Authentication-Results header
  const authResults = (
    headers['authentication-results'] ||
    headers['Authentication-Results'] ||
    ''
  ).toLowerCase();

  if (authResults.includes('spf=fail') || authResults.includes('dkim=fail')) {
    return false;
  }

  return true;
}

/**
 * Express Route Handler: POST /api/support/resend-inbound
 */
async function handleInboundWebhook(req, res, next) {
  try {
    // 1. Verify Svix cryptographic signature using raw body
    const rawBody = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
    const svixResult = verifySvixHeaders({
      rawBody,
      headers: req.headers,
      secret: process.env.RESEND_WEBHOOK_SECRET,
      toleranceSeconds: 300
    });

    if (!svixResult.valid) {
      console.warn(`[InboundWebhookService] Rejected unverified webhook: ${svixResult.error}`);
      return res.status(401).json({ error: `Unauthorized webhook: ${svixResult.error}` });
    }

    // 2. Validate payload format
    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }

    const eventType = payload.type || 'email.received';
    // If event is not an email reception (e.g. bounce/delivered), acknowledge and skip
    if (eventType !== 'email.received') {
      return res.status(200).json({ status: 'ignored', type: eventType });
    }

    const providerEventId = svixResult.msgId || (payload.data && payload.data.email_id) || `evt_${Date.now()}`;
    const storage = getServiceStorage();

    // 3. Webhook Idempotency Claim
    const emailData = payload.data || {};
    const claimResult = await storage.claimInboundWebhookEvent({
      providerEventId,
      eventType,
      payloadPreview: {
        type: eventType,
        from: emailData.from,
        to: emailData.to,
        subject: emailData.subject
      },
      workerId: 'inbound-webhook-service',
      leaseSeconds: 60
    });

    if (claimResult.claim_action === 'already_processed') {
      return res.status(200).json({ status: 'already_processed', event_id: providerEventId });
    }
    if (claimResult.claim_action === 'quarantined') {
      return res.status(200).json({ status: 'quarantined', event_id: providerEventId });
    }
    if (claimResult.claim_action === 'in_flight') {
      return res.status(429).json({ error: 'Webhook event is currently being processed by another worker' });
    }

    // 4. Extract Inbound Email Fields
    const fromHeader = emailData.from || '';
    const senderEmail = extractSenderEmail(fromHeader);
    const toHeader = emailData.to || [];
    const routingToken = extractRoutingToken(toHeader);
    const subject = emailData.subject || '';
    const rawText = emailData.text || '';
    const rawHeaders = emailData.headers || {};
    const providerMessageId = emailData.email_id || providerEventId;
    const payloadHash = canonicalHash(payload);

    // 5. SPF / DKIM Authentication Check
    if (!checkAuthHeaders(rawHeaders)) {
      console.warn(`[InboundWebhookService] Quarantine: SPF/DKIM check failed for email from ${senderEmail}`);
      await storage.quarantineInboundMessage({
        providerMessageId,
        routingToken: routingToken || 'none',
        senderEmail,
        subject,
        rawHeaders,
        rawBody: rawText,
        payloadHash,
        quarantineReason: 'SPF_OR_DKIM_FAILED',
        webhookEventId: providerEventId,
        workerId: 'inbound-webhook-service'
      });
      return res.status(200).json({ status: 'quarantined', reason: 'SPF_OR_DKIM_FAILED' });
    }

    // 6. Sender Authorization Check (Prevent unauthenticated spoofed developer replies)
    const authorizedDevEmail = (process.env.SUPPORT_DEVELOPER_EMAIL || 'tasklypets@gmail.com').toLowerCase().trim();
    if (senderEmail !== authorizedDevEmail) {
      console.warn(`[InboundWebhookService] Quarantine: Unauthorized sender ${senderEmail} (expected ${authorizedDevEmail})`);
      await storage.quarantineInboundMessage({
        providerMessageId,
        routingToken: routingToken || 'none',
        senderEmail,
        subject,
        rawHeaders,
        rawBody: rawText,
        payloadHash,
        quarantineReason: `UNAUTHORIZED_SENDER: ${senderEmail}`,
        webhookEventId: providerEventId,
        workerId: 'inbound-webhook-service'
      });
      return res.status(200).json({ status: 'quarantined', reason: 'UNAUTHORIZED_SENDER' });
    }

    // 7. Cryptographic Routing Token Validation
    if (!routingToken) {
      console.warn(`[InboundWebhookService] Quarantine: Missing or invalid routing token in recipient ${JSON.stringify(toHeader)}`);
      await storage.quarantineInboundMessage({
        providerMessageId,
        routingToken: 'none',
        senderEmail,
        subject,
        rawHeaders,
        rawBody: rawText,
        payloadHash,
        quarantineReason: 'MISSING_OR_INVALID_ROUTING_TOKEN',
        webhookEventId: providerEventId,
        workerId: 'inbound-webhook-service'
      });
      return res.status(200).json({ status: 'quarantined', reason: 'MISSING_OR_INVALID_ROUTING_TOKEN' });
    }

    // 8. Clean message body & extract developer directives
    const { cleanMessage, newStatus } = parseDeveloperReply(rawText);
    if (!cleanMessage || !cleanMessage.trim()) {
      console.warn(`[InboundWebhookService] Quarantine: Inbound developer message body is empty`);
      await storage.quarantineInboundMessage({
        providerMessageId,
        routingToken,
        senderEmail,
        subject,
        rawHeaders,
        rawBody: rawText,
        payloadHash,
        quarantineReason: 'EMPTY_MESSAGE_BODY',
        webhookEventId: providerEventId,
        workerId: 'inbound-webhook-service'
      });
      return res.status(200).json({ status: 'quarantined', reason: 'EMPTY_MESSAGE_BODY' });
    }

    // 9. Atomic Database Ingestion
    const ingestResult = await storage.ingestDeveloperReply({
      routingToken,
      providerMessageId,
      senderEmail,
      cleanMessage,
      newStatus,
      webhookEventId: providerEventId,
      developerUserId: null
    });

    if (!ingestResult || !ingestResult.success) {
      if (ingestResult && ingestResult.error_code === 'TICKET_NOT_FOUND') {
        console.warn(`[InboundWebhookService] Quarantine: No matching ticket found for routing token ${routingToken}`);
        await storage.quarantineInboundMessage({
          providerMessageId,
          routingToken,
          senderEmail,
          subject,
          rawHeaders,
          rawBody: rawText,
          payloadHash,
          quarantineReason: 'TICKET_NOT_FOUND_FOR_ROUTING_TOKEN',
          webhookEventId: providerEventId,
          workerId: 'inbound-webhook-service'
        });
        return res.status(200).json({ status: 'quarantined', reason: 'TICKET_NOT_FOUND' });
      }
      throw new Error(ingestResult ? ingestResult.error_message : 'Failed to ingest developer reply');
    }

    return res.status(200).json({
      status: 'ingested',
      ticket_id: ingestResult.ticket_id,
      ticket_code: ingestResult.ticket_code,
      message_id: ingestResult.message_id,
      new_status: ingestResult.new_status
    });
  } catch (err) {
    console.error('[InboundWebhookService] Inbound webhook error:', err);
    next(err);
  }
}

module.exports = {
  handleInboundWebhook,
  checkAuthHeaders
};

