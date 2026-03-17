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
      contentType: filename.endsWith('.docx')
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf',
      upsert: true,
    });
  if (error) throw error;

  const { data } = supabase.storage.from(OUTPUT_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
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
