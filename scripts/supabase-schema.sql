-- ==============================================================================
-- Taskly - Supabase PostgreSQL Production Database Schema
-- ==============================================================================
-- Instructions:
-- 1. Open your Supabase Dashboard: https://supabase.com/dashboard
-- 2. Select your Project -> Click "SQL Editor" in the left sidebar.
-- 3. Click "+ New query", paste this entire script, and click "Run".
-- ==============================================================================

-- 1. Create the todos table
CREATE TABLE IF NOT EXISTS public.todos (
  id TEXT PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  due_date VARCHAR(10) DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NULL
);

-- 2. Performance Index: Order by creation date descending
CREATE INDEX IF NOT EXISTS idx_todos_created_at ON public.todos (created_at DESC);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;

-- 4. Idempotent Security Policies (Allows anon/authenticated CRUD access via Supabase API)
DROP POLICY IF EXISTS "Allow public read access" ON public.todos;
CREATE POLICY "Allow public read access" ON public.todos
  FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Allow public insert access" ON public.todos;
CREATE POLICY "Allow public insert access" ON public.todos
  FOR INSERT
  TO public
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public update access" ON public.todos;
CREATE POLICY "Allow public update access" ON public.todos
  FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public delete access" ON public.todos;
CREATE POLICY "Allow public delete access" ON public.todos
  FOR DELETE
  TO public
  USING (true);

-- 5. Seed initial tasks (safe and idempotent - only inserts if IDs do not already exist)
INSERT INTO public.todos (id, title, completed, due_date, created_at)
SELECT
  '58233a4e-2f73-49bf-b927-a5e59acbcf12',
  'Team roadmap sync',
  false,
  '2026-11-10',
  '2026-10-31T12:48:35.195Z'::TIMESTAMPTZ
WHERE NOT EXISTS (
  SELECT 1 FROM public.todos WHERE id = '58233a4e-2f73-49bf-b927-a5e59acbcf12'
);

INSERT INTO public.todos (id, title, completed, due_date, created_at)
SELECT
  '90bcd97e-6f57-4855-828f-a95ee31dd371',
  'Quarterly audit review',
  false,
  '2026-10-25',
  '2026-10-31T12:48:35.186Z'::TIMESTAMPTZ
WHERE NOT EXISTS (
  SELECT 1 FROM public.todos WHERE id = '90bcd97e-6f57-4855-828f-a95ee31dd371'
);

INSERT INTO public.todos (id, title, completed, due_date, created_at)
SELECT
  'ad48a114-ca80-465b-b7ba-b97a8dbae729',
  'Review client proposal',
  false,
  '2026-10-31',
  '2026-10-31T12:48:35.174Z'::TIMESTAMPTZ
WHERE NOT EXISTS (
  SELECT 1 FROM public.todos WHERE id = 'ad48a114-ca80-465b-b7ba-b97a8dbae729'
);


