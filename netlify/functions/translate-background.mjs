/**
 * Netlify Background Function (v1 format) — handles long-running translation jobs.
 * Runs up to 15 minutes asynchronously. Netlify returns 202 to the caller immediately.
 *
 * Uses v1 convention: filename ends in "-background" + exports `handler`.
 * This is more reliable with esbuild bundling than v2 config.type approach.
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

// v1 background function handler — receives (event, context)
export const handler = async (event, context) => {
  console.log('translate-background invoked');

  // Require INTERNAL_SECRET env var
  const EXPECTED_SECRET = process.env.INTERNAL_SECRET;
  if (!EXPECTED_SECRET) {
    console.error('INTERNAL_SECRET env var is not set');
    return { statusCode: 500, body: 'Server misconfigured' };
  }

  // Timing-safe secret comparison
  const incomingSecret = event.headers['x-internal-secret'] || '';
  if (!secretsMatch(incomingSecret, EXPECTED_SECRET)) {
    console.error('Invalid internal secret');
    return { statusCode: 403, body: 'Forbidden' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    console.error('Failed to parse request body');
    return { statusCode: 400, body: 'Bad request' };
  }

  const { jobId, storageKey, baseName, bookContext, userId, userRole } = body;
  if (!jobId || !storageKey) {
    console.error('Missing jobId or storageKey');
    return { statusCode: 400, body: 'Missing jobId or storageKey' };
  }

  console.log(`Starting translation job ${jobId}`);

  // Run the full translation — this can take minutes
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const localInputPath = `/tmp/${uuidv4()}.docx`;

  try {
    await dbUpdateJob(jobId, { progress: 2, message: 'Loading document...' });
    console.log(`Job ${jobId}: downloading input file...`);
    await downloadInputFile(storageKey, localInputPath);

    console.log(`Job ${jobId}: starting processTranslation...`);
    await processTranslation(jobId, localInputPath, baseName, bookContext, userId, userRole, OUTPUT_DIR);

    console.log(`Job ${jobId}: completed successfully`);
  } catch (error) {
    console.error(`Background job ${jobId} failed:`, error.message);
    try {
      await dbUpdateJob(jobId, { status: 'failed', message: `Translation failed: ${error.message}` });
    } catch {}
  } finally {
    try { fs.unlinkSync(localInputPath); } catch {}
    try { await deleteInputFile(storageKey); } catch {}
  }

  return { statusCode: 200, body: 'Done' };
};
