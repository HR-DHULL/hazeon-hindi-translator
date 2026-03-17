/**
 * Netlify Background Function — handles long-running translation jobs.
 * Runs up to 15 minutes (no timeout issues). Called by the upload route
 * after returning the jobId to the client.
 *
 * The filename ends in "-background" which Netlify requires for background functions.
 * These run asynchronously — the 202 response is returned immediately.
 */
import 'dotenv/config';
import { timingSafeEqual } from 'crypto';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { dbUpdateJob, downloadInputFile, deleteInputFile } from '../../server/services/database.js';
import { processTranslation } from '../../server/services/translationPipeline.js';

const OUTPUT_DIR = '/tmp/output';

function secretsMatch(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export default async (req) => {
  // Require INTERNAL_SECRET env var — no hardcoded fallback
  const EXPECTED_SECRET = process.env.INTERNAL_SECRET;
  if (!EXPECTED_SECRET) {
    console.error('INTERNAL_SECRET env var is not set — rejecting background function call');
    return new Response('Server misconfigured', { status: 500 });
  }

  // Timing-safe comparison to prevent timing attacks
  const incomingSecret = req.headers.get('x-internal-secret');
  if (!secretsMatch(incomingSecret, EXPECTED_SECRET)) {
    return new Response('Forbidden', { status: 403 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const { jobId, storageKey, baseName, bookContext, userId, userRole } = body;
  if (!jobId || !storageKey) {
    return new Response('Missing jobId or storageKey', { status: 400 });
  }

  // Must return quickly for Netlify background fn to register correctly.
  // The async work continues after the return.
  runTranslation({ jobId, storageKey, baseName, bookContext, userId, userRole });

  return new Response(null, { status: 202 });
};

async function runTranslation({ jobId, storageKey, baseName, bookContext, userId, userRole }) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const localInputPath = `/tmp/${uuidv4()}.docx`;

  try {
    await dbUpdateJob(jobId, { progress: 2, message: 'Loading document...' });
    await downloadInputFile(storageKey, localInputPath);

    await processTranslation(jobId, localInputPath, baseName, bookContext, userId, userRole, OUTPUT_DIR);

  } catch (error) {
    console.error(`Background job ${jobId} failed:`, error.message);
    try {
      await dbUpdateJob(jobId, { status: 'failed', message: `Translation failed: ${error.message}` });
    } catch {}
  } finally {
    try { fs.unlinkSync(localInputPath); } catch {}
    try { await deleteInputFile(storageKey); } catch {}
  }
}
