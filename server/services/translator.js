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
  // Additional common abbreviations
  'ICAR', 'IVC', 'RTAI',
].sort((a, b) => b.length - a.length);

/**
 * Global counter for unique numeric-only placeholders.
 * Using purely numeric placeholders (e.g. «§7001§») that Google Translate
 * will NOT transliterate into Hindi — unlike «MCQ0» which gets transliterated.
 */
let _placeholderCounter = 7000;

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
  for (const [placeholder, original] of map) {
    // Exact match first
    const escaped = escapeRegex(placeholder);
    result = result.replace(new RegExp(escaped, 'g'), original);

    // Handle if translator added spaces inside « » for old-style abbreviation placeholders
    if (placeholder.startsWith('«') && !placeholder.includes('§')) {
      const innerText = placeholder.slice(1, -1); // strip « »
      result = result.replace(new RegExp(`«\\s*${escapeRegex(innerText)}\\s*»`, 'gi'), original);
    }

    // Handle numeric placeholders with spaces: « § 7001 § »
    if (placeholder.includes('§')) {
      const num = placeholder.match(/\d+/)?.[0];
      if (num) {
        result = result.replace(new RegExp(`«\\s*§\\s*${num}\\s*§\\s*»`, 'g'), original);
        // Also handle if « » got stripped but §...§ remains
        result = result.replace(new RegExp(`§\\s*${num}\\s*§`, 'g'), original);
      }
    }
  }
  return result;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Decode HTML entities that Google Translate sometimes returns in output.
 * e.g. &quot; → "   &amp; → &   &#39; → '
 * Runs multiple passes to handle double-encoded entities.
 */
function decodeHtmlEntities(str) {
  let result = str;
  // Run up to 2 passes to handle double-encoded entities (e.g. &amp;amp; → &amp; → &)
  for (let pass = 0; pass < 2; pass++) {
    const prev = result;
    result = result
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')   // must be last to avoid double-decoding
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
    if (result === prev) break; // no more entities to decode
  }
  // Final cleanup: catch stray "amp;" that Google Translate sometimes injects
  // when it partially translates & entities
  result = result.replace(/\bamp\s*;/g, '&');
  return result;
}

/**
 * Generate a numeric-only placeholder that Google Translate won't transliterate.
 * Format: «§7001§» — purely numeric inside special brackets.
 */
function nextPlaceholder() {
  return `«§${_placeholderCounter++}§»`;
}

/**
 * Protect MCQ option patterns so A/B/C/D answer choices stay in English.
 * Handles: (a) (b) (A) (B)  |  a) b)  |  उत्तर: A  |  Answer: B
 */
function protectMCQPatterns(text, map) {
  let result = text;

  // Protect answer key lines: "उत्तर: A" / "Answer: B" / "Ans: C"
  result = result.replace(
    /((?:उत्तर|Answer|Ans)[\s]*[:।]\s*)([A-Ea-e])\b/gi,
    (match) => {
      const ph = nextPlaceholder();
      map.set(ph, match);
      return ph;
    }
  );

  // Protect bracketed options: (a) (b) (A) (B) (c) (d) (e)
  result = result.replace(/\(([a-eA-E])\)/g, (match) => {
    const ph = nextPlaceholder();
    map.set(ph, match);
    return ph;
  });

  // Protect "a)" "b)" style at line start or after whitespace (not inside words)
  result = result.replace(/(?<![a-zA-Z])([a-eA-E])\)(?=\s|$)/gm, (match) => {
    const ph = nextPlaceholder();
    map.set(ph, match);
    return ph;
  });

  return result;
}

/**
 * Protect match-the-following answer code patterns so they stay in English.
 * Handles: "A-1, B-2, C-3, D-4" and variations like "A.1", "A:1"
 * Also protects standalone column labels: "A.", "B.", "C.", "D." in tables
 */
function protectMatchCodes(text, map) {
  let result = text;

  // Protect full match code sequences: "A-1, B-2, C-3, D-4" or "A-1, B-2, C-3, D-4"
  result = result.replace(
    /\b([A-Da-d])[-.:]\s*(\d)\s*,\s*([A-Da-d])[-.:]\s*(\d)\s*,\s*([A-Da-d])[-.:]\s*(\d)\s*,\s*([A-Da-d])[-.:]\s*(\d)\b/g,
    (match) => {
      const ph = nextPlaceholder();
      map.set(ph, match);
      return ph;
    }
  );

  // Protect individual match codes at start of table cells or lines: "A." "B." "C." "D."
  // (used as row labels in match-the-following tables)
  result = result.replace(/(?:^|(?<=\s))([A-D])\.\s/gm, (match) => {
    const ph = nextPlaceholder();
    map.set(ph, match);
    return ph;
  });

  return result;
}

/**
 * Protect ampersand (&) from being mangled by Google Translate.
 * Google Translate often converts & to HTML entities or translates "and".
 */
function protectSpecialChars(text, map) {
  let result = text;

  // Protect & that's part of organization names or abbreviations
  result = result.replace(/\s&\s/g, (match) => {
    const ph = ` ${nextPlaceholder()} `;
    map.set(ph.trim(), '&');
    return ph;
  });

  return result;
}

/**
 * Final cleanup pass to catch any placeholder remnants that Google Translate
 * may have transliterated or mangled (e.g. «एमज़ीक्यू0» or stray «§...§»).
 */
function cleanupPlaceholderRemnants(text) {
  let result = text;

  // Remove any remaining «§...§» numeric placeholders that weren't restored
  result = result.replace(/«§\d+§»/g, '');

  // Remove transliterated MCQ placeholders: «एम...» patterns
  // These occur when Google Translate transliterates «MCQ0» into Hindi
  result = result.replace(/«[^\u00BB]*?»/g, (match) => {
    // If it looks like a transliterated placeholder (contains Devanagari), remove it
    if (/[\u0900-\u097F]/.test(match)) return '';
    return match;
  });

  // Clean up stray « » brackets left behind
  result = result.replace(/[«»§]/g, '');

  // Clean up double spaces left by removed placeholders
  result = result.replace(/\s{2,}/g, ' ').trim();

  return result;
}

/**
 * Translate a single chunk with abbreviation protection.
 */
async function translateChunkRaw(text, customAbbrs = []) {
  if (!text.trim()) return text;

  // Build a shared placeholder map for abbreviation, MCQ, and match-code protection
  const { protected: abbProtected, map } = protectAbbreviations(text, customAbbrs);
  const mcqProtected = protectMCQPatterns(abbProtected, map);
  const matchProtected = protectMatchCodes(mcqProtected, map);
  const fullyProtected = protectSpecialChars(matchProtected, map);

  const result = await translate(fullyProtected, { from: 'en', to: 'hi' });
  let translated = result.text?.trim() || '';

  // Decode any HTML entities Google Translate injected (e.g. &quot; → ")
  translated = decodeHtmlEntities(translated);

  // Restore abbreviations, MCQ placeholders, and match codes
  translated = restoreAbbreviations(translated, map);

  // Final cleanup: catch any transliterated/mangled placeholders
  translated = cleanupPlaceholderRemnants(translated);

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
 * Translate a single paragraph with full protection pipeline (used as fallback).
 */
async function translateSingleParagraph(para, customAbbrs) {
  const { protected: abbPara, map: pMap } = protectAbbreviations(para, customAbbrs);
  const mcqPara = protectMCQPatterns(abbPara, pMap);
  const matchPara = protectMatchCodes(mcqPara, pMap);
  const safePara = protectSpecialChars(matchPara, pMap);
  const r = await translate(safePara, { from: 'en', to: 'hi' });
  let t = decodeHtmlEntities((r.text || '').trim());
  t = restoreAbbreviations(t, pMap);
  t = cleanupPlaceholderRemnants(t);
  t = applyGlossaryPostProcessing(t, para);
  return t;
}

export async function translateParagraphs(paragraphs, bookContext = '', onProgress) {
  const BATCH_SIZE = 10;
  // Use a purely numeric separator that Google Translate won't translate or mangle
  const SEPARATOR = '\n|||SEP999|||\n';
  const SEPARATOR_REGEX = /\n?\|*\s*SEP\s*999\s*\|*\n?/;
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
      const mcqJoined = protectMCQPatterns(abbJoined, map);
      const matchJoined = protectMatchCodes(mcqJoined, map);
      const safeJoined = protectSpecialChars(matchJoined, map);

      const result = await translate(safeJoined, { from: 'en', to: 'hi' });
      let resultText = decodeHtmlEntities(result.text || '');
      resultText = restoreAbbreviations(resultText, map);
      resultText = cleanupPlaceholderRemnants(resultText);

      const parts = resultText.split(SEPARATOR_REGEX);

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
        // Separator got mangled — fall back to individual translation
        console.warn(`Batch ${b + 1}: split mismatch (got ${parts.length}, expected ${batch.length}). Translating individually.`);
        for (const para of batch) {
          try {
            translated.push(await translateSingleParagraph(para, customAbbrs));
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
          translated.push(await translateSingleParagraph(para, customAbbrs));
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
