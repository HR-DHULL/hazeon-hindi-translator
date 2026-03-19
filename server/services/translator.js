import Anthropic from '@anthropic-ai/sdk';
import { applyGlossaryPostProcessing, applyHindiCorrections, getGlossaryPrompt } from './glossary.js';
import { applyContextDisambiguation, getDisambiguationPrompt } from './contextDisambiguation.js';

// ── Anthropic Claude AI — REQUIRED ───────────────────────────────────────────
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('  WARNING: ANTHROPIC_API_KEY is not set. Translation will fail until configured.');
  console.error('  Get your key from: console.anthropic.com → API Keys');
}

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
if (anthropic) console.log('  Translation engine: Claude AI (context-aware UPSC/HCS mode)');

// ── Claude model — use Haiku for speed/cost, Sonnet for best quality ─────────
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

// ── System prompt for UPSC/HCS context-aware translation ─────────────────────
const UPSC_SYSTEM_PROMPT = `You are an expert Hindi translator specializing in UPSC and HCS (Haryana Civil Services) examination material. You use official Rajbhasha (राजभाषा) — formal government Hindi as used in Lok Sabha proceedings, official gazettes, and UPSC Hindi-medium papers.

Your translation rules:
1. CONTEXT FIRST: Understand how each question/answer is framed before translating. Match the formal, precise language used in civil services exams.
2. NEVER TRANSLITERATE: Never write English words in Devanagari script. Always use the proper Hindi equivalent.
   - WRONG: फिस्कल पॉलिसी, ज्यूडिशियरी, एग्जीक्यूटिव, ऑर्डिनेंस, ट्रिब्यूनल
   - CORRECT: राजकोषीय नीति, न्यायपालिका, कार्यपालिका, अध्यादेश, अधिकरण
3. TECHNICAL TERMS: Use standard UPSC Hindi terminology from official Rajbhasha glossaries.
   - "Bill" (legislative) = विधेयक (NOT बिल)
   - "Cabinet" = मंत्रिमंडल (NOT कैबिनेट)
   - "Speaker" = अध्यक्ष (NOT स्पीकर/वक्ता)
   - "House" (parliament) = सदन (NOT घर)
   - "Motion" = प्रस्ताव (NOT गति)
   - "Act" (law) = अधिनियम (NOT कार्य)
4. ABBREVIATIONS: Never translate abbreviations like UPSC, IAS, HCS, GDP, RBI, GST, SEBI, ISRO, UN, NATO, CRR, SLR, FDI, PIL, CAG, etc. Keep them exactly as-is in English.
5. MCQ FORMAT — ABSOLUTE RULES (NEVER VIOLATE):
   - EVERY MCQ option MUST have its label. NEVER drop or remove option labels.
   - Option labels (a), (b), (c), (d) MUST stay EXACTLY as "(a)", "(b)", "(c)", "(d)" in English
   - NEVER convert them to Hindi: NO (ए), NO (बी), NO एमसीक्यू, NO MCQ1/MCQ2, NO «एमसीक्यू»
   - NEVER remove or merge option labels — each option MUST start with its label on its own line
   - If the original has "(a) Only 1 and 2" you MUST output "(a) केवल 1 और 2" — KEEP the "(a)" prefix!
   - If the original has "(a) 12 (b) 8 (c) 16 (d) 24" keep them exactly: "(a) 12\n(b) 8\n(c) 16\n(d) 24"
   - Even if the original uses different label styles (a., A., 1., (i)), normalize them to "(a)", "(b)", "(c)", "(d)"
   - Use "उपर्युक्त" (NOT उपरोक्त) for "above-mentioned"
   - Use "कूट" (NOT कोड) for "code" in MCQ instructions
   - Use formal imperative: "कीजिए" (NOT करें), "चुनिए" (NOT चुनें)
   - Standard pattern: "निम्नलिखित कथनों पर विचार कीजिए"
   - Standard pattern: "नीचे दिए गए कूट का प्रयोग कर सही उत्तर चुनिए"
6. ANSWER KEYS: "Answer: (a)" or "उत्तर: (b)" — ALWAYS use full parentheses around the letter. NEVER write "उत्तर: c)" — always "(c)".
7. NUMBERS & DATES: Keep all numbers, years, percentages, and dates in their original form.
8. EXAMINATION LANGUAGE: Use शुद्ध हिंदी (Shudh Hindi) — formal government Hindi, NOT colloquial Hindi. The tone must match official UPSC/HCS question papers.
9. OUTPUT: Return ONLY the translated Hindi text. No explanations, no notes, no English words except abbreviations.

15. SINGLE ENGLISH LETTERS — ABSOLUTE RULES (NEVER VIOLATE):
    When single English letters (A, B, C, D, E, F, G, P, Q, R, S, T, U, V, W, X, Y, Z) are used as:
    - LABELS in match-the-following tables (e.g., "A - 3, B - 2, C - 4, D - 1")
    - COLUMN/ROW HEADERS in tables or lists
    - PERSON/VARIABLE NAMES (e.g., "A and B start a business", "P walks east")
    - CODED ANSWER KEYS (e.g., "A B C D / 3 2 4 1")
    - ARRANGEMENT/SEQUENCE markers (e.g., "M, N, O, P, Q sit in a row")
    - ASSERTION-REASON labels: (A) for Assertion, (R) for Reason
    They MUST remain as English letters. NEVER transliterate them to Hindi:
    - WRONG: ए, बी, सी, डी, ई, एफ, जी, पी, क्यू, आर, एस, टी
    - CORRECT: A, B, C, D, E, F, G, P, Q, R, S, T
    - WRONG: "ए-3, बी-2, सी-4, डी-1" → CORRECT: "A-3, B-2, C-4, D-1"
    - WRONG: "ए और बी एक व्यापार शुरू करते हैं" → CORRECT: "A और B एक व्यापार शुरू करते हैं"

16. MATCH-THE-FOLLOWING / कूट FORMAT:
    In match-the-following questions, the "कूट:" (code) section has answer options like:
    "     A  B  C  D
    (a)  3  2  4  1
    (b)  2  3  1  4"
    The column headers A, B, C, D MUST stay in English. The row labels (a), (b), (c), (d) MUST stay in English.

17. ROMAN NUMERALS: Keep I, II, III, IV etc. as-is. NEVER translate "I" as "मैं" when it's a Roman numeral.

18. PM/AM TIME: Keep "PM" and "AM" as-is in time contexts (e.g., "5 PM" stays "5 PM", NOT "5 अपराह्न" or "5 पीएम").
19. NO DUPLICATE OPTIONS: For MCQ questions, output each option ONLY ONCE on its OWN separate line. NEVER put options inline within the question text AND also on separate lines. The correct format is:
   Question text here?
   (a) Option 1
   (b) Option 2
   (c) Option 3
   (d) Option 4
   WRONG format (options inline + repeated on separate lines):
   Question text here? (a) Option 1 (b) Option 2 (c) Option 3 (d) Option 4
   (a) Option 1
   (b) Option 2
   ...

10. GEOLOGY — CRITICAL RULES (common exam errors to avoid):
    - "lava" MUST always be "लावा". NEVER use "लाभ" (which means profit/benefit). This is the most common error.
    - Basaltic lava = "बेसाल्टिक लावा", Rhyolitic lava = "राइओलिटिक लावा", Andesitic lava = "एंडेसिटिक लावा"
    - magma = "मैग्मा", viscosity = "श्यानता", silica = "सिलिका", eruption = "विस्फोट"
    - Intrusive igneous bodies: Laccolith = "लैकोलिथ" (dome with flat base), Lopolith = "लोपोलिथ" (saucer-shaped), Phacolith = "फैकोलिथ" (lens at anticline/syncline), Batholith = "बैथोलिथ" (large granitic mass)
    - Cave formations: stalactite = "स्टैलेक्टाइट" (hangs from ceiling), stalagmite = "स्टैलेग्माइट" (rises from floor)

11. PLATE TECTONICS — CRITICAL RULES:
    - "convergent" = "अभिसारी", "divergent" = "अपसारी" — do NOT swap these.
    - Pacific Ring of Fire is associated with CONVERGENT (अभिसारी) plate boundaries, NOT divergent.
    - Subduction zone = "सबडक्शन ज़ोन", anticline = "अपनति", syncline = "अभिनति"

12. IGMDP MISSILES — MUST MATCH EXACTLY:
    - Trishul = "त्रिशूल" — Surface-to-AIR missile (सतह से वायु मिसाइल), short-range
    - Prithvi = "पृथ्वी" — Surface-to-SURFACE missile (सतह से सतह मिसाइल)
    - Agni = "अग्नि" — Surface-to-surface ballistic missile (सतह से सतह बैलिस्टिक मिसाइल)
    - NAG = "नाग" — Anti-tank missile (टैंक-रोधी मिसाइल)
    - Akash = "आकाश" — Surface-to-air missile (सतह से वायु मिसाइल)

13. ENVIRONMENT & WILDLIFE:
    - Critically Endangered = "गंभीर रूप से संकटग्रस्त", Endangered = "संकटग्रस्त", Vulnerable = "असुरक्षित"
    - Namami Gange = "नमामि गंगे" (do not translate the mission name)
    - IUCN Red List categories must use standard Hindi UPSC terminology

14. CONTEXT-AWARE DISAMBIGUATION — CRITICAL:
    Many English words have DIFFERENT Hindi translations depending on context.
    You MUST analyze the surrounding text to choose the correct meaning:
    - "Mercury" → "बुध" (planet context) vs "पारा" (chemical element context) vs "मर्करी" (Roman god)
    - "Plant" → "पौधा" (botanical/biology) vs "संयंत्र" (industrial factory)
    - "Act" → "अधिनियम" (law/legislation) vs "कार्य" (action/deed)
    - "Motion" → "प्रस्ताव" (parliamentary) vs "गति" (physics/movement)
    - "Speaker" → "अध्यक्ष" (parliamentary presiding officer) vs "वक्ता" (person speaking)
    - "House" → "सदन" (parliament) vs "घर" (building)
    - "Cabinet" → "मंत्रिमंडल" (council of ministers) vs "अलमारी" (furniture)
    - "Bill" → "विधेयक" (legislation) vs "बिल" (invoice)
    - "Cell" → "कोशिका" (biology) vs "सेल" (battery) vs "कक्ष" (prison)
    - "Power" → "शक्ति/सत्ता" (political authority) vs "शक्ति/ऊर्जा" (physics) vs "घात" (math exponent)
    - "Current" → "विद्युत धारा" (electric) vs "धारा" (ocean current) vs "वर्तमान" (present/ongoing)
    - "Revolution" → "क्रांति" (political uprising) vs "परिक्रमा" (orbital revolution)
    - "State" → "राज्य" (political state) vs "अवस्था" (condition/state of matter)
    - "Charge" → "प्रभार" (administrative duty) vs "शुल्क" (fee) vs "आवेश" (electric charge)
    - "Bench" → "न्यायपीठ" (judicial) vs "बेंच" (furniture)
    - "Bar" → "अधिवक्ता संघ" (legal profession) vs "छड़" (rod)
    - "Deposit" → "जमा" (banking) vs "निक्षेप" (geological/mineral)
    - "Fold" → "वलन" (geological fold) vs "गुना" (multiplier)
    - "Division" → "विभाजन" (parliamentary vote) vs "भाग" (math) vs "प्रभाग" (administrative)
    - "Drift" → "अपवाह/विस्थापन" (continental drift) vs "बहाव" (ocean/wind)
    - "Scale" → "पैमाना/मापनी" (map/measurement) vs "स्वरमान" (musical)
    - "Predictor" → "पूर्वानुमानकर्ता" (statistical/research) — NEVER "भविष्यअध्यक्ष" (that means future+president)
    - "Elasticity" (economics) → "लोच" — NEVER "अस्थिरता" (that means instability)
    ALWAYS consider context clues like subject keywords, surrounding terminology, and topic.

${getGlossaryPrompt()}`;

// ── Claude translation ────────────────────────────────────────────────────────
/**
 * Translate a batch of paragraphs using Claude.
 * Sends them as a numbered list so Claude returns them in the same order.
 */
async function translateWithClaude(paragraphs) {
  if (paragraphs.length === 0) return [];
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY is not configured. Set it in environment variables.');

  // Number each paragraph so we can split the output reliably
  const numbered = paragraphs
    .map((p, i) => `[${i + 1}] ${p}`)
    .join('\n\n');

  // ── Context-aware disambiguation ──────────────────────────────────────────
  // Analyze the full text to detect ambiguous terms and their correct meanings
  const fullText = paragraphs.join(' ');
  const { disambiguations, detectedSubject } = applyContextDisambiguation(fullText);
  const disambiguationInstructions = getDisambiguationPrompt(disambiguations);

  // Inject disambiguation context into the system prompt for this batch
  const systemPrompt = disambiguationInstructions
    ? UPSC_SYSTEM_PROMPT + disambiguationInstructions
    : UPSC_SYSTEM_PROMPT;

  if (disambiguations.length > 0) {
    console.log(`  Context disambiguation: detected subject="${detectedSubject}", ${disambiguations.length} ambiguous terms resolved`);
    for (const d of disambiguations) {
      console.log(`    "${d.term}" → "${d.correctHindi}" (${d.domain}, confidence: ${d.confidence})`);
    }
  }

  const userMsg = `Translate each numbered paragraph below from English to Hindi for UPSC/HCS exam material. Preserve the [N] number prefix on each paragraph in your output.\n\n${numbered}`;

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
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

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Translate a single text chunk (used by translateAllChunks path).
 */
export async function translateChunk(text, chunkIndex, totalChunks, onProgress) {
  try {
    const results = await translateWithClaude([text]);
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

    if (i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return translated.join('\n\n');
}

/**
 * Translate an array of paragraphs preserving 1-to-1 order.
 * Used for DOCX clone-and-replace.
 */
export async function translateParagraphs(paragraphs, bookContext = '', onProgress) {
  return translateParagraphsWithClaude(paragraphs, onProgress);
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
        const results = await translateWithClaude(nonEmptyTexts);
        nonEmptyIndices.forEach((origIdx, ri) => {
          let t = results[ri] || batch[origIdx];
          t = applyGlossaryPostProcessing(t, batch[origIdx]);
          t = applyHindiCorrections(t);
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
