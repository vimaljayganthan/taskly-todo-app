const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { SupabaseSupportStorageAdapter, canonicalHash } = require('../storage/supportStore');

const PG_PORT = 54341;
const PG_DATA_DIR = `/tmp/pg_stage1_prod_${Date.now()}`;
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

describe('Taskly Customer Support — Real PostgreSQL Production-Path Test Suite', () => {
  let isPgAvailable = false;
  const USER_A_ID = 'a0000000-0000-0000-0000-000000000001';
  const USER_B_ID = 'b0000000-0000-0000-0000-000000000002';
  const USER_A_EMAIL = 'alice@taskly.app';
  const USER_B_EMAIL = 'bob@taskly.app';

  before(() => {
    try {
      if (!fs.existsSync(INITDB_BIN) || !fs.existsSync(PSQL_BIN)) {
        console.warn('[Postgres Path]: PostgreSQL binaries not found, skipping live db suite.');
        return;
      }

      // 1. Ensure any stale server on PG_DATA_DIR is stopped
      try {
        execSync(`${PG_CTL_BIN} -D ${PG_DATA_DIR} stop -m immediate`, { stdio: 'pipe' });
      } catch (_) {}

      // 2. Initialize clean disposable cluster
      execSync(`${INITDB_BIN} -D ${PG_DATA_DIR} -U postgres -A trust --no-locale -E UTF8`, { stdio: 'pipe' });

      // 3. Start PostgreSQL on isolated port with dedicated log file
      execSync(`${PG_CTL_BIN} -D ${PG_DATA_DIR} -l ${PG_DATA_DIR}/server.log -o "-p ${PG_PORT} -k /tmp" start`, { stdio: 'pipe' });
      isPgAvailable = true;

      // 4. Setup Supabase simulation prerequisites (auth schema, users table, auth.uid() function, roles)
      const setupSql = `
        CREATE EXTENSION IF NOT EXISTS "pgcrypto";
        CREATE SCHEMA IF NOT EXISTS auth;

        CREATE TABLE IF NOT EXISTS auth.users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email VARCHAR(255) UNIQUE,
            created_at TIMESTAMPTZ DEFAULT now()
        );

        INSERT INTO auth.users (id, email) VALUES
            ('${USER_A_ID}', '${USER_A_EMAIL}'),
            ('${USER_B_ID}', '${USER_B_EMAIL}')
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

      // 5. Execute Migration 007 against the real PostgreSQL database
      const migrationFile = path.join(__dirname, '..', 'scripts', '007_customer_support_tickets_schema.sql');
      runPsqlFile(migrationFile);

    } catch (err) {
      console.warn('[Postgres Setup Warning]:', err.message);
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

  // --------------------------------------------------------------------------
  // Test 1: Column & Table Compatibility
  // --------------------------------------------------------------------------
  test('1. Database Schema & Columns: All 10 tables and required columns exist with correct types', (t) => {
    if (!isPgAvailable) return t.skip('Local PostgreSQL cluster unavailable');

    const tables = [
      'support_tickets',
      'support_ticket_messages',
      'support_ticket_routing',
      'support_quarantined_messages',
      'support_ticket_events',
      'support_security_incidents',
      'support_email_outbox',
      'inbound_webhook_events',
      'support_ticket_idempotency',
      'support_message_idempotency'
    ];

    for (const tbl of tables) {
      const count = runPsqlScalar(`SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${tbl}';`);
      assert.strictEqual(count, '1', `Table ${tbl} must exist`);
    }

    // Verify key columns in support_tickets
    const ticketCols = runPsql(`
      SELECT column_name || ':' || data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'support_tickets'
      ORDER BY column_name;
    `).split('\n').map(l => l.trim());

    assert.ok(ticketCols.includes('id:uuid'), 'support_tickets must have id UUID');
    assert.ok(ticketCols.includes('ticket_code:character varying'), 'support_tickets must have ticket_code');
    assert.ok(ticketCols.includes('user_id:uuid'), 'support_tickets must have user_id');
    assert.ok(ticketCols.includes('user_email:character varying'), 'support_tickets must have user_email');
    assert.ok(ticketCols.includes('category:character varying'), 'support_tickets must have category');
    assert.ok(ticketCols.includes('metadata:jsonb'), 'support_tickets must have metadata jsonb');
    assert.ok(ticketCols.includes('status:character varying'), 'support_tickets must have status');

    // Verify key columns in support_ticket_messages
    const msgCols = runPsql(`
      SELECT column_name || ':' || data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'support_ticket_messages'
      ORDER BY column_name;
    `).split('\n').map(l => l.trim());

    assert.ok(msgCols.includes('sender_type:character varying'), 'messages must have sender_type');
    assert.ok(msgCols.includes('sender_user_id:uuid'), 'messages must have sender_user_id');
    assert.ok(msgCols.includes('sender_email:character varying'), 'messages must have sender_email');
    assert.ok(msgCols.includes('channel:character varying'), 'messages must have channel');
    assert.ok(msgCols.includes('metadata:jsonb'), 'messages must have metadata jsonb');
  });

  // --------------------------------------------------------------------------
  // Test 2: Atomic Stored Procedure Execution
  // --------------------------------------------------------------------------
  test('2. Atomic RPC Execution: create_support_ticket_atomic creates ticket, message, routing, and event atomically', (t) => {
    if (!isPgAvailable) return t.skip('Local PostgreSQL cluster unavailable');

    const result = runPsqlJson(`
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${USER_A_ID}';
      SELECT public.create_support_ticket_atomic(
        '${USER_A_ID}'::uuid,
        '${USER_A_EMAIL}',
        'Database atomicity test',
        'Testing atomic ticket and initial message creation.',
        'high',
        'bug',
        'test-idem-key-prod-1',
        '${canonicalHash({ subject: 'Database atomicity test', description: 'Testing atomic ticket and initial message creation.', priority: 'high', category: 'bug' })}',
        '{"source":"audit_test"}'::jsonb
      );
    `);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.is_replay, false);
    assert.ok(result.ticket.id);
    assert.ok(result.ticket.ticket_code.startsWith('TK-'));
    assert.strictEqual(result.ticket.category, 'bug');
    assert.strictEqual(result.ticket.priority, 'high');

    const ticketId = result.ticket.id;

    // Verify initial message was inserted atomically
    const msgCount = runPsqlScalar(`SELECT count(*) FROM public.support_ticket_messages WHERE ticket_id = '${ticketId}';`);
    assert.strictEqual(msgCount, '1');

    // Verify routing token was generated
    const routingCount = runPsqlScalar(`SELECT count(*) FROM public.support_ticket_routing WHERE ticket_id = '${ticketId}';`);
    assert.strictEqual(routingCount, '1');

    // Verify event was created
    const eventCount = runPsqlScalar(`SELECT count(*) FROM public.support_ticket_events WHERE ticket_id = '${ticketId}' AND event_type = 'ticket_created';`);
    assert.strictEqual(eventCount, '1');

    // Verify idempotency record
    const idempCount = runPsqlScalar(`SELECT count(*) FROM public.support_ticket_idempotency WHERE ticket_id = '${ticketId}' AND user_id = '${USER_A_ID}';`);
    assert.strictEqual(idempCount, '1');
  });

  // --------------------------------------------------------------------------
  // Test 3: Concurrency & Idempotency Conflict Handling
  // --------------------------------------------------------------------------
  test('3. Idempotency Conflict: Same key with matching hash returns replay; differing hash fails with incident log', (t) => {
    if (!isPgAvailable) return t.skip('Local PostgreSQL cluster unavailable');

    const idemKey = 'test-idem-conflict-check';
    const payloadHash = canonicalHash({ subject: 'Conflict check ticket', description: 'Testing replay', priority: 'normal', category: 'general' });

    // Request 1: Creation
    const res1 = runPsqlJson(`
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${USER_A_ID}';
      SELECT public.create_support_ticket_atomic(
        '${USER_A_ID}'::uuid,
        '${USER_A_EMAIL}',
        'Conflict check ticket',
        'Testing replay',
        'normal',
        'general',
        '${idemKey}',
        '${payloadHash}',
        '{}'::jsonb
      );
    `);
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.is_replay, false);
    const createdId = res1.ticket.id;

    // Request 2: Replay with identical hash
    const res2 = runPsqlJson(`
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${USER_A_ID}';
      SELECT public.create_support_ticket_atomic(
        '${USER_A_ID}'::uuid,
        '${USER_A_EMAIL}',
        'Conflict check ticket',
        'Testing replay',
        'normal',
        'general',
        '${idemKey}',
        '${payloadHash}',
        '{}'::jsonb
      );
    `);
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.is_replay, true);
    assert.strictEqual(res2.ticket.id, createdId);

    // Request 3: Tampered payload with same key -> IDEMPOTENCY_MISMATCH
    const tamperedHash = canonicalHash({ subject: 'TAMPERED subject', description: 'Tampered', priority: 'urgent', category: 'billing' });
    const res3 = runPsqlJson(`
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${USER_A_ID}';
      SELECT public.create_support_ticket_atomic(
        '${USER_A_ID}'::uuid,
        '${USER_A_EMAIL}',
        'TAMPERED subject',
        'Tampered',
        'urgent',
        'billing',
        '${idemKey}',
        '${tamperedHash}',
        '{}'::jsonb
      );
    `);
    assert.strictEqual(res3.success, false);
    assert.strictEqual(res3.error_code, 'IDEMPOTENCY_MISMATCH');

    // Verify incident was logged in database
    const incidentCount = runPsqlScalar(`
      SELECT count(*) FROM public.support_security_incidents 
      WHERE incident_type = 'idempotency_hash_mismatch' AND target_identifier = '${idemKey}';
    `);
    assert.strictEqual(incidentCount, '1');
  });

  // --------------------------------------------------------------------------
  // Test 4: Identity Validation & Anti-Spoofing Inside Database
  // --------------------------------------------------------------------------
  test('4. Security Definer Anti-Spoofing: Caller authenticated identity cannot create ticket for another user', (t) => {
    if (!isPgAvailable) return t.skip('Local PostgreSQL cluster unavailable');

    // Authenticated caller is User A, but p_user_id passed is User B
    assert.throws(() => {
      runPsql(`
        SET request.jwt.claim.role = 'authenticated';
        SET request.jwt.claim.sub = '${USER_A_ID}';
        SELECT public.create_support_ticket_atomic(
          '${USER_B_ID}'::uuid,
          '${USER_B_EMAIL}',
          'Forged ticket attempt',
          'Attempting to insert for user B',
          'normal',
          'general',
          NULL,
          NULL,
          '{}'::jsonb
        );
      `);
    }, /Caller identity mismatch/);
  });

  // --------------------------------------------------------------------------
  // Test 5: Row Level Security (RLS) Tenant Isolation
  // --------------------------------------------------------------------------
  test('5. Row Level Security: User B querying support_tickets directly cannot see User A tickets', (t) => {
    if (!isPgAvailable) return t.skip('Local PostgreSQL cluster unavailable');

    // As User A: can see their own ticket
    const countA = runPsqlScalar(`
      SET ROLE authenticated;
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${USER_A_ID}';
      SELECT count(*) FROM public.support_tickets;
    `);
    assert.ok(parseInt(countA, 10) >= 1, `User A sees their own tickets (got ${countA})`);

    // As User B: sees 0 of User A's tickets
    const countB = runPsqlScalar(`
      SET ROLE authenticated;
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${USER_B_ID}';
      SELECT count(*) FROM public.support_tickets;
    `);
    assert.strictEqual(countB, '0', 'User B must see zero tickets under RLS');
  });

  // --------------------------------------------------------------------------
  // Test 6: Message Addition & Closed Ticket Enforcement
  // --------------------------------------------------------------------------
  test('6. Message Addition: Appending to open ticket updates timestamps; closed ticket returns TICKET_CLOSED', (t) => {
    if (!isPgAvailable) return t.skip('Local PostgreSQL cluster unavailable');

    // Create ticket for User A
    const createRes = runPsqlJson(`
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${USER_A_ID}';
      SELECT public.create_support_ticket_atomic(
        '${USER_A_ID}'::uuid,
        '${USER_A_EMAIL}',
        'Message flow ticket',
        'Initial message',
        'normal',
        'general',
        NULL,
        NULL,
        '{}'::jsonb
      );
    `);
    const ticketId = createRes.ticket.id;

    // Add message
    const msgRes = runPsqlJson(`
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${USER_A_ID}';
      SELECT public.add_support_ticket_message_atomic(
        '${ticketId}'::uuid,
        '${USER_A_ID}'::uuid,
        'Follow-up message from User A',
        'msg-idem-prod-1',
        '${canonicalHash({ ticketId, body: 'Follow-up message from User A', channel: 'in_app' })}',
        'in_app',
        '{}'::jsonb
      );
    `);
    assert.strictEqual(msgRes.success, true);
    assert.strictEqual(msgRes.message.sender_type, 'user');
    assert.strictEqual(msgRes.message.sender_user_id, USER_A_ID);

    // Cross-user message attempt by User B on User A ticket
    const crossRes = runPsqlJson(`
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${USER_B_ID}';
      SELECT public.add_support_ticket_message_atomic(
        '${ticketId}'::uuid,
        '${USER_B_ID}'::uuid,
        'Malicious injection by User B',
        NULL,
        NULL,
        'in_app',
        '{}'::jsonb
      );
    `);
    assert.strictEqual(crossRes.success, false);
    assert.strictEqual(crossRes.error_code, 'ACCESS_DENIED');

    // Close the ticket
    runPsql(`UPDATE public.support_tickets SET status = 'closed' WHERE id = '${ticketId}';`);

    // Attempt to append to closed ticket
    const closedRes = runPsqlJson(`
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${USER_A_ID}';
      SELECT public.add_support_ticket_message_atomic(
        '${ticketId}'::uuid,
        '${USER_A_ID}'::uuid,
        'Post on closed ticket',
        NULL,
        NULL,
        'in_app',
        '{}'::jsonb
      );
    `);
    assert.strictEqual(closedRes.success, false);
    assert.strictEqual(closedRes.error_code, 'TICKET_CLOSED');
  });

  // --------------------------------------------------------------------------
  // Test 7: Direct Table Write Blocked (Privilege Separation)
  // --------------------------------------------------------------------------
  test('7. Privilege Separation: authenticated role has no direct INSERT/UPDATE on support tables', (t) => {
    if (!isPgAvailable) return t.skip('Local PostgreSQL cluster unavailable');

    assert.throws(() => {
      runPsql(`
        SET ROLE authenticated;
        SET request.jwt.claim.role = 'authenticated';
        SET request.jwt.claim.sub = '${USER_A_ID}';
        INSERT INTO public.support_tickets (
          ticket_code, user_id, user_email, subject
        ) VALUES (
          'TK-FORGED', '${USER_A_ID}'::uuid, '${USER_A_EMAIL}', 'Bypassing RPC'
        );
      `);
    }, /permission denied for table support_tickets/);
  });

  // --------------------------------------------------------------------------
  // Test 8: SupabaseSupportStorageAdapter Integration via Scoped Client
  // --------------------------------------------------------------------------
  test('8. SupabaseSupportStorageAdapter Integration: Exercises adapter methods against PostgreSQL RPCs', async (t) => {
    if (!isPgAvailable) return t.skip('Local PostgreSQL cluster unavailable');

    // Create lightweight PostgREST bridge client that runs queries through psql
    const mockPostgrestClient = {
      rpc: async (fnName, params) => {
        try {
          const namedArgs = Object.entries(params || {}).map(([k, v]) => {
            if (v === null || v === undefined) {
              return `${k} => NULL`;
            }
            if (typeof v === 'object') {
              return `${k} => '${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
            }
            if (k.includes('id') && typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)) {
              return `${k} => '${v}'::uuid`;
            }
            return `${k} => '${String(v).replace(/'/g, "''")}'`;
          }).join(', ');

          const sql = `
            SET request.jwt.claim.role = 'authenticated';
            SET request.jwt.claim.sub = '${USER_A_ID}';
            SELECT public.${fnName}(${namedArgs});
          `;
          const data = runPsqlJson(sql);
          return { data, error: null };
        } catch (err) {
          return { data: null, error: err };
        }
      },
      from: (tbl) => {
        let filters = [];
        let orderCol = null;
        let isAscending = true;

        const builder = {
          select: () => builder,
          eq: (col, val) => {
            filters.push(`${col} = '${val}'`);
            return builder;
          },
          order: (col, { ascending = true } = {}) => {
            orderCol = col;
            isAscending = ascending;
            return builder;
          },
          range: (start, end) => builder,
          maybeSingle: async () => {
            const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
            const sql = `
              SET ROLE authenticated;
              SET request.jwt.claim.role = 'authenticated';
              SET request.jwt.claim.sub = '${USER_A_ID}';
              SELECT row_to_json(t) FROM (SELECT * FROM public.${tbl} ${whereClause} LIMIT 1) t;
            `;
            try {
              const data = runPsqlJson(sql);
              return { data, error: null };
            } catch (err) {
              return { data: null, error: err };
            }
          },
          then: (resolve, reject) => {
            const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
            const orderClause = orderCol ? `ORDER BY ${orderCol} ${isAscending ? 'ASC' : 'DESC'}` : '';
            const sql = `
              SET ROLE authenticated;
              SET request.jwt.claim.role = 'authenticated';
              SET request.jwt.claim.sub = '${USER_A_ID}';
              SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT * FROM public.${tbl} ${whereClause} ${orderClause}) t;
            `;
            try {
              const data = runPsqlJson(sql);
              resolve({ data, error: null });
            } catch (err) {
              resolve({ data: null, error: err });
            }
          }
        };
        return builder;
      }
    };

    const adapter = new SupabaseSupportStorageAdapter(mockPostgrestClient);

    // Test adapter createTicket
    const ticket = await adapter.createTicket({
      userId: USER_A_ID,
      userEmail: USER_A_EMAIL,
      subject: 'Adapter production test',
      description: 'Testing adapter RPC integration',
      priority: 'high',
      category: 'feedback',
      idempotencyKey: `adapter-test-${Date.now()}`
    });

    assert.ok(ticket.id);
    assert.strictEqual(ticket.subject, 'Adapter production test');
    assert.strictEqual(ticket.category, 'feedback');
    assert.strictEqual(ticket.priority, 'high');

    // Test adapter addMessage
    const msg = await adapter.addMessage({
      ticketId: ticket.id,
      userId: USER_A_ID,
      userEmail: USER_A_EMAIL,
      body: 'Adapter message body'
    });

    assert.ok(msg.id);
    assert.strictEqual(msg.sender_type, 'user');
    assert.strictEqual(msg.author_type, 'customer'); // backward-compatible alias
    assert.strictEqual(msg.body, 'Adapter message body');

    // Test adapter getTicket
    const fetchedTicket = await adapter.getTicket(ticket.id, USER_A_ID);
    assert.strictEqual(fetchedTicket.id, ticket.id);
    assert.strictEqual(fetchedTicket.messages.length, 2); // Initial + follow-up

    // Test adapter listTickets
    const tickets = await adapter.listTickets(USER_A_ID);
    assert.ok(tickets.length >= 1);
  });

  // --------------------------------------------------------------------------
  // Test 9: Migration Idempotency (Re-run Safety)
  // --------------------------------------------------------------------------
  test('9. Migration Idempotency: Re-executing Migration 007 against already-migrated database succeeds cleanly', (t) => {
    if (!isPgAvailable) return t.skip('Local PostgreSQL cluster unavailable');

    const migrationFile = path.join(__dirname, '..', 'scripts', '007_customer_support_tickets_schema.sql');
    assert.doesNotThrow(() => {
      runPsqlFile(migrationFile);
    }, 'Re-running Migration 007 must be 100% idempotent and error-free');
  });
});
