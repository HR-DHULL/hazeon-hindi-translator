-- ============================================================
-- Supabase Setup for Hazeon Hindi Translator
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- 1. Create the jobs table
CREATE TABLE IF NOT EXISTS public.jobs (
  id UUID PRIMARY KEY,
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

-- 2. Enable Row Level Security
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

-- 3. Allow full access via service_role key (used by backend)
CREATE POLICY "Service role full access"
  ON public.jobs FOR ALL
  USING (true)
  WITH CHECK (true);

-- 4. Create storage buckets
--    'outputs'      → public bucket for translated files (users download from here)
--    'temp-uploads' → private bucket for temporary uploaded files (used by background function)
INSERT INTO storage.buckets (id, name, public)
VALUES ('outputs', 'outputs', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('temp-uploads', 'temp-uploads', false)
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

-- 6. Storage policies — temp-uploads bucket (service key only)
CREATE POLICY "Service role full access to temp-uploads"
  ON storage.objects FOR ALL
  USING (bucket_id = 'temp-uploads')
  WITH CHECK (bucket_id = 'temp-uploads');
