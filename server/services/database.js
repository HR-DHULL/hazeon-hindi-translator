import { createClient } from '@supabase/supabase-js';

// Lazy Supabase client — only created when first used (allows server to start without credentials)
let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      throw new Error('Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');
    }
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  }
  return _supabase;
}
// Backward-compatible getter
const supabase = new Proxy({}, {
  get: (_, prop) => getSupabase()[prop],
});

// ─── Job CRUD ────────────────────────────────────────────────────────────────

export async function dbGetJob(id) {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return rowToJob(data);
}

export async function dbGetAllJobs(userId = null) {
  let query = supabase.from('jobs').select('*').order('created_at', { ascending: false });
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(rowToJob);
}

export async function dbCreateJob(job) {
  const { error } = await supabase
    .from('jobs')
    .insert([jobToRow(job)]);
  if (error) throw error;
}

export async function dbCountActiveJobs() {
  const { count, error } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'processing');
  if (error) throw error;
  return count || 0;
}

export async function dbUpdateJob(id, updates) {
  const { error } = await supabase
    .from('jobs')
    .update(updatesToRow(updates))
    .eq('id', id);
  if (error) throw error;
}

export async function dbDeleteJob(id) {
  const { error } = await supabase
    .from('jobs')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ─── Supabase Storage for translated output files ────────────────────────────

const OUTPUT_BUCKET = 'outputs';

export async function uploadOutputFile(jobId, filename, filePath) {
  const fs = await import('fs');
  const fileBuffer = fs.readFileSync(filePath);

  const storagePath = `${jobId}/${filename}`;
  const { error } = await supabase.storage
    .from(OUTPUT_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true,
    });
  if (error) throw error;

  const { data } = supabase.storage.from(OUTPUT_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

// ─── User profile helpers (uses Supabase Auth app_metadata — no extra table needed) ──

export async function dbGetUserProfile(userId) {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) throw error;
  const meta = data?.user?.app_metadata || {};
  return {
    pages_used: meta.pages_used || 0,
    pages_limit: meta.pages_limit || 500,
    role: meta.role || 'user',
  };
}

/**
 * Check remaining pages and reserve them using Supabase Auth app_metadata.
 * Returns { success: true, remaining } or { success: false, remaining, needed }.
 */
export async function dbReservePages(userId, pagesNeeded) {
  const profile = await dbGetUserProfile(userId);
  const remaining = (profile.pages_limit || 500) - (profile.pages_used || 0);
  if (pagesNeeded > remaining) {
    return { success: false, remaining, needed: pagesNeeded };
  }
  // Increment pages_used in app_metadata
  await dbIncrementPages(userId, pagesNeeded);
  return { success: true, remaining: remaining - pagesNeeded, reserved: true };
}

export async function dbIncrementPages(userId, pages) {
  // Fetch current pages_used from app_metadata
  const { data, error: fetchErr } = await supabase.auth.admin.getUserById(userId);
  if (fetchErr) {
    console.error('Failed to fetch user for page increment:', fetchErr.message);
    throw fetchErr;
  }
  const currentUsed = data?.user?.app_metadata?.pages_used || 0;
  const { error: updateErr } = await supabase.auth.admin.updateUserById(userId, {
    app_metadata: { pages_used: currentUsed + pages },
  });
  if (updateErr) {
    console.error('Failed to update pages_used in app_metadata:', updateErr.message);
    throw updateErr;
  }
}

// ─── Supabase Storage: input files (temp, for Netlify background fn) ─────────

const INPUT_BUCKET = 'inputs';

export async function uploadInputFile(jobId, filename, filePath) {
  const fs = await import('fs');
  const fileBuffer = fs.readFileSync(filePath);
  const storagePath = `${jobId}/${filename}`;
  const { error } = await supabase.storage
    .from(INPUT_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true,
    });
  if (error) throw error;
  return storagePath;
}

export async function downloadInputFile(storageKey, destPath) {
  const { data, error } = await supabase.storage.from(INPUT_BUCKET).download(storageKey);
  if (error) throw error;
  const fs = await import('fs');
  const buffer = Buffer.from(await data.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
}

export async function deleteInputFile(storageKey) {
  await supabase.storage.from(INPUT_BUCKET).remove([storageKey]);
}

export async function createSignedUploadUrl(jobId, filename) {
  const storagePath = `${jobId}/${filename}`;
  const { data, error } = await supabase.storage
    .from(INPUT_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (error) throw error;
  return { signedUrl: data.signedUrl, storagePath };
}

// ─── Row ↔ Job mappers ───────────────────────────────────────────────────────

function jobToRow(job) {
  return {
    id: job.id,
    user_id: job.userId || null,
    original_name: job.originalName,
    book_context: job.bookContext || '',
    status: job.status,
    progress: job.progress || 0,
    message: job.message || '',
    page_count: job.pageCount || null,
    char_count: job.charCount || null,
    current_chunk: job.currentChunk || null,
    total_chunks: job.totalChunks || null,
    output_files: job.outputFiles || [],
    created_at: job.createdAt,
    completed_at: job.completedAt || null,
  };
}

function updatesToRow(updates) {
  const row = {};
  if (updates.status !== undefined)       row.status = updates.status;
  if (updates.progress !== undefined)     row.progress = updates.progress;
  if (updates.message !== undefined)      row.message = updates.message;
  if (updates.pageCount !== undefined)    row.page_count = updates.pageCount;
  if (updates.charCount !== undefined)    row.char_count = updates.charCount;
  if (updates.currentChunk !== undefined) row.current_chunk = updates.currentChunk;
  if (updates.totalChunks !== undefined)  row.total_chunks = updates.totalChunks;
  if (updates.outputFiles !== undefined)  row.output_files = updates.outputFiles;
  if (updates.completedAt !== undefined)  row.completed_at = updates.completedAt;
  return row;
}

function rowToJob(row) {
  return {
    id: row.id,
    userId: row.user_id,
    originalName: row.original_name,
    bookContext: row.book_context,
    status: row.status,
    progress: row.progress,
    message: row.message,
    pageCount: row.page_count,
    charCount: row.char_count,
    currentChunk: row.current_chunk,
    totalChunks: row.total_chunks,
    outputFiles: row.output_files || [],
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}
