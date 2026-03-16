import translate from 'google-translate-api-x';
import { applyGlossaryPostProcessing, parseCustomAbbreviations } from './glossary.js';

/**
 * UPSC abbreviations that must NEVER be translated — kept as-is in English.
 * Sorted longest-first to avoid partial match issues.
 */
const PROTECTED_ABBREVIATIONS = [
  // Constitutional bodies
  'NHRC', 'NITI', 'SEBI', 'NABARD', 'SIDBI', 'AFSPA', 'PMGSY', 'PMAY',
  'MNREGA', 'NREGA', 'TPDS', 'DRDO', 'BARC', 'CSIR', 'SAARC', 'ASEAN',
  'BRICS', 'NATO', 'UNSC', 'UNGA', 'ISRO', 'CAG', 'CVC', 'CBI', 'CID',
  'NCW', 'CIC', 'RTI', 'RTE', 'PPP', 'BOT', 'DBT', 'JAM', 'DTC', 'MPC',
  'SLR', 'CRR', 'MSP', 'FCI', 'PDS', 'BPL', 'APL', 'AAY', 'EWS',
  'UPSC', 'SPSC', 'FDI', 'FII', 'FPI', 'GNP', 'NNP', 'GDP', 'GST',
  'RBI', 'OBC', 'IAS', 'IPS', 'IFS', 'IRS', 'HCS', 'DM', 'SDM', 'BDO',
  'PIL', 'NGO', 'UPA', 'NDA', 'BJP', 'INC', 'RSS', 'G20', 'G7', 'UN',
  'PM', 'CM', 'MP', 'MLA', 'MLC', 'SC', 'ST', 'HC', 'ED',
].sort((a, b) => b.length - a.length);

/**
 * Replace all known abbreviations in text with unique placeholders before translation.
 * Returns { protected: string, map: Map<placeholder, abbr> }
 */
function protectAbbreviations(text, customAbbrs = []) {
  const allAbbrs = [...new Set([...customAbbrs, ...PROTECTED_ABBREVIATIONS])];
  const map = new Map();
  let result = text;

  for (const abbr of allAbbrs) {
    const placeholder = `\u00AB${abbr}\u00BB`; // «ABBR»
    const regex = new RegExp(`\\b${escapeRegex(abbr)}\\b`, 'g');
    if (regex.test(result)) {
      result = result.replace(regex, placeholder);
      map.set(placeholder, abbr);
    }
  }
  return { protected: result, map };
}

/**
 * Restore abbreviation placeholders after translation.
 */
function restoreAbbreviations(text, map) {
  let result = text;
  for (const [placeholder, abbr] of map) {
    // Google Translate may add spaces around or slightly modify the placeholder
    const escaped = escapeRegex(placeholder);
    result = result.replace(new RegExp(escaped, 'g'), abbr);
    // Also handle if translator added spaces inside « »
    result = result.replace(new RegExp(`«\\s*${escapeRegex(abbr)}\\s*»`, 'gi'), abbr);
  }
  return result;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Decode HTML entities that Google Translate sometimes returns in output.
 * e.g. &quot; → "   &amp; → &   &#39; → '
 */
function decodeHtmlEntities(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')   // must be last to avoid double-decoding
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

/**
 * Protect MCQ option patterns so A/B/C/D answer choices stay in English.
 * Handles: (a) (b) (A) (B)  |  a) b)  |  उत्तर: A  |  Answer: B
 */
function protectMCQPatterns(text, map) {
  let result = text;
  let idx = map.size;

  // Protect answer key lines: "उत्तर: A" / "Answer: B" / "Ans: C"
  result = result.replace(
    /((?:उत्तर|Answer|Ans)[\s]*[:।]\s*)([A-Ea-e])\b/gi,
    (match, prefix, letter) => {
      const ph = `«MCQ${idx++}»`;
      map.set(ph, match);
      return ph;
    }
  );

  // Protect bracketed options: (a) (b) (A) (B) (c) (d) (e)
  result = result.replace(/\(([a-eA-E])\)/g, (match) => {
    const ph = `«MCQ${idx++}»`;
    map.set(ph, match);
    return ph;
  });

  // Protect "a)" "b)" style at line start or after whitespace (not inside words)
  result = result.replace(/(?<![a-zA-Z])([a-eA-E])\)(?=\s|$)/gm, (match) => {
    const ph = `«MCQ${idx++}»`;
    map.set(ph, match);
    return ph;
  });

  return result;
}

/**
 * Translate a single chunk with abbreviation protection.
 */
async function translateChunkRaw(text, customAbbrs = []) {
  if (!text.trim()) return text;

  // Build a shared placeholder map for both MCQ and abbreviation protection
  const { protected: abbProtected, map } = protectAbbreviations(text, customAbbrs);
  const mcqProtected = protectMCQPatterns(abbProtected, map);

  const result = await translate(mcqProtected, { from: 'en', to: 'hi' });
  let translated = result.text?.trim() || '';

  // Decode any HTML entities Google Translate injected (e.g. &quot; → ")
  translated = decodeHtmlEntities(translated);

  // Restore abbreviations and MCQ placeholders
  translated = restoreAbbreviations(translated, map);

  // Strip spurious surrounding quotes Google Translate sometimes adds
  const origTrimmed = text.trim();
  if (!origTrimmed.startsWith('"') && !origTrimmed.startsWith('\u201c')) {
    translated = translated.replace(/^[""\u201c\u201d]+|[""\u201c\u201d]+$/g, '').trim();
  }

  return translated;
}

/**
 * Translate a single chunk of text from English to Hindi.
 */
export async function translateChunk(text, chunkIndex, totalChunks, onProgress, customAbbrs = []) {
  try {
    let translatedText = await translateChunkRaw(text, customAbbrs);
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
export async function translateAllChunks(chunks, onProgress, bookContext = '') {
  const customAbbrs = parseCustomAbbreviations(bookContext);
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

    const result = await translateChunk(chunks[i], i, chunks.length, onProgress, customAbbrs);
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
export async function translateParagraphs(paragraphs, bookContext = '', onProgress) {
  const BATCH_SIZE = 10;
  const SEPARATOR = '\n[PARA_SEP]\n';
  const customAbbrs = parseCustomAbbreviations(bookContext);
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
        message: `Translating paragraphs ${start + 1}–${Math.min(start + BATCH_SIZE, paragraphs.length)} of ${paragraphs.length}...`,
      });
    }

    try {
      const joined = batch.join(SEPARATOR);
      const { protected: abbJoined, map } = protectAbbreviations(joined, customAbbrs);
      const safeJoined = protectMCQPatterns(abbJoined, map);

      const result = await translate(safeJoined, { from: 'en', to: 'hi' });
      let resultText = decodeHtmlEntities(result.text || '');
      resultText = restoreAbbreviations(resultText, map);

      const parts = resultText.split(/\n?\[?PARA_SEP\]?\n?/);

      if (parts.length === batch.length) {
        for (let i = 0; i < parts.length; i++) {
          let t = parts[i].trim();
          if (!batch[i].trim().startsWith('"')) {
            t = t.replace(/^[""\u201c\u201d]+|[""\u201c\u201d]+$/g, '').trim();
          }
          t = applyGlossaryPostProcessing(t, batch[i]);
          translated.push(t);
        }
      } else {
        // Separator got mangled — fall back to individual
        console.warn(`Batch ${b + 1}: split mismatch (got ${parts.length}, expected ${batch.length}). Translating individually.`);
        for (const para of batch) {
          try {
            const { protected: abbPara, map: pMap } = protectAbbreviations(para, customAbbrs);
            const safePara = protectMCQPatterns(abbPara, pMap);
            const r = await translate(safePara, { from: 'en', to: 'hi' });
            let t = restoreAbbreviations(decodeHtmlEntities((r.text || '').trim()), pMap);
            t = applyGlossaryPostProcessing(t, para);
            translated.push(t);
          } catch {
            translated.push(para);
          }
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    } catch (err) {
      console.warn(`Batch ${b + 1} failed: ${err.message}. Translating individually.`);
      for (const para of batch) {
        try {
          const { protected: abbPara, map: pMap } = protectAbbreviations(para, customAbbrs);
          const safePara = protectMCQPatterns(abbPara, pMap);
          const r = await translate(safePara, { from: 'en', to: 'hi' });
          let t = restoreAbbreviations(decodeHtmlEntities((r.text || '').trim()), pMap);
          t = applyGlossaryPostProcessing(t, para);
          translated.push(t);
        } catch {
          translated.push(para);
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    if (b < totalBatches - 1) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  return translated;
}
