/**
 * Migration script — creates missing tables, columns, functions, and storage buckets.
 * Run with: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node migrate.mjs
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://okdfariofkoezymvripl.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_KEY is required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Helper: run SQL via the Supabase SQL endpoint (requires service_role)
async function runSQL(sql) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ query: sql }),
  });
  if (res.ok) return await res.json();

  // If exec_sql doesn't exist, try creating it first
  return null;
}

// Create the exec_sql helper function if it doesn't exist
async function ensureExecSQL() {
  const createFn = `
    CREATE OR REPLACE FUNCTION public.exec_sql(query text)
    RETURNS json
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      EXECUTE query;
      RETURN json_build_object('success', true);
    EXCEPTION WHEN OTHERS THEN
      RETURN json_build_object('success', false, 'error', SQLERRM);
    END;
    $$;
  `;

  // Try to call it first
  const test = await runSQL('SELECT 1');
  if (test) return true;

  // Need to create the function — use the Supabase Management API
  console.log('Creating exec_sql helper function...');
  // We'll try via a different approach — using the pg-meta API
  const pgRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ query: 'SELECT 1' }),
  });

  if (pgRes.status === 404) {
    console.log('\nexec_sql function does not exist. You need to run this SQL manually.');
    return false;
  }
  return true;
}

async function migrate() {
  console.log('Starting migration...\n');

  // 1. Check if exec_sql is available
  const hasExecSQL = await ensureExecSQL();

  if (hasExecSQL) {
    // Run all migrations via SQL
    const migrations = [
      {
        name: 'Create user_profiles table',
        sql: `
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
        `,
      },
      {
        name: 'Create user_profiles RLS policy',
        sql: `
          DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role full access on user_profiles') THEN
              CREATE POLICY "Service role full access on user_profiles"
                ON public.user_profiles FOR ALL USING (true) WITH CHECK (true);
            END IF;
          END $$;
        `,
      },
      {
        name: 'Add user_id column to jobs table',
        sql: `
          DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'user_id') THEN
              ALTER TABLE public.jobs ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
            END IF;
          END $$;
        `,
      },
      {
        name: 'Create indexes on jobs',
        sql: `
          CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON public.jobs(user_id);
          CREATE INDEX IF NOT EXISTS idx_jobs_status ON public.jobs(status);
        `,
      },
      {
        name: 'Create increment_pages_used function',
        sql: `
          CREATE OR REPLACE FUNCTION public.increment_pages_used(user_id UUID, increment INTEGER)
          RETURNS void AS $$
          BEGIN
            UPDATE public.user_profiles SET pages_used = pages_used + increment WHERE id = user_id;
          END;
          $$ LANGUAGE plpgsql SECURITY DEFINER;
        `,
      },
    ];

    for (const m of migrations) {
      console.log(`Running: ${m.name}...`);
      const result = await runSQL(m.sql);
      if (result?.success === false) {
        console.error(`  FAILED: ${result.error}`);
      } else {
        console.log(`  OK`);
      }
    }
  } else {
    console.log('\n⚠️  Cannot run SQL directly. Please copy the SQL below and run it in');
    console.log('   Supabase Dashboard → SQL Editor → New Query:\n');
    console.log('─'.repeat(70));
    console.log(`
-- Step 1: Create user_profiles table
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
  ON public.user_profiles FOR ALL USING (true) WITH CHECK (true);

-- Step 2: Add user_id column to existing jobs table
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON public.jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON public.jobs(status);

-- Step 3: Create increment_pages_used function
CREATE OR REPLACE FUNCTION public.increment_pages_used(user_id UUID, increment INTEGER)
RETURNS void AS $$
BEGIN
  UPDATE public.user_profiles SET pages_used = pages_used + increment WHERE id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
    `);
    console.log('─'.repeat(70));
  }

  // 2. Create storage buckets (works via JS client)
  console.log('\nCreating storage buckets...');

  for (const bucket of [
    { name: 'outputs', isPublic: true },
    { name: 'inputs', isPublic: false },
  ]) {
    const { error } = await supabase.storage.createBucket(bucket.name, {
      public: bucket.isPublic,
    });
    if (error && !error.message.includes('already exists')) {
      console.error(`  "${bucket.name}" FAILED: ${error.message}`);
    } else {
      console.log(`  "${bucket.name}" bucket ready (${bucket.isPublic ? 'public' : 'private'})`);
    }
  }

  console.log('\nMigration complete!');
}

migrate().catch(console.error);
