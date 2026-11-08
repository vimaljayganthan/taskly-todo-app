-- ==============================================================================
-- Taskly - Production Database Migration: Smart Lists Feature
-- File: scripts/002_smart_lists_schema.sql
-- ==============================================================================
-- Target: Supabase PostgreSQL
-- Features:
--   1. smart_routines: Routine definitions (title, order_index, user_id)
--   2. smart_routine_completions: Date-specific completion state & carry-forward
--   3. smart_routine_reports: Daily summary reports & carry-forward decisions
--   4. smart_routine_settings: User reminder preferences (time, enabled)
-- Security:
--   Strict Row Level Security (RLS) enforcing auth.uid() = user_id for all operations.
-- ==============================================================================

BEGIN;

-- 1. smart_routines table
CREATE TABLE IF NOT EXISTS public.smart_routines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title VARCHAR(150) NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_smart_routines_user_order 
  ON public.smart_routines (user_id, order_index ASC, created_at ASC);

ALTER TABLE public.smart_routines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "smart_routines_select_policy" ON public.smart_routines;
CREATE POLICY "smart_routines_select_policy" ON public.smart_routines
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_routines_insert_policy" ON public.smart_routines;
CREATE POLICY "smart_routines_insert_policy" ON public.smart_routines
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_routines_update_policy" ON public.smart_routines;
CREATE POLICY "smart_routines_update_policy" ON public.smart_routines
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_routines_delete_policy" ON public.smart_routines;
CREATE POLICY "smart_routines_delete_policy" ON public.smart_routines
  FOR DELETE TO authenticated USING (auth.uid() = user_id);


-- 2. smart_routine_completions table
CREATE TABLE IF NOT EXISTS public.smart_routine_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  routine_id UUID NOT NULL REFERENCES public.smart_routines(id) ON DELETE CASCADE,
  date VARCHAR(10) NOT NULL, -- Format: YYYY-MM-DD
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ DEFAULT NULL,
  carried_forward BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_smart_completions_user_routine_date UNIQUE (user_id, routine_id, date)
);

CREATE INDEX IF NOT EXISTS idx_smart_completions_user_date 
  ON public.smart_routine_completions (user_id, date);

ALTER TABLE public.smart_routine_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "smart_completions_select_policy" ON public.smart_routine_completions;
CREATE POLICY "smart_completions_select_policy" ON public.smart_routine_completions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_completions_insert_policy" ON public.smart_routine_completions;
CREATE POLICY "smart_completions_insert_policy" ON public.smart_routine_completions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_completions_update_policy" ON public.smart_routine_completions;
CREATE POLICY "smart_completions_update_policy" ON public.smart_routine_completions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_completions_delete_policy" ON public.smart_routine_completions;
CREATE POLICY "smart_completions_delete_policy" ON public.smart_routine_completions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);


-- 3. smart_routine_reports table
CREATE TABLE IF NOT EXISTS public.smart_routine_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date VARCHAR(10) NOT NULL, -- Format: YYYY-MM-DD
  total_routines INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  incomplete_count INTEGER NOT NULL DEFAULT 0,
  completion_rate INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'Not Started',
  completed_routines JSONB NOT NULL DEFAULT '[]'::jsonb,
  incomplete_routines JSONB NOT NULL DEFAULT '[]'::jsonb,
  carry_forward_decision VARCHAR(20) DEFAULT 'pending', -- 'yes', 'no', 'pending'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NULL,
  CONSTRAINT uq_smart_reports_user_date UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_smart_reports_user_date 
  ON public.smart_routine_reports (user_id, date DESC);

ALTER TABLE public.smart_routine_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "smart_reports_select_policy" ON public.smart_routine_reports;
CREATE POLICY "smart_reports_select_policy" ON public.smart_routine_reports
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_reports_insert_policy" ON public.smart_routine_reports;
CREATE POLICY "smart_reports_insert_policy" ON public.smart_routine_reports
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_reports_update_policy" ON public.smart_routine_reports;
CREATE POLICY "smart_reports_update_policy" ON public.smart_routine_reports
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_reports_delete_policy" ON public.smart_routine_reports;
CREATE POLICY "smart_reports_delete_policy" ON public.smart_routine_reports
  FOR DELETE TO authenticated USING (auth.uid() = user_id);


-- 4. smart_routine_settings table
CREATE TABLE IF NOT EXISTS public.smart_routine_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  daily_summary_enabled BOOLEAN NOT NULL DEFAULT true,
  daily_summary_time VARCHAR(10) NOT NULL DEFAULT '22:00',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.smart_routine_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "smart_settings_select_policy" ON public.smart_routine_settings;
CREATE POLICY "smart_settings_select_policy" ON public.smart_routine_settings
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_settings_insert_policy" ON public.smart_routine_settings;
CREATE POLICY "smart_settings_insert_policy" ON public.smart_routine_settings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_settings_update_policy" ON public.smart_routine_settings;
CREATE POLICY "smart_settings_update_policy" ON public.smart_routine_settings
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "smart_settings_delete_policy" ON public.smart_routine_settings;
CREATE POLICY "smart_settings_delete_policy" ON public.smart_routine_settings
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Privileges: authenticated users get full CRUD; anon gets none
GRANT SELECT, INSERT, UPDATE, DELETE ON public.smart_routines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.smart_routine_completions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.smart_routine_reports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.smart_routine_settings TO authenticated;

REVOKE ALL ON public.smart_routines FROM anon, PUBLIC;
REVOKE ALL ON public.smart_routine_completions FROM anon, PUBLIC;
REVOKE ALL ON public.smart_routine_reports FROM anon, PUBLIC;
REVOKE ALL ON public.smart_routine_settings FROM anon, PUBLIC;

COMMIT;

