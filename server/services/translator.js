import translate from 'google-translate-api-x';
import { applyGlossaryPostProcessing } from './glossary.js';

/**
 * Translate a single chunk of text from English to Hindi using Google Translate.
 */
export async function translateChunk(text, chunkIndex, totalChunks, onProgress) {
  try {
    const result = await translate(text, { from: 'en', to: 'hi' });
    let translatedText = result.text?.trim();

    if (!translatedText) {
      throw new Error('Empty response from translation service');
    }

    translatedText = applyGlossaryPostProcessing(translatedText, text);

    if (onProgress) {
      onProgress({
        chunk: chunkIndex + 1,
        totalChunks,
        percent: Math.round(((chunkIndex + 1) / totalChunks) * 100),
        status: 'translating',
      });
    }

    return translatedText;
  } catch (error) {
    console.error(`Translation error on chunk ${chunkIndex + 1}:`, error.message);
    throw new Error(`Translation failed on chunk ${chunkIndex + 1}: ${error.message}`);
  }
}

/**
 * Translate all chunks sequentially with progress reporting.
 */
export async function translateAllChunks(chunks, onProgress) {
  const translated = [];

  for (let i = 0; i < chunks.length; i++) {
    if (onProgress) {
      onProgress({
        chunk: i + 1,
        totalChunks: chunks.length,
        percent: Math.round((i / chunks.length) * 100),
        status: 'translating',
        message: `Translating chunk ${i + 1} of ${chunks.length}...`,
      });
    }

    const result = await translateChunk(chunks[i], i, chunks.length, onProgress);
    translated.push(result);

    if (i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return translated.join('\n\n');
}

/**
 * Translate an array of paragraphs preserving 1-to-1 order.
 * Used for DOCX clone-and-replace so each translated paragraph
 * maps exactly to its original XML paragraph.
 *
 * Batches paragraphs together with a separator for efficiency,
 * falls back to individual translation if batch splitting fails.
 */
export async function translateParagraphs(paragraphs, onProgress) {
  const BATCH_SIZE = 10;
  const SEPARATOR = '\n[PARA_SEP]\n';
  const translated = [];
  const totalBatches = Math.ceil(paragraphs.length / BATCH_SIZE);

  for (let b = 0; b < totalBatches; b++) {
    const start = b * BATCH_SIZE;
    const batch = paragraphs.slice(start, start + BATCH_SIZE);

    if (onProgress) {
      onProgress({
        chunk: b + 1,
        totalChunks: totalBatches,
        percent: Math.round((b / totalBatches) * 100),
        status: 'translating',
        message: `Translating paragraphs ${start + 1}-${Math.min(start + BATCH_SIZE, paragraphs.length)} of ${paragraphs.length}...`,
      });
    }

    try {
      // Join paragraphs with a unique separator
      const joined = batch.join(SEPARATOR);
      const result = await translate(joined, { from: 'en', to: 'hi' });
      const resultText = result.text || '';

      // Split back using the separator (Google Translate may slightly modify it)
      const parts = resultText.split(/\n?\[?PARA_SEP\]?\n?/);

      if (parts.length === batch.length) {
        // Perfect split — push all
        for (let i = 0; i < parts.length; i++) {
          let t = parts[i].trim();
          t = applyGlossaryPostProcessing(t, batch[i]);
          translated.push(t);
        }
      } else {
        // Separator got mangled — fall back to individual translation
        console.warn(`Batch ${b + 1}: split mismatch (got ${parts.length}, expected ${batch.length}). Translating individually.`);
        for (const para of batch) {
          const r = await translate(para, { from: 'en', to: 'hi' });
          let t = (r.text || '').trim();
          t = applyGlossaryPostProcessing(t, para);
          translated.push(t);
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    } catch (err) {
      // If batch fails entirely, translate individually
      console.warn(`Batch ${b + 1} failed: ${err.message}. Translating individually.`);
      for (const para of batch) {
        try {
          const r = await translate(para, { from: 'en', to: 'hi' });
          let t = (r.text || '').trim();
          t = applyGlossaryPostProcessing(t, para);
          translated.push(t);
        } catch {
          translated.push(para); // keep original if translation fails
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    // Rate limit delay between batches
    if (b < totalBatches - 1) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  return translated;
}
