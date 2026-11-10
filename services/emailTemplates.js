/**
 * Taskly Customer Support — Email Notification Templates
 * Version: 2.2.0 (Build 14)
 * 
 * Generates structured HTML and plain-text email notifications with
 * cryptographically unguessable routing Reply-To addresses.
 */

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Builds the unguessable reply-to address using the ticket code and routing token
 * Format: reply+tk_<cleancode>_<routingtoken>@<receivingdomain>
 */
function buildReplyToAddress(ticketCode, routingToken, receivingDomain = null) {
  const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  const isProduction = process.env.NODE_ENV === 'production' || isVercel;
  const domain = String(receivingDomain || process.env.RESEND_RECEIVING_DOMAIN || (isProduction ? '' : 'd893f1.resend.app')).trim();
  if (!domain) {
    throw new Error('Missing RESEND_RECEIVING_DOMAIN for generating reply-to address.');
  }
  const cleanCode = String(ticketCode || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanToken = String(routingToken || '').toLowerCase().trim();
  return `reply+tk_${cleanCode}_${cleanToken}@${domain}`;
}

/**
 * Generates email content for a new support ticket notification to developer
 */
function formatNewTicketNotification({
  ticket,
  initialMessage,
  routingToken,
  receivingDomain = null
}) {
  const replyTo = buildReplyToAddress(ticket.ticket_code, routingToken, receivingDomain);
  const subject = `[Ticket #${ticket.ticket_code}] ${ticket.subject}`;

  const safeSubject = escapeHtml(ticket.subject);
  const safeTicketCode = escapeHtml(ticket.ticket_code);
  const safeUserEmail = escapeHtml(ticket.user_email);
  const safeCategory = escapeHtml(ticket.category || 'general');
  const safePriority = escapeHtml(ticket.priority || 'normal');
  const messageBody = typeof initialMessage === 'string' ? initialMessage : (initialMessage ? initialMessage.body : '');
  const safeBody = escapeHtml(messageBody);

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1f2937; margin: 0; padding: 20px; background-color: #f9fafb; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; }
    .header { border-bottom: 2px solid #3b82f6; padding-bottom: 12px; margin-bottom: 20px; }
    .title { font-size: 20px; font-weight: 700; color: #111827; margin: 0; }
    .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    .meta-table td { padding: 6px 10px; font-size: 14px; border-bottom: 1px solid #f3f4f6; }
    .meta-label { font-weight: 600; color: #4b5563; width: 100px; }
    .body-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; margin: 20px 0; white-space: pre-wrap; font-size: 15px; }
    .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 13px; color: #6b7280; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 class="title">New Taskly Support Ticket: ${safeTicketCode}</h2>
    </div>
    <table class="meta-table">
      <tr><td class="meta-label">User:</td><td>${safeUserEmail}</td></tr>
      <tr><td class="meta-label">Subject:</td><td><strong>${safeSubject}</strong></td></tr>
      <tr><td class="meta-label">Category:</td><td>${safeCategory}</td></tr>
      <tr><td class="meta-label">Priority:</td><td>${safePriority}</td></tr>
    </table>
    <div class="body-box">${safeBody}</div>
    <div class="footer">
      <p><strong>Reply directly to this email</strong> to respond to the customer. Do not modify the Reply-To address.</p>
    </div>
  </div>
</body>
</html>`;

  const text = `New Taskly Support Ticket: ${ticket.ticket_code}\n` +
    `User: ${ticket.user_email}\n` +
    `Subject: ${ticket.subject}\n` +
    `Category: ${ticket.category || 'general'}\n` +
    `Priority: ${ticket.priority || 'normal'}\n\n` +
    `Message:\n${messageBody}\n\n` +
    `---\n` +
    `Reply directly to this email to respond to the customer.`;

  return {
    subject,
    replyTo,
    html,
    text
  };
}

/**
 * Generates email content for a customer follow-up message notification to developer
 */
function formatNewMessageNotification({
  ticket,
  message,
  routingToken,
  receivingDomain = null
}) {
  const replyTo = buildReplyToAddress(ticket.ticket_code, routingToken, receivingDomain);
  const subject = `Re: [Ticket #${ticket.ticket_code}] ${ticket.subject}`;

  const safeSubject = escapeHtml(ticket.subject);
  const safeTicketCode = escapeHtml(ticket.ticket_code);
  const safeUserEmail = escapeHtml(message.sender_email || ticket.user_email);
  const messageBody = typeof message === 'string' ? message : (message ? message.body : '');
  const safeBody = escapeHtml(messageBody);

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1f2937; margin: 0; padding: 20px; background-color: #f9fafb; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; }
    .header { border-bottom: 2px solid #10b981; padding-bottom: 12px; margin-bottom: 20px; }
    .title { font-size: 18px; font-weight: 700; color: #111827; margin: 0; }
    .body-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; margin: 20px 0; white-space: pre-wrap; font-size: 15px; }
    .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 13px; color: #6b7280; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h3 class="title">Follow-up on Ticket #${safeTicketCode} from ${safeUserEmail}</h3>
    </div>
    <div class="body-box">${safeBody}</div>
    <div class="footer">
      <p><strong>Reply directly to this email</strong> to respond to the customer.</p>
    </div>
  </div>
</body>
</html>`;

  const text = `Follow-up on Ticket #${ticket.ticket_code}\n` +
    `From: ${message.sender_email || ticket.user_email}\n` +
    `Subject: ${ticket.subject}\n\n` +
    `Message:\n${messageBody}\n\n` +
    `---\n` +
    `Reply directly to this email to respond to the customer.`;

  return {
    subject,
    replyTo,
    html,
    text
  };
}

module.exports = {
  escapeHtml,
  buildReplyToAddress,
  formatNewTicketNotification,
  formatNewMessageNotification
};

