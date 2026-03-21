import { GoogleGenerativeAI } from '@google/generative-ai';
import { applyGlossaryPostProcessing, applyHindiCorrections, getGlossaryPrompt } from './glossary.js';
import { applyContextDisambiguation, getDisambiguationPrompt } from './contextDisambiguation.js';

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

// ── System prompt for UPSC/HCS context-aware translation ─────────────────────
// Base prompt — glossary is injected separately via buildSystemPrompt()
const UPSC_BASE_PROMPT = `Translate UPSC/HCS exam material from English to formal Hindi (राजभाषा). Use the exact language of official UPSC question papers and Lok Sabha proceedings.

RULES:
1. NEVER transliterate. Use proper Hindi: राजकोषीय (fiscal), न्यायपालिका (judiciary), अध्यादेश (ordinance), अधिकरण (tribunal).
2. Keep abbreviations as-is: UPSC, IAS, HCS, GDP, RBI, GST, SEBI, ISRO, PIL, CAG, DNA, pH, AM, PM.
3. Use the glossary terms exactly as given — they override your default choices.
4. MCQ labels: (a)(b)(c)(d) stay in English. One option per line. Never drop or merge labels. Use कूट (not कोड), कीजिए (not करें), चुनिए (not चुनें), उपर्युक्त (not उपरोक्त).
5. Single letters as variables/labels (A, B, C in match-the-following; P, Q, R in puzzles): keep as English. WRONG: ए-3, बी-2 → CORRECT: A-3, B-2.
6. Roman numerals I, II, III: keep as-is. Never translate I as मैं.
7. Numbers, dates, years, math formulas, percentages: keep unchanged.
8. Translate ALL English text — no English sentences left in output. Only exceptions: abbreviations, option labels, single-letter variables, formulas.
9. Output ONLY the translated text. No explanations or comments.`;

/** Build the full system prompt, injecting subject-specific glossary once. */
function buildSystemPrompt(subject = null) {
  return UPSC_BASE_PROMPT + '\n\n' + getGlossaryPrompt(subject && subject !== 'general' ? subject : null);
}

// ── Gemini translation ───────────────────────────────────────────────────────

/** Check if text has significant untranslated English content */
function hasUntranslatedEnglish(text, original) {
  if (!text || !original) return false;
  // Skip if it's a math formula or symbol-heavy line
  if (/^[\d\s\(\)\.\-\+\*\/=×÷%<>a-dA-D,;:?!]+$/.test(text.trim())) return false;
  const engWords = (text.match(/\b[A-Za-z]{4,}\b/g) || []).filter(w =>
    !/^(UPSC|IAS|HCS|GDP|RBI|GST|SEBI|ISRO|UN|NATO|CRR|SLR|FDI|PIL|CAG|ATM|EMI|DNA|RNA|NOTA|NCL|CSR|IMF|NGO|NRI|UNESCO|UNICEF|WHO|FIFA|BRICS|IGMDP|OMR|CSAT|PCS|pH|UV|AM|PM|MCQ|DOCX|PDF)$/i.test(w)
  );
  // If more than 40% of content is English words, it's likely untranslated
  if (engWords.length >= 5) {
    const engCharCount = engWords.join('').length;
    const totalChars = text.replace(/\s/g, '').length;
    return engCharCount / totalChars > 0.3;
  }
  return false;
}

/**
 * Translate a batch of paragraphs using Gemini.
 * Sends them as a numbered list so Gemini returns them in the same order.
 */
async function translateWithGemini(paragraphs, retryCount = 0) {
  if (paragraphs.length === 0) return [];
  if (!genAI) throw new Error('GEMINI_API_KEY is not configured. Set it in environment variables.');

  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature: 0.2,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  // Number each paragraph so we can split the output reliably
  const numbered = paragraphs
    .map((p, i) => `[${i + 1}] ${p}`)
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

  // Build system prompt dynamically with detected subject glossary
  const systemPrompt = buildSystemPrompt(detectedSubject);

  const userMsg = `${disambiguationInstructions ? disambiguationInstructions + '\n\n' : ''}Translate each numbered paragraph below from English to Hindi for UPSC/HCS exam material. Preserve the [N] number prefix on each paragraph in your output. TRANSLATE EVERYTHING INTO HINDI — do NOT leave any English text untranslated except abbreviations and math formulas.\n\n${numbered}`;

  const result = await model.generateContent(userMsg);
  const rawOutput = result.response.text();

  // Split on [1], [2], [3]... markers
  const parts = rawOutput.split(/\n*\[(\d+)\]\s*/);
  const parsed = Array(paragraphs.length).fill('');
  for (let i = 1; i < parts.length - 1; i += 2) {
    const idx = parseInt(parts[i], 10) - 1;
    if (idx >= 0 && idx < paragraphs.length) {
      parsed[idx] = parts[i + 1].trim();
    }
  }

  // Fallback: if Gemini didn't number properly for single paragraph
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

  return parsed.map((t, i) => t || paragraphs[i]); // keep original as last resort
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
 */
export async function translateParagraphs(paragraphs, bookContext = '', onProgress) {
  return translateParagraphsBatched(paragraphs, onProgress);
}

// ── Gemini paragraph translation (batched) ───────────────────────────────────
async function translateParagraphsBatched(paragraphs, onProgress) {
  // Smaller batches = more reliable 1:1 mapping and fewer missed paragraphs
  const BATCH_SIZE = 15;
  const translated = [];
  const totalBatches = Math.ceil(paragraphs.length / BATCH_SIZE);

  for (let b = 0; b < totalBatches; b++) {
    const start = b * BATCH_SIZE;
    const batch = paragraphs.slice(start, start + BATCH_SIZE);

    if (onProgress) {
      await onProgress({
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
        const results = await translateWithGemini(nonEmptyTexts);
        nonEmptyIndices.forEach((origIdx, ri) => {
          let t = results[ri] || batch[origIdx];
          t = applyGlossaryPostProcessing(t, batch[origIdx]);
          t = applyHindiCorrections(t);
          batchResult[origIdx] = t;
        });
      }
      translated.push(...batchResult);
    } catch (err) {
      console.warn(`Gemini batch ${b + 1} failed: ${err.message}. Retrying individually...`);
      // Instead of keeping originals, retry each paragraph individually
      for (let i = 0; i < batch.length; i++) {
        if (!batch[i].trim()) { translated.push(''); continue; }
        try {
          const results = await translateWithGemini([batch[i]]);
          let t = results[0] || batch[i];
          t = applyGlossaryPostProcessing(t, batch[i]);
          t = applyHindiCorrections(t);
          translated.push(t);
        } catch (retryErr) {
          console.warn(`  Individual retry failed for paragraph ${start + i}: ${retryErr.message}`);
          translated.push(batch[i]); // last resort: keep original
        }
      }
    }
  }

  return translated;
}
