-- Hindi Translator - Database Index Migration
-- Run this in Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- These indexes improve query performance for common operations.

-- 1. Translation cache: speed up hash lookups (used on every translation request)
CREATE INDEX IF NOT EXISTS idx_translation_cache_source_hash
  ON translation_cache(source_hash);

-- 2. Jobs: speed up zombie cleanup and status filtering
CREATE INDEX IF NOT EXISTS idx_jobs_status_created
  ON jobs(status, created_at);

-- 3. Jobs: speed up user-specific job listing
CREATE INDEX IF NOT EXISTS idx_jobs_user_id
  ON jobs(user_id);

-- 4. Custom glossary: speed up per-user term lookup
CREATE INDEX IF NOT EXISTS idx_custom_glossary_user_id
  ON custom_glossary(user_id);

-- 5. Translation cache: add TTL column for future cleanup
-- (Optional - uncomment if you want auto-cleanup of old cache entries)
-- ALTER TABLE translation_cache ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
-- CREATE INDEX IF NOT EXISTS idx_translation_cache_created ON translation_cache(created_at);

-- Verify indexes were created
SELECT indexname, tablename FROM pg_indexes
WHERE tablename IN ('translation_cache', 'jobs', 'custom_glossary')
ORDER BY tablename, indexname;
