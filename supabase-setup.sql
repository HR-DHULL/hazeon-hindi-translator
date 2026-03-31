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
  quality_score INTEGER,
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

-- 3. RPC functions for atomic page operations (avoids race conditions)

-- Simple increment (used after translation completes)
CREATE OR REPLACE FUNCTION public.increment_pages_used(user_id UUID, increment INTEGER)
RETURNS void AS $$
BEGIN
  UPDATE public.user_profiles
  SET pages_used = pages_used + increment
  WHERE id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Atomic reserve-and-increment: checks limit then increments in one transaction.
-- Returns (success, pages_used, pages_limit). If limit exceeded, does nothing.
CREATE OR REPLACE FUNCTION public.reserve_pages_atomic(
  p_user_id UUID,
  p_increment INTEGER
) RETURNS TABLE(success BOOLEAN, pages_used INTEGER, pages_limit INTEGER) AS $$
DECLARE
  v_used  INTEGER;
  v_limit INTEGER;
BEGIN
  SELECT up.pages_used, up.pages_limit
    INTO v_used, v_limit
    FROM public.user_profiles up
   WHERE up.id = p_user_id
     FOR UPDATE;  -- row-level lock prevents concurrent updates

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, 0;
    RETURN;
  END IF;

  IF v_used + p_increment > v_limit THEN
    RETURN QUERY SELECT false, v_used, v_limit;
    RETURN;
  END IF;

  UPDATE public.user_profiles
     SET pages_used = pages_used + p_increment
   WHERE id = p_user_id
  RETURNING user_profiles.pages_used, user_profiles.pages_limit
    INTO v_used, v_limit;

  RETURN QUERY SELECT true, v_used, v_limit;
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

-- 7. Custom Glossary — user-defined English→Hindi term overrides
CREATE TABLE IF NOT EXISTS public.custom_glossary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  english_term TEXT NOT NULL,
  hindi_term TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, english_term)
);

CREATE INDEX IF NOT EXISTS idx_custom_glossary_user ON public.custom_glossary(user_id);

ALTER TABLE public.custom_glossary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on custom_glossary"
  ON public.custom_glossary FOR ALL
  USING (true)
  WITH CHECK (true);

-- 8. Translation Memory — caches English→Hindi paragraph translations
--    Saves Gemini API calls for repeated UPSC content across documents.
CREATE TABLE IF NOT EXISTS public.translation_cache (
  source_hash TEXT PRIMARY KEY,            -- MD5 of trimmed source text
  source_text TEXT NOT NULL,               -- first 2000 chars of English source
  translated_text TEXT NOT NULL,           -- Hindi translation
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for cleanup queries (delete old entries if table grows too large)
CREATE INDEX IF NOT EXISTS idx_translation_cache_created
  ON public.translation_cache(created_at);

ALTER TABLE public.translation_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on translation_cache"
  ON public.translation_cache FOR ALL
  USING (true)
  WITH CHECK (true);
