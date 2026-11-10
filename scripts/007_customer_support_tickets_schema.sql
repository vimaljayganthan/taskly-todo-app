-- ==============================================================================
-- Taskly - Production Database Migration: Customer Support Tickets Schema
-- File: scripts/007_customer_support_tickets_schema.sql
-- ==============================================================================
-- Target: Supabase PostgreSQL (PostgreSQL 15+)
-- Feature: Taskly v2.2.0 Build 14 - Customer Support & Ticket Management Foundation
--
-- Notice:
--   DO NOT EXECUTE WITHOUT EXPLICIT SEPARATE USER AUTHORIZATION.
--   This script is safe, idempotent, and transaction-wrapped.
-- ==============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. Table Definitions
-- ============================================================================

-- 1.1 Support Tickets Table
CREATE TABLE IF NOT EXISTS public.support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_code VARCHAR(32) NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    user_email VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed')),
    priority VARCHAR(16) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    category VARCHAR(32) NOT NULL DEFAULT 'general' CHECK (category IN ('general', 'bug', 'feedback', 'account', 'billing')),
    developer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.2 Support Ticket Messages Table
CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
    sender_type VARCHAR(16) NOT NULL CHECK (sender_type IN ('user', 'developer', 'system')),
    sender_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    sender_email VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    channel VARCHAR(16) NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'email')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    inbound_provider_message_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.3 Support Ticket Routing Table (Isolated Internal Reply Tokens)
CREATE TABLE IF NOT EXISTS public.support_ticket_routing (
    ticket_id UUID PRIMARY KEY REFERENCES public.support_tickets(id) ON DELETE CASCADE,
    routing_token VARCHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.4 Support Quarantined Messages Table (Manual Developer Review Queue)
CREATE TABLE IF NOT EXISTS public.support_quarantined_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_message_id VARCHAR(255) NOT NULL UNIQUE,
    routing_token VARCHAR(64),
    sender_email VARCHAR(255) NOT NULL,
    subject VARCHAR(255),
    raw_headers JSONB NOT NULL DEFAULT '{}'::JSONB,
    raw_body TEXT NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    quarantine_reason TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'quarantined' CHECK (status IN ('quarantined', 'released', 'rejected')),
    reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    reviewer_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.5 Support Ticket Events Table (Durable Audit)
CREATE TABLE IF NOT EXISTS public.support_ticket_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
    event_type VARCHAR(64) NOT NULL,
    actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_type VARCHAR(16) NOT NULL CHECK (actor_type IN ('user', 'developer', 'system')),
    old_state JSONB,
    new_state JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.6 Support Security Incidents Table (Durable Non-Aborting Security Audit)
CREATE TABLE IF NOT EXISTS public.support_security_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_type VARCHAR(64) NOT NULL,
    severity VARCHAR(16) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    target_identifier VARCHAR(255) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.7 Support Email Outbox Table
CREATE TABLE IF NOT EXISTS public.support_email_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
    recipient_email VARCHAR(255) NOT NULL,
    recipient_type VARCHAR(16) NOT NULL CHECK (recipient_type IN ('developer', 'user')),
    reply_to_address VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT NOT NULL,
    deduplication_key VARCHAR(128) NOT NULL UNIQUE,
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 
        'processing', 
        'sending', 
        'ambiguous_processing', 
        'sent', 
        'failed', 
        'ambiguous_delivery_timeout'
    )),
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 5,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    first_attempt_started_at TIMESTAMPTZ,
    last_attempt_started_at TIMESTAMPTZ,
    locked_by VARCHAR(64),
    locked_until TIMESTAMPTZ,
    last_error TEXT,
    outbox_provider_message_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.8 Inbound Webhook Events Table
CREATE TABLE IF NOT EXISTS public.inbound_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_event_id VARCHAR(255) NOT NULL UNIQUE,
    event_type VARCHAR(64) NOT NULL,
    payload_preview JSONB NOT NULL DEFAULT '{}'::JSONB,
    status VARCHAR(32) NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'quarantined', 'failed', 'terminal_failure')),
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 3,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_by VARCHAR(64),
    locked_until TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.9 Ticket Creation Idempotency Table (Scoped to User)
CREATE TABLE IF NOT EXISTS public.support_ticket_idempotency (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(128) NOT NULL,
    ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
    request_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, idempotency_key)
);

-- 1.10 Ticket Message Submission Idempotency Table (Scoped to User)
CREATE TABLE IF NOT EXISTS public.support_message_idempotency (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(128) NOT NULL,
    ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES public.support_ticket_messages(id) ON DELETE CASCADE,
    request_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, idempotency_key)
);

-- ============================================================================
-- 2. Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON public.support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_last_message ON public.support_tickets(last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket_id ON public.support_ticket_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_created_at ON public.support_ticket_messages(created_at ASC);

CREATE INDEX IF NOT EXISTS idx_support_quarantined_status ON public.support_quarantined_messages(status);
CREATE INDEX IF NOT EXISTS idx_support_quarantined_created ON public.support_quarantined_messages(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_outbox_claim ON public.support_email_outbox(status, next_attempt_at) 
    WHERE status IN ('pending', 'processing', 'sending', 'ambiguous_processing');

CREATE INDEX IF NOT EXISTS idx_support_webhook_claim ON public.inbound_webhook_events(status, next_attempt_at)
    WHERE status IN ('received', 'failed');

CREATE INDEX IF NOT EXISTS idx_support_security_incidents_target ON public.support_security_incidents(target_identifier);

-- ============================================================================
-- 3. Row Level Security (RLS) & Targeted Table Permissions
-- ============================================================================

-- Enable RLS strictly on the 10 support tables
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_routing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_quarantined_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_security_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_message_idempotency ENABLE ROW LEVEL SECURITY;

-- Explicitly revoke all privileges from untrusted roles on the 10 support tables ONLY
REVOKE ALL ON TABLE public.support_tickets FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.support_ticket_messages FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.support_ticket_routing FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.support_quarantined_messages FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.support_ticket_events FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.support_security_incidents FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.support_email_outbox FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.inbound_webhook_events FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.support_ticket_idempotency FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.support_message_idempotency FROM anon, authenticated, public;

-- Grant selective read-only SELECT permissions to authenticated users on customer-facing tables ONLY
GRANT SELECT ON TABLE public.support_tickets TO authenticated;
GRANT SELECT ON TABLE public.support_ticket_messages TO authenticated;

-- Grant full management privileges to service_role on the 10 support tables ONLY
GRANT ALL ON TABLE public.support_tickets TO service_role;
GRANT ALL ON TABLE public.support_ticket_messages TO service_role;
GRANT ALL ON TABLE public.support_ticket_routing TO service_role;
GRANT ALL ON TABLE public.support_quarantined_messages TO service_role;
GRANT ALL ON TABLE public.support_ticket_events TO service_role;
GRANT ALL ON TABLE public.support_security_incidents TO service_role;
GRANT ALL ON TABLE public.support_email_outbox TO service_role;
GRANT ALL ON TABLE public.inbound_webhook_events TO service_role;
GRANT ALL ON TABLE public.support_ticket_idempotency TO service_role;
GRANT ALL ON TABLE public.support_message_idempotency TO service_role;

-- RLS Policy: Authenticated users can view ONLY their own tickets (Idempotent)
DROP POLICY IF EXISTS support_tickets_select_own ON public.support_tickets;
CREATE POLICY support_tickets_select_own ON public.support_tickets
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

-- RLS Policy: Authenticated users can view ONLY messages in their own tickets (Idempotent)
DROP POLICY IF EXISTS support_ticket_messages_select_own ON public.support_ticket_messages;
CREATE POLICY support_ticket_messages_select_own ON public.support_ticket_messages
    FOR SELECT TO authenticated
    USING (
        ticket_id IN (
            SELECT id FROM public.support_tickets WHERE user_id = auth.uid()
        )
    );

-- ============================================================================
-- 4. Stored Procedures (SECURITY DEFINER with Fixed Search Path)
-- ============================================================================

-- Procedure 1: Create Support Ticket Atomic (Whitelisted Public Projection)
CREATE OR REPLACE FUNCTION public.create_support_ticket_atomic(
    p_user_id UUID,
    p_user_email VARCHAR,
    p_subject VARCHAR,
    p_body TEXT,
    p_priority VARCHAR DEFAULT 'normal',
    p_category VARCHAR DEFAULT 'general',
    p_idempotency_key VARCHAR DEFAULT NULL,
    p_request_hash VARCHAR DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_ticket_id UUID;
    v_message_id UUID;
    v_ticket_code VARCHAR(32);
    v_routing_token VARCHAR(64);
    v_existing_idemp RECORD;
    v_existing_ticket RECORD;
    v_priority VARCHAR(16);
    v_category VARCHAR(32);
    v_metadata JSONB;
    v_result JSONB;
BEGIN
    -- 1. Caller Authorization Check (prevents authenticated user from forging user ID)
    IF auth.role() = 'authenticated' AND auth.uid() IS NOT NULL THEN
        IF auth.uid() <> p_user_id THEN
            RAISE EXCEPTION 'Caller identity mismatch: cannot create ticket for another user' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- 2. Input Validation
    IF p_user_id IS NULL OR p_user_email IS NULL OR length(trim(p_user_email)) < 5 THEN
        RAISE EXCEPTION 'Invalid user credentials' USING ERRCODE = '22023';
    END IF;
    IF p_subject IS NULL OR length(trim(p_subject)) = 0 OR length(p_subject) > 255 THEN
        RAISE EXCEPTION 'Subject is required and must not exceed 255 characters' USING ERRCODE = '22023';
    END IF;
    IF p_body IS NULL OR length(trim(p_body)) = 0 OR length(p_body) > 10000 THEN
        RAISE EXCEPTION 'Message body is required and must not exceed 10000 characters' USING ERRCODE = '22023';
    END IF;

    v_priority := LOWER(COALESCE(p_priority, 'normal'));
    IF v_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
        v_priority := 'normal';
    END IF;

    v_category := LOWER(COALESCE(p_category, 'general'));
    IF v_category NOT IN ('general', 'bug', 'feedback', 'account', 'billing') THEN
        v_category := 'general';
    END IF;

    v_metadata := COALESCE(p_metadata, '{}'::jsonb);

    -- 3. Idempotency Check with Transaction-Scoped Advisory Lock
    IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
        PERFORM pg_advisory_xact_lock(hashtext('ticket_idemp:' || p_user_id::text || ':' || p_idempotency_key));

        SELECT * INTO v_existing_idemp
        FROM public.support_ticket_idempotency
        WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key
        FOR UPDATE;

        IF v_existing_idemp.ticket_id IS NOT NULL THEN
            IF v_existing_idemp.request_hash <> p_request_hash THEN
                INSERT INTO public.support_security_incidents (
                    incident_type, severity, target_identifier, details
                ) VALUES (
                    'idempotency_hash_mismatch', 'medium', p_idempotency_key,
                    jsonb_build_object(
                        'user_id', p_user_id,
                        'stored_hash', v_existing_idemp.request_hash,
                        'incoming_hash', p_request_hash
                    )
                );

                SELECT jsonb_build_object(
                    'success', false,
                    'error_code', 'IDEMPOTENCY_MISMATCH',
                    'error_message', 'Idempotency key reuse with mismatched request payload'
                ) INTO v_result;
                RETURN v_result;
            END IF;

            SELECT id, ticket_code, user_id, user_email, subject, status, priority, category, metadata, created_at, last_message_at
            INTO v_existing_ticket
            FROM public.support_tickets
            WHERE id = v_existing_idemp.ticket_id;

            SELECT jsonb_build_object(
                'success', true,
                'is_replay', true,
                'ticket', jsonb_build_object(
                    'id', v_existing_ticket.id,
                    'ticket_code', v_existing_ticket.ticket_code,
                    'user_id', v_existing_ticket.user_id,
                    'user_email', v_existing_ticket.user_email,
                    'subject', v_existing_ticket.subject,
                    'status', v_existing_ticket.status,
                    'priority', v_existing_ticket.priority,
                    'category', v_existing_ticket.category,
                    'metadata', v_existing_ticket.metadata,
                    'created_at', v_existing_ticket.created_at,
                    'last_message_at', v_existing_ticket.last_message_at
                )
            ) INTO v_result;
            RETURN v_result;
        END IF;
    END IF;

    -- 4. Atomic Creation of Ticket, Message, Routing Token, and Event
    v_ticket_id := gen_random_uuid();
    v_ticket_code := 'TK-' || UPPER(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
    v_routing_token := lower(encode(gen_random_bytes(16), 'hex'));

    INSERT INTO public.support_tickets (
        id, ticket_code, user_id, user_email, subject, status, priority, category, metadata, last_message_at, created_at, updated_at
    ) VALUES (
        v_ticket_id, v_ticket_code, p_user_id, p_user_email, p_subject, 'open', v_priority, v_category, v_metadata, now(), now(), now()
    );

    v_message_id := gen_random_uuid();
    INSERT INTO public.support_ticket_messages (
        id, ticket_id, sender_type, sender_user_id, sender_email, body, channel, metadata, created_at
    ) VALUES (
        v_message_id, v_ticket_id, 'user', p_user_id, p_user_email, p_body, 'in_app', '{}'::jsonb, now()
    );

    INSERT INTO public.support_ticket_routing (
        ticket_id, routing_token, created_at
    ) VALUES (
        v_ticket_id, v_routing_token, now()
    );

    INSERT INTO public.support_ticket_events (
        ticket_id, event_type, actor_id, actor_type, new_state
    ) VALUES (
        v_ticket_id, 'ticket_created', p_user_id, 'user',
        jsonb_build_object('ticket_code', v_ticket_code, 'subject', p_subject, 'priority', v_priority, 'category', v_category)
    );

    -- Enqueue Outbox Notification to Developer (Transactional Outbox Pattern)
    INSERT INTO public.support_email_outbox (
        ticket_id,
        recipient_email,
        recipient_type,
        reply_to_address,
        subject,
        body_html,
        body_text,
        deduplication_key,
        status,
        next_attempt_at
    ) VALUES (
        v_ticket_id,
        'tasklypets@gmail.com',
        'developer',
        'reply+tk_' || lower(replace(v_ticket_code, '-', '')) || '_' || v_routing_token || '@d893f1.resend.app',
        '[Ticket #' || v_ticket_code || '] ' || p_subject,
        '<h3>New Taskly Support Ticket: ' || v_ticket_code || '</h3>' ||
        '<p><strong>User:</strong> ' || p_user_email || '</p>' ||
        '<p><strong>Subject:</strong> ' || p_subject || '</p>' ||
        '<hr/><p>' || replace(replace(p_body, '<', '&lt;'), '>', '&gt;') || '</p>' ||
        '<hr/><p style="color:#666; font-size:12px;">Reply directly to this email to respond to the customer.</p>',
        'New Taskly Support Ticket: ' || v_ticket_code || E'\n' ||
        'User: ' || p_user_email || E'\n' ||
        'Subject: ' || p_subject || E'\n\n' ||
        p_body || E'\n\n' ||
        '---\nReply directly to this email to respond to the customer.',
        'ticket-created-' || v_ticket_id::TEXT,
        'pending',
        now()
    );

    IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
        INSERT INTO public.support_ticket_idempotency (
            user_id, idempotency_key, ticket_id, request_hash, created_at
        ) VALUES (
            p_user_id, p_idempotency_key, v_ticket_id, p_request_hash, now()
        );
    END IF;

    SELECT jsonb_build_object(
        'success', true,
        'is_replay', false,
        'ticket', jsonb_build_object(
            'id', v_ticket_id,
            'ticket_code', v_ticket_code,
            'user_id', p_user_id,
            'user_email', p_user_email,
            'subject', p_subject,
            'status', 'open',
            'priority', v_priority,
            'category', v_category,
            'metadata', v_metadata,
            'created_at', now(),
            'last_message_at', now()
        ),
        'initial_message_id', v_message_id
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- Procedure 2: Add Support Ticket Message Atomic (Public Projection)
CREATE OR REPLACE FUNCTION public.add_support_ticket_message_atomic(
    p_ticket_id UUID,
    p_user_id UUID,
    p_body TEXT,
    p_idempotency_key VARCHAR DEFAULT NULL,
    p_request_hash VARCHAR DEFAULT NULL,
    p_channel VARCHAR DEFAULT 'in_app',
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_ticket RECORD;
    v_existing_idemp RECORD;
    v_existing_msg RECORD;
    v_message_id UUID;
    v_routing_token VARCHAR(64);
    v_channel VARCHAR(16);
    v_metadata JSONB;
    v_result JSONB;
BEGIN
    -- 1. Caller Authorization Check
    IF auth.role() = 'authenticated' AND auth.uid() IS NOT NULL THEN
        IF auth.uid() <> p_user_id THEN
            RAISE EXCEPTION 'Caller identity mismatch: cannot add message for another user' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- 2. Input Validation
    IF p_ticket_id IS NULL OR p_user_id IS NULL THEN
        RAISE EXCEPTION 'Ticket ID and User ID are required' USING ERRCODE = '22023';
    END IF;
    IF p_body IS NULL OR length(trim(p_body)) = 0 OR length(p_body) > 10000 THEN
        RAISE EXCEPTION 'Message body must be between 1 and 10000 characters' USING ERRCODE = '22023';
    END IF;

    v_channel := LOWER(COALESCE(p_channel, 'in_app'));
    IF v_channel NOT IN ('in_app', 'email') THEN
        v_channel := 'in_app';
    END IF;

    v_metadata := COALESCE(p_metadata, '{}'::jsonb);

    -- 3. Ticket Row Lock & Access Checks
    SELECT * INTO v_ticket
    FROM public.support_tickets
    WHERE id = p_ticket_id
    FOR UPDATE;

    IF NOT FOUND THEN
        SELECT jsonb_build_object('success', false, 'error_code', 'TICKET_NOT_FOUND', 'error_message', 'Ticket does not exist') INTO v_result;
        RETURN v_result;
    END IF;

    IF v_ticket.user_id <> p_user_id THEN
        INSERT INTO public.support_security_incidents (
            incident_type, severity, target_identifier, details
        ) VALUES (
            'unauthorized_ticket_message_attempt', 'high', p_ticket_id::text,
            jsonb_build_object('caller_id', p_user_id, 'actual_owner_id', v_ticket.user_id)
        );

        SELECT jsonb_build_object('success', false, 'error_code', 'ACCESS_DENIED', 'error_message', 'You do not have access to this ticket') INTO v_result;
        RETURN v_result;
    END IF;

    IF v_ticket.status = 'closed' THEN
        SELECT jsonb_build_object(
            'success', false,
            'error_code', 'TICKET_CLOSED',
            'error_message', 'Cannot add message: ticket is closed'
        ) INTO v_result;
        RETURN v_result;
    END IF;

    -- 4. Idempotency Check with Transaction-Scoped Advisory Lock
    IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
        PERFORM pg_advisory_xact_lock(hashtext('msg_idemp:' || p_user_id::text || ':' || p_idempotency_key));

        SELECT * INTO v_existing_idemp
        FROM public.support_message_idempotency
        WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key
        FOR UPDATE;

        IF v_existing_idemp.message_id IS NOT NULL THEN
            IF v_existing_idemp.request_hash <> p_request_hash THEN
                INSERT INTO public.support_security_incidents (
                    incident_type, severity, target_identifier, details
                ) VALUES (
                    'message_idempotency_hash_mismatch', 'medium', p_idempotency_key,
                    jsonb_build_object('user_id', p_user_id, 'ticket_id', p_ticket_id)
                );

                SELECT jsonb_build_object('success', false, 'error_code', 'IDEMPOTENCY_MISMATCH', 'error_message', 'Idempotency key reused with different message content') INTO v_result;
                RETURN v_result;
            END IF;

            SELECT id, ticket_id, sender_type, sender_user_id, sender_email, body, channel, metadata, created_at
            INTO v_existing_msg
            FROM public.support_ticket_messages
            WHERE id = v_existing_idemp.message_id;

            SELECT jsonb_build_object(
                'success', true,
                'is_replay', true,
                'message', jsonb_build_object(
                    'id', v_existing_msg.id,
                    'ticket_id', v_existing_msg.ticket_id,
                    'sender_type', v_existing_msg.sender_type,
                    'sender_user_id', v_existing_msg.sender_user_id,
                    'sender_email', v_existing_msg.sender_email,
                    'body', v_existing_msg.body,
                    'channel', v_existing_msg.channel,
                    'metadata', v_existing_msg.metadata,
                    'created_at', v_existing_msg.created_at
                )
            ) INTO v_result;
            RETURN v_result;
        END IF;
    END IF;

    -- 5. Atomic Message Insertion & Ticket Update
    v_message_id := gen_random_uuid();
    INSERT INTO public.support_ticket_messages (
        id, ticket_id, sender_type, sender_user_id, sender_email, body, channel, metadata, created_at
    ) VALUES (
        v_message_id, p_ticket_id, 'user', p_user_id, v_ticket.user_email, p_body, v_channel, v_metadata, now()
    );

    UPDATE public.support_tickets
    SET last_message_at = now(),
        status = CASE WHEN status IN ('waiting_customer', 'resolved') THEN 'open' ELSE status END,
        updated_at = now()
    WHERE id = p_ticket_id;

    INSERT INTO public.support_ticket_events (
        ticket_id, event_type, actor_id, actor_type, new_state
    ) VALUES (
        p_ticket_id, 'message_added', p_user_id, 'user',
        jsonb_build_object('message_id', v_message_id, 'sender_type', 'user', 'channel', v_channel)
    );

    -- Enqueue Outbox Notification to Developer
    SELECT routing_token INTO v_routing_token FROM public.support_ticket_routing WHERE ticket_id = p_ticket_id LIMIT 1;
    IF v_routing_token IS NOT NULL THEN
        INSERT INTO public.support_email_outbox (
            ticket_id,
            recipient_email,
            recipient_type,
            reply_to_address,
            subject,
            body_html,
            body_text,
            deduplication_key,
            status,
            next_attempt_at
        ) VALUES (
            p_ticket_id,
            'tasklypets@gmail.com',
            'developer',
            'reply+tk_' || lower(replace(v_ticket.ticket_code, '-', '')) || '_' || v_routing_token || '@d893f1.resend.app',
            'Re: [Ticket #' || v_ticket.ticket_code || '] ' || v_ticket.subject,
            '<p>New follow-up from ' || v_ticket.user_email || ' on ticket #' || v_ticket.ticket_code || ':</p><hr/><p>' || replace(replace(p_body, '<', '&lt;'), '>', '&gt;') || '</p><hr/><p style="color:#666; font-size:12px;">Reply directly to this email to respond to the customer.</p>',
            'New follow-up on ticket #' || v_ticket.ticket_code || E'\nFrom: ' || v_ticket.user_email || E'\n\n' || p_body || E'\n\n---\nReply directly to this email to respond to the customer.',
            'message-created-' || v_message_id::TEXT,
            'pending',
            now()
        );
    END IF;

    IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
        INSERT INTO public.support_message_idempotency (
            user_id, idempotency_key, ticket_id, message_id, request_hash, created_at
        ) VALUES (
            p_user_id, p_idempotency_key, p_ticket_id, v_message_id, p_request_hash, now()
        );
    END IF;

    SELECT jsonb_build_object(
        'success', true,
        'is_replay', false,
        'message', jsonb_build_object(
            'id', v_message_id,
            'ticket_id', p_ticket_id,
            'sender_type', 'user',
            'sender_user_id', p_user_id,
            'sender_email', v_ticket.user_email,
            'body', p_body,
            'channel', v_channel,
            'metadata', v_metadata,
            'created_at', now()
        )
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- Procedure 3: Resolve Ticket by Routing Token (Internal)
CREATE OR REPLACE FUNCTION public.resolve_ticket_by_routing_token(
    p_routing_token VARCHAR
)
RETURNS TABLE (ticket_id UUID, user_id UUID, ticket_code VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    RETURN QUERY
    SELECT t.id, t.user_id, t.ticket_code
    FROM public.support_ticket_routing r
    JOIN public.support_tickets t ON t.id = r.ticket_id
    WHERE r.routing_token = p_routing_token;
END;
$$;

-- Procedure 3B: Ingest Developer Reply Atomic
CREATE OR REPLACE FUNCTION public.ingest_developer_reply_atomic(
    p_routing_token VARCHAR,
    p_provider_message_id VARCHAR,
    p_sender_email VARCHAR,
    p_clean_message TEXT,
    p_new_status VARCHAR DEFAULT NULL,
    p_webhook_event_id VARCHAR DEFAULT NULL,
    p_developer_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_routing RECORD;
    v_ticket RECORD;
    v_target_status VARCHAR(32);
    v_message_id UUID;
    v_result JSONB;
BEGIN
    IF p_routing_token IS NULL OR length(trim(p_routing_token)) < 16 THEN
        RAISE EXCEPTION 'Invalid routing token' USING ERRCODE = '22023';
    END IF;
    IF p_clean_message IS NULL OR length(trim(p_clean_message)) = 0 THEN
        RAISE EXCEPTION 'Message body cannot be empty' USING ERRCODE = '22023';
    END IF;

    -- 1. Match Ticket by Cryptographic Routing Token
    SELECT * INTO v_routing
    FROM public.support_ticket_routing
    WHERE routing_token = p_routing_token
    FOR UPDATE;

    IF NOT FOUND THEN
        SELECT jsonb_build_object(
            'success', false,
            'error_code', 'TICKET_NOT_FOUND',
            'error_message', 'No matching ticket found for provided routing token'
        ) INTO v_result;
        RETURN v_result;
    END IF;

    SELECT * INTO v_ticket
    FROM public.support_tickets
    WHERE id = v_routing.ticket_id
    FOR UPDATE;

    IF NOT FOUND THEN
        SELECT jsonb_build_object(
            'success', false,
            'error_code', 'TICKET_NOT_FOUND',
            'error_message', 'Ticket not found'
        ) INTO v_result;
        RETURN v_result;
    END IF;

    -- 2. Determine Ticket Status
    v_target_status := LOWER(COALESCE(p_new_status, 'waiting_customer'));
    IF v_target_status = 'waiting_on_user' OR v_target_status = 'waiting_on_customer' THEN
        v_target_status := 'waiting_customer';
    END IF;
    IF v_target_status NOT IN ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed') THEN
        v_target_status := 'waiting_customer';
    END IF;

    -- 3. Insert Developer Message
    v_message_id := gen_random_uuid();
    INSERT INTO public.support_ticket_messages (
        id, ticket_id, sender_type, sender_user_id, sender_email, body, channel, metadata, inbound_provider_message_id, created_at
    ) VALUES (
        v_message_id, v_ticket.id, 'developer', p_developer_user_id, p_sender_email, p_clean_message, 'email', '{}'::jsonb, p_provider_message_id, now()
    );

    -- 4. Update Ticket State
    UPDATE public.support_tickets
    SET status = v_target_status,
        developer_user_id = COALESCE(p_developer_user_id, developer_user_id),
        last_message_at = now(),
        updated_at = now()
    WHERE id = v_ticket.id;

    -- 5. Audit Events
    INSERT INTO public.support_ticket_events (
        ticket_id, event_type, actor_id, actor_type, new_state
    ) VALUES (
        v_ticket.id, 'message_added', p_developer_user_id, 'developer',
        jsonb_build_object(
            'message_id', v_message_id,
            'sender_type', 'developer',
            'channel', 'email',
            'inbound_provider_message_id', p_provider_message_id
        )
    );

    IF v_ticket.status <> v_target_status THEN
        INSERT INTO public.support_ticket_events (
            ticket_id, event_type, actor_id, actor_type, old_state, new_state
        ) VALUES (
            v_ticket.id, 'status_changed', p_developer_user_id, 'developer',
            jsonb_build_object('status', v_ticket.status),
            jsonb_build_object('status', v_target_status)
        );
    END IF;

    -- 6. Mark Webhook Event as processed
    IF p_webhook_event_id IS NOT NULL THEN
        UPDATE public.inbound_webhook_events
        SET status = 'processed',
            locked_by = NULL,
            locked_until = NULL,
            error_message = NULL
        WHERE provider_event_id = p_webhook_event_id;
    END IF;

    SELECT jsonb_build_object(
        'success', true,
        'ticket_id', v_ticket.id,
        'ticket_code', v_ticket.ticket_code,
        'user_id', v_ticket.user_id,
        'message_id', v_message_id,
        'new_status', v_target_status
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- Procedure 4: Quarantine Inbound Message Atomic (Strict Lease & Row-Count Validation)
CREATE OR REPLACE FUNCTION public.quarantine_inbound_message_atomic(
    p_provider_message_id VARCHAR,
    p_routing_token VARCHAR,
    p_sender_email VARCHAR,
    p_subject VARCHAR,
    p_raw_headers JSONB,
    p_raw_body TEXT,
    p_payload_hash VARCHAR,
    p_quarantine_reason TEXT,
    p_webhook_event_id VARCHAR,
    p_worker_id VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_webhook_event RECORD;
    v_existing RECORD;
    v_quarantine_id UUID;
    v_ticket_id UUID;
    v_rows_affected INT;
    v_result JSONB;
BEGIN
    IF p_provider_message_id IS NULL OR length(trim(p_provider_message_id)) < 5 THEN
        RAISE EXCEPTION 'Invalid provider_message_id' USING ERRCODE = '22023';
    END IF;
    IF p_payload_hash IS NULL OR length(p_payload_hash) <> 64 OR p_payload_hash !~ '^[a-f0-9]{64}$' THEN
        RAISE EXCEPTION 'Payload hash must be a 64-character lowercase hexadecimal string' USING ERRCODE = '22023';
    END IF;
    IF p_webhook_event_id IS NULL OR p_worker_id IS NULL THEN
        RAISE EXCEPTION 'Webhook event ID and worker ID are required' USING ERRCODE = '22023';
    END IF;

    SELECT id, status, locked_by, locked_until INTO v_webhook_event
    FROM public.inbound_webhook_events
    WHERE provider_event_id = p_webhook_event_id
    FOR UPDATE;

    IF NOT FOUND THEN
        SELECT jsonb_build_object(
            'success', false,
            'error_code', 'WEBHOOK_EVENT_NOT_FOUND',
            'error_message', 'Webhook event does not exist'
        ) INTO v_result;
        RETURN v_result;
    END IF;

    IF v_webhook_event.status <> 'received' 
       OR v_webhook_event.locked_by IS NULL 
       OR v_webhook_event.locked_by <> p_worker_id 
       OR v_webhook_event.locked_until IS NULL 
       OR v_webhook_event.locked_until < now() THEN
        SELECT jsonb_build_object(
            'success', false,
            'error_code', 'STALE_WEBHOOK_LEASE',
            'error_message', 'Worker does not own active lease on webhook event'
        ) INTO v_result;
        RETURN v_result;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('quarantine_msg:' || p_provider_message_id));

    SELECT * INTO v_existing
    FROM public.support_quarantined_messages
    WHERE provider_message_id = p_provider_message_id
    FOR UPDATE;

    IF v_existing.id IS NOT NULL THEN
        IF v_existing.payload_hash <> p_payload_hash 
           OR COALESCE(v_existing.routing_token, '') <> COALESCE(p_routing_token, '') 
           OR v_existing.sender_email <> p_sender_email THEN
            
            INSERT INTO public.support_security_incidents (
                incident_type, severity, target_identifier, details
            ) VALUES (
                'quarantine_payload_integrity_violation', 'critical', p_provider_message_id,
                jsonb_build_object(
                    'existing_quarantine_id', v_existing.id,
                    'existing_hash', v_existing.payload_hash,
                    'incoming_hash', p_payload_hash,
                    'existing_sender', v_existing.sender_email,
                    'incoming_sender', p_sender_email,
                    'existing_token', v_existing.routing_token,
                    'incoming_token', p_routing_token
                )
            );

            UPDATE public.inbound_webhook_events
            SET status = 'terminal_failure',
                locked_by = NULL,
                locked_until = NULL,
                error_message = 'Quarantine payload integrity conflict detected',
                updated_at = now()
            WHERE id = v_webhook_event.id
              AND locked_by = p_worker_id;

            SELECT jsonb_build_object(
                'success', false,
                'error_code', 'INTEGRITY_VIOLATION',
                'error_message', 'Quarantine replay integrity violation: provider_message_id already exists with conflicting payload or metadata',
                'provider_message_id', p_provider_message_id
            ) INTO v_result;
            RETURN v_result;
        END IF;

        UPDATE public.inbound_webhook_events
        SET status = 'quarantined',
            locked_by = NULL,
            locked_until = NULL,
            error_message = 'Duplicate webhook delivery of existing quarantine record',
            updated_at = now()
        WHERE id = v_webhook_event.id
          AND locked_by = p_worker_id;

        GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
        IF v_rows_affected = 0 THEN
            SELECT jsonb_build_object(
                'success', false,
                'error_code', 'STALE_WEBHOOK_LEASE',
                'error_message', 'Lost lease during identical replay resolution'
            ) INTO v_result;
            RETURN v_result;
        END IF;

        SELECT jsonb_build_object(
            'success', true,
            'quarantine_id', v_existing.id,
            'is_replay', true,
            'status', v_existing.status
        ) INTO v_result;
        RETURN v_result;
    END IF;

    IF p_routing_token IS NOT NULL AND length(trim(p_routing_token)) > 0 THEN
        SELECT ticket_id INTO v_ticket_id
        FROM public.support_ticket_routing
        WHERE routing_token = p_routing_token;
    END IF;

    v_quarantine_id := gen_random_uuid();
    INSERT INTO public.support_quarantined_messages (
        id, provider_message_id, routing_token, sender_email, subject,
        raw_headers, raw_body, payload_hash, quarantine_reason, status, created_at
    ) VALUES (
        v_quarantine_id, p_provider_message_id, p_routing_token, p_sender_email, p_subject,
        p_raw_headers, p_raw_body, p_payload_hash, p_quarantine_reason, 'quarantined', now()
    );

    IF p_quarantine_reason LIKE 'UNAUTHORIZED_SENDER%' OR p_quarantine_reason = 'SPF_OR_DKIM_FAILED' THEN
        INSERT INTO public.support_security_incidents (
            incident_type, severity, target_identifier, details
        ) VALUES (
            CASE WHEN p_quarantine_reason = 'SPF_OR_DKIM_FAILED' THEN 'spf_dkim_verification_failed' ELSE 'unauthorized_sender' END,
            'high',
            p_sender_email,
            jsonb_build_object(
                'quarantine_id', v_quarantine_id,
                'provider_message_id', p_provider_message_id,
                'routing_token', p_routing_token,
                'reason', p_quarantine_reason
            )
        );
    END IF;

    UPDATE public.inbound_webhook_events
    SET status = 'quarantined',
        locked_by = NULL,
        locked_until = NULL,
        updated_at = now()
    WHERE id = v_webhook_event.id 
      AND locked_by = p_worker_id 
      AND status = 'received' 
      AND locked_until IS NOT NULL
      AND locked_until >= now();

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    IF v_rows_affected = 0 THEN
        RAISE EXCEPTION 'Stale lease detected during webhook transition. Aborting quarantine creation.' USING ERRCODE = '55P03';
    END IF;

    IF v_ticket_id IS NOT NULL THEN
        INSERT INTO public.support_ticket_events (
            ticket_id, event_type, actor_id, actor_type, new_state
        ) VALUES (
            v_ticket_id, 'inbound_email_quarantined', NULL, 'system',
            jsonb_build_object(
                'quarantine_id', v_quarantine_id,
                'provider_message_id', p_provider_message_id,
                'reason', p_quarantine_reason
            )
        );
    END IF;

    SELECT jsonb_build_object(
        'success', true,
        'quarantine_id', v_quarantine_id,
        'ticket_id', v_ticket_id,
        'is_replay', false,
        'status', 'quarantined'
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- Procedure 5: Release Quarantined Message Atomic (Developer Review)
CREATE OR REPLACE FUNCTION public.release_quarantined_message_atomic(
    p_quarantine_id UUID,
    p_reviewer_id UUID,
    p_reviewer_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_quarantine RECORD;
    v_ticket RECORD;
    v_message_id UUID;
    v_reviewer_exists BOOLEAN;
    v_result JSONB;
BEGIN
    IF p_quarantine_id IS NULL OR p_reviewer_id IS NULL THEN
        RAISE EXCEPTION 'Quarantine ID and Reviewer ID are required' USING ERRCODE = '22023';
    END IF;

    SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = p_reviewer_id) INTO v_reviewer_exists;
    IF NOT v_reviewer_exists THEN
        SELECT jsonb_build_object('success', false, 'error_code', 'INVALID_REVIEWER', 'error_message', 'Reviewer does not exist in auth.users') INTO v_result;
        RETURN v_result;
    END IF;

    SELECT * INTO v_quarantine
    FROM public.support_quarantined_messages
    WHERE id = p_quarantine_id
    FOR UPDATE;

    IF NOT FOUND THEN
        SELECT jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'error_message', 'Quarantined message not found') INTO v_result;
        RETURN v_result;
    END IF;

    IF v_quarantine.status <> 'quarantined' THEN
        SELECT jsonb_build_object('success', false, 'error_code', 'ALREADY_REVIEWED', 'error_message', 'Message has already been reviewed', 'status', v_quarantine.status) INTO v_result;
        RETURN v_result;
    END IF;

    IF v_quarantine.routing_token IS NULL THEN
        SELECT jsonb_build_object('success', false, 'error_code', 'NO_ROUTING_TOKEN', 'error_message', 'Cannot release message without a routing token') INTO v_result;
        RETURN v_result;
    END IF;

    SELECT t.* INTO v_ticket
    FROM public.support_ticket_routing r
    JOIN public.support_tickets t ON t.id = r.ticket_id
    WHERE r.routing_token = v_quarantine.routing_token
    FOR UPDATE;

    IF NOT FOUND THEN
        SELECT jsonb_build_object('success', false, 'error_code', 'TICKET_NOT_FOUND', 'error_message', 'Associated ticket could not be resolved from routing token') INTO v_result;
        RETURN v_result;
    END IF;

    v_message_id := gen_random_uuid();
    INSERT INTO public.support_ticket_messages (
        id, ticket_id, sender_type, sender_user_id, sender_email, body, inbound_provider_message_id, created_at
    ) VALUES (
        v_message_id, v_ticket.id, 'developer', p_reviewer_id, v_quarantine.sender_email, v_quarantine.raw_body, v_quarantine.provider_message_id, now()
    );

    UPDATE public.support_tickets
    SET status = 'waiting_customer',
        developer_user_id = p_reviewer_id,
        last_message_at = now(),
        updated_at = now()
    WHERE id = v_ticket.id;

    UPDATE public.support_quarantined_messages
    SET status = 'released',
        reviewed_by = p_reviewer_id,
        reviewed_at = now(),
        reviewer_notes = p_reviewer_notes
    WHERE id = p_quarantine_id;

    INSERT INTO public.support_ticket_events (
        ticket_id, event_type, actor_id, actor_type, new_state
    ) VALUES (
        v_ticket.id, 'quarantine_released', p_reviewer_id, 'developer',
        jsonb_build_object('quarantine_id', p_quarantine_id, 'message_id', v_message_id, 'notes', p_reviewer_notes)
    );

    SELECT jsonb_build_object(
        'success', true,
        'quarantine_id', p_quarantine_id,
        'ticket_id', v_ticket.id,
        'message_id', v_message_id,
        'status', 'released'
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- Procedure 6: Reject Quarantined Message Atomic
CREATE OR REPLACE FUNCTION public.reject_quarantined_message_atomic(
    p_quarantine_id UUID,
    p_reviewer_id UUID,
    p_rejection_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_quarantine RECORD;
    v_ticket_id UUID;
    v_reviewer_exists BOOLEAN;
    v_result JSONB;
BEGIN
    IF p_quarantine_id IS NULL OR p_reviewer_id IS NULL THEN
        RAISE EXCEPTION 'Quarantine ID and Reviewer ID are required' USING ERRCODE = '22023';
    END IF;

    SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = p_reviewer_id) INTO v_reviewer_exists;
    IF NOT v_reviewer_exists THEN
        SELECT jsonb_build_object('success', false, 'error_code', 'INVALID_REVIEWER', 'error_message', 'Reviewer does not exist in auth.users') INTO v_result;
        RETURN v_result;
    END IF;

    SELECT * INTO v_quarantine
    FROM public.support_quarantined_messages
    WHERE id = p_quarantine_id
    FOR UPDATE;

    IF NOT FOUND THEN
        SELECT jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'error_message', 'Quarantined message not found') INTO v_result;
        RETURN v_result;
    END IF;

    IF v_quarantine.status <> 'quarantined' THEN
        SELECT jsonb_build_object('success', false, 'error_code', 'ALREADY_REVIEWED', 'error_message', 'Message has already been reviewed', 'status', v_quarantine.status) INTO v_result;
        RETURN v_result;
    END IF;

    UPDATE public.support_quarantined_messages
    SET status = 'rejected',
        reviewed_by = p_reviewer_id,
        reviewed_at = now(),
        reviewer_notes = p_rejection_reason
    WHERE id = p_quarantine_id;

    IF v_quarantine.routing_token IS NOT NULL THEN
        SELECT ticket_id INTO v_ticket_id
        FROM public.support_ticket_routing
        WHERE routing_token = v_quarantine.routing_token;
    END IF;

    IF v_ticket_id IS NOT NULL THEN
        INSERT INTO public.support_ticket_events (
            ticket_id, event_type, actor_id, actor_type, new_state
        ) VALUES (
            v_ticket_id, 'quarantine_rejected', p_reviewer_id, 'developer',
            jsonb_build_object('quarantine_id', p_quarantine_id, 'reason', p_rejection_reason)
        );
    END IF;

    SELECT jsonb_build_object(
        'success', true,
        'quarantine_id', p_quarantine_id,
        'status', 'rejected'
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- Procedure 7: Claim Webhook Event (Advisory Lock + ON CONFLICT Safe)
CREATE OR REPLACE FUNCTION public.claim_inbound_webhook_event(
    p_provider_event_id VARCHAR,
    p_event_type VARCHAR,
    p_payload_preview JSONB,
    p_worker_id VARCHAR,
    p_lease_seconds INT DEFAULT 60
)
RETURNS TABLE (
    claim_action VARCHAR,
    event_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_event RECORD;
    v_new_id UUID;
    v_lease_duration INT;
BEGIN
    IF p_provider_event_id IS NULL OR length(trim(p_provider_event_id)) < 5 THEN
        RAISE EXCEPTION 'Invalid provider_event_id' USING ERRCODE = '22023';
    END IF;
    IF p_worker_id IS NULL OR length(trim(p_worker_id)) < 3 THEN
        RAISE EXCEPTION 'Invalid worker_id' USING ERRCODE = '22023';
    END IF;

    v_lease_duration := GREATEST(10, LEAST(300, COALESCE(p_lease_seconds, 60)));

    PERFORM pg_advisory_xact_lock(hashtext('claim_webhook:' || p_provider_event_id));

    SELECT * INTO v_event
    FROM public.inbound_webhook_events
    WHERE provider_event_id = p_provider_event_id
    FOR UPDATE;

    IF NOT FOUND THEN
        INSERT INTO public.inbound_webhook_events (
            provider_event_id, event_type, payload_preview, status, locked_by, locked_until
        ) VALUES (
            p_provider_event_id, p_event_type, p_payload_preview, 'received', p_worker_id, now() + (v_lease_duration || ' seconds')::INTERVAL
        ) ON CONFLICT (provider_event_id) DO NOTHING
        RETURNING id INTO v_new_id;

        IF v_new_id IS NOT NULL THEN
            claim_action := 'claimed';
            event_id := v_new_id;
            RETURN NEXT;
            RETURN;
        ELSE
            SELECT * INTO v_event FROM public.inbound_webhook_events WHERE provider_event_id = p_provider_event_id FOR UPDATE;
        END IF;
    END IF;

    IF v_event.status = 'processed' THEN
        claim_action := 'already_processed';
        event_id := v_event.id;
        RETURN NEXT;
        RETURN;
    END IF;

    IF v_event.status = 'quarantined' THEN
        claim_action := 'quarantined';
        event_id := v_event.id;
        RETURN NEXT;
        RETURN;
    END IF;

    IF v_event.status = 'terminal_failure' THEN
        claim_action := 'terminal_failure';
        event_id := v_event.id;
        RETURN NEXT;
        RETURN;
    END IF;

    IF v_event.status = 'received' AND v_event.locked_until IS NOT NULL AND v_event.locked_until > now() THEN
        claim_action := 'in_flight';
        event_id := v_event.id;
        RETURN NEXT;
        RETURN;
    END IF;

    IF v_event.status = 'failed' AND v_event.next_attempt_at > now() THEN
        claim_action := 'retry_backoff_wait';
        event_id := v_event.id;
        RETURN NEXT;
        RETURN;
    END IF;

    UPDATE public.inbound_webhook_events
    SET status = 'received',
        locked_by = p_worker_id,
        locked_until = now() + (v_lease_duration || ' seconds')::INTERVAL,
        updated_at = now()
    WHERE id = v_event.id;

    claim_action := 'claimed_for_retry';
    event_id := v_event.id;
    RETURN NEXT;
    RETURN;
END;
$$;

-- Procedure 8: Fail Inbound Webhook Event (Atomic Lease Re-validation)
CREATE OR REPLACE FUNCTION public.fail_inbound_webhook_event(
    p_provider_event_id VARCHAR,
    p_worker_id VARCHAR,
    p_error_message TEXT,
    p_retryable BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_record RECORD;
    v_rows INT;
BEGIN
    IF p_provider_event_id IS NULL OR p_worker_id IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT id, retry_count, max_retries INTO v_record
    FROM public.inbound_webhook_events
    WHERE provider_event_id = p_provider_event_id 
      AND locked_by = p_worker_id 
      AND locked_until IS NOT NULL
      AND locked_until >= now() 
      AND status = 'received'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    IF NOT p_retryable OR (v_record.retry_count + 1 >= v_record.max_retries) THEN
        UPDATE public.inbound_webhook_events
        SET status = 'terminal_failure',
            locked_by = NULL,
            locked_until = NULL,
            error_message = p_error_message,
            updated_at = now()
        WHERE id = v_record.id
          AND locked_by = p_worker_id
          AND status = 'received'
          AND locked_until IS NOT NULL
          AND locked_until >= now();
    ELSE
        UPDATE public.inbound_webhook_events
        SET status = 'failed',
            retry_count = retry_count + 1,
            next_attempt_at = now() + ((v_record.retry_count + 1) * 60 || ' seconds')::INTERVAL,
            locked_by = NULL,
            locked_until = NULL,
            error_message = p_error_message,
            updated_at = now()
        WHERE id = v_record.id
          AND locked_by = p_worker_id
          AND status = 'received'
          AND locked_until IS NOT NULL
          AND locked_until >= now();
    END IF;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows > 0;
END;
$$;

-- Procedure 9: Claim Support Email Outbox Batch (Strict 23h 45m Cutoff & Retry State Separation)
CREATE OR REPLACE FUNCTION public.claim_support_email_outbox_batch(
    p_worker_id VARCHAR,
    p_batch_size INT DEFAULT 10,
    p_lease_seconds INT DEFAULT 60
)
RETURNS TABLE (
    id UUID,
    ticket_id UUID,
    recipient_email VARCHAR,
    recipient_type VARCHAR,
    reply_to_address VARCHAR,
    subject VARCHAR,
    body_html TEXT,
    body_text TEXT,
    deduplication_key VARCHAR,
    retry_count INT,
    first_attempt_started_at TIMESTAMPTZ,
    last_attempt_started_at TIMESTAMPTZ,
    outbox_status VARCHAR,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_batch INT;
    v_lease INT;
BEGIN
    IF p_worker_id IS NULL OR length(trim(p_worker_id)) < 3 THEN
        RAISE EXCEPTION 'Invalid worker_id' USING ERRCODE = '22023';
    END IF;

    v_batch := GREATEST(1, LEAST(50, COALESCE(p_batch_size, 10)));
    v_lease := GREATEST(10, LEAST(300, COALESCE(p_lease_seconds, 60)));

    -- 1. Auto-timeout jobs that exceeded the Resend 24-hour idempotency window (23h 45m safety cutoff)
    UPDATE public.support_email_outbox o
    SET status = 'ambiguous_delivery_timeout',
        locked_by = NULL,
        locked_until = NULL,
        last_error = 'Automated retries halted: Job exceeded Resend 24-hour idempotency retention window (23h 45m safety cutoff). Requires manual review.',
        updated_at = now()
    WHERE o.status IN ('ambiguous_processing', 'sending', 'processing')
      AND o.first_attempt_started_at IS NOT NULL
      AND o.first_attempt_started_at < (now() - interval '23 hours 45 minutes');

    -- 2. Select eligible jobs with atomic SKIP LOCKED locking
    RETURN QUERY
    WITH available_jobs AS (
        SELECT o.id,
               CASE 
                   WHEN o.first_attempt_started_at IS NOT NULL THEN 'ambiguous_processing'
                   ELSE 'processing'
               END AS target_status
        FROM public.support_email_outbox o
        WHERE (
            -- Branch 1: Pending jobs (fresh or retry elapsed within 23h 45m cutoff)
            (
                o.status = 'pending' 
                AND o.next_attempt_at <= now() 
                AND o.retry_count < o.max_retries
                AND (o.first_attempt_started_at IS NULL OR o.first_attempt_started_at >= (now() - interval '23 hours 45 minutes'))
            )
            OR
            -- Branch 2: Expired processing lease where previous worker crashed before dispatch (first_attempt_started_at IS NULL)
            (
                o.status = 'processing' 
                AND o.locked_until < now() 
                AND o.retry_count < o.max_retries
                AND o.first_attempt_started_at IS NULL
            )
            OR
            -- Branch 3: Ambiguous processing retry whose backoff elapsed, lease unlocked/expired, within 23h 45m cutoff
            (
                o.status = 'ambiguous_processing' 
                AND o.next_attempt_at <= now() 
                AND o.retry_count < o.max_retries 
                AND (o.locked_until IS NULL OR o.locked_until < now())
                AND o.first_attempt_started_at IS NOT NULL
                AND o.first_attempt_started_at >= (now() - interval '23 hours 45 minutes')
            )
            OR
            -- Branch 4: Expired sending lease where previous worker crashed in-flight, within 23h 45m cutoff
            (
                o.status = 'sending' 
                AND o.locked_until < now() 
                AND o.retry_count < o.max_retries
                AND o.first_attempt_started_at IS NOT NULL
                AND o.first_attempt_started_at >= (now() - interval '23 hours 45 minutes')
            )
            OR
            -- Branch 5: Expired processing lease on previous retry with non-null attempt timestamp within cutoff
            (
                o.status = 'processing' 
                AND o.locked_until < now() 
                AND o.retry_count < o.max_retries
                AND o.first_attempt_started_at IS NOT NULL
                AND o.first_attempt_started_at >= (now() - interval '23 hours 45 minutes')
            )
        )
        ORDER BY o.next_attempt_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT v_batch
    )
    UPDATE public.support_email_outbox u
    SET status = a.target_status,
        locked_by = p_worker_id,
        locked_until = now() + (v_lease || ' seconds')::INTERVAL,
        updated_at = now()
    FROM available_jobs a
    WHERE u.id = a.id
    RETURNING
        u.id,
        u.ticket_id,
        u.recipient_email,
        u.recipient_type,
        u.reply_to_address,
        u.subject,
        u.body_html,
        u.body_text,
        u.deduplication_key,
        u.retry_count,
        u.first_attempt_started_at,
        u.last_attempt_started_at,
        u.status,
        u.created_at;
END;
$$;

-- Procedure 10: Mark Outbox Attempt Start (Independent 23h 45m Cutoff Verification)
CREATE OR REPLACE FUNCTION public.mark_outbox_attempt_start(
    p_outbox_id UUID,
    p_worker_id VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_record RECORD;
    v_rows INT;
BEGIN
    IF p_outbox_id IS NULL OR p_worker_id IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT * INTO v_record
    FROM public.support_email_outbox
    WHERE id = p_outbox_id
      AND locked_by = p_worker_id
      AND locked_until IS NOT NULL
      AND locked_until >= now()
      AND status IN ('processing', 'ambiguous_processing')
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- Independent cutoff check: if first attempt started >= 23h 45m ago, halt send!
    IF v_record.first_attempt_started_at IS NOT NULL 
       AND v_record.first_attempt_started_at < (now() - interval '23 hours 45 minutes') THEN
        UPDATE public.support_email_outbox
        SET status = 'ambiguous_delivery_timeout',
            locked_by = NULL,
            locked_until = NULL,
            last_error = 'Attempt aborted: Job exceeded 24-hour Resend idempotency retention window (23h 45m cutoff). Automated send blocked.',
            updated_at = now()
        WHERE id = p_outbox_id
          AND locked_by = p_worker_id;

        RETURN FALSE;
    END IF;

    UPDATE public.support_email_outbox
    SET status = 'sending',
        first_attempt_started_at = COALESCE(first_attempt_started_at, now()),
        last_attempt_started_at = now(),
        updated_at = now()
    WHERE id = p_outbox_id 
      AND locked_by = p_worker_id 
      AND status IN ('processing', 'ambiguous_processing') 
      AND locked_until IS NOT NULL
      AND locked_until >= now();

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows > 0;
END;
$$;

-- Procedure 11: Mark Outbox Success (Stale Worker Guard + Delivery Audit)
CREATE OR REPLACE FUNCTION public.mark_outbox_success(
    p_outbox_id UUID,
    p_worker_id VARCHAR,
    p_provider_message_id VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_ticket_id UUID;
    v_recipient VARCHAR(255);
    v_rows_updated INT;
BEGIN
    IF p_provider_message_id IS NULL OR length(trim(p_provider_message_id)) < 3 THEN
        RAISE EXCEPTION 'Invalid provider_message_id' USING ERRCODE = '22023';
    END IF;

    UPDATE public.support_email_outbox
    SET status = 'sent',
        outbox_provider_message_id = p_provider_message_id,
        locked_by = NULL,
        locked_until = NULL,
        last_error = NULL,
        updated_at = now()
    WHERE id = p_outbox_id 
      AND locked_by = p_worker_id 
      AND status = 'sending' 
      AND locked_until IS NOT NULL
      AND locked_until >= now()
    RETURNING ticket_id, recipient_email INTO v_ticket_id, v_recipient;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    IF v_rows_updated = 0 THEN
        RETURN FALSE;
    END IF;

    INSERT INTO public.support_ticket_events (
        ticket_id, event_type, actor_id, actor_type, new_state
    ) VALUES (
        v_ticket_id, 'email_notification_sent', NULL, 'system',
        jsonb_build_object(
            'outbox_id', p_outbox_id,
            'provider_message_id', p_provider_message_id,
            'recipient', v_recipient
        )
    );

    RETURN TRUE;
END;
$$;

-- Procedure 12: Mark Outbox Failure
CREATE OR REPLACE FUNCTION public.mark_outbox_failure(
    p_outbox_id UUID,
    p_worker_id VARCHAR,
    p_error_message TEXT,
    p_retry_delay_seconds INT DEFAULT 60,
    p_is_permanent BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_record RECORD;
    v_delay INT;
    v_rows INT;
BEGIN
    v_delay := GREATEST(10, LEAST(86400, COALESCE(p_retry_delay_seconds, 60)));

    SELECT * INTO v_record
    FROM public.support_email_outbox
    WHERE id = p_outbox_id 
      AND locked_by = p_worker_id 
      AND status IN ('processing', 'sending', 'ambiguous_processing') 
      AND locked_until IS NOT NULL
      AND locked_until >= now()
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    IF p_is_permanent OR (v_record.retry_count + 1 >= v_record.max_retries) THEN
        UPDATE public.support_email_outbox
        SET status = 'failed',
            retry_count = retry_count + 1,
            locked_by = NULL,
            locked_until = NULL,
            last_error = p_error_message,
            updated_at = now()
        WHERE id = p_outbox_id
          AND locked_by = p_worker_id;
    ELSE
        UPDATE public.support_email_outbox
        SET status = 'pending',
            retry_count = retry_count + 1,
            next_attempt_at = now() + (v_delay || ' seconds')::INTERVAL,
            locked_by = NULL,
            locked_until = NULL,
            last_error = p_error_message,
            updated_at = now()
        WHERE id = p_outbox_id
          AND locked_by = p_worker_id;
    END IF;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows > 0;
END;
$$;

-- Procedure 13: Mark Outbox Ambiguous (Guarded 23h 45m Cutoff & max_retries)
CREATE OR REPLACE FUNCTION public.mark_outbox_ambiguous(
    p_outbox_id UUID,
    p_worker_id VARCHAR,
    p_error_message TEXT,
    p_retry_delay_seconds INT DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_record RECORD;
    v_delay INT;
    v_rows INT;
BEGIN
    v_delay := GREATEST(10, LEAST(86400, COALESCE(p_retry_delay_seconds, 60)));

    SELECT * INTO v_record
    FROM public.support_email_outbox
    WHERE id = p_outbox_id 
      AND locked_by = p_worker_id 
      AND status = 'sending' 
      AND locked_until IS NOT NULL
      AND locked_until >= now()
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    IF v_record.first_attempt_started_at IS NOT NULL 
       AND v_record.first_attempt_started_at < (now() - interval '23 hours 45 minutes') THEN
        UPDATE public.support_email_outbox
        SET status = 'ambiguous_delivery_timeout',
            locked_by = NULL,
            locked_until = NULL,
            last_error = 'Ambiguous outcome exceeded 24-hour Resend idempotency window (23h 45m cutoff). Automated retries halted.',
            updated_at = now()
        WHERE id = p_outbox_id
          AND locked_by = p_worker_id;
    ELSIF v_record.retry_count + 1 >= v_record.max_retries THEN
        UPDATE public.support_email_outbox
        SET status = 'failed',
            retry_count = retry_count + 1,
            locked_by = NULL,
            locked_until = NULL,
            last_error = 'Max retries exceeded on ambiguous send: ' || COALESCE(p_error_message, 'Unknown timeout'),
            updated_at = now()
        WHERE id = p_outbox_id
          AND locked_by = p_worker_id;
    ELSE
        UPDATE public.support_email_outbox
        SET status = 'ambiguous_processing',
            retry_count = retry_count + 1,
            next_attempt_at = now() + (v_delay || ' seconds')::INTERVAL,
            locked_by = NULL,
            locked_until = NULL,
            last_error = p_error_message,
            updated_at = now()
        WHERE id = p_outbox_id
          AND locked_by = p_worker_id;
    END IF;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows > 0;
END;
$$;

-- Procedure 14: Mark Outbox Ambiguous Timeout (Ownership & Eligibility Safe)
CREATE OR REPLACE FUNCTION public.mark_outbox_ambiguous_timeout(
    p_outbox_id UUID,
    p_worker_id VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_rows INT;
BEGIN
    IF p_outbox_id IS NULL OR p_worker_id IS NULL THEN
        RETURN FALSE;
    END IF;

    UPDATE public.support_email_outbox
    SET status = 'ambiguous_delivery_timeout',
        locked_by = NULL,
        locked_until = NULL,
        last_error = 'Worker timed out job: Resend 24-hour idempotency retention window expired (23h 45m cutoff).',
        updated_at = now()
    WHERE id = p_outbox_id
      AND locked_by = p_worker_id
      AND locked_until IS NOT NULL
      AND locked_until >= now()
      AND status IN ('sending', 'ambiguous_processing')
      AND first_attempt_started_at IS NOT NULL
      AND first_attempt_started_at < (now() - interval '23 hours 45 minutes');

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows > 0;
END;
$$;

-- Procedure 15: Sweep Outbox Ambiguous Timeouts (Privileged Sweeper for Unleased Expired Jobs)
CREATE OR REPLACE FUNCTION public.sweep_outbox_ambiguous_timeouts()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_count INT;
BEGIN
    UPDATE public.support_email_outbox
    SET status = 'ambiguous_delivery_timeout',
        locked_by = NULL,
        locked_until = NULL,
        last_error = 'Sweeper timed out job: Resend 24-hour idempotency retention window expired (23h 45m cutoff).',
        updated_at = now()
    WHERE status IN ('sending', 'ambiguous_processing', 'processing')
      AND (locked_until IS NULL OR locked_until < now())
      AND first_attempt_started_at IS NOT NULL
      AND first_attempt_started_at < (now() - interval '23 hours 45 minutes');

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- ============================================================================
-- 5. Stored Procedure Grants and Revokes
-- ============================================================================

REVOKE ALL ON FUNCTION public.create_support_ticket_atomic(UUID, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_support_ticket_atomic(UUID, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.add_support_ticket_message_atomic(UUID, UUID, TEXT, VARCHAR, VARCHAR, VARCHAR, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_support_ticket_message_atomic(UUID, UUID, TEXT, VARCHAR, VARCHAR, VARCHAR, JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.resolve_ticket_by_routing_token(VARCHAR) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.resolve_ticket_by_routing_token(VARCHAR) TO service_role;

REVOKE ALL ON FUNCTION public.ingest_developer_reply_atomic(VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.ingest_developer_reply_atomic(VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.quarantine_inbound_message_atomic(VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, TEXT, VARCHAR, TEXT, VARCHAR, VARCHAR) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.quarantine_inbound_message_atomic(VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, TEXT, VARCHAR, TEXT, VARCHAR, VARCHAR) TO service_role;

REVOKE ALL ON FUNCTION public.release_quarantined_message_atomic(UUID, UUID, TEXT) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.release_quarantined_message_atomic(UUID, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.reject_quarantined_message_atomic(UUID, UUID, TEXT) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.reject_quarantined_message_atomic(UUID, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.claim_inbound_webhook_event(VARCHAR, VARCHAR, JSONB, VARCHAR, INT) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.claim_inbound_webhook_event(VARCHAR, VARCHAR, JSONB, VARCHAR, INT) TO service_role;

REVOKE ALL ON FUNCTION public.fail_inbound_webhook_event(VARCHAR, VARCHAR, TEXT, BOOLEAN) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.fail_inbound_webhook_event(VARCHAR, VARCHAR, TEXT, BOOLEAN) TO service_role;

REVOKE ALL ON FUNCTION public.claim_support_email_outbox_batch(VARCHAR, INT, INT) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.claim_support_email_outbox_batch(VARCHAR, INT, INT) TO service_role;

REVOKE ALL ON FUNCTION public.mark_outbox_attempt_start(UUID, VARCHAR) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.mark_outbox_attempt_start(UUID, VARCHAR) TO service_role;

REVOKE ALL ON FUNCTION public.mark_outbox_success(UUID, VARCHAR, VARCHAR) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.mark_outbox_success(UUID, VARCHAR, VARCHAR) TO service_role;

REVOKE ALL ON FUNCTION public.mark_outbox_failure(UUID, VARCHAR, TEXT, INT, BOOLEAN) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.mark_outbox_failure(UUID, VARCHAR, TEXT, INT, BOOLEAN) TO service_role;

REVOKE ALL ON FUNCTION public.mark_outbox_ambiguous(UUID, VARCHAR, TEXT, INT) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.mark_outbox_ambiguous(UUID, VARCHAR, TEXT, INT) TO service_role;

REVOKE ALL ON FUNCTION public.mark_outbox_ambiguous_timeout(UUID, VARCHAR) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.mark_outbox_ambiguous_timeout(UUID, VARCHAR) TO service_role;

REVOKE ALL ON FUNCTION public.sweep_outbox_ambiguous_timeouts() FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.sweep_outbox_ambiguous_timeouts() TO service_role;
COMMIT;
