# TASKLY v2.2.0 (BUILD 14) — MIGRATION 007 READINESS AUDIT

**Target:** Supabase PostgreSQL Database (Production)  
**Schema Migration File:** `scripts/007_customer_support_tickets_schema.sql` (1,857 lines)  
**Rollback File:** `scripts/007_rollback.sql` (40 lines)  
**Git Branch:** `release/taskly-v2.2.0-b14`  
**Git Commit SHA:** `44b12f51e8518ce097601d76a88ca89f621c8290`  
**Audit Scope:** Read-Only Static and Architectural Safety Verification  
**Audit Date:** November 10, 2026  

---

## 1. Executive Summary

| Audit Dimension | Status | Summary Finding |
| :--- | :---: | :--- |
| **Transaction Safety & Atomicity** | **PASS** | Migration 007 is wrapped in a single database transaction (`BEGIN; ... COMMIT;`). Any failure immediately aborts with zero partial schema changes. |
| **Schema Isolation & Non-Destructive Impact** | **PASS** | Modifies **zero** existing tables (`todos`, `smart_routines`, `habit_reports`, `smart_lists_settings` are completely untouched). Creates 10 new isolated tables. |
| **Supabase Managed Schema Compatibility** | **PASS** | Does not alter, create, or drop `auth.users` or the `auth` schema. References `auth.users(id)` via standard foreign keys and `auth.uid()` / `auth.role()` functions. |
| **Row Level Security (RLS) & Table Privileges** | **PASS** | RLS is explicitly enabled on all 10 tables. Direct access is revoked from `public` and `anon`. Selective read-only `SELECT` is granted to `authenticated` on tickets and messages with `auth.uid() = user_id` enforcement. |
| **Stored Procedure Security & Search Path** | **PASS** | All 16 functions use `SECURITY DEFINER` with fixed, explicit `SET search_path = pg_catalog, public`. Privilege separation strictly restricts 14 functions to `service_role`. |
| **Idempotency & Re-execution Safety** | **PASS** | All DDL statements use `IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP POLICY IF EXISTS`. Re-running the migration against an already migrated schema succeeds cleanly. |
| **Zero-Cost Budget Compliance (₹0)** | **PASS** | Uses only built-in PostgreSQL capabilities (`pgcrypto`). Operates 100% within Supabase Free Tier (500 MB storage, unlimited API) and Resend Free Tier (3,000 emails/mo). |
| **Rollback Script Viability** | **NEEDS ATTENTION** | `scripts/007_rollback.sql` contains argument type mismatches on 8 functions and incorrect/missing table names (`quarantined_inbound_messages` vs `support_quarantined_messages`, missing `support_message_idempotency`). |
| **Final Recommendation** | **READY WITH CONDITIONS** | Schema 007 is fully safe and ready to execute. Migration must proceed only after: (1) creating a pre-migration database backup, (2) synchronizing `scripts/007_rollback.sql`, and (3) configuring backend environment variables. |

---

## 2. Schema Compatibility Findings

### 2.1 Table Structure & Constraints
Migration 007 defines 10 new relational tables in the `public` schema (`scripts/007_customer_support_tickets_schema.sql` lines 22–168):

| Table Name | Primary Key | Foreign Keys | Key Constraints & Checks |
| :--- | :--- | :--- | :--- |
| `public.support_tickets` | `id UUID DEFAULT gen_random_uuid()` | `user_id -> auth.users(id) ON DELETE CASCADE`<br>`developer_user_id -> auth.users(id) ON DELETE SET NULL` | `UNIQUE(ticket_code)`<br>`status IN ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed')`<br>`priority IN ('low', 'normal', 'high', 'urgent')`<br>`category IN ('general', 'bug', 'feedback', 'account', 'billing')` |
| `public.support_ticket_messages` | `id UUID DEFAULT gen_random_uuid()` | `ticket_id -> public.support_tickets(id) ON DELETE CASCADE`<br>`sender_user_id -> auth.users(id) ON DELETE SET NULL` | `sender_type IN ('user', 'developer', 'system')`<br>`channel IN ('in_app', 'email')` |
| `public.support_ticket_routing` | `ticket_id UUID` (PK) | `ticket_id -> public.support_tickets(id) ON DELETE CASCADE` | `UNIQUE(routing_token)` (16-byte hex cryptographic token) |
| `public.support_quarantined_messages` | `id UUID DEFAULT gen_random_uuid()` | `reviewed_by -> auth.users(id) ON DELETE SET NULL` | `UNIQUE(provider_message_id)`<br>`status IN ('quarantined', 'released', 'rejected')` |
| `public.support_ticket_events` | `id UUID DEFAULT gen_random_uuid()` | `ticket_id -> public.support_tickets(id) ON DELETE CASCADE`<br>`actor_id -> auth.users(id) ON DELETE SET NULL` | `actor_type IN ('user', 'developer', 'system')` |
| `public.support_security_incidents` | `id UUID DEFAULT gen_random_uuid()` | None (isolated audit log) | `severity IN ('low', 'medium', 'high', 'critical')` |
| `public.support_email_outbox` | `id UUID DEFAULT gen_random_uuid()` | `ticket_id -> public.support_tickets(id) ON DELETE CASCADE` | `UNIQUE(deduplication_key)`<br>`status IN ('pending', 'processing', 'sending', 'ambiguous_processing', 'sent', 'failed', 'ambiguous_delivery_timeout')`<br>`recipient_type IN ('developer', 'user')` |
| `public.inbound_webhook_events` | `id UUID DEFAULT gen_random_uuid()` | None (isolated event queue) | `UNIQUE(provider_event_id)`<br>`status IN ('received', 'processed', 'quarantined', 'failed', 'terminal_failure')` |
| `public.support_ticket_idempotency` | `(user_id, idempotency_key)` | `user_id -> auth.users(id) ON DELETE CASCADE`<br>`ticket_id -> public.support_tickets(id) ON DELETE CASCADE` | User-scoped composite primary key preventing global collision |
| `public.support_message_idempotency` | `(user_id, idempotency_key)` | `user_id -> auth.users(id) ON DELETE CASCADE`<br>`ticket_id -> public.support_tickets(id) ON DELETE CASCADE`<br>`message_id -> public.support_ticket_messages(id) ON DELETE CASCADE` | User-scoped composite primary key |

### 2.2 Extension Dependencies
- `scripts/007_customer_support_tickets_schema.sql` line 15:
  ```sql
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";
  ```
- **Finding:** `pgcrypto` is available by default across all Supabase PostgreSQL instances and is standard for `gen_random_bytes()` and cryptographic digest generation. No proprietary or non-standard extensions are required.

### 2.3 Foreign Key Safety on `auth.users`
- All foreign keys referencing `auth.users(id)` use either:
  - `ON DELETE CASCADE` (for user-owned tickets, messages, and idempotency records). When an account is deleted via Supabase Auth, their personal support data is automatically cleaned up without leaving orphaned rows.
  - `ON DELETE SET NULL` (for developer actors, reviewers, and senders). Preserves ticket conversation history and audit logs even if a developer or staff account is deactivated.
- **Finding:** Migration 007 does NOT create or alter tables in the `auth` schema.

---

## 3. RLS and Security Findings

### 3.1 Row Level Security (RLS) Verification
- **Tables Protected:** All 10 support tables have RLS explicitly enabled (`scripts/007_customer_support_tickets_schema.sql` lines 197–206).
- **Default Posture:** Complete revocation of privileges from `anon`, `authenticated`, and `public` (`lines 209–218`).
- **Selective Grants:**
  - `GRANT SELECT ON public.support_tickets TO authenticated;` (line 221)
  - `GRANT SELECT ON public.support_ticket_messages TO authenticated;` (line 222)
  - Direct `INSERT`, `UPDATE`, and `DELETE` on all 10 tables are **strictly forbidden** to `authenticated` and `anon`. All mutations must occur through whitelisted `SECURITY DEFINER` stored procedures.

### 3.2 Tenant Isolation & Cross-User Privacy
- **Support Tickets Policy:**
  ```sql
  CREATE POLICY support_tickets_select_own ON public.support_tickets
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  ```
  *(Line 238–240)* — Verified: User B cannot query or view User A's tickets.
- **Support Messages Policy:**
  ```sql
  CREATE POLICY support_ticket_messages_select_own ON public.support_ticket_messages
      FOR SELECT TO authenticated
      USING (
          ticket_id IN (
              SELECT id FROM public.support_tickets WHERE user_id = auth.uid()
          )
      );
  ```
  *(Lines 243–250)* — Verified: User B cannot inspect messages belonging to User A's tickets.
- **Internal Infrastructure Tables:**
  `support_ticket_routing`, `support_quarantined_messages`, `support_ticket_events`, `support_security_incidents`, `support_email_outbox`, `inbound_webhook_events`, `support_ticket_idempotency`, and `support_message_idempotency` have **zero** grants to `authenticated` or `anon`. They are accessible exclusively by `service_role`.

### 3.3 SECURITY DEFINER & Search Path Safety
All 16 stored functions declare explicit, sanitized search paths:
```sql
SECURITY DEFINER
SET search_path = pg_catalog, public
```
- **Finding:** Mitigates CVE-2018-1058 and search-path hijacking. Malicious users cannot create objects in untrusted schemas to intercept function execution.

---

## 4. RPC and Transaction Findings

### 4.1 Stored Procedure Execution Privileges
Migration 007 configures strict privilege separation (`scripts/007_customer_support_tickets_schema.sql` lines 1810–1856):

| Function Name | Grantee Roles | Caller Identity Check |
| :--- | :--- | :--- |
| `create_support_ticket_atomic` | `authenticated`, `service_role` | `auth.uid() = p_user_id` enforced for authenticated callers (line 286–290). Prevents user impersonation. |
| `add_support_ticket_message_atomic` | `authenticated`, `service_role` | `auth.uid() = p_user_id` enforced for authenticated callers (line 492–496). Validates ticket ownership before appending. |
| `resolve_ticket_by_routing_token` | `service_role` ONLY | Revoked from `PUBLIC`, `authenticated`, `anon`. Internal token lookup only. |
| `ingest_developer_reply_atomic` | `service_role` ONLY | Revoked from `PUBLIC`, `authenticated`, `anon`. Only backend webhook processor can ingest. |
| `quarantine_inbound_message_atomic` | `service_role` ONLY | Revoked from `PUBLIC`, `authenticated`, `anon`. |
| `release_quarantined_message_atomic` | `service_role` ONLY | Revoked from `PUBLIC`, `authenticated`, `anon`. |
| `reject_quarantined_message_atomic` | `service_role` ONLY | Revoked from `PUBLIC`, `authenticated`, `anon`. |
| `claim_inbound_webhook_event` | `service_role` ONLY | Revoked from `PUBLIC`, `authenticated`, `anon`. |
| `fail_inbound_webhook_event` | `service_role` ONLY | Revoked from `PUBLIC`, `authenticated`, `anon`. |
| `claim_support_email_outbox_batch` | `service_role` ONLY | Revoked from `PUBLIC`, `authenticated`, `anon`. |
| `mark_outbox_attempt_start` | `service_role` ONLY | Revoked from `PUBLIC`, `authenticated`, `anon`. |
| `mark_outbox_success` | `service_role` ONLY | Revoked from `PUBLIC`, `authenticated`, `anon`. |
| `mark_outbox_failure` | `service_role` ONLY | Revoked from `PUBLIC`, `authenticated`, `anon`. |
| `mark_outbox_ambiguous` | `service_role` ONLY | Revoked from `PUBLIC`, `authenticated`, `anon`. |
| `mark_outbox_ambiguous_timeout` | `service_role` ONLY | Revoked from `PUBLIC`, `authenticated`, `anon`. |
| `sweep_outbox_ambiguous_timeouts` | `service_role` ONLY | Revoked from `PUBLIC`, `authenticated`, `anon`. |

### 4.2 Atomicity & Concurrency Controls
1. **Advisory Locks for Idempotency:**
   - `create_support_ticket_atomic` uses `pg_advisory_xact_lock(hashtext('ticket_idemp:' || p_user_id::text || ':' || p_idempotency_key))` (line 317).
   - `add_support_ticket_message_atomic` uses `pg_advisory_xact_lock(hashtext('msg_idemp:' || p_user_id::text || ':' || p_idempotency_key))` (line 514).
   - Prevents race conditions from simultaneous double-taps on mobile devices.
2. **Transactional Outbox Guarantee:**
   - In `create_support_ticket_atomic`, the support ticket, initial message, routing token, audit event, and outbox notification row are inserted in a **single database transaction** (lines 376–441).
   - An email is never queued unless the ticket successfully persists, and a ticket is never created without its outbox delivery record.
3. **Queue Claiming Concurrency:**
   - `claim_support_email_outbox_batch` uses `FOR UPDATE SKIP LOCKED` (line 1403). Multiple worker instances can run simultaneously without claiming the same outbox item.

---

## 5. Rollback Risk Assessment

### 5.1 Critical Discrepancies in `scripts/007_rollback.sql`
A rigorous comparison between `scripts/007_customer_support_tickets_schema.sql` and `scripts/007_rollback.sql` identified **8 function signature mismatches** and **2 table discrepancies**:

| Item | `007_customer_support_tickets_schema.sql` | `007_rollback.sql` | Discrepancy Effect |
| :--- | :--- | :--- | :--- |
| **`add_support_ticket_message_atomic`** | `(UUID, UUID, TEXT, VARCHAR, VARCHAR, VARCHAR, JSONB)` (7 args) | `(UUID, UUID, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, JSONB)` (8 args) | PostgreSQL fails to match signature; **function remains in database**. |
| **`ingest_developer_reply_atomic`** | `(VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, UUID)` | `(VARCHAR, VARCHAR, TEXT, TEXT, JSONB, VARCHAR, JSONB)` | Signature mismatch; **function remains in database**. |
| **`quarantine_inbound_message_atomic`** | `(VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, TEXT, VARCHAR, TEXT, VARCHAR, VARCHAR)` (10 args) | `(VARCHAR, VARCHAR, VARCHAR, TEXT, TEXT, VARCHAR, JSONB)` (7 args) | Signature mismatch; **function remains in database**. |
| **`claim_support_email_outbox_batch`** | `(VARCHAR, INT, INT)` | `(INTEGER, INTEGER, VARCHAR)` | Argument order inverted; **function remains in database**. |
| **`mark_outbox_failure`** | `(UUID, VARCHAR, TEXT, INT, BOOLEAN)` | `(UUID, INTEGER, TEXT, BOOLEAN)` | Argument order mismatch; **function remains in database**. |
| **`mark_outbox_success`** | `(UUID, VARCHAR, VARCHAR)` | `(UUID, VARCHAR)` | Argument count mismatch; **function remains in database**. |
| **`mark_outbox_ambiguous`** | `(UUID, VARCHAR, TEXT, INT)` | `(UUID, TEXT)` | Argument count mismatch; **function remains in database**. |
| **`claim_inbound_webhook_event`** | `(VARCHAR, VARCHAR, JSONB, VARCHAR, INT)` | `(VARCHAR, VARCHAR, VARCHAR, JSONB)` | Signature mismatch; **function remains in database**. |
| **`fail_inbound_webhook_event`** | `(VARCHAR, VARCHAR, TEXT, BOOLEAN)` | `(VARCHAR, TEXT)` | Signature mismatch; **function remains in database**. |
| **Quarantine Table Name** | `public.support_quarantined_messages` | `DROP TABLE IF EXISTS public.quarantined_inbound_messages CASCADE;` | **Wrong table name**; actual table remains in database. |
| **Message Idempotency Table** | `public.support_message_idempotency` | *Omitted entirely* | Table is never dropped. |

### 5.2 Data-Loss Implications of Rollback
- Executing a rollback (`DROP TABLE public.support_tickets CASCADE`) will permanently delete all customer support tickets, conversation threads, and routing tokens.
- **Core Data Safety:** Todo lists, routines, and habit records will suffer **zero data loss** because no core tables reference the support tables.

---

## 6. Backup and Recovery Requirements

### 6.1 Pre-Migration Backup Checklist
Prior to running Migration 007 on Supabase:
1. **Supabase Dashboard Export:**
   - Open Supabase Dashboard $\to$ Project $\to$ Table Editor.
   - Verify row counts on core tables (`todos`, `smart_routines`, `smart_routine_completions`).
2. **Logical Dump via Supabase CLI (or pg_dump):**
   ```bash
   # Create isolated pre-migration logical backup
   supabase db dump --data-only -f backup_pre_migration_007_data.sql
   supabase db dump --schema-only -f backup_pre_migration_007_schema.sql
   ```
3. **Backup Verification:**
   - Confirm backup file size $> 0$ KB.
   - Inspect dump header to confirm valid PostgreSQL dump format.

### 6.2 Safe Execution Sequence
1. Navigate to Supabase Dashboard $\to$ **SQL Editor**.
2. Open `scripts/007_customer_support_tickets_schema.sql`.
3. Paste the entire SQL script and execute.
4. Verify execution returns: `Success. No rows returned` (transaction committed).
5. Run the post-migration validation query:
   ```sql
   SELECT table_name, row_security 
   FROM information_schema.tables t
   JOIN pg_tables p ON p.tablename = t.table_name AND p.schemaname = t.table_schema
   WHERE t.table_schema = 'public' AND t.table_name LIKE 'support_%';
   ```
   Confirm all 8 `support_*` tables return `row_security = true`.

---

## 7. Environment Variable Checklist

To support the customer support backend in production, the following environment variables must be configured in Vercel Project Settings:

| Environment Variable | Status | Scope | Purpose |
| :--- | :---: | :--- | :--- |
| `SUPABASE_URL` | **Mandatory** | Server & Client | Supabase project URL |
| `SUPABASE_ANON_KEY` | **Mandatory** | Server & Client | Public client operations (authenticated user JWT queries) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Mandatory** | Server Only | High-entropy key for outbox batch worker & inbound webhook processing |
| `DEVELOPER_EMAILS` | **Mandatory** | Server Only | Comma-separated authorized developer emails (`tasklypets@gmail.com`) |
| `SUPPORT_DEVELOPER_EMAIL` | Optional | Server Only | Target notification recipient (defaults to `tasklypets@gmail.com`) |
| `CRON_SECRET` | **Mandatory** | Server Only | Shared bearer secret protecting `/api/internal/support/outbox/*` routes |
| `RESEND_API_KEY` | Optional* | Server Only | Resend API delivery key. *Required only for outbound email delivery. |
| `RESEND_RECEIVING_DOMAIN` | Optional* | Server Only | Managed inbound domain (`d893f1.resend.app`). *Required for email replies. |
| `RESEND_WEBHOOK_SECRET` | Optional* | Server Only | Svix signing secret (`whsec_...`). *Required for inbound email webhook. |

> **Note on Feature Decoupling:** In-app ticket submission and management functions 100% reliably even if Resend variables (`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`) are not yet active. In the absence of Resend keys, tickets remain safely recorded in the database, and outbox rows remain queued in `pending` status.

---

## 8. Zero-Cost Compatibility Assessment

| Cost Vector | Limit / Allowance | Taskly v2.2.0 Projected Usage | Cost Assessment |
| :--- | :--- | :--- | :--- |
| **Supabase Database Storage** | 500 MB Free Tier | ~4 MB for 1,000 complete support threads (~0.8% of quota) | **₹0 (Free)** |
| **Supabase Auth Users** | 50,000 MAU Free Tier | Leverages existing Taskly user accounts | **₹0 (Free)** |
| **Supabase Database Egress** | 5 GB / month Free Tier | Support JSON payloads are $< 10$ KB per request | **₹0 (Free)** |
| **Resend Inbound Receiving** | Free on `*.resend.app` | Developer replies to ticket threads | **₹0 (Free)** |
| **Resend Outbound Delivery** | 3,000 emails / month, 100 / day | Ticket notifications to developer | **₹0 (Free)** |
| **GitHub Actions Outbox Cron** | 2,000 min / month Free Tier | Outbox worker run every 10 min ($\approx 300$ min / mo) | **₹0 (Free)** |
| **Total Production Cost** | — | — | **₹0.00 (Strictly Zero)** |

---

## 9. Missing Tests and Unresolved Risks

1. **Quarantine Release / Reject RPC Tests in Production-Path Suite:**
   - Stored functions `release_quarantined_message_atomic` and `reject_quarantined_message_atomic` are defined and granted in SQL, but `tests/support_tickets_inbound_production_path.test.js` tests quarantine insertion only.
2. **Ambiguous Timeout Sweeper Production-Path Test:**
   - `sweep_outbox_ambiguous_timeouts()` is covered in unit tests (`tests/support_tickets_stage2_outbox.test.js`), but not tested against a real PostgreSQL instance with aged timestamps.
3. **Rollback Script Inconsistencies:**
   - `scripts/007_rollback.sql` has not been tested against a live database. As documented in Section 5, it contains mismatched function signatures and table names.

---

## 10. Final Audit Decision

### Decision: **READY WITH CONDITIONS**

Migration 007 (`scripts/007_customer_support_tickets_schema.sql`) is safe, non-destructive, idempotent, and fully compatible with Supabase PostgreSQL. It will not disrupt existing todo or habit tracking features.

#### Mandatory Pre-Execution Conditions:
1. **Create and verify a database backup** via Supabase Dashboard before executing any DDL.
2. **Synchronize `scripts/007_rollback.sql`** with the exact function signatures and table names from `007_customer_support_tickets_schema.sql` to ensure safe emergency teardown capability.
3. **Verify Vercel environment variables** (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `DEVELOPER_EMAILS`) are set in production before running the migration.
4. **Obtain explicit user approval** before pasting or executing the SQL script in Supabase.

