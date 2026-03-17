-- ============================================================
-- Supabase Setup for Hazeon Hindi Translator
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- 1. Create the user_profiles table
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',
  plan TEXT NOT NULL DEFAULT 'free',
  pages_used INTEGER DEFAULT 0,
  pages_limit INTEGER DEFAULT 500,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on user_profiles"
  ON public.user_profiles FOR ALL
  USING (true)
  WITH CHECK (true);

-- 2. Create the jobs table (with user_id column)
CREATE TABLE IF NOT EXISTS public.jobs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  original_name TEXT NOT NULL,
  book_context TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'processing',
  progress INTEGER DEFAULT 0,
  message TEXT DEFAULT '',
  page_count INTEGER,
  char_count INTEGER,
  current_chunk INTEGER,
  total_chunks INTEGER,
  output_files JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Index for fast user-specific job lookups (history page)
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON public.jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON public.jobs(status);

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on jobs"
  ON public.jobs FOR ALL
  USING (true)
  WITH CHECK (true);

-- 3. RPC function for atomic page increment (avoids race conditions)
CREATE OR REPLACE FUNCTION public.increment_pages_used(user_id UUID, increment INTEGER)
RETURNS void AS $$
BEGIN
  UPDATE public.user_profiles
  SET pages_used = pages_used + increment
  WHERE id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create storage buckets
--    'outputs' → public bucket for translated files (users download from here)
--    'inputs'  → private bucket for temporary uploaded files (used by background function)
INSERT INTO storage.buckets (id, name, public)
VALUES ('outputs', 'outputs', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('inputs', 'inputs', false)
ON CONFLICT (id) DO NOTHING;

-- 5. Storage policies — outputs bucket (public read, service key write)
CREATE POLICY "Public read for outputs"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'outputs');

CREATE POLICY "Service role upload to outputs"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'outputs');

CREATE POLICY "Service role update outputs"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'outputs');

-- 6. Storage policies — inputs bucket (service key only)
CREATE POLICY "Service role full access to inputs"
  ON storage.objects FOR ALL
  USING (bucket_id = 'inputs')
  WITH CHECK (bucket_id = 'inputs');
