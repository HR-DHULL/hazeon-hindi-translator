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

// Store active jobs
const jobs = new Map();

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
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}. Allowed: ${allowed.join(', ')}`));
    }
  },
});

// POST /api/translate/upload
router.post('/upload', upload.single('file'), async (req, res) => {
  const io = req.app.get('io');

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const jobId = uuidv4();
  const originalName = req.file.originalname;
  const baseName = path.basename(originalName, path.extname(originalName));

  const job = {
    id: jobId,
    originalName,
    status: 'processing',
    progress: 0,
    message: 'File uploaded, starting parsing...',
    createdAt: new Date().toISOString(),
    outputFiles: [],
  };

  jobs.set(jobId, job);
  res.json({ jobId, message: 'Translation started', originalName });

  processTranslation(jobId, req.file.path, baseName, io).catch((error) => {
    console.error(`Job ${jobId} failed:`, error);
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'failed';
      job.message = error.message;
      io.emit(`job:${jobId}`, { ...job });
    }
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
async function processTranslation(jobId, filePath, baseName, io) {
  const job = jobs.get(jobId);
  const outputDir = path.join(__dirname, '..', 'uploads', 'output');
  const inputExt = path.extname(filePath).toLowerCase();

  const emit = (updates) => {
    Object.assign(job, updates);
    io.emit(`job:${jobId}`, { ...job });
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
      const translatedParagraphs = await translateParagraphs(paragraphs, (progress) => {
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
