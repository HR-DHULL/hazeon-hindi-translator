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
  uploadOutputFile,
  uploadTempFile,
} from '../services/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const MAX_CONCURRENT_JOBS = 2;

// Use /tmp on serverless (Vercel/Netlify), local uploads dir otherwise
const isServerless = !!(process.env.VERCEL || process.env.NETLIFY);
const OUTPUT_DIR = isServerless
  ? '/tmp/output'
  : path.join(__dirname, '..', 'uploads', 'output');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Configure multer for file uploads
const UPLOAD_DIR = isServerless ? '/tmp' : path.join(__dirname, '..', 'uploads');
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
router.post('/upload', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
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

  if (process.env.NETLIFY) {
    // Serverless: upload file to Supabase temp storage, trigger background function
    try {
      const fileBuffer = fs.readFileSync(req.file.path);
      const tempPath = await uploadTempFile(jobId, req.file.filename, fileBuffer);
      const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || 'http://localhost:8888';
      fetch(`${siteUrl}/.netlify/functions/translate-background`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, tempPath, baseName, bookContext }),
      }).catch((err) => console.error('Failed to trigger background function:', err));
    } catch (err) {
      console.error('Failed to queue background translation:', err);
      try { await dbUpdateJob(jobId, { status: 'failed', message: err.message }); } catch {}
    }
    // Cleanup local temp file
    fs.unlink(req.file.path, () => {});
  } else {
    // Local / Render: process in background
    processTranslation(jobId, req.file.path, baseName, bookContext)
      .catch(async (error) => {
        console.error(`Job ${jobId} failed:`, error);
        try { await dbUpdateJob(jobId, { status: 'failed', message: error.message }); } catch {}
      });
  }
});

// ─── GET /api/translate/status/:jobId ────────────────────────────────────────
router.get('/status/:jobId', async (req, res) => {
  try {
    const job = await dbGetJob(req.params.jobId);
    res.json(job);
  } catch {
    res.status(404).json({ error: 'Job not found' });
  }
});

// ─── GET /api/translate/download/:jobId/:format ───────────────────────────────
// Downloads work via Supabase Storage public URL stored in outputFiles.
// This endpoint is kept for local dev fallback.
router.get('/download/:jobId/:format', async (req, res) => {
  try {
    const job = await dbGetJob(req.params.jobId);
    const file = job.outputFiles.find((f) => f.format === req.params.format);
    if (!file) return res.status(404).json({ error: `No ${req.params.format} output available` });

    // If we have a Supabase URL, redirect to it
    if (file.url) return res.redirect(file.url);

    // Local dev fallback
    if (file.path && fs.existsSync(file.path)) return res.download(file.path, file.name);

    res.status(404).json({ error: 'File not found' });
  } catch {
    res.status(404).json({ error: 'Job not found' });
  }
});

// ─── GET /api/translate/jobs ──────────────────────────────────────────────────
router.get('/jobs', async (req, res) => {
  try {
    const jobs = await dbGetAllJobs();
    res.json(jobs);
  } catch (err) {
    console.error('Failed to load jobs from database:', err.message);
    res.json([]);
  }
});

// ─── Background translation pipeline ─────────────────────────────────────────
async function processTranslation(jobId, filePath, baseName, bookContext) {
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
