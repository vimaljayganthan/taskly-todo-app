# Taskly v2.2.0 (Build 14) — Zero-Cost Rollback Plan

This document establishes the step-by-step procedures to revert any component of the Taskly v2.2.0 (Build 14) system in the event of production regressions, service degradations, or third-party outages, without incurring any financial expense (**₹0**).

---

## 1. Rollback Matrix by Component

| System Layer | Primary Failure Mode | Rollback Procedure | Estimated Recovery Time | Financial Cost |
|---|---|---|:---:|:---:|
| **Frontend & API (Vercel)** | UI bug, unexpected serverless crash, or routing error | 1-Click Instant Rollback via Vercel Dashboard to previous deployment hash | $< 30\text{ seconds}$ | **₹0.00** |
| **Database Schema (Supabase)** | SQL function error or table constraint mismatch | Execute `scripts/007_rollback.sql` via Supabase SQL Editor | $< 2\text{ minutes}$ | **₹0.00** |
| **Database Pausing (Supabase)** | Project paused due to 7 days of inactivity | Click "Restore Project" in Supabase Dashboard | $< 90\text{ seconds}$ | **₹0.00** |
| **Email Delivery (Resend)** | Resend API outage, key revocation, or quota exhausted | Toggle in-app-only mode or rely on Customer Support Hub | Instant (Automatic) | **₹0.00** |
| **Background Automation (GitHub Actions)** | Workflow runner failure or GitHub incident | Disable workflow in GitHub Actions tab; trigger outbox manually | $< 1\text{ minute}$ | **₹0.00** |

---

## 2. Component-Specific Rollback Procedures

### 2.1 Vercel Frontend & Serverless Rollback (Instant 1-Click)
Vercel retains previous immutable deployment builds indefinitely on the Hobby plan at ₹0.

**Execution Steps**:
1. Navigate to [vercel.com/dashboard](https://vercel.com/dashboard) $\to$ Select project `taskly-todo-app`.
2. Click the **Deployments** tab.
3. Locate the previous stable production deployment (e.g. `v2.1.1` Build 12.1).
4. Click the three dots menu (`...`) $\to$ Select **Instant Rollback**.
5. Confirm the action.
6. **Result**: Vercel instantly routes 100% of production traffic back to the prior deployment snapshot with zero downtime.

---

### 2.2 Supabase Database Migration 007 Teardown Script
If Migration 007 needs to be removed without affecting core Taskly tables (`todos`, `smart_lists`, `smart_routines`, `habit_streaks`), execute the following idempotent rollback script in the Supabase SQL Editor:

```sql
-- ==============================================================================
-- TASKLY MIGRATION 007 ROLLBACK SCRIPT (SAFE TEARDOWN)
-- Removes customer support system while preserving all core todo and habit data
-- ==============================================================================

BEGIN;

-- 1. Drop Stored Functions
DROP FUNCTION IF EXISTS public.create_support_ticket_atomic(UUID, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB);
DROP FUNCTION IF EXISTS public.add_support_ticket_message_atomic(UUID, UUID, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, JSONB);
DROP FUNCTION IF EXISTS public.resolve_ticket_by_routing_token(VARCHAR);
DROP FUNCTION IF EXISTS public.ingest_developer_reply_atomic(VARCHAR, VARCHAR, TEXT, TEXT, JSONB, VARCHAR, JSONB);
DROP FUNCTION IF EXISTS public.quarantine_inbound_message_atomic(VARCHAR, VARCHAR, VARCHAR, TEXT, TEXT, VARCHAR, JSONB);
DROP FUNCTION IF EXISTS public.release_quarantined_message_atomic(UUID, UUID);
DROP FUNCTION IF EXISTS public.reject_quarantined_message_atomic(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.claim_inbound_webhook_event(VARCHAR, VARCHAR, VARCHAR, JSONB);
DROP FUNCTION IF EXISTS public.fail_inbound_webhook_event(VARCHAR, TEXT);
DROP FUNCTION IF EXISTS public.claim_support_email_outbox_batch(INTEGER, INTEGER, VARCHAR);
DROP FUNCTION IF EXISTS public.mark_outbox_attempt_start(UUID, VARCHAR);
DROP FUNCTION IF EXISTS public.mark_outbox_success(UUID, VARCHAR);
DROP FUNCTION IF EXISTS public.mark_outbox_failure(UUID, INTEGER, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.mark_outbox_ambiguous(UUID, TEXT);
DROP FUNCTION IF EXISTS public.mark_outbox_ambiguous_timeout(UUID, TEXT);
DROP FUNCTION IF EXISTS public.sweep_outbox_ambiguous_timeouts();

-- 2. Drop Support Tables (Cascade drops related indexes, triggers, and foreign keys)
DROP TABLE IF EXISTS public.support_security_incidents CASCADE;
DROP TABLE IF EXISTS public.quarantined_inbound_messages CASCADE;
DROP TABLE IF EXISTS public.inbound_webhook_events CASCADE;
DROP TABLE IF EXISTS public.support_outbox_attempts CASCADE;
DROP TABLE IF EXISTS public.support_email_outbox CASCADE;
DROP TABLE IF EXISTS public.support_ticket_idempotency CASCADE;
DROP TABLE IF EXISTS public.support_ticket_events CASCADE;
DROP TABLE IF EXISTS public.support_ticket_routing CASCADE;
DROP TABLE IF EXISTS public.support_ticket_messages CASCADE;
DROP TABLE IF EXISTS public.support_tickets CASCADE;

COMMIT;
```

---

### 2.3 Free-Tier Local Database Backup & Restore Procedure
Because automated daily backups are a paid feature on Supabase Pro ($25/mo), the following zero-cost backup and restore commands must be used:

#### Zero-Cost Database Backup:
```bash
# Export complete schema and data to local compressed SQL file
pg_dump -h db.<PROJECT_REF>.supabase.co -U postgres -d postgres \
  --clean --if-exists --quote-all-identifiers \
  | gzip > taskly_db_backup_$(date +%Y%m%d_%H%M%S).sql.gz
```

#### Zero-Cost Database Restore:
```bash
# Restore local backup to Supabase PostgreSQL instance
gunzip -c taskly_db_backup_<TIMESTAMP>.sql.gz | psql -h db.<PROJECT_REF>.supabase.co -U postgres -d postgres
```

---

### 2.4 Resend Email Failure / Quota Exhaustion Rollback
If Resend is unavailable or reaches the 100 emails/day free limit:
1. **Zero Customer Impact**: Customers continue to create tickets and communicate through the app.
2. **Outbox Durability**: Outbox rows remain in status `pending` with exponential backoff delay.
3. **Developer In-App Workaround**: The support developer logs into the Taskly Web UI or Android app with `tasklypets@gmail.com` and views/responds to all tickets directly via the **Developer Support Dashboard**.
4. **No Code Change Required**: The system gracefully falls back to in-app messaging without requiring a software deployment.

---

### 2.5 Git Working Tree Rollback
If local changes need to be reverted back to the verified baseline commit `4afa53d4c5e5fd68b55c87a0980dab49768e3272` (Tag: `v2.1.1`):
```bash
# Discard working tree modifications to existing files
git restore public/app.js public/index.html public/styles.css server.js

# Clean untracked support files (if full rollback is desired)
git clean -fd services/ storage/supportStore.js config/ scripts/007* tests/support_tickets*
```

