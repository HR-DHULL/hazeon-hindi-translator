import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { parseFile, splitIntoChunks } from '../services/fileParser.js';
import { translateAllChunks, translateParagraphs } from '../services/translator.js';
import { generateDOCX, generatePDF } from '../services/fileGenerator.js';
import { cloneAndTranslateDOCX } from '../services/docxProcessor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Persist jobs to a JSON file so history survives server restarts
const JOBS_FILE = path.join(__dirname, '..', 'jobs.json');

function loadJobs() {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      const data = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
      return new Map(Object.entries(data));
    }
  } catch {}
  return new Map();
}

function saveJobs() {
  try {
    fs.writeFileSync(JOBS_FILE, JSON.stringify(Object.fromEntries(jobs), null, 2));
  } catch (e) {
    console.error('Failed to save jobs:', e.message);
  }
}

// Store active jobs (loaded from disk on startup)
const jobs = loadJobs();

// Mark any jobs that were "processing" at server shutdown as failed
for (const job of jobs.values()) {
  if (job.status === 'processing') {
    job.status = 'failed';
    job.message = 'Server was restarted while job was in progress.';
  }
}
saveJobs();

// Concurrency limiter: max 2 large jobs at once to prevent OOM on big files
let activeJobs = 0;
const MAX_CONCURRENT_JOBS = 2;

// Ensure output directory exists
const OUTPUT_DIR = path.join(__dirname, '..', 'uploads', 'output');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
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

// POST /api/translate/upload
router.post('/upload', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  const io = req.app.get('io');

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  if (activeJobs >= MAX_CONCURRENT_JOBS) {
    fs.unlink(req.file.path, () => {});
    return res.status(429).json({ error: `Too many translations in progress (max ${MAX_CONCURRENT_JOBS}). Please wait for a job to finish.` });
  }

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

  jobs.set(jobId, job);
  saveJobs();
  activeJobs++;
  res.json({ jobId, message: 'Translation started', originalName });

  processTranslation(jobId, req.file.path, baseName, bookContext, io)
    .catch((error) => {
      console.error(`Job ${jobId} failed:`, error);
      const job = jobs.get(jobId);
      if (job) {
        job.status = 'failed';
        job.message = error.message;
        io.emit(`job:${jobId}`, { ...job });
        saveJobs();
      }
    })
    .finally(() => {
      activeJobs = Math.max(0, activeJobs - 1);
    });
});

// GET /api/translate/status/:jobId
router.get('/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// GET /api/translate/download/:jobId/:format
router.get('/download/:jobId/:format', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const file = job.outputFiles.find((f) => f.format === req.params.format);
  if (!file) return res.status(404).json({ error: `No ${req.params.format} output available` });
  if (!fs.existsSync(file.path)) return res.status(404).json({ error: 'File not found on disk' });

  res.download(file.path, file.name);
});

// GET /api/translate/jobs
router.get('/jobs', (req, res) => {
  const allJobs = Array.from(jobs.values()).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  res.json(allJobs);
});

/**
 * Background translation processing pipeline.
 * Uses different strategies depending on input format:
 *   DOCX → paragraph-level translation + clone-and-replace (preserves formatting)
 *   PDF  → chunk translation + from-scratch output
 *   TXT  → chunk translation + from-scratch output
 */
async function processTranslation(jobId, filePath, baseName, bookContext, io) {
  const job = jobs.get(jobId);
  const outputDir = OUTPUT_DIR;
  const inputExt = path.extname(filePath).toLowerCase();

  const emit = (updates) => {
    Object.assign(job, updates);
    io.emit(`job:${jobId}`, { ...job });
    saveJobs();
  };

  try {
    // Step 1: Parse file
    emit({ progress: 5, message: 'Parsing document...' });
    const parsed = await parseFile(filePath);
    emit({
      progress: 10,
      message: `Parsed ${parsed.pageCount} page(s). Preparing for translation...`,
      pageCount: parsed.pageCount,
      charCount: parsed.text.length,
    });

    const metadata = { title: baseName.replace(/[-_]/g, ' ') };
    const outputFiles = [];

    if (inputExt === '.docx' && parsed.paragraphTexts?.length > 0) {
      // ========== DOCX FLOW: paragraph-level, format-preserving ==========
      const paragraphs = parsed.paragraphTexts;
      emit({
        progress: 15,
        message: `Found ${paragraphs.length} paragraphs. Starting translation...`,
        totalChunks: paragraphs.length,
      });

      // Step 2: Translate paragraphs (batched, 1-to-1 mapping)
      const translatedParagraphs = await translateParagraphs(paragraphs, bookContext, (progress) => {
        const overallPercent = 15 + Math.round((progress.percent / 100) * 70);
        emit({
          progress: overallPercent,
          message: progress.message,
          currentChunk: progress.chunk,
          totalChunks: progress.totalChunks,
        });
      });

      emit({ progress: 85, message: 'Translation complete. Generating output...' });

      // Step 3: Clone DOCX and replace text (preserves colors, bullets, watermark, header, footer)
      const docxPath = path.join(outputDir, `${baseName}_hindi.docx`);
      emit({ progress: 90, message: 'Generating DOCX (preserving original formatting)...' });
      await cloneAndTranslateDOCX(filePath, translatedParagraphs, docxPath);
      outputFiles.push({ format: 'docx', path: docxPath, name: `${baseName}_hindi.docx` });

      // Step 4: Also generate a PDF from the translated text
      const pdfPath = path.join(outputDir, `${baseName}_hindi.pdf`);
      emit({ progress: 95, message: 'Generating PDF...' });
      try {
        const fullText = translatedParagraphs.join('\n\n');
        await generatePDF(fullText, pdfPath, metadata);
        outputFiles.push({ format: 'pdf', path: pdfPath, name: `${baseName}_hindi.pdf` });
      } catch (pdfErr) {
        console.warn('PDF generation failed (DOCX still available):', pdfErr.message);
      }

    } else {
      // ========== PDF/TXT FLOW: chunk-based ==========
      const chunks = splitIntoChunks(parsed.text);
      emit({
        progress: 15,
        message: `Split into ${chunks.length} chunk(s). Starting translation...`,
        totalChunks: chunks.length,
      });

      // Step 2: Translate chunks
      const translatedText = await translateAllChunks(chunks, (progress) => {
        const overallPercent = 15 + Math.round((progress.percent / 100) * 70);
        emit({
          progress: overallPercent,
          message: progress.message,
          currentChunk: progress.chunk,
          totalChunks: progress.totalChunks,
        });
      });

      emit({ progress: 85, message: 'Translation complete. Generating output files...' });

      // Step 3: Generate DOCX from scratch
      const docxPath = path.join(outputDir, `${baseName}_hindi.docx`);
      emit({ progress: 90, message: 'Generating DOCX file...' });
      await generateDOCX(translatedText, docxPath, metadata);
      outputFiles.push({ format: 'docx', path: docxPath, name: `${baseName}_hindi.docx` });

      // Step 4: Generate PDF
      const pdfPath = path.join(outputDir, `${baseName}_hindi.pdf`);
      emit({ progress: 95, message: 'Generating PDF file...' });
      try {
        await generatePDF(translatedText, pdfPath, metadata);
        outputFiles.push({ format: 'pdf', path: pdfPath, name: `${baseName}_hindi.pdf` });
      } catch (pdfErr) {
        console.warn('PDF generation failed (DOCX still available):', pdfErr.message);
      }
    }

    // Step 5: Complete
    emit({
      status: 'completed',
      progress: 100,
      message: 'Translation completed successfully!',
      outputFiles,
      completedAt: new Date().toISOString(),
    });

    // Cleanup uploaded file (after output is generated)
    setTimeout(() => fs.unlink(filePath, () => {}), 5000);
  } catch (error) {
    emit({
      status: 'failed',
      message: `Translation failed: ${error.message}`,
    });
    throw error;
  }
}

export default router;
