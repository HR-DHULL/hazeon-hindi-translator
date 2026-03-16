/**
 * Netlify Background Function for long-running translation jobs.
 * File name ends with "-background" so Netlify treats it as a background function
 * (up to 15 minutes execution time on Pro plan).
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { parseFile } from '../../server/services/fileParser.js';
import { translateParagraphs } from '../../server/services/translator.js';
import { cloneAndTranslateDOCX } from '../../server/services/docxProcessor.js';
import {
  dbUpdateJob,
  uploadOutputFile,
  downloadTempFile,
} from '../../server/services/database.js';

export async function handler(event) {
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { jobId, tempPath, baseName, bookContext } = body;
  if (!jobId || !tempPath) {
    return { statusCode: 400, body: 'Missing jobId or tempPath' };
  }

  const localPath = path.join('/tmp', `${jobId}_input.docx`);
  const outputDir = '/tmp';

  try {
    // Step 1: Download uploaded file from Supabase temp storage
    const fileBuffer = await downloadTempFile(tempPath);
    fs.writeFileSync(localPath, fileBuffer);

    // Step 2: Parse
    await dbUpdateJob(jobId, { progress: 5, message: 'Parsing document...' });
    const parsed = await parseFile(localPath);
    await dbUpdateJob(jobId, {
      progress: 10,
      message: `Parsed ${parsed.pageCount} page(s). Preparing for translation...`,
      pageCount: parsed.pageCount,
      charCount: parsed.text.length,
    });

    const paragraphs = parsed.paragraphTexts || [];

    await dbUpdateJob(jobId, {
      progress: 15,
      message: `Found ${paragraphs.length} paragraphs. Starting translation...`,
      totalChunks: paragraphs.length,
    });

    // Step 3: Translate
    const translatedParagraphs = await translateParagraphs(
      paragraphs,
      bookContext,
      async (progress) => {
        const overallPercent = 15 + Math.round((progress.percent / 100) * 70);
        await dbUpdateJob(jobId, {
          progress: overallPercent,
          message: progress.message,
          currentChunk: progress.chunk,
          totalChunks: progress.totalChunks,
        });
      },
    );

    await dbUpdateJob(jobId, {
      progress: 85,
      message: 'Translation complete. Generating DOCX...',
    });

    // Step 4: Generate output DOCX
    const docxFilename = `${baseName}_hindi.docx`;
    const docxPath = path.join(outputDir, docxFilename);
    await cloneAndTranslateDOCX(localPath, translatedParagraphs, docxPath);

    await dbUpdateJob(jobId, {
      progress: 92,
      message: 'Uploading translated file...',
    });

    // Step 5: Upload output to Supabase Storage
    let docxUrl = null;
    try {
      docxUrl = await uploadOutputFile(jobId, docxFilename, docxPath);
    } catch (err) {
      console.warn('Supabase Storage upload failed:', err.message);
    }

    const outputFiles = [
      {
        format: 'docx',
        name: docxFilename,
        url: docxUrl,
      },
    ];

    // Step 6: Mark complete
    await dbUpdateJob(jobId, {
      status: 'completed',
      progress: 100,
      message: 'Translation completed successfully!',
      outputFiles,
      completedAt: new Date().toISOString(),
    });

    // Cleanup temp files
    try { fs.unlinkSync(localPath); } catch {}
    try { fs.unlinkSync(docxPath); } catch {}

  } catch (error) {
    console.error(`Background job ${jobId} failed:`, error);
    try {
      await dbUpdateJob(jobId, {
        status: 'failed',
        message: `Translation failed: ${error.message}`,
      });
    } catch {}
  }

  return { statusCode: 200 };
}
