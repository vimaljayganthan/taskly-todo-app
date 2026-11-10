-- ==============================================================================
-- TASKLY MIGRATION 007 ROLLBACK SCRIPT (SAFE TEARDOWN)
-- Version: 2.2.0 (Build 14)
-- Removes customer support schema while preserving all core todo & habit data
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

