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

export async function dbGetAllJobs(userId = null, role = 'user', { limit = 50, offset = 0 } = {}) {
  if (userId) {
    // Regular user — fetch only their jobs
    const { data, error } = await supabase
      .from('jobs').select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    // Get total count for pagination
    const { count } = await supabase
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    return { jobs: (data || []).map(rowToJob), total: count || 0 };
  }
  // Admin — fetch all jobs + user info
  const { data: jobRows, error } = await supabase
    .from('jobs').select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;

  // Get total count for pagination
  const { count } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true });

  // Fetch user profiles to map user_id → name/email
  const userIds = [...new Set((jobRows || []).map(j => j.user_id).filter(Boolean))];
  let userMap = {};
  if (userIds.length > 0) {
    try {
      const { data: profiles } = await supabase
        .from('user_profiles').select('id, full_name, email')
        .in('id', userIds);
      for (const p of (profiles || [])) {
        userMap[p.id] = { name: p.full_name || '', email: p.email || '' };
      }
    } catch {}
  }

  const jobs = (jobRows || []).map(row => {
    const job = rowToJob(row);
    const user = userMap[row.user_id];
    if (user) {
      job.userName = user.name;
      job.userEmail = user.email;
    }
    return job;
  });

  return { jobs, total: count || 0 };
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
  const { stat } = await import('fs/promises');
  const https = await import('https');

  const storagePath = `${jobId}/${filename}`;
  const contentType = filename.endsWith('.json')
    ? 'application/json'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  const fileSize = (await stat(filePath)).size;
  const uploadUrl = new URL(`${supabaseUrl}/storage/v1/object/${OUTPUT_BUCKET}/${storagePath}`);

  // Use native https.request with streaming — most reliable for large file uploads
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      req.destroy(new Error('Upload timed out after 3 minutes'));
    }, 180_000);

    const req = https.request({
      hostname: uploadUrl.hostname,
      port: 443,
      path: uploadUrl.pathname,
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': contentType,
        'Content-Length': fileSize,
        'x-upsert': 'true',
      },
    }, (res) => {
      clearTimeout(timeout);
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`Storage upload failed (${res.statusCode}): ${body}`));
        }
      });
    });

    req.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    // Stream the file to the request
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(req);
    fileStream.on('error', (err) => {
      clearTimeout(timeout);
      req.destroy(err);
      reject(err);
    });
  });

  const publicUrl = `${supabaseUrl}/storage/v1/object/public/${OUTPUT_BUCKET}/${storagePath}`;
  return publicUrl;
}

// ─── User profile helpers (source of truth: user_profiles table) ─────────────

export async function dbGetUserProfile(userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('pages_used, pages_limit, role')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return {
    pages_used: data.pages_used || 0,
    pages_limit: data.pages_limit || 500,
    role: data.role || 'user',
  };
}

/**
 * Atomically check and reserve pages in one SQL transaction via RPC.
 * Uses SELECT FOR UPDATE + conditional UPDATE — no TOCTOU race condition.
 * Returns { success: true, remaining } or { success: false, remaining, needed }.
 */
export async function dbReservePages(userId, pagesNeeded) {
  const { data, error } = await supabase.rpc('reserve_pages_atomic', {
    p_user_id: userId,
    p_increment: pagesNeeded,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('reserve_pages_atomic returned no result');
  const remaining = (row.pages_limit || 500) - (row.pages_used || 0);
  if (!row.success) {
    const before = (row.pages_limit || 500) - ((row.pages_used || 0) - pagesNeeded);
    return { success: false, remaining: row.pages_used !== undefined ? (row.pages_limit - row.pages_used) : 0, needed: pagesNeeded };
  }
  return { success: true, remaining, reserved: true };
}

export async function dbIncrementPages(userId, pages) {
  const { error } = await supabase.rpc('increment_pages_used', {
    user_id: userId,
    increment: pages,
  });
  if (error) {
    console.error('Failed to increment pages_used:', error.message);
    throw error;
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

// ─── Custom Glossary ─────────────────────────────────────────────────────────

export async function dbGetGlossary(userId) {
  const { data, error } = await supabase
    .from('custom_glossary')
    .select('id, english_term, hindi_term')
    .eq('user_id', userId)
    .order('english_term');
  if (error) throw error;
  return data || [];
}

export async function dbAddGlossaryTerms(userId, terms) {
  // terms: [{ english_term, hindi_term }]
  const rows = terms.map(t => ({
    user_id: userId,
    english_term: t.english_term.trim(),
    hindi_term: t.hindi_term.trim(),
  }));
  const { error } = await supabase
    .from('custom_glossary')
    .upsert(rows, { onConflict: 'user_id,english_term' });
  if (error) throw error;
}

export async function dbDeleteGlossaryTerm(userId, termId) {
  const { error } = await supabase
    .from('custom_glossary')
    .delete()
    .eq('id', termId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function dbClearGlossary(userId) {
  const { error } = await supabase
    .from('custom_glossary')
    .delete()
    .eq('user_id', userId);
  if (error) throw error;
}

// ─── Zombie job cleanup ─────────────────────────────────────────────────────
// Jobs stuck in "processing" for >15 minutes are zombie jobs (server crashed/restarted).
// Mark them as failed so they don't block the queue.

export async function dbCleanupZombieJobs(maxAgeMinutes = 15) {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();
  try {
    // Find processing jobs older than cutoff that haven't been updated
    const { data: zombies, error: fetchErr } = await supabase
      .from('jobs')
      .select('id, original_name, progress, created_at')
      .eq('status', 'processing')
      .lt('created_at', cutoff);
    if (fetchErr || !zombies?.length) return 0;

    // Mark them as failed
    const { error: updateErr } = await supabase
      .from('jobs')
      .update({ status: 'failed', message: 'Translation timed out (server restarted). Please try again.' })
      .eq('status', 'processing')
      .lt('created_at', cutoff);
    if (updateErr) throw updateErr;

    console.log(`  Cleaned up ${zombies.length} zombie job(s):`, zombies.map(z => `${z.original_name} (${z.progress}%)`).join(', '));
    return zombies.length;
  } catch (e) {
    console.warn('Zombie cleanup failed (non-fatal):', e.message);
    return 0;
  }
}

// ─── Row ↔ Job mappers ───────────────────────────────────────────────────────

function jobToRow(job) {
  return {
    id: job.id,
    user_id: job.userId,
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
  if (updates.qualityScore !== undefined) row.quality_score = updates.qualityScore;
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
    qualityScore: row.quality_score ?? null,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}
