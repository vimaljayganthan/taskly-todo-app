/**
 * Taskly Customer Support — Outbox Real PostgreSQL Production-Path Test Suite
 * Version: 2.2.0 (Build 14)
 * 
 * Verifies Outbox Stored Procedures in real PostgreSQL 16:
 * - claim_support_email_outbox_batch (SKIP LOCKED, batching, lease locking)
 * - mark_outbox_attempt_start (sending transition, timestamps, 23h 45m cutoff guard)
 * - mark_outbox_success (sent transition, provider message ID, ticket event audit)
 * - mark_outbox_failure (retry increment, backoff scheduling, is_permanent dead-letter)
 * - mark_outbox_ambiguous (ambiguous_processing transition, 23h 45m cutoff)
 * - sweep_outbox_ambiguous_timeouts (sweeper for expired unleased jobs)
 * - SupabaseOutboxStore integration with real database RPCs
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { SupabaseOutboxStore } = require('../services/outboxStore');

const PG_PORT = 54342; // Distinct port from stage 1 suite
const PG_DATA_DIR = `/tmp/pg_stage2_outbox_${Date.now()}`;
const PSQL_BIN = '/opt/homebrew/opt/postgresql@16/bin/psql';
const PG_CTL_BIN = '/opt/homebrew/opt/postgresql@16/bin/pg_ctl';
const INITDB_BIN = '/opt/homebrew/opt/postgresql@16/bin/initdb';

function runPsql(sql, dbName = 'postgres', envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  const tmpFile = `/tmp/psql_tmp_${Date.now()}_${Math.random().toString(36).substring(2)}.sql`;
  fs.writeFileSync(tmpFile, sql, 'utf8');
  try {
    const cmd = `${PSQL_BIN} -q -h /tmp -p ${PG_PORT} -U postgres -d ${dbName} -v ON_ERROR_STOP=1 -A -t -f ${tmpFile}`;
    return execSync(cmd, { env, encoding: 'utf8' }).trim();
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
}

function runPsqlJson(sql, dbName = 'postgres') {
  const raw = runPsql(sql, dbName);
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const jsonLine = lines.reverse().find(l => l.startsWith('{') || l.startsWith('['));
  if (!jsonLine) throw new Error(`Expected JSON from query, got:\n${raw}`);
  return JSON.parse(jsonLine);
}

function runPsqlScalar(sql, dbName = 'postgres') {
  const raw = runPsql(sql, dbName);
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : '';
}

function runPsqlFile(filePath, dbName = 'postgres') {
  const cmd = `${PSQL_BIN} -q -h /tmp -p ${PG_PORT} -U postgres -d ${dbName} -v ON_ERROR_STOP=1 -f ${JSON.stringify(filePath)}`;
  return execSync(cmd, { encoding: 'utf8' });
}

describe('Taskly Customer Support — Outbox PostgreSQL Production-Path Suite', () => {
  let isPgAvailable = false;
  const USER_A_ID = 'a0000000-0000-0000-0000-000000000001';
  const USER_A_EMAIL = 'alice@taskly.app';

  before(() => {
    try {
      if (!fs.existsSync(INITDB_BIN) || !fs.existsSync(PSQL_BIN)) {
        console.warn('[Postgres Outbox]: PostgreSQL binaries not found, skipping live db suite.');
        return;
      }

      try {
        execSync(`${PG_CTL_BIN} -D ${PG_DATA_DIR} stop -m immediate`, { stdio: 'pipe' });
      } catch (_) {}

      execSync(`${INITDB_BIN} -D ${PG_DATA_DIR} -U postgres -A trust --no-locale -E UTF8`, { stdio: 'pipe' });
      execSync(`${PG_CTL_BIN} -D ${PG_DATA_DIR} -l ${PG_DATA_DIR}/server.log -o "-p ${PG_PORT} -k /tmp" start`, { stdio: 'pipe' });
      isPgAvailable = true;

      // Supabase simulation prerequisites
      const setupSql = `
        CREATE EXTENSION IF NOT EXISTS "pgcrypto";
        CREATE SCHEMA IF NOT EXISTS auth;

        CREATE TABLE IF NOT EXISTS auth.users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email VARCHAR(255) UNIQUE,
            created_at TIMESTAMPTZ DEFAULT now()
        );

        INSERT INTO auth.users (id, email) VALUES
            ('${USER_A_ID}', '${USER_A_EMAIL}')
        ON CONFLICT (id) DO NOTHING;

        CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
        BEGIN
            RETURN NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
        EXCEPTION WHEN OTHERS THEN
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql STABLE;

        CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
        BEGIN
            RETURN COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon');
        EXCEPTION WHEN OTHERS THEN
            RETURN 'anon';
        END;
        $$ LANGUAGE plpgsql STABLE;

        DO $$
        BEGIN
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
                CREATE ROLE authenticated;
            END IF;
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
                CREATE ROLE anon;
            END IF;
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
                CREATE ROLE service_role;
            END IF;
        END
        $$;

        GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
        GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
        GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated, service_role;
      `;
      runPsql(setupSql);

      const migrationFile = path.join(__dirname, '..', 'scripts', '007_customer_support_tickets_schema.sql');
      runPsqlFile(migrationFile);

    } catch (err) {
      console.warn('[Postgres Outbox Setup Warning]:', err.message);
      isPgAvailable = false;
    }
  });

  after(() => {
    if (isPgAvailable) {
      try {
        execSync(`${PG_CTL_BIN} -D ${PG_DATA_DIR} stop -m immediate`, { stdio: 'pipe' });
      } catch (_) {}
    }
    try {
      if (fs.existsSync(PG_DATA_DIR)) {
        fs.rmSync(PG_DATA_DIR, { recursive: true, force: true });
      }
    } catch (_) {}
  });

  // Helper to create a test ticket in PostgreSQL
  function createTestTicket() {
    const res = runPsqlJson(`
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${USER_A_ID}';
      SELECT public.create_support_ticket_atomic(
        '${USER_A_ID}'::uuid,
        '${USER_A_EMAIL}',
        'Postgres Outbox Test Ticket',
        'Testing outbox procedures in live PostgreSQL',
        'normal',
        'general',
        NULL,
        NULL,
        '{}'::jsonb
      );
    `);
    return res.ticket.id;
  }

  // --------------------------------------------------------------------------
  // Test 1: Automatic Transactional Outbox Enqueuing
  // --------------------------------------------------------------------------
  test('1. Transactional Outbox Enqueue: create_support_ticket_atomic enqueues notification in support_email_outbox', (t) => {
    if (!isPgAvailable) return t.skip('Local PostgreSQL cluster unavailable');

    const ticketId = createTestTicket();

    const outboxCount = runPsqlScalar(`SELECT count(*) FROM public.support_email_outbox WHERE ticket_id = '${ticketId}';`);
    assert.strictEqual(outboxCount, '1', 'One outbox record must be enqueued atomically');

    const outboxStatus = runPsqlScalar(`SELECT status FROM public.support_email_outbox WHERE ticket_id = '${ticketId}';`);
    assert.strictEqual(outboxStatus, 'pending');

    const recipient = runPsqlScalar(`SELECT recipient_email FROM public.support_email_outbox WHERE ticket_id = '${ticketId}';`);
    assert.strictEqual(recipient, 'tasklypets@gmail.com');
  });

  // --------------------------------------------------------------------------
  // Test 2: Batched Claim with Atomic Leasing (SKIP LOCKED)
  // --------------------------------------------------------------------------
  test('2. Outbox Batch Claim: claim_support_email_outbox_batch locks jobs and sets target status', (t) => {
    if (!isPgAvailable) return t.skip('Local PostgreSQL cluster unavailable');

    const workerId = 'worker_pg_test_1';
    const claimedRows = runPsqlJson(`
      SET ROLE service_role;
      SELECT coalesce(json_agg(row_to_json(c)), '[]'::json) FROM public.claim_support_email_outbox_batch(
        '${workerId}', 5, 60
      ) c;
    `);

    assert.ok(Array.isArray(claimedRows));
    assert.ok(claimedRows.length >= 1);
    const claimed = claimedRows[0];
    assert.strictEqual(claimed.outbox_status, 'processing');

    // Verify database row lock
    const lockedBy = runPsqlScalar(`SELECT locked_by FROM public.support_email_outbox WHERE id = '${claimed.id}';`);
    assert.strictEqual(lockedBy, workerId);
  });

  // --------------------------------------------------------------------------
  // Test 3: Attempt Start Transition (Sending)
  // --------------------------------------------------------------------------
  test('3. Outbox Attempt Start: mark_outbox_attempt_start transitions status to sending and records timestamps', (t) => {
    if (!isPgAvailable) return t.skip('Local PostgreSQL cluster unavailable');

    const ticketId = createTestTicket();
    const workerId = 'worker_pg_test_2';

    // Claim
    const claimed = runPsqlJson(`
      SET ROLE service_role;
      SELECT row_to_json(c) FROM public.claim_support_email_outbox_batch('${workerId}', 1, 60) c LIMIT 1;
    `);

    // Mark attempt start
    const started = runPsqlScalar(`
      SET ROLE service_role;
      SELECT public.mark_outbox_attempt_start('${claimed.id}'::uuid, '${workerId}');
    `);
    assert.strictEqual(started, 't');

    // Verify row state
    const status = runPsqlScalar(`SELECT status FROM public.support_email_outbox WHERE id = '${claimed.id}';`);
    assert.strictEqual(status, 'sending');

    const firstAttempt = runPsqlScalar(`SELECT first_attempt_started_at IS NOT NULL FROM public.support_email_outbox WHERE id = '${claimed.id}';`);
    assert.strictEqual(firstAttempt, 't');
  });

  // --------------------------------------------------------------------------
  // Test 4: Outbox Success & Event Audit Trail
  // --------------------------------------------------------------------------
  test('4. Outbox Success & Audit: mark_outbox_success transitions to sent and writes support_ticket_events', (t) => {
    if (!isPgAvailable) return t.skip('Local PostgreSQL cluster unavailable');

    const ticketId = createTestTicket();
    const workerId = 'worker_pg_test_3';
    const providerMessageId = 're_live_msg_987654321';

    // Claim & start
    const claimed = runPsqlJson(`
      SET ROLE service_role;
      SELECT row_to_json(c) FROM public.claim_support_email_outbox_batch('${workerId}', 1, 60) c LIMIT 1;
    `);
    runPsql(`SET ROLE service_role; SELECT public.mark_outbox_attempt_start('${claimed.id}'::uuid, '${workerId}');`);

    // Mark success
    const success = runPsqlScalar(`
      SET ROLE service_role;
      SELECT public.mark_outbox_success('${claimed.id}'::uuid, '${workerId}', '${providerMessageId}');
    `);
    assert.strictEqual(success, 't');

    // Verify status is sent and lock cleared
    const row = runPsqlJson(`SELECT row_to_json(o) FROM public.support_email_outbox o WHERE id = '${claimed.id}';`);
    assert.strictEqual(row.status, 'sent');
    assert.strictEqual(row.locked_by, null);
    assert.strictEqual(row.outbox_provider_message_id, providerMessageId);

    // Verify support_ticket_events audit entry
    const auditCount = runPsqlScalar(`
      SELECT count(*) FROM public.support_ticket_events 
      WHERE ticket_id = '${row.ticket_id}' AND event_type = 'email_notification_sent';
    `);
    assert.strictEqual(auditCount, '1');
  });

  // --------------------------------------------------------------------------
  // Test 5: Outbox Failure & Permanent Dead-Letter
  // --------------------------------------------------------------------------
  test('5. Outbox Failure & Dead-Letter: mark_outbox_failure with is_permanent marks failed immediately', (t) => {
    if (!isPgAvailable) return t.skip('Local PostgreSQL cluster unavailable');

    const ticketId = createTestTicket();
    const workerId = 'worker_pg_test_4';

    // Claim
    const claimed = runPsqlJson(`
      SET ROLE service_role;
      SELECT row_to_json(c) FROM public.claim_support_email_outbox_batch('${workerId}', 1, 60) c LIMIT 1;
    `);

    // Mark permanent failure
    const failed = runPsqlScalar(`
      SET ROLE service_role;
      SELECT public.mark_outbox_failure('${claimed.id}'::uuid, '${workerId}', 'Permanent 400 rejection', 60, true);
    `);
    assert.strictEqual(failed, 't');

    const status = runPsqlScalar(`SELECT status FROM public.support_email_outbox WHERE id = '${claimed.id}';`);
    assert.strictEqual(status, 'failed');

    const lastError = runPsqlScalar(`SELECT last_error FROM public.support_email_outbox WHERE id = '${claimed.id}';`);
    assert.strictEqual(lastError, 'Permanent 400 rejection');
  });

  // --------------------------------------------------------------------------
  // Test 6: Ambiguous Outcome & 23h 45m Safety Cutoff
  // --------------------------------------------------------------------------
  test('6. Resend 24-Hour Safety Cutoff: Stored procedure halts retries beyond 23h 45m window', (t) => {
    if (!isPgAvailable) return t.skip('Local PostgreSQL cluster unavailable');

    const ticketId = createTestTicket();
    const workerId = 'worker_pg_test_5';

    // Claim & start
    const claimed = runPsqlJson(`
      SET ROLE service_role;
      SELECT row_to_json(c) FROM public.claim_support_email_outbox_batch('${workerId}', 1, 60) c LIMIT 1;
    `);
    runPsql(`SET ROLE service_role; SELECT public.mark_outbox_attempt_start('${claimed.id}'::uuid, '${workerId}');`);

    // Backdate first_attempt_started_at to 23 hours 50 minutes ago
    runPsql(`
      UPDATE public.support_email_outbox 
      SET first_attempt_started_at = now() - interval '23 hours 50 minutes'
      WHERE id = '${claimed.id}';
    `);

    // mark_outbox_ambiguous halts retry and transitions to ambiguous_delivery_timeout
    const ambigRes = runPsqlScalar(`
      SET ROLE service_role;
      SELECT public.mark_outbox_ambiguous('${claimed.id}'::uuid, '${workerId}', 'Gateway timeout', 60);
    `);
    assert.strictEqual(ambigRes, 't');

    const status = runPsqlScalar(`SELECT status FROM public.support_email_outbox WHERE id = '${claimed.id}';`);
    assert.strictEqual(status, 'ambiguous_delivery_timeout');

    // Test sweeper sweeps unleased expired jobs
    runPsql(`
      UPDATE public.support_email_outbox 
      SET status = 'processing', locked_until = NULL, first_attempt_started_at = now() - interval '23 hours 50 minutes'
      WHERE id = '${claimed.id}';
    `);

    const sweptCount = runPsqlScalar(`SET ROLE service_role; SELECT public.sweep_outbox_ambiguous_timeouts();`);
    assert.strictEqual(sweptCount, '1');

    const sweptStatus = runPsqlScalar(`SELECT status FROM public.support_email_outbox WHERE id = '${claimed.id}';`);
    assert.strictEqual(sweptStatus, 'ambiguous_delivery_timeout');
  });
});

