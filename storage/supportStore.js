const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
function getDataFile() {
  return process.env.SUPPORT_TICKETS_DATA_FILE || path.join(DATA_DIR, 'support_tickets.json');
}

/**
 * Valid ticket categories, priorities, and statuses aligned with Migration 007
 */
const VALID_CATEGORIES = ['general', 'bug', 'feedback', 'account', 'billing'];
const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const VALID_STATUSES = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'];

/**
 * Normalizes status strings (accepts 'waiting_on_customer' and maps to 'waiting_customer')
 */
function normalizeStatus(status) {
  if (!status || typeof status !== 'string') return null;
  const clean = status.trim().toLowerCase();
  if (clean === 'waiting_on_customer') return 'waiting_customer';
  return clean;
}

/**
 * RFC 8785 / Canonical JSON hashing helper for idempotency
 */
function canonicalize(val) {
  if (val === null || typeof val !== 'object') return val;
  if (Array.isArray(val)) return val.map(canonicalize);
  const sorted = {};
  for (const key of Object.keys(val).sort()) {
    sorted[key] = canonicalize(val[key]);
  }
  return sorted;
}

function canonicalHash(obj) {
  const str = JSON.stringify(canonicalize(obj));
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Generates human-friendly ticket code matching Migration 007
 * Format: TK-XXXXXXXX (8 uppercase hex/alphanumeric characters)
 */
function generateTicketCode() {
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `TK-${rand}`;
}

/**
 * Formats message object with canonical schema columns and backward-compatible aliases
 */
function formatMessageOutput(m) {
  if (!m) return m;
  const senderType = m.sender_type || (m.author_type === 'customer' ? 'user' : (m.author_type === 'agent' ? 'developer' : m.author_type)) || 'user';
  const senderUserId = m.sender_user_id || m.author_id || null;
  const senderEmail = m.sender_email || m.author_email || '';
  return {
    id: m.id,
    ticket_id: m.ticket_id,
    sender_type: senderType,
    sender_user_id: senderUserId,
    sender_email: senderEmail,
    body: m.body,
    channel: m.channel || 'in_app',
    metadata: m.metadata || {},
    created_at: m.created_at,
    // Aliases for backward compatibility
    author_type: senderType === 'user' ? 'customer' : (senderType === 'developer' ? 'agent' : senderType),
    author_id: senderUserId,
    author_email: senderEmail
  };
}

// ==============================================================================
// 1. File-Based Support Storage Adapter (Local Development & Offline Tests)
// ==============================================================================
class FileSupportStorageAdapter {
  constructor(filePath) {
    this.filePath = filePath || getDataFile();
    this.dataDir = path.dirname(this.filePath);
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      if (!fs.existsSync(this.filePath)) {
        const initial = {
          tickets: [],
          messages: [],
          idempotency: [],
          events: []
        };
        fs.writeFileSync(this.filePath, JSON.stringify(initial, null, 2), 'utf8');
      }
    } catch (err) {
      console.warn(`[FileSupportStorageAdapter] Warning: Could not initialize local data directory (${err.message}).`);
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
        outbox: Array.isArray(parsed.outbox) ? parsed.outbox : [],
        routing: Array.isArray(parsed.routing) ? parsed.routing : [],
        webhookEvents: Array.isArray(parsed.webhookEvents) ? parsed.webhookEvents : [],
        quarantined: Array.isArray(parsed.quarantined) ? parsed.quarantined : [],
        securityIncidents: Array.isArray(parsed.securityIncidents) ? parsed.securityIncidents : []
      };
    } catch (err) {
      if (err.code === 'ENOENT') {
        return {
          tickets: [],
          messages: [],
          idempotency: [],
          events: [],
          outbox: [],
          routing: [],
          webhookEvents: [],
          quarantined: [],
          securityIncidents: []
        };
      }
      console.error('[FileSupportStorageAdapter] Read error:', err.message);
      return {
        tickets: [],
        messages: [],
        idempotency: [],
        events: [],
        outbox: [],
        routing: [],
        webhookEvents: [],
        quarantined: [],
        securityIncidents: []
      };
    }
  }

  async _writeData(data) {
    try {
      await fsPromises.mkdir(path.dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      await fsPromises.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
      await fsPromises.rename(tempPath, this.filePath);
    } catch (err) {
      console.error('[FileSupportStorageAdapter] Write error:', err.message);
      throw err;
    }
  }

  async createTicket({
    userId,
    userEmail,
    subject,
    description,
    priority = 'normal',
    category = 'general',
    idempotencyKey = null,
    metadata = {}
  }) {
    const data = await this._readData();

    // Idempotency verification using request_hash
    if (idempotencyKey) {
      const requestHash = canonicalHash({ subject, description, priority, category });
      const existingKey = data.idempotency.find(
        entry => entry.type === 'ticket' && entry.userId === userId && entry.key === idempotencyKey
      );

      if (existingKey) {
        if (existingKey.request_hash === requestHash) {
          const existingTicket = data.tickets.find(t => t.id === existingKey.resourceId);
          if (existingTicket) {
            return { ...existingTicket, is_replay: true };
          }
        }
        const conflictErr = new Error('Idempotency conflict: key already used with different payload');
        conflictErr.statusCode = 409;
        throw conflictErr;
      }
    }

    const now = new Date().toISOString();
    const ticketId = crypto.randomUUID();
    const ticketCode = generateTicketCode();

    const cleanPriority = VALID_PRIORITIES.includes(priority) ? priority : 'normal';
    const cleanCategory = VALID_CATEGORIES.includes(category) ? category : 'general';

    const newTicket = {
      id: ticketId,
      ticket_code: ticketCode,
      user_id: userId,
      user_email: userEmail,
      subject: subject.trim(),
      status: 'open',
      priority: cleanPriority,
      category: cleanCategory,
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      created_at: now,
      updated_at: now,
      last_message_at: now
    };

    // Initial message creation
    const messageId = crypto.randomUUID();
    const initialMessage = {
      id: messageId,
      ticket_id: ticketId,
      sender_type: 'user',
      sender_user_id: userId,
      sender_email: userEmail,
      body: description.trim(),
      channel: 'in_app',
      metadata: {},
      created_at: now
    };

    // Event audit record
    const event = {
      id: crypto.randomUUID(),
      ticket_id: ticketId,
      event_type: 'ticket_created',
      actor_type: 'user',
      actor_id: userId,
      new_state: { ticket_code: ticketCode, subject: newTicket.subject, priority: cleanPriority, category: cleanCategory },
      created_at: now
    };

    data.tickets.push(newTicket);
    data.messages.push(initialMessage);
    data.events.push(event);

    // Enqueue outbox notification to developer (Transactional Outbox Pattern)
    if (!Array.isArray(data.outbox)) {
      data.outbox = [];
    }
    const routingToken = crypto.randomBytes(16).toString('hex');
    if (!Array.isArray(data.routing)) {
      data.routing = [];
    }
    data.routing.push({
      ticket_id: ticketId,
      routing_token: routingToken,
      created_at: now
    });

    const receivingDomain = process.env.RESEND_RECEIVING_DOMAIN || 'd893f1.resend.app';
    const devEmail = process.env.SUPPORT_DEVELOPER_EMAIL || 'tasklypets@gmail.com';
    const replyTo = `reply+tk_${ticketCode.toLowerCase().replace(/[^a-z0-9]/g, '')}_${routingToken}@${receivingDomain}`;
    
    data.outbox.push({
      id: crypto.randomUUID(),
      ticket_id: ticketId,
      recipient_email: devEmail,
      recipient_type: 'developer',
      reply_to_address: replyTo,
      subject: `[Ticket #${ticketCode}] ${newTicket.subject}`,
      body_html: `<h3>New Taskly Support Ticket: ${ticketCode}</h3><p>User: ${userEmail}</p><p>${description.trim()}</p>`,
      body_text: `New Taskly Support Ticket: ${ticketCode}\nUser: ${userEmail}\n\n${description.trim()}`,
      deduplication_key: `ticket-created-${ticketId}`,
      status: 'pending',
      retry_count: 0,
      max_retries: 5,
      next_attempt_at: now,
      first_attempt_started_at: null,
      last_attempt_started_at: null,
      locked_by: null,
      locked_until: null,
      last_error: null,
      outbox_provider_message_id: null,
      created_at: now,
      updated_at: now
    });

    if (idempotencyKey) {
      const requestHash = canonicalHash({ subject, description, priority, category });
      data.idempotency.push({
        id: crypto.randomUUID(),
        type: 'ticket',
        userId,
        key: idempotencyKey,
        request_hash: requestHash,
        resourceId: ticketId,
        createdAt: now
      });
    }

    await this._writeData(data);
    return newTicket;
  }

  async listTickets(userId, { status = null, limit = 50, offset = 0 } = {}) {
    const data = await this._readData();
    let tickets = data.tickets.filter(t => t.user_id === userId);

    if (status) {
      const cleanStatus = normalizeStatus(status);
      tickets = tickets.filter(t => t.status === cleanStatus);
    }

    // Sort by last_message_at DESC
    tickets.sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));

    const parsedLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
    const parsedOffset = Math.max(0, parseInt(offset, 10) || 0);

    return tickets.slice(parsedOffset, parsedOffset + parsedLimit);
  }

  async getTicket(ticketId, userId) {
    const data = await this._readData();
    const ticket = data.tickets.find(t => t.id === ticketId);
    if (!ticket || ticket.user_id !== userId) {
      return null;
    }

    const messages = data.messages
      .filter(m => m.ticket_id === ticketId)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map(formatMessageOutput);

    return { ...ticket, messages };
  }

  async addMessage({
    ticketId,
    userId,
    userEmail,
    body,
    idempotencyKey = null,
    channel = 'in_app',
    metadata = {}
  }) {
    const data = await this._readData();
    const ticket = data.tickets.find(t => t.id === ticketId);

    // Verify existence and authorization
    if (!ticket || ticket.user_id !== userId) {
      return null;
    }

    // Reject new messages if ticket is closed
    if (ticket.status === 'closed') {
      const closedErr = new Error('Cannot add message: ticket is closed');
      closedErr.statusCode = 400;
      throw closedErr;
    }

    // Idempotency check
    if (idempotencyKey) {
      const requestHash = canonicalHash({ ticketId, body: body.trim(), channel });
      const existingKey = data.idempotency.find(
        entry => entry.type === 'message' && entry.resourceId === ticketId && entry.key === idempotencyKey
      );

      if (existingKey) {
        if (existingKey.request_hash === requestHash) {
          const existingMsg = data.messages.find(m => m.id === existingKey.messageId);
          if (existingMsg) {
            return { ...formatMessageOutput(existingMsg), is_replay: true };
          }
        }
        const conflictErr = new Error('Idempotency conflict: key already used with different payload');
        conflictErr.statusCode = 409;
        throw conflictErr;
      }
    }

    const now = new Date().toISOString();
    const messageId = crypto.randomUUID();

    const newMessage = {
      id: messageId,
      ticket_id: ticketId,
      sender_type: 'user',
      sender_user_id: userId,
      sender_email: userEmail,
      body: body.trim(),
      channel: channel || 'in_app',
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      created_at: now
    };

    // Update ticket timestamps and status transition
    ticket.last_message_at = now;
    ticket.updated_at = now;
    if (ticket.status === 'waiting_customer' || ticket.status === 'resolved') {
      ticket.status = 'open';
    }

    const event = {
      id: crypto.randomUUID(),
      ticket_id: ticketId,
      event_type: 'message_added',
      actor_type: 'user',
      actor_id: userId,
      new_state: { message_id: messageId, sender_type: 'user', channel: newMessage.channel },
      created_at: now
    };

    data.messages.push(newMessage);
    data.events.push(event);

    // Enqueue outbox notification to developer if follow-up is from customer
    if (newMessage.sender_type === 'user') {
      if (!Array.isArray(data.outbox)) {
        data.outbox = [];
      }
      if (!Array.isArray(data.routing)) {
        data.routing = [];
      }
      let routingEntry = data.routing.find(r => r.ticket_id === ticketId);
      const routingToken = routingEntry ? routingEntry.routing_token : crypto.randomBytes(16).toString('hex');
      if (!routingEntry) {
        data.routing.push({ ticket_id: ticketId, routing_token: routingToken, created_at: now });
      }

      const receivingDomain = process.env.RESEND_RECEIVING_DOMAIN || 'd893f1.resend.app';
      const devEmail = process.env.SUPPORT_DEVELOPER_EMAIL || 'tasklypets@gmail.com';
      const replyTo = `reply+tk_${ticket.ticket_code.toLowerCase().replace(/[^a-z0-9]/g, '')}_${routingToken}@${receivingDomain}`;

      data.outbox.push({
        id: crypto.randomUUID(),
        ticket_id: ticketId,
        recipient_email: devEmail,
        recipient_type: 'developer',
        reply_to_address: replyTo,
        subject: `Re: [Ticket #${ticket.ticket_code}] ${ticket.subject}`,
        body_html: `<p>New reply from ${userEmail} on ticket ${ticket.ticket_code}:</p><p>${body.trim()}</p>`,
        body_text: `New reply from ${userEmail} on ticket ${ticket.ticket_code}:\n\n${body.trim()}`,
        deduplication_key: `message-created-${messageId}`,
        status: 'pending',
        retry_count: 0,
        max_retries: 5,
        next_attempt_at: now,
        first_attempt_started_at: null,
        last_attempt_started_at: null,
        locked_by: null,
        locked_until: null,
        last_error: null,
        outbox_provider_message_id: null,
        created_at: now,
        updated_at: now
      });
    }

    if (idempotencyKey) {
      const requestHash = canonicalHash({ ticketId, body: body.trim(), channel });
      data.idempotency.push({
        id: crypto.randomUUID(),
        type: 'message',
        resourceId: ticketId,
        messageId,
        userId,
        key: idempotencyKey,
        request_hash: requestHash,
        createdAt: now
      });
    }

    await this._writeData(data);
    return formatMessageOutput(newMessage);
  }

  async getMessages(ticketId, userId) {
    const data = await this._readData();
    const ticket = data.tickets.find(t => t.id === ticketId);
    if (!ticket || ticket.user_id !== userId) {
      return null;
    }

    return data.messages
      .filter(m => m.ticket_id === ticketId)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map(formatMessageOutput);
  }

  async updateTicketStatus(ticketId, status) {
    const data = await this._readData();
    const ticket = data.tickets.find(t => t.id === ticketId);
    if (!ticket) return null;
    ticket.status = normalizeStatus(status);
    ticket.updated_at = new Date().toISOString();
    await this._writeData(data);
    return ticket;
  }

  async claimInboundWebhookEvent({
    providerEventId,
    eventType,
    payloadPreview = {},
    workerId = 'webhook-worker',
    leaseSeconds = 60
  }) {
    if (!providerEventId || providerEventId.trim().length < 5) {
      throw new Error('Invalid provider_event_id');
    }
    const data = await this._readData();
    if (!Array.isArray(data.webhookEvents)) {
      data.webhookEvents = [];
    }

    const now = new Date();
    const existing = data.webhookEvents.find(e => e.provider_event_id === providerEventId);

    if (!existing) {
      const newId = crypto.randomUUID();
      const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
      data.webhookEvents.push({
        id: newId,
        provider_event_id: providerEventId,
        event_type: eventType,
        payload_preview: payloadPreview,
        status: 'received',
        locked_by: workerId,
        locked_until: leaseUntil,
        error_message: null,
        created_at: now.toISOString(),
        updated_at: now.toISOString()
      });
      await this._writeData(data);
      return { claim_action: 'claimed', event_id: newId };
    }

    if (existing.status === 'processed') {
      return { claim_action: 'already_processed', event_id: existing.id };
    }

    if (existing.status === 'quarantined') {
      return { claim_action: 'quarantined', event_id: existing.id };
    }

    if (existing.status === 'terminal_failure') {
      return { claim_action: 'terminal_failure', event_id: existing.id };
    }

    if (existing.status === 'received' && existing.locked_until && new Date(existing.locked_until) > now) {
      return { claim_action: 'in_flight', event_id: existing.id };
    }

    existing.status = 'received';
    existing.locked_by = workerId;
    existing.locked_until = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
    existing.updated_at = now.toISOString();
    await this._writeData(data);
    return { claim_action: 'claimed_for_retry', event_id: existing.id };
  }

  async ingestDeveloperReply({
    routingToken,
    providerMessageId,
    senderEmail,
    cleanMessage,
    newStatus = null,
    webhookEventId = null,
    developerUserId = null
  }) {
    if (!routingToken || routingToken.trim().length < 16) {
      throw new Error('Invalid routing token');
    }
    if (!cleanMessage || !cleanMessage.trim()) {
      throw new Error('Message body cannot be empty');
    }

    const data = await this._readData();
    if (!Array.isArray(data.routing)) {
      data.routing = [];
    }

    const routingEntry = data.routing.find(r => r.routing_token.toLowerCase() === routingToken.toLowerCase());
    if (!routingEntry) {
      return {
        success: false,
        error_code: 'TICKET_NOT_FOUND',
        error_message: 'No matching ticket found for provided routing token'
      };
    }

    const ticket = data.tickets.find(t => t.id === routingEntry.ticket_id);
    if (!ticket) {
      return {
        success: false,
        error_code: 'TICKET_NOT_FOUND',
        error_message: 'Ticket not found'
      };
    }

    let targetStatus = normalizeStatus(newStatus) || 'waiting_customer';
    if (!VALID_STATUSES.includes(targetStatus)) {
      targetStatus = 'waiting_customer';
    }

    const now = new Date().toISOString();
    const messageId = crypto.randomUUID();

    const devMessage = {
      id: messageId,
      ticket_id: ticket.id,
      sender_type: 'developer',
      sender_user_id: developerUserId || null,
      sender_email: senderEmail,
      body: cleanMessage.trim(),
      channel: 'email',
      metadata: {},
      inbound_provider_message_id: providerMessageId,
      created_at: now
    };

    const oldStatus = ticket.status;
    ticket.status = targetStatus;
    ticket.developer_user_id = developerUserId || ticket.developer_user_id || null;
    ticket.last_message_at = now;
    ticket.updated_at = now;

    data.messages.push(devMessage);

    data.events.push({
      id: crypto.randomUUID(),
      ticket_id: ticket.id,
      event_type: 'message_added',
      actor_id: developerUserId || null,
      actor_type: 'developer',
      new_state: {
        message_id: messageId,
        sender_type: 'developer',
        channel: 'email',
        inbound_provider_message_id: providerMessageId
      },
      created_at: now
    });

    if (oldStatus !== targetStatus) {
      data.events.push({
        id: crypto.randomUUID(),
        ticket_id: ticket.id,
        event_type: 'status_changed',
        actor_id: developerUserId || null,
        actor_type: 'developer',
        old_state: { status: oldStatus },
        new_state: { status: targetStatus },
        created_at: now
      });
    }

    if (webhookEventId && Array.isArray(data.webhookEvents)) {
      const evt = data.webhookEvents.find(e => e.provider_event_id === webhookEventId);
      if (evt) {
        evt.status = 'processed';
        evt.locked_by = null;
        evt.locked_until = null;
        evt.error_message = null;
        evt.updated_at = now;
      }
    }

    await this._writeData(data);

    return {
      success: true,
      ticket_id: ticket.id,
      ticket_code: ticket.ticket_code,
      user_id: ticket.user_id,
      message_id: messageId,
      new_status: targetStatus
    };
  }

  async quarantineInboundMessage({
    providerMessageId,
    routingToken = null,
    senderEmail,
    subject = '',
    rawHeaders = {},
    rawBody = '',
    payloadHash,
    quarantineReason,
    webhookEventId,
    workerId
  }) {
    const data = await this._readData();
    if (!Array.isArray(data.quarantined)) data.quarantined = [];
    if (!Array.isArray(data.securityIncidents)) data.securityIncidents = [];

    const existing = data.quarantined.find(q => q.provider_message_id === providerMessageId);
    if (existing) {
      return {
        success: true,
        quarantine_id: existing.id,
        is_replay: true,
        status: existing.status
      };
    }

    const quarantineId = crypto.randomUUID();
    const now = new Date().toISOString();

    data.quarantined.push({
      id: quarantineId,
      provider_message_id: providerMessageId,
      routing_token: routingToken,
      sender_email: senderEmail,
      subject,
      raw_headers: rawHeaders,
      raw_body: rawBody,
      payload_hash: payloadHash,
      quarantine_reason: quarantineReason,
      status: 'quarantined',
      created_at: now
    });

    data.securityIncidents.push({
      id: crypto.randomUUID(),
      incident_type: 'inbound_message_quarantined',
      target_identifier: senderEmail,
      details: {
        provider_message_id: providerMessageId,
        routing_token: routingToken,
        reason: quarantineReason
      },
      created_at: now
    });

    if (webhookEventId && Array.isArray(data.webhookEvents)) {
      const evt = data.webhookEvents.find(e => e.provider_event_id === webhookEventId);
      if (evt) {
        evt.status = 'quarantined';
        evt.locked_by = null;
        evt.locked_until = null;
        evt.updated_at = now;
      }
    }

    await this._writeData(data);

    return {
      success: true,
      quarantine_id: quarantineId,
      status: 'quarantined'
    };
  }

  async failInboundWebhookEvent({
    providerEventId,
    workerId,
    errorMessage,
    retryable = true
  }) {
    const data = await this._readData();
    if (!Array.isArray(data.webhookEvents)) return false;
    const evt = data.webhookEvents.find(e => e.provider_event_id === providerEventId);
    if (!evt) return false;
    evt.status = retryable ? 'failed' : 'terminal_failure';
    evt.error_message = errorMessage;
    evt.locked_by = null;
    evt.locked_until = null;
    evt.updated_at = new Date().toISOString();
    await this._writeData(data);
    return true;
  }

  async developerListTickets({ status = null, search = null, limit = 50, offset = 0 } = {}) {
    const data = await this._readData();
    let tickets = [...data.tickets];

    if (status && status !== 'all') {
      const cleanStatus = normalizeStatus(status);
      tickets = tickets.filter(t => t.status === cleanStatus);
    }

    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim().toLowerCase();
      tickets = tickets.filter(t => 
        (t.subject && t.subject.toLowerCase().includes(q)) ||
        (t.ticket_code && t.ticket_code.toLowerCase().includes(q)) ||
        (t.user_email && t.user_email.toLowerCase().includes(q))
      );
    }

    tickets.sort((a, b) => new Date(b.last_message_at || b.created_at) - new Date(a.last_message_at || a.created_at));

    const total = tickets.length;
    const parsedLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
    const parsedOffset = Math.max(0, parseInt(offset, 10) || 0);

    return {
      tickets: tickets.slice(parsedOffset, parsedOffset + parsedLimit),
      total,
      limit: parsedLimit,
      offset: parsedOffset
    };
  }

  async developerGetTicket(ticketId) {
    const data = await this._readData();
    const ticket = data.tickets.find(t => t.id === ticketId);
    if (!ticket) return null;

    const messages = data.messages
      .filter(m => m.ticket_id === ticketId)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map(formatMessageOutput);

    return { ...ticket, messages };
  }

  async developerAddMessage({
    ticketId,
    developerId,
    developerEmail,
    body,
    status = null
  }) {
    if (!body || !body.trim()) {
      throw new Error('Message body is required');
    }

    const data = await this._readData();
    const ticket = data.tickets.find(t => t.id === ticketId);
    if (!ticket) return null;

    const now = new Date().toISOString();
    const messageId = crypto.randomUUID();
    const oldStatus = ticket.status;
    let targetStatus = status ? normalizeStatus(status) : 'waiting_customer';
    if (!VALID_STATUSES.includes(targetStatus)) {
      targetStatus = 'waiting_customer';
    }

    const devMessage = {
      id: messageId,
      ticket_id: ticketId,
      sender_type: 'developer',
      sender_user_id: developerId || null,
      sender_email: developerEmail || 'developer@taskly.app',
      body: body.trim(),
      channel: 'in_app',
      metadata: {},
      created_at: now
    };

    ticket.status = targetStatus;
    ticket.developer_user_id = developerId || ticket.developer_user_id || null;
    ticket.last_message_at = now;
    ticket.updated_at = now;

    data.messages.push(devMessage);

    data.events.push({
      id: crypto.randomUUID(),
      ticket_id: ticketId,
      event_type: 'message_added',
      actor_id: developerId || null,
      actor_type: 'developer',
      new_state: { message_id: messageId, sender_type: 'developer', channel: 'in_app' },
      created_at: now
    });

    if (oldStatus !== targetStatus) {
      data.events.push({
        id: crypto.randomUUID(),
        ticket_id: ticketId,
        event_type: 'status_changed',
        actor_id: developerId || null,
        actor_type: 'developer',
        old_state: { status: oldStatus },
        new_state: { status: targetStatus },
        created_at: now
      });
    }

    await this._writeData(data);
    return formatMessageOutput(devMessage);
  }

  async developerUpdateStatus(ticketId, status, developerId = null) {
    const cleanStatus = normalizeStatus(status);
    if (!VALID_STATUSES.includes(cleanStatus)) {
      throw new Error(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    const data = await this._readData();
    const ticket = data.tickets.find(t => t.id === ticketId);
    if (!ticket) return null;

    const oldStatus = ticket.status;
    const now = new Date().toISOString();
    ticket.status = cleanStatus;
    ticket.updated_at = now;
    if (developerId) {
      ticket.developer_user_id = developerId;
    }

    if (oldStatus !== cleanStatus) {
      data.events.push({
        id: crypto.randomUUID(),
        ticket_id: ticketId,
        event_type: 'status_changed',
        actor_id: developerId || null,
        actor_type: 'developer',
        old_state: { status: oldStatus },
        new_state: { status: cleanStatus },
        created_at: now
      });
    }

    await this._writeData(data);
    return ticket;
  }

  async developerGetStats() {
    const data = await this._readData();
    const tickets = data.tickets || [];
    const stats = {
      total: tickets.length,
      open: 0,
      in_progress: 0,
      waiting_customer: 0,
      resolved: 0,
      closed: 0
    };
    for (const t of tickets) {
      if (stats[t.status] !== undefined) {
        stats[t.status]++;
      }
    }
    return stats;
  }
}

// ==============================================================================
// 2. Supabase Support Storage Adapter (Production Mode with Atomic RPCs)
// ==============================================================================
class SupabaseSupportStorageAdapter {
  constructor(supabaseClient) {
    if (!supabaseClient) {
      throw new Error('Supabase client is required for SupabaseSupportStorageAdapter');
    }
    this.client = supabaseClient;
  }

  async createTicket({
    userId,
    userEmail,
    subject,
    description,
    priority = 'normal',
    category = 'general',
    idempotencyKey = null,
    metadata = {}
  }) {
    const requestHash = idempotencyKey
      ? canonicalHash({ subject, description, priority, category })
      : null;

    // Call atomic SECURITY DEFINER database procedure
    const { data, error } = await this.client.rpc('create_support_ticket_atomic', {
      p_user_id: userId,
      p_user_email: userEmail,
      p_subject: subject.trim(),
      p_body: description.trim(),
      p_priority: priority || 'normal',
      p_category: category || 'general',
      p_idempotency_key: idempotencyKey || null,
      p_request_hash: requestHash,
      p_metadata: metadata || {}
    });

    if (error) {
      throw new Error(`Database error creating support ticket: ${error.message}`);
    }

    if (!data || !data.success) {
      if (data && data.error_code === 'IDEMPOTENCY_MISMATCH') {
        const conflictErr = new Error('Idempotency conflict: key already used with different payload');
        conflictErr.statusCode = 409;
        throw conflictErr;
      }
      throw new Error(data ? data.error_message : 'Failed to create support ticket in database');
    }

    if (data.is_replay) {
      return { ...data.ticket, is_replay: true };
    }

    return data.ticket;
  }

  async listTickets(userId, { status = null, limit = 50, offset = 0 } = {}) {
    let query = this.client
      .from('support_tickets')
      .select('*')
      .eq('user_id', userId)
      .order('last_message_at', { ascending: false });

    if (status) {
      const cleanStatus = normalizeStatus(status);
      query = query.eq('status', cleanStatus);
    }

    const parsedLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
    const parsedOffset = Math.max(0, parseInt(offset, 10) || 0);

    query = query.range(parsedOffset, parsedOffset + parsedLimit - 1);

    const { data, error } = await query;
    if (error) {
      throw new Error(`Database error listing tickets: ${error.message}`);
    }
    return data || [];
  }

  async getTicket(ticketId, userId) {
    const { data: ticket, error: ticketErr } = await this.client
      .from('support_tickets')
      .select('*')
      .eq('id', ticketId)
      .eq('user_id', userId)
      .maybeSingle();

    if (ticketErr) {
      throw new Error(`Database error fetching ticket: ${ticketErr.message}`);
    }

    if (!ticket) {
      return null;
    }

    const { data: rawMessages, error: msgErr } = await this.client
      .from('support_ticket_messages')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });

    if (msgErr) {
      throw new Error(`Database error fetching ticket messages: ${msgErr.message}`);
    }

    const messages = (rawMessages || []).map(formatMessageOutput);
    return { ...ticket, messages };
  }

  async addMessage({
    ticketId,
    userId,
    userEmail,
    body,
    idempotencyKey = null,
    channel = 'in_app',
    metadata = {}
  }) {
    const requestHash = idempotencyKey
      ? canonicalHash({ ticketId, body: body.trim(), channel })
      : null;

    // Call atomic SECURITY DEFINER database procedure
    const { data, error } = await this.client.rpc('add_support_ticket_message_atomic', {
      p_ticket_id: ticketId,
      p_user_id: userId,
      p_body: body.trim(),
      p_idempotency_key: idempotencyKey || null,
      p_request_hash: requestHash,
      p_channel: channel || 'in_app',
      p_metadata: metadata || {}
    });

    if (error) {
      throw new Error(`Database error adding message: ${error.message}`);
    }

    if (!data || !data.success) {
      if (data && (data.error_code === 'TICKET_NOT_FOUND' || data.error_code === 'ACCESS_DENIED')) {
        return null;
      }
      if (data && data.error_code === 'TICKET_CLOSED') {
        const closedErr = new Error('Cannot add message: ticket is closed');
        closedErr.statusCode = 400;
        throw closedErr;
      }
      if (data && data.error_code === 'IDEMPOTENCY_MISMATCH') {
        const conflictErr = new Error('Idempotency conflict: key already used with different payload');
        conflictErr.statusCode = 409;
        throw conflictErr;
      }
      throw new Error(data ? data.error_message : 'Failed to add message to ticket in database');
    }

    const formatted = formatMessageOutput(data.message);
    if (data.is_replay) {
      return { ...formatted, is_replay: true };
    }

    return formatted;
  }

  async getMessages(ticketId, userId) {
    // Verify user owns ticket before fetching messages (prevent cross-user enumeration)
    const { data: ticket, error: ticketErr } = await this.client
      .from('support_tickets')
      .select('id')
      .eq('id', ticketId)
      .eq('user_id', userId)
      .maybeSingle();

    if (ticketErr) {
      throw new Error(`Database error verifying ticket access: ${ticketErr.message}`);
    }

    if (!ticket) {
      return null;
    }

    const { data: rawMessages, error: msgErr } = await this.client
      .from('support_ticket_messages')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });

    if (msgErr) {
      throw new Error(`Database error fetching messages: ${msgErr.message}`);
    }

    return (rawMessages || []).map(formatMessageOutput);
  }

  async claimInboundWebhookEvent({
    providerEventId,
    eventType,
    payloadPreview = {},
    workerId = 'webhook-worker',
    leaseSeconds = 60
  }) {
    const { data, error } = await this.client.rpc('claim_inbound_webhook_event', {
      p_provider_event_id: providerEventId,
      p_event_type: eventType,
      p_payload_preview: payloadPreview,
      p_worker_id: workerId,
      p_lease_seconds: leaseSeconds
    });
    if (error) throw new Error(`Database error claiming webhook event: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    return row || { claim_action: 'claimed' };
  }

  async ingestDeveloperReply({
    routingToken,
    providerMessageId,
    senderEmail,
    cleanMessage,
    newStatus = null,
    webhookEventId = null,
    developerUserId = null
  }) {
    const { data, error } = await this.client.rpc('ingest_developer_reply_atomic', {
      p_routing_token: routingToken,
      p_provider_message_id: providerMessageId,
      p_sender_email: senderEmail,
      p_clean_message: cleanMessage,
      p_new_status: newStatus,
      p_webhook_event_id: webhookEventId,
      p_developer_user_id: developerUserId
    });
    if (error) throw new Error(`Database error ingesting developer reply: ${error.message}`);
    return data;
  }

  async quarantineInboundMessage({
    providerMessageId,
    routingToken = null,
    senderEmail,
    subject = '',
    rawHeaders = {},
    rawBody = '',
    payloadHash,
    quarantineReason,
    webhookEventId,
    workerId
  }) {
    const { data, error } = await this.client.rpc('quarantine_inbound_message_atomic', {
      p_provider_message_id: providerMessageId,
      p_routing_token: routingToken,
      p_sender_email: senderEmail,
      p_subject: subject,
      p_raw_headers: rawHeaders,
      p_raw_body: rawBody,
      p_payload_hash: payloadHash,
      p_quarantine_reason: quarantineReason,
      p_webhook_event_id: webhookEventId,
      p_worker_id: workerId
    });
    if (error) throw new Error(`Database error quarantining inbound message: ${error.message}`);
    return data;
  }

  async failInboundWebhookEvent({
    providerEventId,
    workerId,
    errorMessage,
    retryable = true
  }) {
    const { data, error } = await this.client.rpc('fail_inbound_webhook_event', {
      p_provider_event_id: providerEventId,
      p_worker_id: workerId,
      p_error_message: errorMessage,
      p_retryable: retryable
    });
    if (error) throw new Error(`Database error failing webhook event: ${error.message}`);
    return data;
  }

  async developerListTickets({ status = null, search = null, limit = 50, offset = 0 } = {}) {
    let query = this.client
      .from('support_tickets')
      .select('*', { count: 'exact' })
      .order('last_message_at', { ascending: false });

    if (status && status !== 'all') {
      const cleanStatus = normalizeStatus(status);
      query = query.eq('status', cleanStatus);
    }

    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      query = query.or(`subject.ilike.%${q}%,ticket_code.ilike.%${q}%,user_email.ilike.%${q}%`);
    }

    const parsedLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
    const parsedOffset = Math.max(0, parseInt(offset, 10) || 0);

    query = query.range(parsedOffset, parsedOffset + parsedLimit - 1);

    const { data, count, error } = await query;
    if (error) throw new Error(`Database error listing developer tickets: ${error.message}`);

    return {
      tickets: data || [],
      total: count !== null ? count : (data ? data.length : 0),
      limit: parsedLimit,
      offset: parsedOffset
    };
  }

  async developerGetTicket(ticketId) {
    const { data: ticket, error: ticketErr } = await this.client
      .from('support_tickets')
      .select('*')
      .eq('id', ticketId)
      .maybeSingle();

    if (ticketErr) throw new Error(`Database error fetching developer ticket: ${ticketErr.message}`);
    if (!ticket) return null;

    const { data: rawMessages, error: msgErr } = await this.client
      .from('support_ticket_messages')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });

    if (msgErr) throw new Error(`Database error fetching developer messages: ${msgErr.message}`);

    return {
      ...ticket,
      messages: (rawMessages || []).map(formatMessageOutput)
    };
  }

  async developerAddMessage({
    ticketId,
    developerId,
    developerEmail,
    body,
    status = null
  }) {
    if (!body || !body.trim()) {
      throw new Error('Message body is required');
    }

    const cleanBody = body.trim();
    let targetStatus = status ? normalizeStatus(status) : 'waiting_customer';
    if (!VALID_STATUSES.includes(targetStatus)) {
      targetStatus = 'waiting_customer';
    }

    const messageId = crypto.randomUUID();
    const now = new Date().toISOString();

    const { data: msg, error: msgErr } = await this.client
      .from('support_ticket_messages')
      .insert({
        id: messageId,
        ticket_id: ticketId,
        sender_type: 'developer',
        sender_user_id: developerId || null,
        sender_email: developerEmail || 'developer@taskly.app',
        body: cleanBody,
        channel: 'in_app',
        metadata: {},
        created_at: now
      })
      .select()
      .single();

    if (msgErr) throw new Error(`Database error adding developer message: ${msgErr.message}`);

    const { data: updatedTicket, error: tErr } = await this.client
      .from('support_tickets')
      .update({
        status: targetStatus,
        developer_user_id: developerId || null,
        last_message_at: now,
        updated_at: now
      })
      .eq('id', ticketId)
      .select()
      .single();

    if (tErr) throw new Error(`Database error updating ticket on developer message: ${tErr.message}`);

    await this.client
      .from('support_ticket_events')
      .insert({
        ticket_id: ticketId,
        event_type: 'message_added',
        actor_id: developerId || null,
        actor_type: 'developer',
        new_state: { message_id: messageId, sender_type: 'developer', channel: 'in_app' },
        created_at: now
      });

    return formatMessageOutput(msg);
  }

  async developerUpdateStatus(ticketId, status, developerId = null) {
    const cleanStatus = normalizeStatus(status);
    if (!VALID_STATUSES.includes(cleanStatus)) {
      throw new Error(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    const now = new Date().toISOString();
    const updatePayload = {
      status: cleanStatus,
      updated_at: now
    };
    if (developerId) {
      updatePayload.developer_user_id = developerId;
    }

    const { data: ticket, error } = await this.client
      .from('support_tickets')
      .update(updatePayload)
      .eq('id', ticketId)
      .select()
      .single();

    if (error) throw new Error(`Database error updating ticket status: ${error.message}`);

    await this.client
      .from('support_ticket_events')
      .insert({
        ticket_id: ticketId,
        event_type: 'status_changed',
        actor_id: developerId || null,
        actor_type: 'developer',
        new_state: { status: cleanStatus },
        created_at: now
      });

    return ticket;
  }

  async developerGetStats() {
    const { data: tickets, error } = await this.client
      .from('support_tickets')
      .select('status');

    if (error) throw new Error(`Database error fetching developer stats: ${error.message}`);

    const stats = {
      total: (tickets || []).length,
      open: 0,
      in_progress: 0,
      waiting_customer: 0,
      resolved: 0,
      closed: 0
    };
    for (const t of tickets || []) {
      if (stats[t.status] !== undefined) {
        stats[t.status]++;
      }
    }
    return stats;
  }
}

// ==============================================================================
// 3. Storage Adapter Management & Factory Functions
// ==============================================================================
let activeAdapter = null;
let isExplicitlySet = false;

function getStorage() {
  if (!activeAdapter) {
    activeAdapter = new FileSupportStorageAdapter();
  }
  return activeAdapter;
}

function setStorage(adapter) {
  activeAdapter = adapter;
  isExplicitlySet = true;
}

function resetStorage() {
  activeAdapter = null;
  isExplicitlySet = false;
}

function getServiceStorage() {
  if (isExplicitlySet && activeAdapter) {
    return activeAdapter;
  }
  const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  const isProduction = process.env.NODE_ENV === 'production' || isVercel;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseServiceKey) {
    const { createClient } = require('@supabase/supabase-js');
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });
    return new SupabaseSupportStorageAdapter(serviceClient);
  }

  if (isProduction) {
    throw new Error('Missing Supabase service role configuration in production.');
  }

  return getStorage();
}

function getScopedStorage(req = null) {
  const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  const isProduction = process.env.NODE_ENV === 'production' || isVercel;

  // 1. Explicit mock or test adapter injection (always honored if set by test runner)
  if (isExplicitlySet && activeAdapter) {
    return activeAdapter;
  }

  // 2. Production Mode: Scoped Supabase client with user Bearer token
  if (isProduction) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing public Supabase configuration in production.');
    }

    if (req && req.userToken) {
      const { createClient } = require('@supabase/supabase-js');
      const scopedClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${req.userToken}` } }
      });
      return new SupabaseSupportStorageAdapter(scopedClient);
    }

    throw new Error('Unauthenticated support storage access is prohibited in production.');
  }

  // 3. Development / Test environment with real Supabase credentials and token
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
  if (supabaseUrl && supabaseAnonKey && req && req.userToken && !req.userToken.startsWith('mock-user:')) {
    const { createClient } = require('@supabase/supabase-js');
    const scopedClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${req.userToken}` } }
    });
    return new SupabaseSupportStorageAdapter(scopedClient);
  }

  // 4. Default to local file storage adapter
  return getStorage();
}

module.exports = {
  FileSupportStorageAdapter,
  SupabaseSupportStorageAdapter,
  getStorage,
  getScopedStorage,
  getServiceStorage,
  setStorage,
  resetStorage,
  canonicalHash,
  generateTicketCode,
  formatMessageOutput,
  normalizeStatus,
  VALID_CATEGORIES,
  VALID_PRIORITIES,
  VALID_STATUSES
};
