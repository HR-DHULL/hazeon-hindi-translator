import { createClient } from '@supabase/supabase-js';

// Supabase client — credentials come from environment variables
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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

// ─── User profile helpers ─────────────────────────────────────────────────────

export async function dbGetUserProfile(userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('pages_used, pages_limit, role')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Atomically check remaining pages and reserve them to prevent TOCTOU race conditions.
 * Returns { success: true, remaining } or { success: false, remaining, needed }.
 */
export async function dbReservePages(userId, pagesNeeded) {
  // Try RPC first (atomic DB-level check-and-increment)
  const { data, error } = await supabase.rpc('reserve_pages_if_available', {
    p_user_id: userId,
    p_pages_needed: pagesNeeded,
  });

  if (!error && data !== null && data !== undefined) {
    // RPC returned true/false
    if (data === true || data?.success) {
      return { success: true };
    }
    return { success: false, message: 'Page limit would be exceeded' };
  }

  // Fallback: fetch-check-update (not fully atomic but better than nothing)
  console.warn('reserve_pages_if_available RPC not available, using fallback');
  const profile = await dbGetUserProfile(userId);
  const remaining = (profile.pages_limit || 500) - (profile.pages_used || 0);
  if (pagesNeeded > remaining) {
    return { success: false, remaining, needed: pagesNeeded };
  }
  // Optimistic increment — reserve the pages upfront
  await dbIncrementPages(userId, pagesNeeded);
  return { success: true, remaining: remaining - pagesNeeded, reserved: true };
}

export async function dbIncrementPages(userId, pages) {
  const { error } = await supabase.rpc('increment_pages_used', {
    user_id: userId,
    increment: pages,
  });
  // Fallback if RPC function doesn't exist: fetch then update
  if (error) {
    console.warn('RPC increment_pages_used failed, using fallback:', error.message);
    const { data: profile, error: fetchErr } = await supabase
      .from('user_profiles')
      .select('pages_used')
      .eq('id', userId)
      .single();
    if (fetchErr) {
      console.error('Failed to fetch user profile for page increment:', fetchErr.message);
      throw fetchErr;
    }
    const current = profile?.pages_used || 0;
    const { error: updateErr } = await supabase
      .from('user_profiles')
      .update({ pages_used: current + pages })
      .eq('id', userId);
    if (updateErr) {
      console.error('Failed to update pages_used:', updateErr.message);
      throw updateErr;
    }
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
