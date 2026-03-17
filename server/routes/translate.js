import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { parseFile } from '../services/fileParser.js';
import { translateParagraphs } from '../services/translator.js';
import { cloneAndTranslateDOCX } from '../services/docxProcessor.js';
import {
  dbCreateJob,
  dbGetJob,
  dbGetAllJobs,
  dbUpdateJob,
  dbCountActiveJobs,
  dbGetUserProfile,
  dbIncrementPages,
  uploadOutputFile,
} from '../services/database.js';
import { requireAuth } from '../middleware/auth.js';
import { sendTranslationEmail } from '../services/email.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const MAX_CONCURRENT_JOBS = 2;

// Use /tmp on Vercel (serverless), local uploads dir otherwise
const OUTPUT_DIR = process.env.VERCEL
  ? '/tmp/output'
  : path.join(__dirname, '..', 'uploads', 'output');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Configure multer for file uploads
const UPLOAD_DIR = process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', 'uploads');
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.pdf' || ext === '.txt') {
      cb(new Error('Only DOCX files are supported. PDF and TXT cannot preserve formatting. Please convert to DOCX first.'));
    } else if (ext === '.docx') {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}. Only .docx files are accepted.`));
    }
  },
});

// ─── POST /api/translate/upload ───────────────────────────────────────────────
router.post('/upload', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // ── Page limit check (skip for admins) ───────────────────────────────────
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
        error: `Too many translations in progress (max ${MAX_CONCURRENT_JOBS}). Please wait for a job to finish.`,
      });
    }
  } catch { /* allow if DB check fails */ }

  const jobId = uuidv4();
  const originalName = req.file.originalname;
  const baseName = path.basename(originalName, path.extname(originalName));
  const bookContext = (req.body.bookContext || '').trim();

  const job = {
    id: jobId,
    userId: req.user.id,
    originalName,
    bookContext,
    status: 'processing',
    progress: 0,
    message: 'File uploaded, starting parsing...',
    createdAt: new Date().toISOString(),
    outputFiles: [],
  };

  try {
    await dbCreateJob(job);
  } catch (err) {
    console.error('Failed to save job to database:', err.message);
  }

  res.json({ jobId, message: 'Translation started', originalName });

  processTranslation(jobId, req.file.path, baseName, bookContext, req.user.id, req.user.role)
    .catch(async (error) => {
      console.error(`Job ${jobId} failed:`, error);
      try { await dbUpdateJob(jobId, { status: 'failed', message: error.message }); } catch {}
    });
});

// ─── GET /api/translate/status/:jobId ────────────────────────────────────────
router.get('/status/:jobId', requireAuth, async (req, res) => {
  try {
    const job = await dbGetJob(req.params.jobId);
    res.json(job);
  } catch {
    res.status(404).json({ error: 'Job not found' });
  }
});

// ─── GET /api/translate/download/:jobId ──────────────────────────────────────
// DOCX-only download. Redirects to Supabase URL or serves local fallback.
router.get('/download/:jobId', requireAuth, async (req, res) => {
  try {
    const job = await dbGetJob(req.params.jobId);
    const file = job.outputFiles?.find((f) => f.format === 'docx');
    if (!file) return res.status(404).json({ error: 'No DOCX output available' });

    if (file.url) return res.redirect(file.url);
    if (file.path && fs.existsSync(file.path)) return res.download(file.path, file.name);

    res.status(404).json({ error: 'File not found' });
  } catch {
    res.status(404).json({ error: 'Job not found' });
  }
});

// Legacy route kept for backwards compatibility
router.get('/download/:jobId/:format', requireAuth, async (req, res) => {
  res.redirect(`/api/translate/download/${req.params.jobId}`);
});

// ─── GET /api/translate/jobs ──────────────────────────────────────────────────
router.get('/jobs', requireAuth, async (req, res) => {
  try {
    // Admins see all jobs; regular users see only their own
    const jobs = await dbGetAllJobs(
      req.user.role === 'admin' ? null : req.user.id
    );
    res.json(jobs);
  } catch (err) {
    console.error('Failed to load jobs from database:', err.message);
    res.json([]);
  }
});

// ─── POST /api/translate/share/:jobId ────────────────────────────────────────
// Send download link to a given email address
router.post('/share/:jobId', requireAuth, async (req, res) => {
  const { toEmail } = req.body;
  if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    return res.status(400).json({ error: 'Valid email address is required' });
  }

  let job;
  try {
    job = await dbGetJob(req.params.jobId);
  } catch {
    return res.status(404).json({ error: 'Job not found' });
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

// ─── Background translation pipeline ─────────────────────────────────────────
async function processTranslation(jobId, filePath, baseName, bookContext, userId, userRole) {
  const emit = async (updates) => {
    try { await dbUpdateJob(jobId, updates); } catch (e) {
      console.warn('DB update failed (non-fatal):', e.message);
    }
  };

  try {
    // Step 1: Parse
    await emit({ progress: 5, message: 'Parsing document...' });
    const parsed = await parseFile(filePath);
    await emit({
      progress: 10,
      message: `Parsed ${parsed.pageCount} page(s). Preparing for translation...`,
      pageCount: parsed.pageCount,
      charCount: parsed.text.length,
    });

    // Re-check page limit now that we know the actual page count
    if (userRole !== 'admin' && userId) {
      try {
        const profile = await dbGetUserProfile(userId);
        const remaining = (profile.pages_limit || 500) - (profile.pages_used || 0);
        if (parsed.pageCount > remaining) {
          throw new Error(
            `Page limit would be exceeded. You have ${remaining} page(s) remaining but this document has ${parsed.pageCount} page(s). Contact admin to increase your limit.`
          );
        }
      } catch (limitErr) {
        if (limitErr.message.includes('Page limit')) throw limitErr;
        // DB error — allow to proceed
      }
    }

    const outputFiles = [];
    const paragraphs = parsed.paragraphTexts || [];

    // Step 2: Translate paragraphs
    await emit({
      progress: 15,
      message: `Found ${paragraphs.length} paragraphs. Starting translation...`,
      totalChunks: paragraphs.length,
    });

    const translatedParagraphs = await translateParagraphs(paragraphs, bookContext, async (progress) => {
      const overallPercent = 15 + Math.round((progress.percent / 100) * 70);
      await emit({
        progress: overallPercent,
        message: progress.message,
        currentChunk: progress.chunk,
        totalChunks: progress.totalChunks,
      });
    });

    await emit({ progress: 85, message: 'Translation complete. Generating DOCX...' });

    // Step 3: Clone DOCX with translated text (preserves all formatting)
    const docxFilename = `${baseName}_hindi.docx`;
    const docxPath = path.join(OUTPUT_DIR, docxFilename);
    await cloneAndTranslateDOCX(filePath, translatedParagraphs, docxPath);

    await emit({ progress: 92, message: 'Uploading translated file...' });

    // Step 4: Upload to Supabase Storage (persistent across restarts)
    let docxUrl = null;
    try {
      docxUrl = await uploadOutputFile(jobId, docxFilename, docxPath);
    } catch (uploadErr) {
      console.warn('Supabase Storage upload failed, keeping local file:', uploadErr.message);
    }

    outputFiles.push({
      format: 'docx',
      name: docxFilename,
      path: docxPath,        // local fallback
      url: docxUrl,          // Supabase public URL
    });

    // Step 5: Complete
    await emit({
      status: 'completed',
      progress: 100,
      message: 'Translation completed successfully!',
      outputFiles,
      completedAt: new Date().toISOString(),
    });

    // Increment pages used for this user
    if (userRole !== 'admin' && userId && parsed.pageCount) {
      try { await dbIncrementPages(userId, parsed.pageCount); } catch (e) {
        console.warn('Failed to increment pages_used:', e.message);
      }
    }

    // Cleanup local temp files after 60s
    setTimeout(() => {
      fs.unlink(filePath, () => {});
      fs.unlink(docxPath, () => {});
    }, 60_000);

  } catch (error) {
    await emit({
      status: 'failed',
      message: `Translation failed: ${error.message}`,
    });
    throw error;
  }
}

export default router;
