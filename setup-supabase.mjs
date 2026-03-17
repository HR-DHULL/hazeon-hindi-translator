/**
 * One-time setup script — creates the jobs table and storage buckets in Supabase.
 * Run with: node setup-supabase.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

async function setup() {
  console.log('Setting up Supabase...\n');

  // 1. Create storage buckets
  console.log('1. Creating storage buckets...');

  const { error: outErr } = await supabase.storage.createBucket('outputs', {
    public: true,
    allowedMimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/pdf',
    ],
  });
  if (outErr && !outErr.message.includes('already exists')) {
    console.error('   Failed to create "outputs" bucket:', outErr.message);
  } else {
    console.log('   "outputs" bucket ready (public)');
  }

  const { error: tmpErr } = await supabase.storage.createBucket('temp-uploads', {
    public: false,
    allowedMimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
  });
  if (tmpErr && !tmpErr.message.includes('already exists')) {
    console.error('   Failed to create "temp-uploads" bucket:', tmpErr.message);
  } else {
    console.log('   "temp-uploads" bucket ready (private)');
  }

  // 2. Check if jobs table exists by trying a query
  console.log('\n2. Checking jobs table...');
  const { error: tableErr } = await supabase
    .from('jobs')
    .select('id')
    .limit(1);

  if (tableErr && tableErr.message.includes('does not exist')) {
    console.log('   "jobs" table does NOT exist yet.');
    console.log('   Please run the following SQL in Supabase Dashboard → SQL Editor:\n');
    console.log(`
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

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
  ON public.jobs FOR ALL
  USING (true)
  WITH CHECK (true);
`);
  } else if (tableErr) {
    console.error('   Error checking table:', tableErr.message);
  } else {
    console.log('   "jobs" table exists!');
  }

  console.log('\nSetup complete!');
}

setup().catch(console.error);
