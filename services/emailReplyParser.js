/**
 * Taskly Customer Support — Email Reply Parser & Command Extractor
 * Version: 2.2.0 (Build 14)
 * 
 * Cleans developer email replies:
 * - Extracts developer status override directives (e.g., #status: resolved)
 * - Strips quoted email threads, mobile device signatures, and RFC delimiters
 * - Extracts cryptographically unguessable routing tokens from reply addresses
 * - Extracts bare sender emails from RFC 2822 headers
 */

const QUOTE_HEADER_PATTERNS = [
  /^-+\s*Original Message\s*-+/i,
  /^On\s+.+,\s*.+\s+wrote:?$/i,
  /^On\s+.+wrote:?$/i,
  /^Le\s+.+a écrit\s+:?$/i,
  /^Am\s+.+schrieb\s+.+:?$/i,
  /^El\s+.+escribió:?$/i,
  /^Em\s+.+escreveu:?$/i,
  /^From:\s+.+$/i
];

const SIGNATURE_PATTERNS = [
  /^--\s*$/,                                     // Standard RFC 3676 delimiter
  /^Sent from my (iPhone|iPad|Galaxy|Android|phone)/i,
  /^Get Outlook for (iOS|Android)/i,
  /^Sent from Outlook/i,
  /^Sent from Mail for Windows/i
];

const STATUS_COMMAND_REGEX = /^#status:\s*(open|in_progress|waiting_customer|waiting_on_user|waiting_on_customer|resolved|closed)/i;

/**
 * Normalizes status strings to match database schema constraints
 */
function normalizeInboundStatus(status) {
  if (!status || typeof status !== 'string') return null;
  const clean = status.trim().toLowerCase();
  if (clean === 'waiting_on_user' || clean === 'waiting_on_customer') {
    return 'waiting_customer';
  }
  if (['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'].includes(clean)) {
    return clean;
  }
  return null;
}

/**
 * Parses raw text from developer reply, extracting directives and cleaning quotes
 * 
 * @param {string} rawText - Raw email body text
 * @returns {{ cleanMessage: string, newStatus: string|null }}
 */
function parseDeveloperReply(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { cleanMessage: '', newStatus: null };
  }

  const lines = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const cleanLines = [];
  let newStatus = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check for developer status command (#status: resolved)
    const statusMatch = trimmed.match(STATUS_COMMAND_REGEX);
    if (statusMatch) {
      newStatus = normalizeInboundStatus(statusMatch[1]);
      continue; // Exclude directive from public message body
    }

    // Stop at email quote headers (e.g. "On Tue, Nov 10 ... wrote:")
    if (QUOTE_HEADER_PATTERNS.some(pat => pat.test(trimmed))) {
      break;
    }

    // Stop at signature patterns (e.g. "-- ", "Sent from my iPhone")
    if (SIGNATURE_PATTERNS.some(pat => pat.test(trimmed))) {
      break;
    }

    // Skip quoted lines starting with '>'
    if (trimmed.startsWith('>')) {
      continue;
    }

    cleanLines.push(line);
  }

  let cleanMessage = cleanLines.join('\n').trim();

  // Fallback: If cleaning completely emptied text, return original lines without '>' quotes
  if (!cleanMessage && lines.length > 0) {
    cleanMessage = lines
      .filter(l => !l.trim().startsWith('>'))
      .join('\n')
      .trim();
  }

  return { cleanMessage, newStatus };
}

/**
 * Extracts cryptographic routing token from the recipient address
 * Supports:
 * - reply+tk_tk1001_8f9c1a2e7d3b4f6a5c8e1d2b3c4a5b6c@domain
 * - reply+8f9c1a2e7d3b4f6a5c8e1d2b3c4a5b6c@domain
 * 
 * @param {string|string[]} toHeader
 * @returns {string|null} 32 or 64 character lowercase hex token
 */
function extractRoutingToken(toHeader) {
  if (!toHeader) return null;
  const addresses = Array.isArray(toHeader) ? toHeader : [toHeader];

  for (const addr of addresses) {
    if (!addr || typeof addr !== 'string') continue;

    // Pattern 1: reply+tk_<code_clean>_<routingToken>@...
    const matchFull = addr.match(/reply\+tk_[a-z0-9]+_([a-f0-9]{32,64})@/i);
    if (matchFull) {
      return matchFull[1].toLowerCase();
    }

    // Pattern 2: reply+<routingToken>@...
    const matchSimple = addr.match(/reply\+([a-f0-9]{32,64})@/i);
    if (matchSimple) {
      return matchSimple[1].toLowerCase();
    }
  }

  return null;
}

/**
 * Extracts clean email address from RFC 2822 header (e.g., "Developer <dev@taskly.app>" -> "dev@taskly.app")
 * 
 * @param {string} fromHeader
 * @returns {string} Clean lowercase email address
 */
function extractSenderEmail(fromHeader) {
  if (!fromHeader || typeof fromHeader !== 'string') return '';
  const match = fromHeader.match(/<([^>]+)>/);
  if (match) {
    return match[1].trim().toLowerCase();
  }
  return fromHeader.trim().toLowerCase();
}

module.exports = {
  parseDeveloperReply,
  extractRoutingToken,
  extractSenderEmail,
  normalizeInboundStatus
};

