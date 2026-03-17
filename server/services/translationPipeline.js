/**
 * Core translation pipeline — shared between local server and Netlify background function.
 * Parses the uploaded DOCX, translates paragraphs with Claude/Google, generates output DOCX.
 */
import fs from 'fs';
import path from 'path';
import { parseFile } from './fileParser.js';
import { translateParagraphs } from './translator.js';
import { cloneAndTranslateDOCX } from './docxProcessor.js';
import {
  dbUpdateJob,
  dbGetJob,
  dbGetUserProfile,
  dbIncrementPages,
  uploadOutputFile,
} from './database.js';

export async function processTranslation(jobId, filePath, baseName, bookContext, userId, userRole, outputDir) {
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

    // Re-check page limit now that we know actual page count
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
      }
    }

    const paragraphs = parsed.paragraphTexts || [];

    // Step 2: Translate
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
      // Check if user cancelled the job
      try {
        const current = await dbGetJob(jobId);
        if (current?.status === 'cancelled') throw new Error('CANCELLED');
      } catch (e) {
        if (e.message === 'CANCELLED') throw e;
        // ignore transient DB read errors
      }
    });

    await emit({ progress: 85, message: 'Translation complete. Generating DOCX...' });

    // Step 3: Generate DOCX
    fs.mkdirSync(outputDir, { recursive: true });
    const docxFilename = `${baseName}_hindi.docx`;
    const docxPath = path.join(outputDir, docxFilename);
    await cloneAndTranslateDOCX(filePath, translatedParagraphs, docxPath);

    await emit({ progress: 92, message: 'Uploading translated file...' });

    // Step 4: Upload to Supabase Storage
    let docxUrl = null;
    try {
      docxUrl = await uploadOutputFile(jobId, docxFilename, docxPath);
    } catch (uploadErr) {
      console.warn('Supabase Storage upload failed, keeping local file:', uploadErr.message);
    }

    // Step 5: Mark complete
    await emit({
      status: 'completed',
      progress: 100,
      message: 'Translation completed successfully!',
      outputFiles: [{ format: 'docx', name: docxFilename, path: docxPath, url: docxUrl }],
      completedAt: new Date().toISOString(),
    });

    // Increment pages used
    if (userRole !== 'admin' && userId && parsed.pageCount) {
      try { await dbIncrementPages(userId, parsed.pageCount); } catch (e) {
        console.warn('Failed to increment pages_used:', e.message);
      }
    }

    // Cleanup local temp files after 2 min
    setTimeout(() => {
      try { fs.unlinkSync(filePath); } catch {}
      try { fs.unlinkSync(docxPath); } catch {}
    }, 120_000);

  } catch (error) {
    if (error.message === 'CANCELLED') {
      // Job already marked cancelled in DB — just clean up temp files
      try { fs.unlinkSync(filePath); } catch {}
      return;
    }
    await emit({ status: 'failed', message: `Translation failed: ${error.message}` });
    throw error;
  }
}
