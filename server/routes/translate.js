import express from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
// Safe __dirname for both Node.js and esbuild-bundled (Netlify) environments
let __dirname = '/tmp';
try { __dirname = path.dirname(fileURLToPath(import.meta.url)); } catch {}

import {
  dbCreateJob,
  dbGetJob,
  dbGetAllJobs,
  dbUpdateJob,
  dbDeleteJob,
  dbCountActiveJobs,
  uploadInputFile,
  createSignedUploadUrl,
} from '../services/database.js';
import { processTranslation } from '../services/translationPipeline.js';
import { requireAuth } from '../middleware/auth.js';
import { sendTranslationEmail } from '../services/email.js';


const router = express.Router();
const MAX_CONCURRENT_JOBS = 2;

// Rate limit uploads: max 10 per 10 minutes per IP
const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads. Please wait before uploading again.' },
});

// Rate limit status polling: max 120 per minute per IP (2/sec — enough for normal polling)
const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many status requests. Please slow down.' },
});

// Use /tmp in production (Netlify, Render serverless), local path in dev
const IS_PROD = process.env.NODE_ENV === 'production';
const OUTPUT_DIR = IS_PROD ? '/tmp/output' : path.join(__dirname, '..', 'uploads', 'output');
const UPLOAD_DIR = IS_PROD ? '/tmp' : path.join(__dirname, '..', 'uploads');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  // Always use .docx extension — ignore original extension to prevent path traversal via crafted filenames
  filename: (req, file, cb) => cb(null, `${uuidv4()}.docx`),
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.pdf' || ext === '.txt') {
      cb(new Error('Only DOCX files are supported. Please convert to DOCX first.'));
    } else if (ext === '.docx') {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}. Only .docx files are accepted.`));
    }
  },
});

// ─── POST /api/translate/upload ───────────────────────────────────────────────
router.post('/upload', uploadLimiter, requireAuth, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  // Page limit check (skip for admins)
  if (req.user.role !== 'admin') {
    if (req.user.pagesUsed >= req.user.pagesLimit) {
      fs.unlink(req.file.path, () => {});
      return res.status(403).json({
        error: `Page limit reached. You have used ${req.user.pagesUsed} of ${req.user.pagesLimit} pages. Contact admin to increase your limit.`,
        limitReached: true,
      });
    }
  }

  try {
    const activeCount = await dbCountActiveJobs();
    if (activeCount >= MAX_CONCURRENT_JOBS) {
      fs.unlink(req.file.path, () => {});
      return res.status(429).json({
        error: `Too many translations in progress (max ${MAX_CONCURRENT_JOBS}). Please wait.`,
      });
    }
  } catch { /* allow if DB check fails */ }

  const jobId = uuidv4();
  const originalName = req.file.originalname;
  const baseName = path.basename(originalName, path.extname(originalName));
  const MAX_CONTEXT_LENGTH = 2000;
  const bookContext = (req.body.bookContext || '').trim().slice(0, MAX_CONTEXT_LENGTH);

  const job = {
    id: jobId,
    userId: req.user.id,
    originalName,
    bookContext,
    status: 'processing',
    progress: 0,
    message: 'File uploaded, starting translation...',
    createdAt: new Date().toISOString(),
    outputFiles: [],
  };

  try { await dbCreateJob(job); } catch (err) {
    console.error('Failed to save job to DB:', err.message);
  }

  if (process.env.NETLIFY || (IS_PROD && process.env.URL)) {
    // ── Netlify: upload file to Supabase Storage, trigger background function ──
    // IMPORTANT: Must do ALL async work BEFORE res.json() because serverless-http
    // terminates the function as soon as the response is sent.
    try {
      const storageKey = await uploadInputFile(jobId, originalName, req.file.path);
      fs.unlink(req.file.path, () => {}); // remove from /tmp

      const bgUrl = `${process.env.URL}/.netlify/functions/translate-background`;
      const bgRes = await fetch(bgUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': process.env.INTERNAL_SECRET || '',
        },
        body: JSON.stringify({ jobId, storageKey, baseName, bookContext, userId: req.user.id, userRole: req.user.role }),
      });

      if (!bgRes.ok) {
        console.error(`Background function returned ${bgRes.status}: ${await bgRes.text().catch(() => '')}`);
        await dbUpdateJob(jobId, { status: 'failed', message: 'Failed to start background translation.' });
      }

      // Respond AFTER the background function has been triggered
      res.json({ jobId, message: 'Translation started', originalName });
    } catch (err) {
      console.error('Failed to start translation:', err.message);
      try { await dbUpdateJob(jobId, { status: 'failed', message: `Failed to start translation: ${err.message}` }); } catch {}
      res.json({ jobId, message: 'Translation queued (may be delayed)', originalName });
    }
  } else {
    // ── Local / Render: respond immediately, run translation in background ────
    res.json({ jobId, message: 'Translation started', originalName });
    processTranslation(jobId, req.file.path, baseName, bookContext, req.user.id, req.user.role, OUTPUT_DIR)
      .catch(async (error) => {
        console.error(`Job ${jobId} failed:`, error);
        try { await dbUpdateJob(jobId, { status: 'failed', message: error.message }); } catch {}
      });
  }
});

// ─── POST /api/translate/prepare ─────────────────────────────────────────────
// Step 1 of direct-upload flow: validate, create job, return Supabase signed URL
router.post('/prepare', uploadLimiter, requireAuth, async (req, res) => {
  const { filename, bookContext: rawContext } = req.body;
  if (!filename || !filename.toLowerCase().endsWith('.docx')) {
    return res.status(400).json({ error: 'Only .docx files are accepted.' });
  }

  if (req.user.role !== 'admin') {
    if (req.user.pagesUsed >= req.user.pagesLimit) {
      return res.status(403).json({
        error: `Page limit reached. You have used ${req.user.pagesUsed} of ${req.user.pagesLimit} pages.`,
        limitReached: true,
      });
    }
  }

  try {
    const activeCount = await dbCountActiveJobs();
    if (activeCount >= MAX_CONCURRENT_JOBS) {
      return res.status(429).json({ error: `Too many translations in progress (max ${MAX_CONCURRENT_JOBS}). Please wait.` });
    }
  } catch { /* allow if DB check fails */ }

  const jobId = uuidv4();
  const bookContext = (rawContext || '').trim().slice(0, 2000);
  const job = {
    id: jobId,
    userId: req.user.id,
    originalName: filename,
    bookContext,
    status: 'processing',
    progress: 0,
    message: 'Uploading file...',
    createdAt: new Date().toISOString(),
    outputFiles: [],
  };

  try { await dbCreateJob(job); } catch (err) {
    console.error('Failed to create job:', err.message, JSON.stringify(err));
    return res.status(500).json({ error: `Failed to create job: ${err.message}` });
  }

  try {
    const { signedUrl, storagePath } = await createSignedUploadUrl(jobId, filename);
    res.json({ jobId, signedUrl, storagePath, originalName: filename });
  } catch (err) {
    console.error('Failed to create signed URL:', err.message);
    res.status(500).json({ error: 'Failed to generate upload URL.' });
  }
});

// ─── POST /api/translate/start ────────────────────────────────────────────────
// Step 2 of direct-upload flow: file is in Supabase, kick off translation
router.post('/start', requireAuth, async (req, res) => {
  const { jobId, storagePath } = req.body;
  if (!jobId || !storagePath) return res.status(400).json({ error: 'jobId and storagePath required.' });

  const job = await dbGetJob(jobId).catch(() => null);
  if (!job) return res.status(404).json({ error: 'Job not found.' });

  const baseName = path.basename(job.originalName, path.extname(job.originalName));

  await dbUpdateJob(jobId, { message: 'File received, starting translation...' });

  if (process.env.NETLIFY || (IS_PROD && process.env.URL)) {
    try {
      const bgUrl = `${process.env.URL}/.netlify/functions/translate-background`;
      const bgRes = await fetch(bgUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
        body: JSON.stringify({ jobId, storageKey: storagePath, baseName, bookContext: job.bookContext, userId: req.user.id, userRole: req.user.role }),
      });
      if (!bgRes.ok) {
        console.error(`Background function returned ${bgRes.status}`);
        await dbUpdateJob(jobId, { status: 'failed', message: 'Failed to start background translation.' });
      }
      res.json({ jobId, message: 'Translation started', originalName: job.originalName });
    } catch (err) {
      console.error('Failed to trigger background function:', err.message);
      res.json({ jobId, message: 'Translation queued', originalName: job.originalName });
    }
  } else {
    // Local / Vercel: download from Supabase to /tmp then process
    res.json({ jobId, message: 'Translation started', originalName: job.originalName });
    (async () => {
      try {
        const { downloadInputFile } = await import('../services/database.js');
        const tmpPath = path.join('/tmp', `${jobId}_${job.originalName}`);
        await downloadInputFile(storagePath, tmpPath);
        await processTranslation(jobId, tmpPath, baseName, job.bookContext, req.user.id, req.user.role, OUTPUT_DIR);
      } catch (error) {
        console.error(`Job ${jobId} failed:`, error);
        try { await dbUpdateJob(jobId, { status: 'failed', message: error.message }); } catch {}
      }
    })();
  }
});

// ─── POST /api/translate/cancel/:jobId ───────────────────────────────────────
router.post('/cancel/:jobId', requireAuth, async (req, res) => {
  try {
    const job = await dbGetJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    if (job.status !== 'processing') {
      return res.status(400).json({ error: 'Job is not currently processing' });
    }
    await dbUpdateJob(req.params.jobId, {
      status: 'cancelled',
      message: 'Translation cancelled by user.',
      progress: job.progress || 0,
    });
    res.json({ message: 'Translation cancelled' });
  } catch {
    res.status(404).json({ error: 'Job not found' });
  }
});

// ─── GET /api/translate/status/:jobId ────────────────────────────────────────
router.get('/status/:jobId', statusLimiter, requireAuth, async (req, res) => {
  try {
    const job = await dbGetJob(req.params.jobId);
    if (job.userId && job.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    res.json(job);
  } catch {
    res.status(404).json({ error: 'Job not found' });
  }
});

// ─── GET /api/translate/download/:jobId ──────────────────────────────────────
router.get('/download/:jobId', requireAuth, async (req, res) => {
  try {
    const job = await dbGetJob(req.params.jobId);
    if (job.userId && job.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const file = job.outputFiles?.find((f) => f.format === 'docx');
    if (!file) return res.status(404).json({ error: 'No DOCX output available' });
    if (file.url) return res.redirect(file.url);
    if (file.path && fs.existsSync(file.path)) return res.download(file.path, file.name);
    res.status(404).json({ error: 'File not found' });
  } catch {
    res.status(404).json({ error: 'Job not found' });
  }
});

// Legacy redirect
router.get('/download/:jobId/:format', requireAuth, async (req, res) => {
  res.redirect(`/api/translate/download/${req.params.jobId}`);
});

// ─── GET /api/translate/jobs ──────────────────────────────────────────────────
router.get('/jobs', requireAuth, async (req, res) => {
  try {
    const jobs = await dbGetAllJobs(req.user.role === 'admin' ? null : req.user.id);
    res.json(jobs);
  } catch (err) {
    console.error('Failed to load jobs:', err.message);
    res.json([]);
  }
});

// ─── DELETE /api/translate/jobs/:jobId ────────────────────────────────────────
router.delete('/jobs/:jobId', requireAuth, async (req, res) => {
  try {
    const job = await dbGetJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.userId && job.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Delete output files from storage
    if (job.outputFiles?.length) {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      const paths = job.outputFiles.map(f => `${req.params.jobId}/${f.name}`).filter(Boolean);
      if (paths.length) {
        await supabase.storage.from('outputs').remove(paths).catch(() => {});
      }
    }

    await dbDeleteJob(req.params.jobId);
    res.json({ message: 'Job deleted' });
  } catch (err) {
    console.error('Failed to delete job:', err.message);
    res.status(500).json({ error: 'Failed to delete job' });
  }
});

// ─── POST /api/translate/share/:jobId ────────────────────────────────────────
router.post('/share/:jobId', requireAuth, async (req, res) => {
  const { toEmail } = req.body;
  if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    return res.status(400).json({ error: 'Valid email address is required' });
  }

  let job;
  try { job = await dbGetJob(req.params.jobId); }
  catch { return res.status(404).json({ error: 'Job not found' }); }

  if (job.userId && job.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Not authorized' });
  }

  if (job.status !== 'completed') {
    return res.status(400).json({ error: 'Translation is not complete yet' });
  }

  const docxFile = job.outputFiles?.find((f) => f.format === 'docx');
  if (!docxFile?.url) {
    return res.status(400).json({ error: 'No download URL available for this translation' });
  }

  try {
    await sendTranslationEmail({
      toEmail,
      fromName: req.user.fullName || req.user.email,
      fromEmail: req.user.email,
      filename: job.originalName,
      docxUrl: docxFile.url,
    });
    res.json({ message: `Email sent to ${toEmail}` });
  } catch (err) {
    console.error('Email send failed:', err.message);
    if (err.message.includes('not configured')) {
      return res.status(503).json({ error: 'Email service not configured. Ask admin to set SMTP credentials.' });
    }
    res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }
});

export default router;
