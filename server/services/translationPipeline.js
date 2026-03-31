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
  dbReservePages,
  uploadOutputFile,
  dbGetGlossary,
} from './database.js';
import { scoreDocument } from './qualityScore.js';
import { applyCustomGlossary } from './glossary.js';

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
    const pageCount = parsed.pageCount;
    const pageWarningMsg = pageCount > 80
      ? `⚠ Large document (${pageCount} pages) — translation may timeout. Recommend splitting into 30-page files.`
      : pageCount > 30
      ? `Note: ${pageCount} pages detected — best accuracy is under 30 pages. Translation will proceed.`
      : null;

    await emit({
      progress: 10,
      message: pageWarningMsg || `Parsed ${pageCount} page(s). Preparing for translation...`,
      pageCount,
      charCount: parsed.text.length,
      pageWarning: pageWarningMsg,
    });

    // Atomically reserve pages to prevent TOCTOU race condition
    // (two simultaneous uploads both passing the initial check)
    let pagesReserved = false;
    if (userRole !== 'admin' && userId) {
      try {
        const reservation = await dbReservePages(userId, pageCount);
        if (!reservation.success) {
          const msg = reservation.remaining !== undefined
            ? `Page limit would be exceeded. You have ${reservation.remaining} page(s) remaining but this document has ${pageCount} page(s). Contact admin to increase your limit.`
            : 'Page limit would be exceeded. Contact admin to increase your limit.';
          throw new Error(msg);
        }
        pagesReserved = true;
      } catch (e) {
        if (e.message && e.message.includes('Page limit')) {
          throw e;
        }
        console.warn('Page reservation failed (non-fatal):', e.message);
      }
    }

    const paragraphs = parsed.paragraphTexts || [];
    const docStats = parsed.docStats || { tableCount: 0, imageCount: 0, paragraphMeta: [] };

    // Log document structure
    if (docStats.tableCount > 0 || docStats.imageCount > 0) {
      console.log(`  Document structure: ${docStats.tableCount} table(s), ${docStats.imageCount} image(s)`);
    }

    // Step 2: Translate
    const structInfo = [];
    if (docStats.tableCount > 0) structInfo.push(`${docStats.tableCount} table(s)`);
    if (docStats.imageCount > 0) structInfo.push(`${docStats.imageCount} image(s)`);
    const structMsg = structInfo.length > 0 ? ` [${structInfo.join(', ')}]` : '';

    await emit({
      progress: 15,
      message: `Found ${paragraphs.length} paragraphs${structMsg}. Starting translation...`,
      totalChunks: paragraphs.length,
    });

    // Load user's custom glossary (if any)
    let customGlossary = [];
    try {
      if (userId) customGlossary = await dbGetGlossary(userId);
      if (customGlossary.length > 0) {
        console.log(`  Custom glossary: ${customGlossary.length} user-defined term(s) loaded`);
      }
    } catch { /* non-fatal */ }

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

    // Apply user's custom glossary overrides on top of translated text
    if (customGlossary.length > 0) {
      for (let i = 0; i < translatedParagraphs.length; i++) {
        if (translatedParagraphs[i] && paragraphs[i]) {
          translatedParagraphs[i] = applyCustomGlossary(translatedParagraphs[i], paragraphs[i], customGlossary);
        }
      }
    }

    await emit({ progress: 85, message: 'Translation complete. Generating DOCX...' });

    // Step 3: Generate DOCX
    fs.mkdirSync(outputDir, { recursive: true });
    const docxFilename = `${baseName}_hindi.docx`;
    const docxPath = path.join(outputDir, docxFilename);
    await cloneAndTranslateDOCX(filePath, translatedParagraphs, docxPath);

    await emit({ progress: 90, message: 'Uploading translated file...' });

    // Step 4: Upload to Supabase Storage
    let docxUrl = null;
    try {
      docxUrl = await uploadOutputFile(jobId, docxFilename, docxPath);
    } catch (uploadErr) {
      console.warn('Supabase Storage upload failed, keeping local file:', uploadErr.message);
    }

    // Step 4b: Save preview data with quality scores
    let previewUrl = null;
    let qualityScore = null;
    try {
      const pairs = [];
      for (let i = 0; i < paragraphs.length; i++) {
        if (paragraphs[i]?.trim()) {
          pairs.push({ en: paragraphs[i], hi: translatedParagraphs[i] || '' });
        }
      }

      // Compute quality scores
      const quality = scoreDocument(pairs);
      qualityScore = quality.overall;
      console.log(`  Quality score: ${quality.overall}/100 (${quality.summary.perfect} perfect, ${quality.summary.good} good, ${quality.summary.needsReview} need review)`);

      // Merge scores into preview data
      const previewData = pairs.map((p, i) => ({
        en: p.en,
        hi: p.hi,
        score: quality.paragraphs[i].score,
        flags: quality.paragraphs[i].flags,
      }));

      const previewFilename = `${baseName}_preview.json`;
      const previewPath = path.join(outputDir, previewFilename);
      fs.writeFileSync(previewPath, JSON.stringify({
        quality: { overall: quality.overall, summary: quality.summary },
        paragraphs: previewData,
      }));
      previewUrl = await uploadOutputFile(jobId, previewFilename, previewPath);
      setTimeout(() => { try { fs.unlinkSync(previewPath); } catch {} }, 120_000);
    } catch (previewErr) {
      console.warn('Preview/quality data failed (non-fatal):', previewErr.message);
    }

    // Step 5: Mark complete
    const outputFiles = [{ format: 'docx', name: docxFilename, path: docxPath, url: docxUrl }];
    if (previewUrl) outputFiles.push({ format: 'preview', name: `${baseName}_preview.json`, url: previewUrl });

    await emit({
      status: 'completed',
      progress: 100,
      message: 'Translation completed successfully!',
      outputFiles,
      qualityScore,
      completedAt: new Date().toISOString(),
    });

    // Pages already reserved atomically via dbReservePages above — no separate increment needed

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
