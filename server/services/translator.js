import Anthropic from '@anthropic-ai/sdk';
import translate from 'google-translate-api-x';
import { applyGlossaryPostProcessing, parseCustomAbbreviations } from './glossary.js';

// ── Engine selection ──────────────────────────────────────────────────────────
// Uses Claude (Anthropic) if ANTHROPIC_API_KEY is set, otherwise falls back
// to the free Google Translate unofficial API.
const USE_CLAUDE = !!process.env.ANTHROPIC_API_KEY;

let anthropic = null;
if (USE_CLAUDE) {
  anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  console.log('  Translation engine: Claude AI (context-aware UPSC/HCS mode)');
} else {
  console.log('  Translation engine: Google Translate (EN -> HI Devanagari)');
  console.log('  Tip: Set ANTHROPIC_API_KEY in .env for smarter UPSC translation');
}

// ── Claude model — use Haiku for speed/cost, Sonnet for best quality ─────────
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

// ── System prompt for UPSC/HCS context-aware translation ─────────────────────
const UPSC_SYSTEM_PROMPT = `You are an expert Hindi translator specializing in UPSC and HCS (Haryana Civil Services) examination material.

Your translation rules:
1. CONTEXT FIRST: Understand how each question/answer is framed before translating. Match the formal, precise language used in civil services exams.
2. TECHNICAL TERMS: Use standard UPSC Hindi terminology (e.g., "संविधान" not "कॉन्स्टिट्यूशन", "न्यायपालिका" not "जुडिशियरी", "राजकोषीय" not "फिस्कल").
3. ABBREVIATIONS: Never translate abbreviations like UPSC, IAS, HCS, GDP, RBI, GST, SEBI, ISRO, UN, NATO, etc. Keep them exactly as-is in English.
4. MCQ FORMAT: Preserve MCQ option labels exactly — (a), (b), (c), (d), A), B) — do not translate or remove them.
5. ANSWER KEYS: Lines like "Answer: A" or "उत्तर: B" must stay intact with the original letter.
6. NUMBERS & DATES: Keep all numbers, years, percentages, and dates in their original form.
7. EXAMINATION LANGUAGE: Use formal Sarkari Hindi (formal government Hindi), not colloquial Hindi. The tone should match official UPSC/HCS question papers.
8. CONCEPTS: If a concept has an established Hindi equivalent used in official government documents (e.g., "Directive Principles" = "राज्य के नीति निर्देशक तत्व"), use that exact term.
9. OUTPUT: Return ONLY the translated Hindi text. No explanations, no notes, no English words except where rules above apply.`;

// ─── Abbreviation protection (used for Google Translate path) ─────────────────
const PROTECTED_ABBREVIATIONS = [
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

function protectAbbreviations(text, customAbbrs = []) {
  const allAbbrs = [...new Set([...customAbbrs, ...PROTECTED_ABBREVIATIONS])];
  const map = new Map();
  let result = text;
  for (const abbr of allAbbrs) {
    const placeholder = `\u00AB${abbr}\u00BB`;
    const regex = new RegExp(`\\b${escapeRegex(abbr)}\\b`, 'g');
    if (regex.test(result)) {
      result = result.replace(regex, placeholder);
      map.set(placeholder, abbr);
    }
  }
  return { protected: result, map };
}

function restoreAbbreviations(text, map) {
  let result = text;
  for (const [placeholder, abbr] of map) {
    result = result.replace(new RegExp(escapeRegex(placeholder), 'g'), abbr);
    result = result.replace(new RegExp(`«\\s*${escapeRegex(abbr)}\\s*»`, 'gi'), abbr);
  }
  return result;
}

function protectMCQPatterns(text, map) {
  let result = text;
  let idx = map.size;
  result = result.replace(
    /((?:उत्तर|Answer|Ans)[\s]*[:।]\s*)([A-Ea-e])\b/gi,
    (match) => { const ph = `«MCQ${idx++}»`; map.set(ph, match); return ph; }
  );
  result = result.replace(/\(([a-eA-E])\)/g, (match) => {
    const ph = `«MCQ${idx++}»`; map.set(ph, match); return ph;
  });
  result = result.replace(/(?<![a-zA-Z])([a-eA-E])\)(?=\s|$)/gm, (match) => {
    const ph = `«MCQ${idx++}»`; map.set(ph, match); return ph;
  });
  return result;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

// ── Claude translation ────────────────────────────────────────────────────────
/**
 * Translate a batch of paragraphs using Claude.
 * Sends them as a numbered list so Claude returns them in the same order.
 */
async function translateWithClaude(paragraphs) {
  if (paragraphs.length === 0) return [];

  // Number each paragraph so we can split the output reliably
  const numbered = paragraphs
    .map((p, i) => `[${i + 1}] ${p}`)
    .join('\n\n');

  const userMsg = `Translate each numbered paragraph below from English to Hindi for UPSC/HCS exam material. Preserve the [N] number prefix on each paragraph in your output.\n\n${numbered}`;

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: UPSC_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
  });

  const rawOutput = response.content[0]?.text || '';

  // Split on [1], [2], [3]... markers
  const parts = rawOutput.split(/\n*\[(\d+)\]\s*/);
  // parts[0] = '' (before first marker), then alternating index / text
  const result = Array(paragraphs.length).fill('');
  for (let i = 1; i < parts.length - 1; i += 2) {
    const idx = parseInt(parts[i], 10) - 1;
    if (idx >= 0 && idx < paragraphs.length) {
      result[idx] = parts[i + 1].trim();
    }
  }

  // Fallback: if Claude didn't number properly, return as-is split by double newline
  const hasEmpty = result.some((r, i) => !r && paragraphs[i].trim());
  if (hasEmpty && paragraphs.length === 1) {
    return [rawOutput.trim()];
  }

  return result.map((t, i) => t || paragraphs[i]); // keep original if Claude missed it
}

// ── Google Translate path ─────────────────────────────────────────────────────
async function translateChunkRaw(text, customAbbrs = []) {
  if (!text.trim()) return text;
  const { protected: abbProtected, map } = protectAbbreviations(text, customAbbrs);
  const mcqProtected = protectMCQPatterns(abbProtected, map);
  const result = await translate(mcqProtected, { from: 'en', to: 'hi' });
  let translated = decodeHtmlEntities(result.text?.trim() || '');
  translated = restoreAbbreviations(translated, map);
  const origTrimmed = text.trim();
  if (!origTrimmed.startsWith('"') && !origTrimmed.startsWith('\u201c')) {
    translated = translated.replace(/^[""\u201c\u201d]+|[""\u201c\u201d]+$/g, '').trim();
  }
  return translated;
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Translate a single text chunk (used by translateAllChunks path).
 */
export async function translateChunk(text, chunkIndex, totalChunks, onProgress, customAbbrs = []) {
  try {
    let translatedText;
    if (USE_CLAUDE) {
      const results = await translateWithClaude([text]);
      translatedText = results[0] || text;
    } else {
      translatedText = await translateChunkRaw(text, customAbbrs);
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
      await new Promise((r) => setTimeout(r, USE_CLAUDE ? 200 : 500));
    }
  }

  return translated.join('\n\n');
}

/**
 * Translate an array of paragraphs preserving 1-to-1 order.
 * Used for DOCX clone-and-replace.
 */
export async function translateParagraphs(paragraphs, bookContext = '', onProgress) {
  const customAbbrs = parseCustomAbbreviations(bookContext);

  if (USE_CLAUDE) {
    return translateParagraphsWithClaude(paragraphs, onProgress);
  }
  return translateParagraphsWithGoogle(paragraphs, customAbbrs, onProgress);
}

// ── Claude paragraph translation (batched) ────────────────────────────────────
async function translateParagraphsWithClaude(paragraphs, onProgress) {
  const BATCH_SIZE = 20; // Claude can handle larger batches
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
      // Filter empty paragraphs — translate non-empty ones only
      const nonEmptyIndices = [];
      const nonEmptyTexts = [];
      batch.forEach((p, i) => {
        if (p.trim()) { nonEmptyIndices.push(i); nonEmptyTexts.push(p); }
      });

      const batchResult = Array(batch.length).fill('');
      if (nonEmptyTexts.length > 0) {
        const results = await translateWithClaude(nonEmptyTexts);
        nonEmptyIndices.forEach((origIdx, ri) => {
          let t = results[ri] || batch[origIdx];
          t = applyGlossaryPostProcessing(t, batch[origIdx]);
          batchResult[origIdx] = t;
        });
      }
      translated.push(...batchResult);
    } catch (err) {
      console.warn(`Claude batch ${b + 1} failed: ${err.message}. Keeping originals.`);
      translated.push(...batch); // keep original on failure
    }

    if (b < totalBatches - 1) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  return translated;
}

// ── Google Translate paragraph translation (batched) ─────────────────────────
async function translateParagraphsWithGoogle(paragraphs, customAbbrs, onProgress) {
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
        // Separator mangled — translate individually
        console.warn(`Batch ${b + 1}: split mismatch. Translating individually.`);
        for (const para of batch) {
          try {
            const { protected: abbPara, map: pMap } = protectAbbreviations(para, customAbbrs);
            const safePara = protectMCQPatterns(abbPara, pMap);
            const r = await translate(safePara, { from: 'en', to: 'hi' });
            let t = restoreAbbreviations(decodeHtmlEntities((r.text || '').trim()), pMap);
            t = applyGlossaryPostProcessing(t, para);
            translated.push(t);
          } catch { translated.push(para); }
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
        } catch { translated.push(para); }
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    if (b < totalBatches - 1) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  return translated;
}
