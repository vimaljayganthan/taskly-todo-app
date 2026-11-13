-- ==============================================================================
-- Taskly Database Migration: Push Notifications, Outbox & Device Registry
-- File: scripts/008_push_notifications_schema.sql
-- Target: Supabase PostgreSQL (PostgreSQL 15+)
-- Notice: DO NOT EXECUTE WITHOUT EXPLICIT SEPARATE USER AUTHORIZATION.
-- ==============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 1. Fail-Closed Internal Note Detector
-- ==============================================================================
-- Strict fail-closed behavior: Any malformed, non-object, ambiguous, or error-producing
-- metadata returns TRUE, treating the message as an internal note and suppressing customer notifications.
CREATE OR REPLACE FUNCTION public.is_internal_note_json(
    p_meta JSONB,
    p_sender_type VARCHAR DEFAULT 'developer'
)
RETURNS BOOLEAN
IMMUTABLE
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    -- If sender_type is explicitly internal, it is always an internal note
    IF lower(trim(COALESCE(p_sender_type, ''))) = 'internal' THEN
        RETURN TRUE;
    END IF;

    -- NULL or empty object '{}' is a standard public message
    IF p_meta IS NULL OR p_meta = '{}'::jsonb THEN
        RETURN FALSE;
    END IF;

    -- Fail-closed: non-object structures (strings, numbers, arrays) are unsafe -> treat as internal
    IF jsonb_typeof(p_meta) != 'object' THEN
        RETURN TRUE;
    END IF;

    -- Check is_internal_note key (case-insensitive)
    IF p_meta ? 'is_internal_note' THEN
        IF lower(trim(COALESCE(p_meta->>'is_internal_note', 'true'))) NOT IN ('false', '0', 'f', 'no') THEN
            RETURN TRUE;
        END IF;
    END IF;

    -- Check isInternalNote key (case-insensitive)
    IF p_meta ? 'isInternalNote' THEN
        IF lower(trim(COALESCE(p_meta->>'isInternalNote', 'true'))) NOT IN ('false', '0', 'f', 'no') THEN
            RETURN TRUE;
        END IF;
    END IF;

    -- Check type key
    IF p_meta ? 'type' THEN
        IF lower(trim(COALESCE(p_meta->>'type', ''))) IN ('internal_note', 'internal', 'note') THEN
            RETURN TRUE;
        END IF;
    END IF;

    -- Check visibility key
    IF p_meta ? 'visibility' THEN
        IF lower(trim(COALESCE(p_meta->>'visibility', ''))) IN ('internal', 'private', 'developer') THEN
            RETURN TRUE;
        END IF;
    END IF;

    RETURN FALSE;
EXCEPTION WHEN OTHERS THEN
    -- FAIL-CLOSED: Any exception in metadata parsing suppresses customer notification
    RETURN TRUE;
END;
$$;

-- ==============================================================================
-- 2. Upgrade-Safe Schema Alterations for Existing Installations
-- ==============================================================================
DO $$
BEGIN
    -- Ensure next_retry_at is nullable in notification_outbox if table already existed
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'notification_outbox' 
          AND column_name = 'next_retry_at' 
          AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE public.notification_outbox ALTER COLUMN next_retry_at DROP NOT NULL;
    END IF;
END $$;

-- ==============================================================================
-- 3. Table Definitions
-- ==============================================================================

-- 3.1 Device Tokens Table
CREATE TABLE IF NOT EXISTS public.user_device_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    user_email VARCHAR(255) NOT NULL,
    app_type VARCHAR(32) NOT NULL CHECK (app_type IN ('customer', 'developer')),
    fcm_token TEXT NOT NULL UNIQUE,
    device_platform VARCHAR(16) NOT NULL DEFAULT 'android' CHECK (device_platform IN ('android', 'ios', 'web')),
    device_model VARCHAR(128),
    app_version VARCHAR(32),
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Upgrade-safe constraint addition
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'check_developer_email_authorized'
    ) THEN
        ALTER TABLE public.user_device_tokens 
            ADD CONSTRAINT check_developer_email_authorized 
            CHECK (app_type != 'developer' OR lower(user_email) = 'tasklypets@gmail.com');
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_device_tokens_lookup 
    ON public.user_device_tokens(user_id, is_active, app_type);
CREATE INDEX IF NOT EXISTS idx_device_tokens_active_app 
    ON public.user_device_tokens(app_type, is_active);
CREATE INDEX IF NOT EXISTS idx_device_tokens_keyset
    ON public.user_device_tokens(id ASC)
    WHERE is_active = true;

-- 3.2 Transactional Notification Outbox Table
CREATE TABLE IF NOT EXISTS public.notification_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(64) NOT NULL,
    target_audience VARCHAR(32) NOT NULL CHECK (target_audience IN ('developer_all', 'customer_single', 'customer_all')),
    recipient_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    recipient_email VARCHAR(255),
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    priority VARCHAR(16) NOT NULL DEFAULT 'high' CHECK (priority IN ('high', 'normal')),
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
    deduplication_key VARCHAR(255) NOT NULL UNIQUE,
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 5,
    next_retry_at TIMESTAMPTZ, -- Correctly nullable for dead_letter & failed states
    locked_by VARCHAR(64),
    locked_until TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending_retry 
    ON public.notification_outbox(status, next_retry_at) 
    WHERE status IN ('pending', 'processing');

-- 3.3 Master Notifications Table
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    notification_type VARCHAR(64) NOT NULL CHECK (
        notification_type IN (
            'new_ticket',
            'ticket_reply',
            'status_changed',
            'priority_changed',
            'ticket_resolved',
            'ticket_closed',
            'ticket_reopened',
            'admin_custom_broadcast',
            'admin_custom_direct'
        )
    ),
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    sender_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    sender_email VARCHAR(255),
    target_audience VARCHAR(32) NOT NULL CHECK (target_audience IN ('customer_single', 'customer_all', 'developer_all')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_idempotency 
    ON public.notifications(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_notifications_type_created 
    ON public.notifications(notification_type, created_at DESC);

-- 3.4 User Notification Inbox Table
CREATE TABLE IF NOT EXISTS public.user_notification_inbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    is_read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMPTZ,
    is_dismissed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, notification_id)
);

CREATE INDEX IF NOT EXISTS idx_inbox_user_read_created 
    ON public.user_notification_inbox(user_id, is_read, created_at DESC);

-- 3.5 Notification Delivery Logs Table
CREATE TABLE IF NOT EXISTS public.notification_delivery_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
    device_token_id UUID REFERENCES public.user_device_tokens(id) ON DELETE SET NULL,
    fcm_message_id VARCHAR(255),
    status VARCHAR(32) NOT NULL CHECK (
        status IN ('fcm_accepted', 'client_processed', 'notification_opened', 'fcm_failed', 'invalid_token')
    ),
    error_message TEXT,
    fcm_accepted_at TIMESTAMPTZ,
    client_processed_at TIMESTAMPTZ,
    notification_opened_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(notification_id, device_token_id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_logs_query 
    ON public.notification_delivery_logs(notification_id, status);
CREATE INDEX IF NOT EXISTS idx_delivery_logs_pagination
    ON public.notification_delivery_logs(notification_id, id ASC);

-- ==============================================================================
-- 4. Table Privileges & Row-Level Security
-- ==============================================================================

-- 4.1 Explicit Table Privileges
REVOKE ALL ON TABLE public.user_device_tokens FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_device_tokens TO authenticated;
GRANT ALL ON TABLE public.user_device_tokens TO service_role;

REVOKE ALL ON TABLE public.notification_outbox FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.notification_outbox TO authenticated;
GRANT ALL ON TABLE public.notification_outbox TO service_role;

REVOKE ALL ON TABLE public.notifications FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;

REVOKE ALL ON TABLE public.user_notification_inbox FROM PUBLIC, anon;
GRANT SELECT, UPDATE, DELETE ON TABLE public.user_notification_inbox TO authenticated;
GRANT ALL ON TABLE public.user_notification_inbox TO service_role;

REVOKE ALL ON TABLE public.notification_delivery_logs FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.notification_delivery_logs TO authenticated;
GRANT ALL ON TABLE public.notification_delivery_logs TO service_role;

-- 4.2 Enable RLS on All Notification Tables
ALTER TABLE public.user_device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notification_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_delivery_logs ENABLE ROW LEVEL SECURITY;

-- 4.3 Device Tokens Policies
DROP POLICY IF EXISTS user_device_tokens_select ON public.user_device_tokens;
CREATE POLICY user_device_tokens_select ON public.user_device_tokens
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_device_tokens_insert ON public.user_device_tokens;
CREATE POLICY user_device_tokens_insert ON public.user_device_tokens
    FOR INSERT TO authenticated WITH CHECK (
        auth.uid() = user_id AND 
        lower(user_email) = lower(auth.jwt() ->> 'email') AND 
        (
            app_type = 'customer' OR 
            (app_type = 'developer' AND lower(auth.jwt() ->> 'email') = 'tasklypets@gmail.com')
        )
    );

DROP POLICY IF EXISTS user_device_tokens_update ON public.user_device_tokens;
CREATE POLICY user_device_tokens_update ON public.user_device_tokens
    FOR UPDATE TO authenticated 
    USING (auth.uid() = user_id) 
    WITH CHECK (
        auth.uid() = user_id AND 
        lower(user_email) = lower(auth.jwt() ->> 'email') AND 
        (
            app_type = 'customer' OR 
            (app_type = 'developer' AND lower(auth.jwt() ->> 'email') = 'tasklypets@gmail.com')
        )
    );

DROP POLICY IF EXISTS user_device_tokens_delete ON public.user_device_tokens;
CREATE POLICY user_device_tokens_delete ON public.user_device_tokens
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 4.4 Outbox Policies (Admin Only)
DROP POLICY IF EXISTS notification_outbox_admin_only ON public.notification_outbox;
CREATE POLICY notification_outbox_admin_only ON public.notification_outbox
    FOR ALL TO authenticated USING (lower(auth.jwt() ->> 'email') = 'tasklypets@gmail.com');

-- 4.5 Notifications Policies (Inbox-Bound)
DROP POLICY IF EXISTS notifications_select_inbox_bound ON public.notifications;
CREATE POLICY notifications_select_inbox_bound ON public.notifications
    FOR SELECT TO authenticated USING (
        EXISTS (
            SELECT 1 FROM public.user_notification_inbox i 
            WHERE i.notification_id = public.notifications.id AND i.user_id = auth.uid()
        ) OR (lower(auth.jwt() ->> 'email') = 'tasklypets@gmail.com')
    );

-- 4.6 User Inbox Policies
DROP POLICY IF EXISTS user_notification_inbox_own_select ON public.user_notification_inbox;
CREATE POLICY user_notification_inbox_own_select ON public.user_notification_inbox
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_notification_inbox_own_update ON public.user_notification_inbox;
CREATE POLICY user_notification_inbox_own_update ON public.user_notification_inbox
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_notification_inbox_own_delete ON public.user_notification_inbox;
CREATE POLICY user_notification_inbox_own_delete ON public.user_notification_inbox
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 4.7 Delivery Logs Policies (Admin Only)
DROP POLICY IF EXISTS delivery_logs_admin_only ON public.notification_delivery_logs;
CREATE POLICY delivery_logs_admin_only ON public.notification_delivery_logs
    FOR SELECT TO authenticated USING (lower(auth.jwt() ->> 'email') = 'tasklypets@gmail.com');

-- ==============================================================================
-- 5. Stored Procedures & Atomic Triggers
-- ==============================================================================

-- 5.1 Authorized Developer User IDs Resolver (Server-Side Authentic Identity)
CREATE OR REPLACE FUNCTION public.get_authorized_developer_user_ids()
RETURNS TABLE (
    user_id UUID,
    email VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
BEGIN
    RETURN QUERY
    SELECT u.id, u.email::VARCHAR
    FROM auth.users u
    WHERE lower(trim(u.email)) = 'tasklypets@gmail.com';
END;
$$;

-- 5.2 Broadcast Inbox Expansion (Set-Based, Filtered to Genuine Customer Accounts)
CREATE OR REPLACE FUNCTION public.expand_broadcast_inbox_atomic(p_notification_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
    v_audience VARCHAR;
    v_type VARCHAR;
    v_inserted INT;
BEGIN
    IF p_notification_id IS NULL THEN
        RAISE EXCEPTION 'p_notification_id cannot be null' USING ERRCODE = '22023';
    END IF;

    -- Verify notification exists and retrieve target_audience
    SELECT target_audience, notification_type
    INTO v_audience, v_type
    FROM public.notifications
    WHERE id = p_notification_id;

    IF v_audience IS NULL THEN
        RAISE EXCEPTION 'Notification does not exist: %', p_notification_id USING ERRCODE = '22023';
    END IF;

    -- Verify target_audience is customer_all and notification_type is admin_custom_broadcast
    IF v_audience != 'customer_all' OR v_type != 'admin_custom_broadcast' THEN
        RAISE EXCEPTION 'Invalid notification for broadcast expansion: expected target_audience = ''customer_all'' and notification_type = ''admin_custom_broadcast'', got target_audience = %, notification_type = %', v_audience, v_type USING ERRCODE = '22023';
    END IF;

    -- Insert inbox records for all genuine eligible customer accounts:
    -- Excludes tasklypets@gmail.com (admin / developer) and accounts without valid non-empty emails.
    INSERT INTO public.user_notification_inbox (notification_id, user_id)
    SELECT p_notification_id, u.id
    FROM auth.users u
    WHERE lower(trim(u.email)) != 'tasklypets@gmail.com'
      AND u.email IS NOT NULL
      AND trim(u.email) != ''
      AND u.email LIKE '%@%'
    ON CONFLICT (user_id, notification_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted;
END;
$$;

-- 5.3 Safe Outbox Batch Claiming (Input Bounds, Lease Recovery & FOR UPDATE SKIP LOCKED)
CREATE OR REPLACE FUNCTION public.claim_notification_outbox_batch(
    p_worker_id VARCHAR,
    p_batch_size INT DEFAULT 10,
    p_lease_seconds INT DEFAULT 60
)
RETURNS SETOF public.notification_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_batch INT;
    v_lease INT;
BEGIN
    IF p_worker_id IS NULL OR length(trim(p_worker_id)) < 3 THEN
        RAISE EXCEPTION 'Invalid worker_id: must be at least 3 characters' USING ERRCODE = '22023';
    END IF;

    v_batch := GREATEST(1, LEAST(50, COALESCE(p_batch_size, 10)));
    v_lease := GREATEST(10, LEAST(300, COALESCE(p_lease_seconds, 60)));

    -- Step 1: Recover and transition expired processing jobs that have exhausted max_retries
    -- directly into 'dead_letter'. This bounds repeated crashes and avoids infinite retry loops.
    UPDATE public.notification_outbox
    SET status = 'dead_letter',
        retry_count = retry_count + 1,
        locked_by = NULL,
        locked_until = NULL,
        next_retry_at = NULL,
        last_error = COALESCE(last_error, '') || ' [Dead letter: worker lease expired and max retries exceeded]',
        updated_at = now()
    WHERE id IN (
        SELECT id
        FROM public.notification_outbox
        WHERE status = 'processing'
          AND (locked_until IS NULL OR locked_until < now())
          AND (retry_count + 1 >= max_retries)
        LIMIT 50
        FOR UPDATE SKIP LOCKED
    );

    -- Step 2: Atomically select and claim available pending or expired-lease jobs.
    -- If claiming an expired-lease job from a crashed worker (prev_status = 'processing'),
    -- increment retry_count to record the failed crashed attempt, clear the expired lease,
    -- and reassign lock ownership to p_worker_id.
    RETURN QUERY
    WITH candidate_jobs AS (
        SELECT o.id,
               o.status AS prev_status
        FROM public.notification_outbox o
        WHERE (
            -- Fresh or retryable pending jobs:
            (o.status = 'pending' AND (o.next_retry_at IS NULL OR o.next_retry_at <= now()) AND o.retry_count < o.max_retries)
            OR
            -- Expired lease from crashed worker (strictly below max_retries on next attempt):
            (o.status = 'processing' AND (o.locked_until IS NULL OR o.locked_until < now()) AND (o.retry_count + 1 < o.max_retries))
        )
        ORDER BY o.created_at ASC
        LIMIT v_batch
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.notification_outbox o
    SET status = 'processing',
        locked_by = trim(p_worker_id),
        locked_until = now() + (v_lease || ' seconds')::interval,
        retry_count = CASE 
                        WHEN c.prev_status = 'processing' THEN o.retry_count + 1 
                        ELSE o.retry_count 
                      END,
        updated_at = now()
    FROM candidate_jobs c
    WHERE o.id = c.id
    RETURNING o.*;
END;
$$;

-- 5.4 Lease-Safe Mark Completed
CREATE OR REPLACE FUNCTION public.mark_outbox_job_completed(
    p_job_id UUID,
    p_worker_id VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_updated_rows INT;
BEGIN
    IF p_job_id IS NULL THEN
        RAISE EXCEPTION 'p_job_id cannot be null' USING ERRCODE = '22023';
    END IF;
    IF p_worker_id IS NULL OR length(trim(p_worker_id)) < 3 THEN
        RAISE EXCEPTION 'Invalid worker_id' USING ERRCODE = '22023';
    END IF;

    UPDATE public.notification_outbox
    SET status = 'completed',
        locked_by = NULL,
        locked_until = NULL,
        next_retry_at = NULL,
        processed_at = now(),
        updated_at = now()
    WHERE id = p_job_id 
      AND locked_by = trim(p_worker_id) 
      AND (locked_until IS NOT NULL AND locked_until > now());

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    RETURN (v_updated_rows > 0);
END;
$$;

-- 5.5 Lease-Safe Mark Failed with Nullable next_retry_at for Dead-Letters
CREATE OR REPLACE FUNCTION public.mark_outbox_job_failed(
    p_job_id UUID,
    p_worker_id VARCHAR,
    p_error_message TEXT,
    p_is_permanent BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_updated_rows INT;
    v_is_dead_letter BOOLEAN;
    v_current_retries INT;
    v_max_retries INT;
BEGIN
    IF p_job_id IS NULL THEN
        RAISE EXCEPTION 'p_job_id cannot be null' USING ERRCODE = '22023';
    END IF;
    IF p_worker_id IS NULL OR length(trim(p_worker_id)) < 3 THEN
        RAISE EXCEPTION 'Invalid worker_id' USING ERRCODE = '22023';
    END IF;

    SELECT retry_count, max_retries 
    INTO v_current_retries, v_max_retries
    FROM public.notification_outbox 
    WHERE id = p_job_id;

    IF v_current_retries IS NULL THEN
        RETURN FALSE;
    END IF;

    v_is_dead_letter := (p_is_permanent = TRUE OR (v_current_retries + 1 >= v_max_retries));

    UPDATE public.notification_outbox
    SET status = CASE WHEN v_is_dead_letter THEN 'dead_letter' ELSE 'pending' END,
        retry_count = retry_count + 1,
        next_retry_at = CASE 
                           WHEN v_is_dead_letter THEN NULL 
                           ELSE now() + (power(2, LEAST(retry_count, 6)) * interval '15 seconds')
                        END,
        last_error = substr(COALESCE(p_error_message, 'Unknown error'), 1, 2000),
        locked_by = NULL,
        locked_until = NULL,
        updated_at = now()
    WHERE id = p_job_id 
      AND locked_by = trim(p_worker_id) 
      AND (locked_until IS NOT NULL AND locked_until > now());

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    RETURN (v_updated_rows > 0);
END;
$$;

-- 5.6 Trigger: New Ticket -> Outbox
CREATE OR REPLACE FUNCTION public.trg_fn_ticket_created_outbox()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    INSERT INTO public.notification_outbox (
        event_type, target_audience, recipient_email,
        title, body, data, priority, deduplication_key
    ) VALUES (
        'new_ticket', 'developer_all', 'tasklypets@gmail.com',
        'New Support Ticket',
        '[' || NEW.ticket_code || '] ' || NEW.user_email || ': ' || NEW.subject,
        jsonb_build_object('ticket_id', NEW.id, 'ticket_code', NEW.ticket_code, 'screen', 'ticket_detail'),
        'high',
        'ticket_created:' || NEW.id::text
    ) ON CONFLICT (deduplication_key) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ticket_created_outbox ON public.support_tickets;
CREATE TRIGGER trg_ticket_created_outbox
    AFTER INSERT ON public.support_tickets
    FOR EACH ROW EXECUTE FUNCTION public.trg_fn_ticket_created_outbox();

-- 5.7 Trigger: Developer Reply -> Outbox (Fail-Closed Internal Note Exclusion)
CREATE OR REPLACE FUNCTION public.trg_fn_ticket_reply_outbox()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_ticket RECORD;
    v_snippet TEXT;
BEGIN
    IF NEW.sender_type != 'developer' THEN
        RETURN NEW;
    END IF;

    -- Fail-Closed Guard: Malformed, internal, or non-object metadata strictly returns NEW with zero notification
    IF public.is_internal_note_json(NEW.metadata, NEW.sender_type) THEN
        RETURN NEW;
    END IF;

    SELECT id, ticket_code, user_id, user_email INTO v_ticket 
    FROM public.support_tickets WHERE id = NEW.ticket_id;

    IF v_ticket.id IS NULL THEN
        RETURN NEW;
    END IF;

    v_snippet := substr(NEW.body, 1, 150);
    IF length(NEW.body) > 150 THEN
        v_snippet := v_snippet || '...';
    END IF;

    INSERT INTO public.notification_outbox (
        event_type, target_audience, recipient_user_id, recipient_email,
        title, body, data, priority, deduplication_key
    ) VALUES (
        'ticket_reply', 'customer_single', v_ticket.user_id, v_ticket.user_email,
        'Support Reply: ' || v_ticket.ticket_code,
        v_snippet,
        jsonb_build_object('ticket_id', v_ticket.id, 'ticket_code', v_ticket.ticket_code, 'screen', 'ticket_detail'),
        'high',
        'ticket_reply:' || NEW.id::text
    ) ON CONFLICT (deduplication_key) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ticket_reply_outbox ON public.support_ticket_messages;
CREATE TRIGGER trg_ticket_reply_outbox
    AFTER INSERT ON public.support_ticket_messages
    FOR EACH ROW EXECUTE FUNCTION public.trg_fn_ticket_reply_outbox();

-- 5.8 Trigger: Status & Priority Changes -> Outbox (Microsecond Entropy Collision Avoidance)
CREATE OR REPLACE FUNCTION public.trg_fn_ticket_update_outbox()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_title TEXT;
    v_body TEXT;
    v_event_type TEXT;
    v_dedup TEXT;
    v_entropy TEXT;
BEGIN
    -- Microsecond clock precision combined with 6-char random entropy prevents same-second collisions
    v_entropy := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS') || '_' || substr(gen_random_uuid()::text, 1, 6);

    -- Status Transitions
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        IF NEW.status = 'resolved' THEN
            v_event_type := 'ticket_resolved';
            v_title := 'Ticket Resolved: ' || NEW.ticket_code;
            v_body := 'Your support ticket has been marked as resolved.';
        ELSIF NEW.status = 'closed' THEN
            v_event_type := 'ticket_closed';
            v_title := 'Ticket Closed: ' || NEW.ticket_code;
            v_body := 'Your support ticket has been closed.';
        ELSIF OLD.status IN ('resolved', 'closed') AND NEW.status = 'open' THEN
            v_event_type := 'ticket_reopened';
            v_title := 'Ticket Reopened: ' || NEW.ticket_code;
            v_body := 'Your support ticket has been reopened for further investigation.';
        ELSE
            v_event_type := 'status_changed';
            v_title := 'Ticket Status Updated: ' || NEW.ticket_code;
            v_body := 'Status changed to ' || initcap(replace(NEW.status, '_', ' ')) || '.';
        END IF;

        v_dedup := 'ticket_status:' || NEW.id::text || ':' || NEW.status || ':' || v_entropy;

        INSERT INTO public.notification_outbox (
            event_type, target_audience, recipient_user_id, recipient_email,
            title, body, data, priority, deduplication_key
        ) VALUES (
            v_event_type, 'customer_single', NEW.user_id, NEW.user_email,
            v_title, v_body,
            jsonb_build_object('ticket_id', NEW.id, 'ticket_code', NEW.ticket_code, 'screen', 'ticket_detail'),
            'high', v_dedup
        ) ON CONFLICT (deduplication_key) DO NOTHING;
    END IF;

    -- Priority Transitions
    IF OLD.priority IS DISTINCT FROM NEW.priority THEN
        v_dedup := 'ticket_priority:' || NEW.id::text || ':' || NEW.priority || ':' || v_entropy;

        INSERT INTO public.notification_outbox (
            event_type, target_audience, recipient_user_id, recipient_email,
            title, body, data, priority, deduplication_key
        ) VALUES (
            'priority_changed', 'customer_single', NEW.user_id, NEW.user_email,
            'Ticket Priority Updated: ' || NEW.ticket_code,
            'Priority changed to ' || initcap(NEW.priority) || '.',
            jsonb_build_object('ticket_id', NEW.id, 'ticket_code', NEW.ticket_code, 'screen', 'ticket_detail'),
            'high', v_dedup
        ) ON CONFLICT (deduplication_key) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ticket_update_outbox ON public.support_tickets;
CREATE TRIGGER trg_ticket_update_outbox
    AFTER UPDATE ON public.support_tickets
    FOR EACH ROW EXECUTE FUNCTION public.trg_fn_ticket_update_outbox();

-- 5.9 Enqueue Admin Custom Notification (Input Validation & Server-Side Identity Verification)
CREATE OR REPLACE FUNCTION public.enqueue_admin_custom_notification(
    p_target_type VARCHAR,      -- 'broadcast' or 'direct'
    p_recipient_email VARCHAR,  -- NULL for broadcast
    p_title VARCHAR,
    p_body TEXT,
    p_idempotency_key VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_email VARCHAR(255);
    v_resolved_user_id UUID;
    v_outbox_id UUID;
    v_dedup VARCHAR(255);
    v_priority VARCHAR(16);
    v_target_audience VARCHAR(32);
    v_clean_title VARCHAR(255);
    v_clean_body TEXT;
    v_clean_idempotency_key VARCHAR(255);
    v_clean_email VARCHAR(255);
BEGIN
    -- 1. Strict Server-Side Identity Verification from Session Context
    v_caller_id := auth.uid();
    v_caller_email := auth.jwt() ->> 'email';

    IF v_caller_id IS NULL OR v_caller_email IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: authenticated session required' USING ERRCODE = '42501';
    END IF;

    IF lower(trim(v_caller_email)) != 'tasklypets@gmail.com' THEN
        RAISE EXCEPTION 'Forbidden: only tasklypets@gmail.com may enqueue custom notifications' USING ERRCODE = '42501';
    END IF;

    -- 2. Input Sanitization & Boundary Validation
    IF p_title IS NULL OR length(trim(p_title)) < 1 OR length(trim(p_title)) > 255 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Title is required and must be between 1 and 255 characters');
    END IF;
    v_clean_title := trim(p_title);

    IF p_body IS NULL OR length(trim(p_body)) < 1 OR length(trim(p_body)) > 4000 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Message body is required and must be between 1 and 4000 characters');
    END IF;
    v_clean_body := trim(p_body);

    IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 1 OR length(trim(p_idempotency_key)) > 255 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Idempotency key is required and must be up to 255 characters');
    END IF;
    v_clean_idempotency_key := trim(p_idempotency_key);

    -- 3. Target Audience Resolution
    IF p_target_type = 'direct' THEN
        IF p_recipient_email IS NULL OR length(trim(p_recipient_email)) < 3 THEN
            RETURN jsonb_build_object('success', false, 'error', 'Recipient email is required for direct notifications');
        END IF;

        v_clean_email := lower(trim(p_recipient_email));
        IF v_clean_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Invalid recipient email format');
        END IF;

        IF v_clean_email = 'tasklypets@gmail.com' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Cannot send customer direct notification to admin account');
        END IF;

        -- Resolved securely within auth.users schema boundary
        SELECT id INTO v_resolved_user_id 
        FROM auth.users 
        WHERE lower(trim(email)) = v_clean_email;

        IF v_resolved_user_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'No customer account found for the specified email address');
        END IF;

        v_target_audience := 'customer_single';
        v_priority := 'high';
        v_dedup := 'admin_direct:' || v_resolved_user_id::text || ':' || v_clean_idempotency_key;
    ELSIF p_target_type = 'broadcast' THEN
        v_target_audience := 'customer_all';
        v_priority := 'normal';
        v_dedup := 'admin_broadcast:' || v_clean_idempotency_key;
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'Invalid target type. Must be broadcast or direct');
    END IF;

    -- 4. Atomic Outbox Enqueue
    INSERT INTO public.notification_outbox (
        event_type, target_audience, recipient_user_id, recipient_email,
        title, body, data, priority, deduplication_key
    ) VALUES (
        CASE WHEN p_target_type = 'direct' THEN 'admin_custom_direct' ELSE 'admin_custom_broadcast' END,
        v_target_audience, v_resolved_user_id, v_clean_email,
        v_clean_title, v_clean_body,
        jsonb_build_object('screen', 'notifications'),
        v_priority, v_dedup
    ) ON CONFLICT (deduplication_key) DO NOTHING
    RETURNING id INTO v_outbox_id;

    RETURN jsonb_build_object(
        'success', true,
        'outbox_id', v_outbox_id,
        'deduplication_key', v_dedup,
        'is_replay', (v_outbox_id IS NULL)
    );
END;
$$;

-- ==============================================================================
-- 6. Privileged Grants & Revokes Matrix
-- ==============================================================================

REVOKE ALL ON FUNCTION public.is_internal_note_json(JSONB, VARCHAR) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_internal_note_json(JSONB, VARCHAR) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_authorized_developer_user_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_authorized_developer_user_ids() TO service_role;

REVOKE ALL ON FUNCTION public.expand_broadcast_inbox_atomic(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expand_broadcast_inbox_atomic(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.claim_notification_outbox_batch(VARCHAR, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_outbox_batch(VARCHAR, INT, INT) TO service_role;

REVOKE ALL ON FUNCTION public.mark_outbox_job_completed(UUID, VARCHAR) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_outbox_job_completed(UUID, VARCHAR) TO service_role;

REVOKE ALL ON FUNCTION public.mark_outbox_job_failed(UUID, VARCHAR, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_outbox_job_failed(UUID, VARCHAR, TEXT, BOOLEAN) TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_admin_custom_notification(VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_admin_custom_notification(VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR) TO authenticated, service_role;

COMMIT;
