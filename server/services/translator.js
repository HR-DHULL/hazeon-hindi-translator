import { GoogleGenerativeAI } from '@google/generative-ai';
import { applyGlossaryPostProcessing, applyHindiCorrections, getGlossaryPrompt } from './glossary.js';
import { applyContextDisambiguation, getDisambiguationPrompt } from './contextDisambiguation.js';
import { lookupCache, storeCache, getCacheStats } from './translationCache.js';

// ── Google Gemini AI — REQUIRED ──────────────────────────────────────────────
if (!process.env.GEMINI_API_KEY) {
  console.error('  WARNING: GEMINI_API_KEY is not set. Translation will fail until configured.');
  console.error('  Get your key from: aistudio.google.com → API Keys');
}

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;
if (genAI) console.log('  Translation engine: Google Gemini (context-aware UPSC/HCS mode)');

// ── Gemini model ─────────────────────────────────────────────────────────────
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const IS_THINKING_MODEL = GEMINI_MODEL.includes('2.5');

// ── System prompt for UPSC/HCS context-aware translation ─────────────────────
// Base prompt — glossary is injected separately via buildSystemPrompt()
const UPSC_BASE_PROMPT = `You are an expert Hindi translator for UPSC/HCS competitive exam material. Translate everything from English to formal Hindi (राजभाषा) using the exact language of official UPSC question papers and Lok Sabha proceedings.

RULES:
1. NEVER transliterate. Use proper Hindi: राजकोषीय (fiscal), न्यायपालिका (judiciary), अध्यादेश (ordinance), अधिकरण (tribunal).
2. Keep abbreviations as-is: UPSC, IAS, HCS, GDP, RBI, GST, SEBI, ISRO, PIL, CAG, DNA, pH, AM, PM, WTO, UNESCO, UNICEF, WHO, NDA, BJP, INC, etc.
3. GLOSSARY IS MANDATORY: Use the glossary terms EXACTLY as given — they override your default choices. If the glossary says "Tribunal" = "अधिकरण", you MUST use "अधिकरण" every time. Never deviate from glossary mappings.
4. MCQ labels: (a)(b)(c)(d) stay in English. One option per line. Never drop or merge labels. Use कूट (not कोड), कीजिए (not करें), चुनिए (not चुनें), उपर्युक्त (not उपरोक्त).
5. Single letters as variables/labels (A, B, C in match-the-following; P, Q, R in puzzles): keep as English. WRONG: ए-3, बी-2 → CORRECT: A-3, B-2.
6. Roman numerals I, II, III: keep as-is. Never translate I as मैं.
7. Numbers, dates, years, math formulas, percentages: keep unchanged.
8. ⚠ MANDATORY: Translate EVERY English sentence, question stem, and option text into Hindi. If you see an English question like "Which of the following..." or "Consider the following statements..." — you MUST translate it. Leaving any English sentence untranslated is a critical error.
9. Transliterate all person names and place names to Devanagari script: Annie Besant → एनी बेसेंट, A.O. Hume → ए.ओ. ह्यूम, Sarojini Naidu → सरोजिनी नायडू, Tilak → तिलक, Bombay → बंबई/मुंबई.
10. Exam source citation tags appear as §§0§§, §§1§§ etc. — keep these placeholders EXACTLY as-is in your output. Do NOT translate, modify, or remove them. They are technical markers.
11. Output ONLY the translated text. No explanations, notes, or comments.`;

// Precompute all prompts once at startup — enables Gemini implicit prefix caching
// (same string object reused → API caches KV across calls → much faster)
const SYSTEM_PROMPTS = {
  default:     UPSC_BASE_PROMPT + '\n\n' + getGlossaryPrompt(null),
  history:     UPSC_BASE_PROMPT + '\n\n' + getGlossaryPrompt('history'),
  geography:   UPSC_BASE_PROMPT + '\n\n' + getGlossaryPrompt('geography'),
  economics:   UPSC_BASE_PROMPT + '\n\n' + getGlossaryPrompt('economics'),
  science:     UPSC_BASE_PROMPT + '\n\n' + getGlossaryPrompt('science'),
  environment: UPSC_BASE_PROMPT + '\n\n' + getGlossaryPrompt('environment'),
  polity:      UPSC_BASE_PROMPT + '\n\n' + getGlossaryPrompt('polity'),
};

function buildSystemPrompt(subject = null) {
  return SYSTEM_PROMPTS[subject] || SYSTEM_PROMPTS.default;
}

// ── Gemini translation ───────────────────────────────────────────────────────

// Abbreviations/acronyms that are legitimately kept as English in Hindi output
const ALLOWED_ENGLISH = /^(UPSC|IAS|HCS|GDP|RBI|GST|SEBI|ISRO|UN|NATO|CRR|SLR|FDI|PIL|CAG|ATM|EMI|DNA|RNA|NOTA|NCL|CSR|IMF|NGO|NRI|UNESCO|UNICEF|WHO|FIFA|BRICS|IGMDP|OMR|CSAT|PCS|NDA|BJP|INC|CBI|ED|IPC|CPC|NITI|NHRC|NHPC|NDMA|NCPCR|UIDAI|RTE|RTI|CAA|NRC|NPR|JPC|PAC|ECI|CVC|CIC|pH|UV|AM|PM|MCQ|DOCX|PDF|WTO|ILO|IAEA|OPCW|ICC|ICJ|UNSC|UNGA|UNDP|FAO|IDA|IBRD|ADB|NDB|AIIB|IMF|WB|REC|NABARD|SIDBI|MUDRA|MSME|PSU|LPG|CNG|VLCC|ULCC|LED|CFL|PCB|CPU|GPU|SSD|HDD|USB|GPS|GSM|CDMA|LTE|OLED|AMOLED|LCD|IP|HTTP|HTTPS|TCP|UDP|VPN|API|SQL|XML|HTML|CSS|JS|TS|AI|ML|NLP|IoT|AR|VR|MR|XR|EV|ICE|CAFE|TRAI|IRDA|PFRDA|SEBI|IRDAI|NHB|IBC|NCLT|NCLAT|CCI|SAT|TDSAT|APTEL|CERC|CESTAT|ITAT|NFRA|ICAI|ICSI|ICMAI)$/i;

/** Check if text has significant untranslated English content */
function hasUntranslatedEnglish(text, original) {
  if (!text || !original) return false;
  // Skip if it's a math formula or symbol-heavy line
  if (/^[\d\s\(\)\.\-\+\*\/=×÷%<>a-dA-D,;:?!]+$/.test(text.trim())) return false;

  // Count English words (3+ chars to catch short words like "the", "are", "has", "not")
  const engWords = (text.match(/\b[A-Za-z]{3,}\b/g) || []).filter(w => !ALLOWED_ENGLISH.test(w));

  if (engWords.length === 0) return false;

  const engCharCount = engWords.join('').length;
  const totalChars = text.replace(/\s/g, '').length;
  if (totalChars === 0) return false;

  const engRatio = engCharCount / totalChars;

  // Detect "Term: definition" pattern — e.g. "Barid: गुमचर अधिकारी" or "Waqf: सुल्तान की संपत्ति"
  // These are single Arabic/Persian/English terms followed by a Hindi definition.
  // A single English word before a colon at the start of text = needs transliteration.
  const startsWithEnglishTerm = /^[A-Za-z][A-Za-z\-]{2,}\s*[:।]/.test(text.trim());

  // Detect single MCQ option that is entirely English: "(b) Pressure", "(c) Kilocalorie"
  // These have only 1 English word but should still be retried.
  const isSingleOptionEnglish = /^\([a-d]\)\s+[A-Za-z][\w\s\-]{1,40}$/.test(text.trim()) && engWords.length >= 1;

  // Trigger retry if:
  // - Single English term before colon (historical term pattern)
  // - OR single MCQ option that is entirely English
  // - OR 3+ non-allowed English words AND ratio > 35% (relaxed — glossary handles most terms now)
  // - OR any complete English sentence detected (6+ consecutive words)
  const hasEnglishSentence = /\b[A-Z][a-z]+(\s+[a-zA-Z]+){5,}/.test(text);
  return startsWithEnglishTerm || isSingleOptionEnglish || (engWords.length >= 3 && engRatio > 0.35) || hasEnglishSentence;
}

// ── Exam source tag protection ────────────────────────────────────────────────
// Tags like [UPPSC 2015], [UP Lower Sub. 2004], [UP R.O./A.R.O. (Mains) 2014]
// must NEVER be sent to Gemini — they get transliterated into wrong Hindi.
// We replace them with placeholders before translation and restore after.

/** Matches exam source citation tags, e.g. [UPPSC 2015] [UP Lower Sub. 2004] */
const EXAM_TAG_REGEX = /\[([A-Z][^\]]{1,60}(?:19|20)\d{2}[^\]]*)\]/g;

/**
 * Detect if a paragraph is a standalone exam source citation line.
 * These are short lines containing an exam name + year, e.g.:
 *   "UPPSC 2015", "UP PCS (Pre) 2018", "SSC CGL 2020", "UPSC Prelims 2019"
 *   "UP Lower Sub. 2004", "UP R.O./A.R.O. (Mains) 2014", "BPSC 67th 2022"
 * They should NOT be translated — keep as-is in the output.
 */
const STANDALONE_EXAM_REGEX = /^\s*\(?(?:UPSC|UPPSC|UP\s?PCS|UP\s?PSC|SSC|BPSC|MPPSC|RPSC|CGPSC|JPSC|HPSC|OPSC|WBPSC|KPSC|TNPSC|APPSC|TSPSC|MPSC|GPSC|UKPSC|HCS|RAS|IAS|NDA|CDS|CAPF|CPO|CGL|CHSL|IFS|IES|ISS|GATE|NET|CTET|DSSSB|KAS|JKPSC|UP\s+Lower\s+Sub|UP\s+R\.?O\.?|UP\s+A\.?R\.?O\.?|UP\s+PCS\s*\(|UP\s+U\.?D\.?A|UP\s+L\.?D\.?A)[^)]*\)?\s*\.?\s*(?:Pre\.?|Prelims?|Mains?|Pre\s*&\s*Mains|\d{1,3}(?:st|nd|rd|th))?\s*\.?\s*(?:\((?:Pre|Mains|Re-exam)\))?\s*,?\s*(?:19|20)\d{2}\s*\)?$/i;

function isStandaloneExamCitation(text) {
  const trimmed = text.trim();
  // Must be short (exam citations are typically under 60 chars)
  if (trimmed.length > 80 || trimmed.length < 4) return false;
  // Must contain a year
  if (!/(?:19|20)\d{2}/.test(trimmed)) return false;
  return STANDALONE_EXAM_REGEX.test(trimmed);
}

function protectExamTags(text) {
  const tags = [];
  const protected_ = text.replace(EXAM_TAG_REGEX, (match) => {
    const idx = tags.length;
    tags.push(match);
    // Use §§ delimiters — Gemini treats these as code/symbols and won't translate them
    return `§§${idx}§§`;
  });
  return { protected: protected_, tags };
}

function restoreExamTags(text, tags) {
  if (tags.length === 0) return text;
  // Instead of placing exam tags back inline (which breaks sentence flow),
  // collect them and append on a new line after the text.
  const usedTags = [];
  let result = text.replace(/§\s*§\s*(\d+)\s*§\s*§/g, (_, idx) => {
    const tag = tags[parseInt(idx, 10)];
    if (tag) usedTags.push(tag);
    return ''; // remove placeholder from inline position
  });
  // Fallback: single § variant (Gemini sometimes drops one §)
  if (/§\s*\d+\s*§/.test(result) && !/§§/.test(result)) {
    result = result.replace(/§\s*(\d+)\s*§/g, (_, idx) => {
      const tag = tags[parseInt(idx, 10)];
      if (tag) usedTags.push(tag);
      return '';
    });
  }
  // Clean up residual whitespace/punctuation from removed placeholders
  result = result.replace(/\s*[–—-]\s*$/g, ''); // trailing dashes left after tag removal
  result = result.replace(/\s{2,}/g, ' ').trim();
  // Append exam tags on a new line
  if (usedTags.length > 0) {
    result = result + '\n' + usedTags.join(' ');
  }
  return result;
}

/**
 * Translate a batch of paragraphs using Gemini.
 * Sends them as a numbered list so Gemini returns them in the same order.
 */
async function translateWithGemini(paragraphs, retryCount = 0) {
  if (paragraphs.length === 0) return [];
  if (!genAI) throw new Error('GEMINI_API_KEY is not configured. Set it in environment variables.');

  // Protect exam source tags (e.g. [UPPSC 2015], [UP Lower Sub. 2004]) before sending
  // to Gemini — they get incorrectly transliterated otherwise.
  const tagStores = paragraphs.map(p => protectExamTags(p));
  const protectedParagraphs = tagStores.map(t => t.protected);

  // Number each paragraph with unique delimiters unlikely to appear in UPSC content.
  // Using <<<P1>>> instead of [1] to avoid collision with "[Article 1]", "[Entry 2]" etc.
  const numbered = protectedParagraphs
    .map((p, i) => `<<<P${i + 1}>>> ${p}`)
    .join('\n\n');

  // ── Context-aware disambiguation + subject detection ─────────────────────
  const fullText = paragraphs.join(' ');
  const { disambiguations, detectedSubject } = applyContextDisambiguation(fullText);
  const disambiguationInstructions = getDisambiguationPrompt(disambiguations);

  if (retryCount === 0) {
    if (detectedSubject && detectedSubject !== 'general') {
      console.log(`  Subject detected: "${detectedSubject}" — injecting subject-specific glossary`);
    }
    if (disambiguations.length > 0) {
      console.log(`  Context disambiguation: ${disambiguations.length} ambiguous terms resolved`);
    }
  }

  // Build system prompt with detected subject, then create model
  const systemPrompt = buildSystemPrompt(detectedSubject);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature: 0.1,
      ...(IS_THINKING_MODEL ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  });

  const userMsg = `${disambiguationInstructions ? disambiguationInstructions + '\n\n' : ''}Translate each paragraph below from English to Hindi for UPSC/HCS exam material. Each paragraph starts with <<<PN>>> (e.g., <<<P1>>>, <<<P2>>>). Preserve that exact prefix in your output.\n\nCRITICAL: Translate EVERY English word/sentence into Hindi. Do NOT leave ANY complete English sentence or question untranslated. The only allowed English in output: acronyms (UPSC, GDP, RBI...), MCQ labels (a)(b)(c)(d), single-letter variables, numbers, and math formulas.\n\n${numbered}`;

  // 60-second timeout per batch (45s was too tight for larger batches, causing unnecessary fallbacks)
  const timeoutMs = 60000;
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Gemini batch timed out after ${timeoutMs / 1000}s`)), timeoutMs)
  );
  const result = await Promise.race([model.generateContent(userMsg), timeoutPromise]);
  const rawOutput = result.response.text();

  // Split on <<<P1>>>, <<<P2>>>... markers (also match <<<1>>> without P — Gemini sometimes drops it)
  const parts = rawOutput.split(/\n*<<<P?(\d+)>>>\s*/);
  const parsed = Array(paragraphs.length).fill('');
  for (let i = 1; i < parts.length - 1; i += 2) {
    const idx = parseInt(parts[i], 10) - 1;
    if (idx >= 0 && idx < paragraphs.length) {
      parsed[idx] = parts[i + 1].trim();
    }
  }

  // Fallback: if Gemini didn't use markers properly (e.g. for single paragraph)
  const hasEmpty = parsed.some((r, i) => !r && paragraphs[i].trim());
  if (hasEmpty && paragraphs.length === 1) {
    return [rawOutput.trim()];
  }

  // ── Retry logic: individually translate any missed/untranslated paragraphs ──
  const needsRetry = [];
  for (let i = 0; i < parsed.length; i++) {
    if (!paragraphs[i].trim()) continue;
    if (!parsed[i] || hasUntranslatedEnglish(parsed[i], paragraphs[i])) {
      needsRetry.push(i);
    }
  }

  if (needsRetry.length > 0 && retryCount < 2) {
    console.log(`  Retrying ${needsRetry.length} untranslated paragraphs individually (attempt ${retryCount + 1})...`);
    for (const idx of needsRetry) {
      try {
        const singleResult = await translateWithGemini([paragraphs[idx]], retryCount + 1);
        if (singleResult[0] && !hasUntranslatedEnglish(singleResult[0], paragraphs[idx])) {
          parsed[idx] = singleResult[0];
        }
      } catch (e) {
        console.warn(`  Retry failed for paragraph ${idx}: ${e.message}`);
      }
    }
  }

  // Restore exam source tags into each translated paragraph
  return parsed.map((t, i) => restoreExamTags(t || paragraphs[i], tagStores[i].tags));
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Translate a single text chunk (used by translateAllChunks path).
 */
export async function translateChunk(text, chunkIndex, totalChunks, onProgress) {
  try {
    const results = await translateWithGemini([text]);
    let translatedText = results[0] || text;
    translatedText = applyGlossaryPostProcessing(translatedText, text);
    translatedText = applyHindiCorrections(translatedText);

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
  }

  return translated.join('\n\n');
}

/**
 * Translate an array of paragraphs preserving 1-to-1 order.
 * Used for DOCX clone-and-replace.
 * Two-pass: first pass translates all batches, second pass fixes any remaining English.
 *
 * Standalone exam citation paragraphs (e.g. "UPPSC 2015") are preserved as-is.
 */
/**
 * Pre-process paragraphs to separate answer lines merged with option text.
 * In many UPSC PDFs, option (d) and "Answer: (b)" share the same paragraph:
 *   "(d) 1, 2 and 3   Answer: (b)"
 * This causes Gemini to lose the option text. We split them so each translates properly.
 * Also handles standalone answer lines like "Answer: (b)" — these should not be translated.
 * Returns { processed, answerMap } where answerMap tracks which paragraphs had answers extracted.
 */
function separateAnswerLines(paragraphs) {
  // Matches: "Answer: (b)", "Ans: (d)", "Ans. (a)", "Answer (c)", "Answer:(b)"
  // Also Hindi variants already present: "उत्तर: (b)", "उत्तर (d)"
  const ANSWER_SUFFIX = /\s+(Answer|Ans\.?|उत्तर)\s*:?\s*\(?([a-dA-D])\)?\s*$/i;
  // Standalone answer line: entire paragraph is just "Answer: (b)" or "Ans. (d)"
  const STANDALONE_ANSWER = /^\s*(Answer|Ans\.?)\s*:?\s*\(?([a-dA-D])\)?\s*$/i;

  const processed = [];
  const answerMap = new Map(); // index → extracted answer string

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];

    // Case 1: Standalone answer line — convert to Hindi, don't send to Gemini
    if (STANDALONE_ANSWER.test(p.trim())) {
      const m = p.trim().match(STANDALONE_ANSWER);
      processed.push(''); // empty → won't be translated
      answerMap.set(i, `उत्तर: (${m[2].toLowerCase()})`);
      continue;
    }

    // Case 2: Option + answer merged on same paragraph
    const match = p.match(ANSWER_SUFFIX);
    if (match && /^\s*\([a-d]\)\s+/i.test(p)) {
      const optionText = p.slice(0, match.index).trim();
      const answerLetter = match[2].toLowerCase();
      processed.push(optionText);
      answerMap.set(i, `उत्तर: (${answerLetter})`);
    } else {
      processed.push(p);
    }
  }

  return { processed, answerMap };
}

/**
 * Post-process: re-attach answer lines that were separated before translation.
 */
function reattachAnswerLines(translated, answerMap) {
  if (answerMap.size === 0) return translated;
  const result = [...translated];
  for (const [idx, answerText] of answerMap) {
    // Translate "Answer"/"Ans" to "उत्तर" if still in English
    const hindiAnswer = answerText
      .replace(/^(Answer|Ans\.?)\s*:?\s*/i, 'उत्तर: ');
    result[idx] = (result[idx] || '') + '\n' + hindiAnswer;
  }
  return result;
}

export async function translateParagraphs(paragraphs, bookContext = '', onProgress) {
  // Pre-process: separate answer lines merged with option (d) text
  const { processed: cleanedParagraphs, answerMap } = separateAnswerLines(paragraphs);
  if (answerMap.size > 0) {
    console.log(`  Separated ${answerMap.size} answer line(s) merged with option text`);
  }

  // Identify exam citation paragraphs that should NOT be translated
  const examCitationIndices = new Set();
  for (let i = 0; i < cleanedParagraphs.length; i++) {
    if (isStandaloneExamCitation(cleanedParagraphs[i])) {
      examCitationIndices.add(i);
    }
  }
  if (examCitationIndices.size > 0) {
    console.log(`  Preserving ${examCitationIndices.size} standalone exam citation(s) as-is`);
  }

  // Build filtered list for translation (replace exam citations with empty strings)
  const toTranslate = cleanedParagraphs.map((p, i) => examCitationIndices.has(i) ? '' : p);

  const translated = await translateParagraphsBatched(toTranslate, onProgress);

  // Restore exam citations in their original positions
  for (const idx of examCitationIndices) {
    translated[idx] = cleanedParagraphs[idx];
  }

  const verified  = await verifyAndFixTranslations(cleanedParagraphs, translated, onProgress, examCitationIndices);

  // Final safety: strip any §§N§§ placeholders and <<<PN>>> markers that survived the pipeline
  const sanitized = verified.map(p => {
    if (!p) return p;
    let clean = p.replace(/§\s*§?\s*\d+\s*§?\s*§/g, '');
    clean = clean.replace(/<<<P?\d+>>>/g, '');
    return clean;
  });
  const withLabels = fixMissingMCQLabels(sanitized);
  // Post-process: re-attach answer lines that were separated before translation
  return reattachAnswerLines(withLabels, answerMap);
}

// ── Gemini paragraph translation (batched, parallel, with translation memory) ─
async function translateParagraphsBatched(paragraphs, onProgress) {
  // Reduced from 30 to 20 paragraphs per batch for better accuracy.
  // Larger batches cause Gemini to get lazy and skip/merge paragraphs.
  const BATCH_SIZE = 20;
  const CONCURRENCY = 5; // Paid API key — run 5 batches in parallel

  const translated = new Array(paragraphs.length).fill('');

  // ── Translation Memory: check cache for previously translated paragraphs ──
  // IMPORTANT: cached translations still get post-processed through latest
  // glossary + Hindi corrections, so rule updates apply retroactively.
  let cacheHits = 0;
  try {
    const cached = await lookupCache(paragraphs);
    for (const [idx, text] of cached) {
      let t = applyGlossaryPostProcessing(text, paragraphs[idx]);
      t = applyHindiCorrections(t);
      translated[idx] = t;
      cacheHits++;
    }
    if (cacheHits > 0) {
      const stats = getCacheStats();
      console.log(`  Translation Memory: ${cacheHits}/${paragraphs.length} paragraphs from cache (${stats.memoryEntries} in memory, DB ${stats.dbAvailable ? 'connected' : 'unavailable'})`);
    }
  } catch (e) {
    console.warn('  Translation Memory lookup failed (non-fatal):', e.message);
  }

  // Build list of paragraphs that still need translation (cache misses)
  const needsTranslation = [];
  for (let i = 0; i < paragraphs.length; i++) {
    if (!translated[i] && paragraphs[i]?.trim()) {
      needsTranslation.push(i);
    }
  }

  if (needsTranslation.length === 0) {
    console.log('  All paragraphs served from Translation Memory — skipping Gemini');
    return translated;
  }

  if (cacheHits > 0) {
    console.log(`  Translating ${needsTranslation.length} remaining paragraphs via Gemini (${cacheHits} cached)`);
  }

  // Re-batch only the uncached paragraphs for Gemini
  const uncachedTexts = needsTranslation.map(i => paragraphs[i]);
  const totalBatches = Math.ceil(uncachedTexts.length / BATCH_SIZE);

  // Process uncached paragraphs in windows of CONCURRENCY batches at a time
  const newTranslations = []; // collect {source, translated} pairs for cache storage

  for (let w = 0; w < totalBatches; w += CONCURRENCY) {
    const window = [];
    for (let b = w; b < Math.min(w + CONCURRENCY, totalBatches); b++) {
      window.push(b);
    }

    if (onProgress) {
      const done = w * BATCH_SIZE;
      const total = uncachedTexts.length;
      await onProgress({
        chunk: w + 1,
        totalChunks: totalBatches,
        percent: Math.round((done / total) * 100),
        status: 'translating',
        message: `Translating paragraphs ${done + 1}–${Math.min(done + CONCURRENCY * BATCH_SIZE, total)} of ${total}${cacheHits ? ` (${cacheHits} from cache)` : ''}...`,
      });
    }

    await Promise.all(window.map(async (b) => {
      const batchStart = b * BATCH_SIZE;
      const batch = uncachedTexts.slice(batchStart, batchStart + BATCH_SIZE);
      const batchOriginalIndices = needsTranslation.slice(batchStart, batchStart + BATCH_SIZE);

      try {
        const nonEmptyLocalIndices = [];
        const nonEmptyTexts = [];
        batch.forEach((p, i) => {
          if (p.trim()) { nonEmptyLocalIndices.push(i); nonEmptyTexts.push(p); }
        });

        if (nonEmptyTexts.length > 0) {
          const results = await translateWithGemini(nonEmptyTexts);
          nonEmptyLocalIndices.forEach((localIdx, ri) => {
            let t = results[ri] || batch[localIdx];
            t = applyGlossaryPostProcessing(t, batch[localIdx]);
            t = applyHindiCorrections(t);
            const origIdx = batchOriginalIndices[localIdx];
            translated[origIdx] = t;
            // Safety: never cache text that still has unreplaced §§ placeholders
            if (!/§§?\s*\d+\s*§§?/.test(t)) {
              newTranslations.push({ source: batch[localIdx], translated: t });
            } else {
              console.warn(`  WARNING: Paragraph ${origIdx} still has §§ placeholder — skipping cache`);
            }
          });
        }
      } catch (err) {
        const isRateLimit = err.message.includes('429') || /quota|rate.?limit/i.test(err.message);
        const isTimeout = err.message.includes('timed out');
        console.warn(`Gemini batch ${b + 1} ${isTimeout ? 'timed out' : isRateLimit ? 'rate-limited (429)' : `failed: ${err.message}`}. Retrying individually...`);

        if (isRateLimit) await new Promise(r => setTimeout(r, 5000));

        for (let i = 0; i < batch.length; i++) {
          if (!batch[i].trim()) continue;
          const origIdx = batchOriginalIndices[i];
          try {
            const results = await translateWithGemini([batch[i]]);
            let t = results[0] || batch[i];
            t = applyGlossaryPostProcessing(t, batch[i]);
            t = applyHindiCorrections(t);
            translated[origIdx] = t;
            if (!/§§?\s*\d+\s*§§?/.test(t)) {
              newTranslations.push({ source: batch[i], translated: t });
            }
          } catch (retryErr) {
            if (/429|quota|rate.?limit/i.test(retryErr.message)) {
              await new Promise(r => setTimeout(r, 5000));
              try {
                const results = await translateWithGemini([batch[i]]);
                let t = results[0] || batch[i];
                t = applyGlossaryPostProcessing(t, batch[i]);
                t = applyHindiCorrections(t);
                translated[origIdx] = t;
                if (!/§§?\s*\d+\s*§§?/.test(t)) {
                  newTranslations.push({ source: batch[i], translated: t });
                }
                continue;
              } catch (_) {}
            }
            console.warn(`  Individual retry failed for paragraph ${origIdx}: ${retryErr.message}`);
            translated[origIdx] = batch[i];
          }
        }
      }
    }));
  }

  // Store new translations in cache (background — non-blocking)
  if (newTranslations.length > 0) {
    storeCache(newTranslations).catch(() => {});
    console.log(`  Translation Memory: stored ${newTranslations.length} new translations`);
  }

  return translated;
}

// ── Two-pass verification ─────────────────────────────────────────────────────

/**
 * Force-translate a single paragraph using a minimal, high-priority prompt.
 * Used for stubborn paragraphs that still have English after the first pass.
 */
async function forceTranslateSingle(text) {
  if (!genAI) throw new Error('GEMINI_API_KEY not configured');

  // Protect exam tags before sending
  const { protected: safeText, tags } = protectExamTags(text);

  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: `Translate the given text fully into Hindi (Devanagari script) for UPSC exam material. Keep only: acronyms (UPSC, GDP, RBI, etc.), MCQ option labels (a)(b)(c)(d), single-letter variables (A, B, C), Roman numerals (I, II, III), numbers, math formulas, and §§N§§ placeholders. Translate EVERYTHING else. Output ONLY the Hindi translation — no explanations.`,
    generationConfig: { temperature: 0.0, ...(IS_THINKING_MODEL ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
  });
  const result = await Promise.race([
    model.generateContent(`Translate to Hindi:\n${safeText}`),
    new Promise((_, reject) => setTimeout(() => reject(new Error('forceTranslate timeout')), 25000)),
  ]);
  let out = result.response.text().trim();
  out = restoreExamTags(out, tags);   // restore before post-processing
  out = applyGlossaryPostProcessing(out, text);
  out = applyHindiCorrections(out);
  return out;
}

/**
 * Second pass: find any translated paragraphs that still contain English and re-translate them.
 * This catches paragraphs that survived the first pass + retries unchanged.
 */
async function verifyAndFixTranslations(originals, translated, onProgress, skipIndices = new Set()) {
  // Find paragraphs that still have untranslated English content
  // Skip exam citation paragraphs — they are intentionally kept in English
  const problematic = [];
  for (let i = 0; i < translated.length; i++) {
    if (skipIndices.has(i)) continue;
    if (originals[i]?.trim() && translated[i] && hasUntranslatedEnglish(translated[i], originals[i])) {
      problematic.push(i);
    }
  }

  if (problematic.length === 0) {
    console.log('  Two-pass review: all paragraphs look fully translated ✓');
    return translated;
  }

  // Cap second-pass retries to limit API cost (raised from 15 to 30 for better coverage)
  const MAX_SECOND_PASS = 30;
  if (problematic.length > MAX_SECOND_PASS) {
    console.log(`  Two-pass review: capping from ${problematic.length} → ${MAX_SECOND_PASS} paragraphs to limit API cost`);
    problematic.length = MAX_SECOND_PASS;
  }

  console.log(`  Two-pass review: ${problematic.length} paragraphs still contain English — force-translating...`);

  if (onProgress) {
    await onProgress({
      status: 'reviewing',
      message: `Second pass: fixing ${problematic.length} paragraphs with remaining English...`,
    });
  }

  const result = [...translated];
  for (const idx of problematic) {
    try {
      const fixed = await forceTranslateSingle(originals[idx]);
      if (fixed && !hasUntranslatedEnglish(fixed, originals[idx])) {
        result[idx] = fixed;
        console.log(`    ✓ Fixed paragraph ${idx}`);
      } else {
        console.warn(`    ✗ Paragraph ${idx} still has English after force-translate`);
      }
    } catch (e) {
      console.warn(`    Force-translate failed for paragraph ${idx}: ${e.message}`);
    }
  }

  return result;
}

/**
 * Post-process all translated paragraphs to restore missing MCQ option labels.
 * When a question spans two batches, Gemini drops (c) and (d) labels.
 * This scans the full document and re-adds labels based on sequence position.
 */
function fixMissingMCQLabels(paragraphs) {
  // Option content patterns that indicate an MCQ option line
  const isOptionContent = (line) =>
    /^(केवल|सभी|कोई नहीं|उपर्युक्त में से कोई|[1-9]-[1-9]|A-|B-|C-|D-)/.test(line) ||
    /^\d+[,-]\s*\d/.test(line);

  const labels = ['(a)', '(b)', '(c)', '(d)'];
  const result = [...paragraphs];

  for (let i = 0; i < result.length; i++) {
    const line = (result[i] || '').trim();

    // Found an (a) labeled option — scan next 3 for missing (b)(c)(d)
    if (/^\(a\)\s+/.test(line)) {
      let labelIdx = 1; // next expected: (b)
      for (let j = i + 1; j < result.length && labelIdx < 4; j++) {
        const next = (result[j] || '').trim();
        if (!next) continue;

        // Already has correct label → advance
        if (next.startsWith(labels[labelIdx])) {
          labelIdx++;
          continue;
        }

        // Has a different (x) label → stop (different question)
        if (/^\([a-d]\)/.test(next)) break;

        // Looks like option content but missing label → add it
        if (isOptionContent(next)) {
          result[j] = labels[labelIdx] + ' ' + next;
          labelIdx++;
          continue;
        }

        // Non-option line → stop looking
        break;
      }
    }
  }

  return result;
}
