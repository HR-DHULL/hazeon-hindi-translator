import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { applyGlossaryPostProcessing, applyHindiCorrections, getGlossaryPrompt } from './glossary.js';
import { applyContextDisambiguation, getDisambiguationPrompt } from './contextDisambiguation.js';
import { lookupCache, storeCache, getCacheStats } from './translationCache.js';

// ── Gemini — Primary Translation Engine ─────────────────────────────────────
// Switched from OpenAI (gpt-4o-mini) to Gemini 2.5 Flash:
// - 1M token context → no output truncation even with large batches
// - Better Hindi glossary adherence in our testing
// - Cheaper per token
if (!process.env.GEMINI_API_KEY) {
  console.error('  WARNING: GEMINI_API_KEY is not set. Translation will fail until configured.');
}

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
if (genAI) console.log(`  Translation engine: Gemini ${GEMINI_MODEL} (UPSC/HCS mode)`);

// OpenAI fallback — kicks in when Gemini exhausts all retries (outage/timeout).
// Auto-cached prompt prefixes make repeat calls cheaper.
const OPENAI_FALLBACK_MODEL = process.env.OPENAI_FALLBACK_MODEL || 'gpt-4o-mini';
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
if (openai) console.log(`  Fallback engine: OpenAI ${OPENAI_FALLBACK_MODEL} (kicks in if Gemini fails)`);

// ── System prompt for UPSC/HCS context-aware translation ─────────────────────
// Base prompt — glossary is injected separately via buildSystemPrompt()
const UPSC_BASE_PROMPT = `You are an expert Hindi translator for UPSC/HCS competitive exam material. Translate everything from English to formal Hindi (राजभाषा) using the exact language of official UPSC question papers and Lok Sabha proceedings.

RULES:
1. NEVER transliterate. Always TRANSLATE to proper Hindi. Common mistakes to avoid:
   WRONG: फिस्कल → CORRECT: राजकोषीय (fiscal)
   WRONG: ज्यूडिशियरी → CORRECT: न्यायपालिका (judiciary)
   WRONG: ट्रिब्यूनल → CORRECT: अधिकरण (tribunal)
   WRONG: ऑर्डिनेंस → CORRECT: अध्यादेश (ordinance)
   WRONG: गवर्नमेंट → CORRECT: सरकार (government)
   WRONG: कांस्टीट्यूशन → CORRECT: संविधान (constitution)
   WRONG: पार्लियामेंट → CORRECT: संसद (parliament)
   WRONG: कमिटी → CORRECT: समिति (committee)
   WRONG: रिपोर्ट → CORRECT: प्रतिवेदन (report, in formal context)
2. Keep abbreviations as-is: UPSC, IAS, HCS, GDP, RBI, GST, SEBI, ISRO, PIL, CAG, DNA, pH, AM, PM, WTO, UNESCO, UNICEF, WHO, NDA, BJP, INC, etc.
3. GLOSSARY IS MANDATORY: Use the glossary terms EXACTLY as given — they override your default choices. If the glossary says "Tribunal" = "अधिकरण", you MUST use "अधिकरण" every time. Never deviate from glossary mappings.
4. MCQ labels: (a)(b)(c)(d) — and also a) b) c) d) without parentheses — stay in English EXACTLY as they appear in source. Never write (ए)(बी)(सी)(डी). One option per line. Never drop or merge labels. Use कूट (not कोड), कीजिए (not करें), चुनिए (not चुनें), उपर्युक्त (not उपरोक्त).
5. Single capital letters as variables/labels (A, B, C, D in match-the-following; P, Q, R in puzzles; X, Y, Z in logic): keep as English EXACTLY. WRONG: ए-3, बी-2, सी-1 → CORRECT: A-3, B-2, C-1. Never transliterate capital letter labels to Devanagari.
6. Roman numerals I, II, III: keep as-is. Never translate I as मैं.
7. Numbers, dates, years, math formulas, percentages: keep unchanged.
8. ⚠ MANDATORY: Translate EVERY English sentence, question stem, option text, and list item into Hindi. This includes short lines like "List-I (Article)", "1. Abolition of titles", "Protection of life and personal liberty". Even single-line items MUST be translated. Leaving ANY English text untranslated is a critical error. If a paragraph has <<<PN>>> prefix, you MUST output the translated version with the same <<<PN>>> prefix.
9. Transliterate all person names and place names to Devanagari script: Annie Besant → एनी बेसेंट, A.O. Hume → ए.ओ. ह्यूम, Sarojini Naidu → सरोजिनी नायडू, Tilak → तिलक, Bombay → बंबई/मुंबई.
10. Exam source citation tags appear as §§0§§, §§1§§ etc. — keep these placeholders EXACTLY as-is in your output. Do NOT translate, modify, or remove them. They are technical markers.
11. Output ONLY the translated text. No explanations, notes, or comments.
12. VERIFICATION BEFORE OUTPUT: Check each translated paragraph:
   - Is every English sentence fully translated to Hindi? If any English sentence remains, translate it now.
   - Are glossary terms used correctly? Cross-check against the glossary provided.
   - Are (a)(b)(c)(d) labels and A-1, B-2 codes preserved in English?
   - Are all §§N§§ placeholders intact?`;

/**
 * Build system prompt dynamically per batch.
 * Only includes glossary terms that appear in the batch text.
 * This reduced prompt from ~17K tokens (all 2083 terms) to ~1-2K tokens per call.
 * Massive reduction in token usage = fewer 429 rate limit errors.
 *
 * @param {string|null} subject - detected subject
 * @param {string} batchText - combined text of paragraphs in this batch
 */
function buildSystemPrompt(subject = null, batchText = '') {
  return UPSC_BASE_PROMPT + '\n\n' + getGlossaryPrompt(subject, batchText);
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
 * Sends them as a numbered list so the model returns them in the same order.
 */
async function translateWithGemini(paragraphs, retryCount = 0) {
  if (paragraphs.length === 0) return [];
  if (!genAI) throw new Error('GEMINI_API_KEY is not configured. Set it in environment variables.');

  // Protect exam source tags before sending
  const tagStores = paragraphs.map(p => protectExamTags(p));
  const protectedParagraphs = tagStores.map(t => t.protected);

  const numbered = protectedParagraphs
    .map((p, i) => `<<<P${i + 1}>>> ${p}`)
    .join('\n\n');

  // Context-aware disambiguation + subject detection
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

  const systemPrompt = buildSystemPrompt(detectedSubject, fullText);

  const userMsg = `${disambiguationInstructions ? disambiguationInstructions + '\n\n' : ''}Translate each paragraph below from English to Hindi for UPSC/HCS exam material. Each paragraph starts with <<<PN>>> (e.g., <<<P1>>>, <<<P2>>>). Preserve that exact prefix in your output. Output ALL paragraphs with their <<<PN>>> prefix - do not skip any.\n\nCRITICAL RULES:\n1. Translate EVERY paragraph, even short ones like "Primary Market Growth" or "Govt Healthcare Spending".\n2. Do NOT leave ANY English text untranslated. Even single-word headings must be translated.\n3. The only allowed English: acronyms (UPSC, GDP, RBI...), MCQ labels (a)(b)(c)(d), single-letter variables, numbers.\n4. You MUST output exactly ${paragraphs.length} paragraphs with <<<P1>>> through <<<P${paragraphs.length}>>> prefixes.\n\n${numbered}`;

  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: systemPrompt,
    generationConfig: { temperature: 0.1, maxOutputTokens: 65000 },
  });

  // 6-attempt retry with exponential backoff — ported from translate_local.js.
  // Handles 503 service-overload storms that were causing cascading batch failures.
  let rawOutput;
  const MAX_ATTEMPTS = 6;
  let lastErr;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const result = await Promise.race([
        model.generateContent(userMsg),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 120000)),
      ]);
      rawOutput = result.response.text();
      const finishReason = result.response.candidates?.[0]?.finishReason;
      if (finishReason === 'MAX_TOKENS') {
        console.warn(`  WARNING: Batch output truncated (hit maxOutputTokens). Will retry missing paragraphs.`);
      }
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      const is429 = /429|quota|exhausted|rate.?limit/i.test(err.message);
      const is503 = /503|unavailable|fetching from|ECONNRESET|ETIMEDOUT|network/i.test(err.message);
      const isTimeout = err.message === 'timed out' || /timed out/i.test(err.message);
      const remaining = MAX_ATTEMPTS - attempt - 1;
      if ((is429 || is503 || isTimeout) && remaining > 0) {
        // 503s: exponential 30s, 60s, 90s, 120s, 150s, 180s (capped). 429: fixed 65s.
        const wait = is429 ? 65000 : isTimeout ? 15000 : Math.min(30000 * (attempt + 1), 180000);
        const tag = is429 ? '429' : is503 ? '503' : 'TIMEOUT';
        console.log(`  [${tag}] Waiting ${wait / 1000}s then retrying... (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      break; // not a retryable error or attempts exhausted
    }
  }
  // Gemini exhausted all retries — try OpenAI fallback with the same prompt.
  if (lastErr) {
    if (!openai) throw lastErr;
    console.log(`  [FALLBACK] Gemini exhausted. Trying OpenAI ${OPENAI_FALLBACK_MODEL}...`);
    try {
      const response = await openai.chat.completions.create({
        model: OPENAI_FALLBACK_MODEL,
        temperature: 0.1,
        max_tokens: 8192,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg },
        ],
      });
      rawOutput = response.choices[0]?.message?.content || '';
      const cached = response.usage?.prompt_tokens_details?.cached_tokens || 0;
      console.log(`  [FALLBACK] OpenAI succeeded (cached ${cached} tokens)`);
    } catch (openaiErr) {
      console.warn(`  [FALLBACK] OpenAI also failed: ${openaiErr.message?.slice(0, 100)}`);
      throw lastErr; // re-throw the original Gemini error so outer retry handler logs sanely
    }
  }

  // Sanitize: strip repeated character hallucinations (e.g. "享享享享" or "ड़ड़ड़ड़")
  rawOutput = rawOutput.replace(/(.)\1{20,}/g, '$1');

  // Split on <<<P1>>>, <<<P2>>>... markers
  const parts = rawOutput.split(/\n*<<<P?(\d+)>>>\s*/);
  const parsed = Array(paragraphs.length).fill('');
  for (let i = 1; i < parts.length - 1; i += 2) {
    const idx = parseInt(parts[i], 10) - 1;
    if (idx >= 0 && idx < paragraphs.length) {
      let text = parts[i + 1].trim();
      // Strip any remaining repeated character patterns (hallucination)
      text = text.replace(/(.)\1{15,}/g, '$1');
      parsed[idx] = text;
    }
  }

  // Fallback: if model didn't use markers properly (e.g. for single paragraph)
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
        // Delay between individual retries to avoid rate limits
        await new Promise(r => setTimeout(r, 500));
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
  bookContext = sanitizeBookContext(bookContext);
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

/**
 * Sanitize user-provided bookContext to prevent prompt injection.
 */
function sanitizeBookContext(ctx) {
  if (!ctx || typeof ctx !== 'string') return '';
  // Strip anything that looks like prompt injection
  let clean = ctx.slice(0, 200); // Max 200 chars
  clean = clean.replace(/ignore\s+(all|previous|above)/gi, '');
  clean = clean.replace(/translate\s+(everything|all)\s+to\s+english/gi, '');
  clean = clean.replace(/output\s+only\s+english/gi, '');
  clean = clean.replace(/do\s+not\s+translate/gi, '');
  return clean.trim();
}

export async function translateParagraphs(paragraphs, bookContext = '', onProgress) {
  bookContext = sanitizeBookContext(bookContext);
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

  // ── Multi-pass repair loop with plateau detection ──────────────────────────
  // Runs verify-and-fix + identical-check up to 5 times until either:
  //   - zero stragglers remain, OR
  //   - pass produces no improvement (plateau)
  // This matches the local shell-loop pattern that achieved 97-100% accuracy.
  let verified = translated;
  let prevStraggle = -1;
  const MAX_REPAIR_PASSES = 5;

  for (let repairPass = 1; repairPass <= MAX_REPAIR_PASSES; repairPass++) {
    // Step A: force-translate paragraphs flagged by hasUntranslatedEnglish()
    verified = await verifyAndFixTranslations(cleanedParagraphs, verified, onProgress, examCitationIndices);

    // Step B: retranslate paragraphs where translated === original
    const identicalIndices = [];
    for (let i = 0; i < cleanedParagraphs.length; i++) {
      if (examCitationIndices.has(i)) continue;
      const orig = cleanedParagraphs[i]?.trim();
      const trans = verified[i]?.trim();
      if (!orig || orig.length < 8) continue;
      if (/^[\d\s\.\(\)\-,A-Z\/:%→%+]+$/.test(orig)) continue; // numbers/codes only
      if (trans === orig) identicalIndices.push(i);
    }

    if (identicalIndices.length === 0) {
      console.log(`  Repair pass ${repairPass}: no stragglers — translation fully clean`);
      break;
    }

    // Plateau check: no improvement between passes → stop (these are unrecoverable)
    if (prevStraggle !== -1 && identicalIndices.length >= prevStraggle) {
      console.log(`  Repair pass ${repairPass}: ${identicalIndices.length} stragglers — plateau reached, stopping`);
      break;
    }
    prevStraggle = identicalIndices.length;

    console.log(`  Repair pass ${repairPass}: ${identicalIndices.length} paragraphs unchanged. Retranslating in batches...`);

    if (onProgress) {
      await onProgress({
        status: 'reviewing',
        message: `Repair pass ${repairPass}/${MAX_REPAIR_PASSES}: retrying ${identicalIndices.length} paragraphs...`,
      });
    }

    for (let b = 0; b < identicalIndices.length; b += 10) {
      const batchIndices = identicalIndices.slice(b, b + 10);
      const batchTexts = batchIndices.map(i => cleanedParagraphs[i]);
      try {
        const results = await translateWithGemini(batchTexts);
        for (let j = 0; j < batchIndices.length; j++) {
          const idx = batchIndices[j];
          if (results[j] && results[j].trim() && results[j].trim() !== cleanedParagraphs[idx].trim()) {
            verified[idx] = results[j];
          }
        }
      } catch (_) {
        for (const idx of batchIndices) {
          try {
            const fixed = await forceTranslateSingle(cleanedParagraphs[idx]);
            if (fixed && fixed.trim() && fixed.trim() !== cleanedParagraphs[idx].trim()) {
              verified[idx] = fixed;
            }
          } catch (__) {}
        }
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    const remaining = identicalIndices.filter(i => verified[i]?.trim() === cleanedParagraphs[i]?.trim()).length;
    console.log(`  Repair pass ${repairPass}: fixed ${identicalIndices.length - remaining}/${identicalIndices.length}`);
  }

  // Final safety: strip any §§N§§ placeholders and <<<PN>>> markers that survived the pipeline
  const sanitized = verified.map((p, i) => {
    // Never leave blank where original had text
    if ((!p || !p.trim()) && cleanedParagraphs[i]?.trim()) return cleanedParagraphs[i];
    let clean = p.replace(/§\s*§?\s*\d+\s*§?\s*§/g, '');
    clean = clean.replace(/<<<P?\d+>>>/g, '');
    return clean || cleanedParagraphs[i] || '';
  });
  const withLabels = fixMissingMCQLabels(sanitized);
  // Post-process: re-attach answer lines that were separated before translation
  return reattachAnswerLines(withLabels, answerMap);
}

// ── Gemini paragraph translation (batched, parallel, with translation memory) ─
async function translateParagraphsBatched(paragraphs, onProgress) {
  // Gemini 2.5 Flash has a 1M token context and 64K output tokens.
  // We can safely use a larger batch than OpenAI's gpt-4o-mini (capped at 5 due to 16K output).
  let BATCH_SIZE = 20;
  const MIN_BATCH = 10;
  const MAX_BATCH = 40;

  // Track API response times to adjust batch size
  let lastBatchTime = 0;

  // Adaptive concurrency: with batch-filtered glossary, token usage is much lower
  // so we can run more concurrently without hitting 1M tokens/min quota
  let CONCURRENCY = paragraphs.length > 2000 ? 2 : paragraphs.length > 500 ? 3 : 5;

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
          const batchTimerStart = Date.now();
          const results = await translateWithGemini(nonEmptyTexts);
          lastBatchTime = Date.now() - batchTimerStart;

          // Adjust batch size based on API response time
          if (lastBatchTime > 15000 && BATCH_SIZE > MIN_BATCH) {
            BATCH_SIZE = Math.max(MIN_BATCH, BATCH_SIZE - 5);
            console.log(`  Reducing batch size to ${BATCH_SIZE} (slow API)`);
          } else if (lastBatchTime < 5000 && BATCH_SIZE < MAX_BATCH) {
            BATCH_SIZE = Math.min(MAX_BATCH, BATCH_SIZE + 5);
          }

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
        const isRateLimit = /429|quota|rate.?limit|exhausted/i.test(err.message);
        const isTimeout = /timed out/i.test(err.message);
        const is503 = /503|unavailable|fetching from|ECONNRESET|ETIMEDOUT|network/i.test(err.message);

        if (isRateLimit || is503) {
          // RATE LIMITED or SERVICE UNAVAILABLE:
          // Wait for the FULL cooldown, then retry the batch ONCE. No individual retries.
          // Individual retries cause a cascade that burns the entire quota.
          const retryMatch = err.message.match(/retry\s*(?:in|after|Delay[":]*)\s*([\d.]+)/i);
          const waitMs = retryMatch ? Math.ceil(parseFloat(retryMatch[1]) * 1000) + 5000 : 60000;
          console.warn(`  Batch ${b + 1}: ${isRateLimit ? '429 rate-limited' : '503 unavailable'}. Waiting ${Math.round(waitMs/1000)}s then retrying batch once...`);

          // Also reduce concurrency for remaining batches
          if (CONCURRENCY > 1) {
            CONCURRENCY = 1;
            console.log(`  Reduced concurrency to 1 for remaining batches`);
          }

          await new Promise(r => setTimeout(r, waitMs));

          // ONE retry of the whole batch
          try {
            const nonEmpty = [];
            const nonEmptyIdx = [];
            batch.forEach((p, i) => { if (p.trim()) { nonEmpty.push(p); nonEmptyIdx.push(i); } });
            if (nonEmpty.length > 0) {
              const results = await translateWithGemini(nonEmpty);
              nonEmptyIdx.forEach((localIdx, ri) => {
                let t = results[ri] || batch[localIdx];
                t = applyGlossaryPostProcessing(t, batch[localIdx]);
                t = applyHindiCorrections(t);
                const origIdx = batchOriginalIndices[localIdx];
                translated[origIdx] = t;
                if (!/§§?\s*\d+\s*§§?/.test(t)) {
                  newTranslations.push({ source: batch[localIdx], translated: t });
                }
              });
            }
          } catch (_) {
            // Retry also failed - keep originals, move on. Do NOT cascade into individual retries.
            console.warn(`  Batch ${b + 1} retry also failed. Keeping ${batch.filter(p => p.trim()).length} paragraphs as original English. Will catch in second-pass review.`);
            for (let i = 0; i < batch.length; i++) {
              if (batch[i].trim()) {
                translated[batchOriginalIndices[i]] = batch[i];
              }
            }
          }
        } else if (isTimeout) {
          // TIMEOUT: split batch in half and retry each half
          console.warn(`  Batch ${b + 1} timed out. Keeping originals — will retry in second-pass.`);
          for (let i = 0; i < batch.length; i++) {
            if (batch[i].trim()) {
              translated[batchOriginalIndices[i]] = batch[i];
            }
          }
        } else {
          // OTHER ERROR: log and keep originals
          console.warn(`  Batch ${b + 1} failed: ${err.message?.slice(0, 100)}. Keeping originals.`);
          for (let i = 0; i < batch.length; i++) {
            if (batch[i].trim()) {
              translated[batchOriginalIndices[i]] = batch[i];
            }
          }
        }
      }
    }));

    // Rate limit protection: pause between batch windows for large documents
    // Gemini has 1M tokens/min limit. Longer pause for bigger docs.
    if (totalBatches > 5 && w + CONCURRENCY < totalBatches) {
      const pauseMs = uncachedTexts.length > 1000 ? 5000 : uncachedTexts.length > 500 ? 3000 : 2000;
      await new Promise(r => setTimeout(r, pauseMs));
    }
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

  const { protected: safeText, tags } = protectExamTags(text);

  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: 'Translate the given text fully into Hindi (Devanagari script) for UPSC exam material. Keep only: acronyms (UPSC, GDP, RBI, etc.), MCQ option labels (a)(b)(c)(d), single-letter variables (A, B, C), Roman numerals (I, II, III), numbers, math formulas, and §§N§§ placeholders. Translate EVERYTHING else. Output ONLY the Hindi translation.',
    generationConfig: { temperature: 0.0, maxOutputTokens: 4000 },
  });

  const result = await model.generateContent(`Translate to Hindi:\n${safeText}`);
  let out = result.response.text().trim();
  out = restoreExamTags(out, tags);
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

  // No cap — the outer repair loop in translateParagraphs handles pacing by
  // doing up to 5 passes with plateau detection. Capping here would starve
  // documents that have hundreds of legitimate stragglers.
  console.log(`  Verify pass: ${problematic.length} paragraphs still contain English — force-translating...`);

  if (onProgress) {
    await onProgress({
      status: 'reviewing',
      message: `Second pass: fixing ${problematic.length} paragraphs with remaining English...`,
    });
  }

  const result = [...translated];
  // Track consecutive rate-limit failures instead of globally aborting.
  // forceTranslateSingle already has the 6-attempt exp-backoff inside translateWithGemini's
  // caller chain for the batch path, but this single-paragraph path doesn't retry —
  // so bail after 5 consecutive rate-limit errors to prevent runaway quota burn.
  let consecutiveRateLimited = 0;
  for (const idx of problematic) {
    if (consecutiveRateLimited >= 5) {
      console.warn(`    5+ consecutive rate-limits — skipping remaining (outer repair loop will retry next pass)`);
      break;
    }
    try {
      await new Promise(r => setTimeout(r, 1000));
      const fixed = await forceTranslateSingle(originals[idx]);
      if (fixed && !hasUntranslatedEnglish(fixed, originals[idx])) {
        result[idx] = fixed;
        consecutiveRateLimited = 0;
      }
    } catch (e) {
      if (/429|quota|exhausted|rate.?limit|503|unavailable/i.test(e.message)) {
        consecutiveRateLimited++;
      } else {
        console.warn(`    Force-translate failed for paragraph ${idx}: ${e.message?.slice(0, 60)}`);
      }
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
