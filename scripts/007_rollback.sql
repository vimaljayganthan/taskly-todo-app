-- ==============================================================================
-- TASKLY MIGRATION 007 ROLLBACK SCRIPT (SAFE TEARDOWN)
-- Version: 2.2.0 (Build 14)
-- Removes customer support schema while preserving all core todo & habit data
-- ==============================================================================
--
-- Notice:
--   NEVER EXECUTE AGAINST PRODUCTION WITHOUT EXPLICIT SEPARATE AUTHORIZATION.
--   This script is safe, idempotent, and transaction-wrapped.
-- ==============================================================================

BEGIN;

-- 1. Drop Stored Functions (Exact PostgreSQL Signatures matching Migration 007)
DROP FUNCTION IF EXISTS public.create_support_ticket_atomic(UUID, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB);
DROP FUNCTION IF EXISTS public.add_support_ticket_message_atomic(UUID, UUID, TEXT, VARCHAR, VARCHAR, VARCHAR, JSONB);
DROP FUNCTION IF EXISTS public.resolve_ticket_by_routing_token(VARCHAR);
DROP FUNCTION IF EXISTS public.ingest_developer_reply_atomic(VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, UUID);
DROP FUNCTION IF EXISTS public.quarantine_inbound_message_atomic(VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, TEXT, VARCHAR, TEXT, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS public.release_quarantined_message_atomic(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.reject_quarantined_message_atomic(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.claim_inbound_webhook_event(VARCHAR, VARCHAR, JSONB, VARCHAR, INT);
DROP FUNCTION IF EXISTS public.fail_inbound_webhook_event(VARCHAR, VARCHAR, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.claim_support_email_outbox_batch(VARCHAR, INT, INT);
DROP FUNCTION IF EXISTS public.mark_outbox_attempt_start(UUID, VARCHAR);
DROP FUNCTION IF EXISTS public.mark_outbox_success(UUID, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS public.mark_outbox_failure(UUID, VARCHAR, TEXT, INT, BOOLEAN);
DROP FUNCTION IF EXISTS public.mark_outbox_ambiguous(UUID, VARCHAR, TEXT, INT);
DROP FUNCTION IF EXISTS public.mark_outbox_ambiguous_timeout(UUID, VARCHAR);
DROP FUNCTION IF EXISTS public.sweep_outbox_ambiguous_timeouts();

-- 2. Drop Support Tables (Exact 10 Migration 007 Tables in Reverse Dependency Order)
-- Cascade drops all associated indexes, foreign keys, check constraints, and RLS policies
DROP TABLE IF EXISTS public.support_message_idempotency CASCADE;
DROP TABLE IF EXISTS public.support_ticket_idempotency CASCADE;
DROP TABLE IF EXISTS public.support_email_outbox CASCADE;
DROP TABLE IF EXISTS public.inbound_webhook_events CASCADE;
DROP TABLE IF EXISTS public.support_quarantined_messages CASCADE;
DROP TABLE IF EXISTS public.support_security_incidents CASCADE;
DROP TABLE IF EXISTS public.support_ticket_events CASCADE;
DROP TABLE IF EXISTS public.support_ticket_routing CASCADE;
DROP TABLE IF EXISTS public.support_ticket_messages CASCADE;
DROP TABLE IF EXISTS public.support_tickets CASCADE;

COMMIT;
