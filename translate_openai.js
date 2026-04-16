/**
 * Local DOCX translator using OpenAI GPT-4o-mini.
 * Bypasses Gemini rate limits entirely.
 *
 * Usage:
 *   node translate_openai.js "path/to/input.docx" [output.docx]
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { parseFile } from './server/services/fileParser.js';
import { cloneAndTranslateDOCX } from './server/services/docxProcessor.js';
import { getGlossaryPrompt, applyGlossaryPostProcessing, applyHindiCorrections } from './server/services/glossary.js';
import { applyContextDisambiguation, getDisambiguationPrompt } from './server/services/contextDisambiguation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BATCH_SIZE = 40;
const PAUSE_MS = 1000;  // 1s pause - OpenAI has much higher rate limits
const MODEL = 'gpt-4.1-mini';

const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) {
  console.error('ERROR: Set OPENAI_API_KEY');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_KEY });

const SYSTEM_PROMPT = `You are an expert Hindi translator for UPSC/HCS competitive exam material. Translate everything from English to formal Hindi (Rajbhasha) using the exact language of official UPSC question papers and Lok Sabha proceedings.

RULES:
1. NEVER transliterate. Always TRANSLATE to proper Hindi. WRONG: फिस्कल -> CORRECT: राजकोषीय
2. Keep abbreviations as-is: UPSC, GDP, RBI, GST, SEBI, ISRO, PIL, CAG, etc.
3. GLOSSARY IS MANDATORY: Use glossary terms EXACTLY as given.
4. MCQ labels (a)(b)(c)(d) stay in English. Use कूट (not कोड), कीजिए (not करें).
5. Single letters A, B, C, D and Roman numerals I, II, III: keep as-is.
6. Numbers, dates, years, math formulas, percentages: keep unchanged.
7. Translate EVERY English sentence. Leaving ANY English untranslated is a critical error.
8. Transliterate person/place names to Devanagari: Annie Besant -> एनी बेसेंट.
9. Output ONLY translated text. No explanations, no markdown, no notes.`;

async function translateBatch(paragraphs, batchNum, totalBatches) {
  const batchText = paragraphs.join(' ');
  const glossary = getGlossaryPrompt('economics', batchText);
  const { disambiguations } = applyContextDisambiguation(batchText);
  const disambPrompt = getDisambiguationPrompt(disambiguations);

  const numbered = paragraphs
    .map((p, i) => `<<<P${i + 1}>>> ${p}`)
    .join('\n\n');

  const userMsg = `${disambPrompt ? disambPrompt + '\n\n' : ''}Translate each paragraph from English to Hindi. Preserve <<<PN>>> prefixes exactly.\n\n${numbered}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: MODEL,
        temperature: 0.1,
        max_tokens: 16000,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT + '\n\n' + glossary },
          { role: 'user', content: userMsg },
        ],
      });

      const raw = response.choices[0].message.content;

      // Parse <<<P1>>> markers
      const parts = raw.split(/\n*<<<P?(\d+)>>>\s*/);
      const parsed = Array(paragraphs.length).fill('');
      for (let i = 1; i < parts.length - 1; i += 2) {
        const idx = parseInt(parts[i], 10) - 1;
        if (idx >= 0 && idx < paragraphs.length) {
          parsed[idx] = parts[i + 1].trim();
        }
      }

      if (paragraphs.length === 1 && !parsed[0]) {
        parsed[0] = raw.trim();
      }

      return parsed.map((t, i) => {
        if (!t) return paragraphs[i];
        let result = applyGlossaryPostProcessing(t, paragraphs[i]);
        result = applyHindiCorrections(result);
        return result;
      });
    } catch (err) {
      if (/429|rate/i.test(err.message) && attempt < 2) {
        console.log(`    [429] Waiting 20s... (attempt ${attempt + 1}/3)`);
        await new Promise(r => setTimeout(r, 20000));
        continue;
      }
      console.error(`    FAILED batch ${batchNum}: ${err.message?.slice(0, 80)}`);
      return paragraphs;
    }
  }
  return paragraphs;
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: node translate_openai.js "path/to/file.docx" [output.docx]');
    process.exit(1);
  }

  const baseName = path.basename(inputPath, path.extname(inputPath));
  const outputPath = process.argv[3] || path.join(path.dirname(inputPath), `${baseName}_hindi.docx`);

  console.log(`\n  Input:  ${inputPath}`);
  console.log(`  Output: ${outputPath}`);
  console.log(`  Model:  ${MODEL}`);
  console.log(`  Batch:  ${BATCH_SIZE} paragraphs\n`);

  console.log('  [1/4] Parsing DOCX...');
  const parsed = await parseFile(inputPath);
  const paragraphs = parsed.paragraphTexts;
  console.log(`    ${paragraphs.length} paragraphs, ${parsed.pageCount} pages\n`);

  console.log('  [2/4] Translating...');
  const translated = new Array(paragraphs.length).fill('');
  const totalBatches = Math.ceil(paragraphs.length / BATCH_SIZE);
  let translatedCount = 0;
  const startTime = Date.now();

  for (let b = 0; b < totalBatches; b++) {
    const batchStart = b * BATCH_SIZE;
    const batch = paragraphs.slice(batchStart, batchStart + BATCH_SIZE);
    const nonEmpty = batch.filter(p => p.trim());

    if (nonEmpty.length === 0) {
      for (let i = 0; i < batch.length; i++) translated[batchStart + i] = batch[i];
      continue;
    }

    const results = await translateBatch(nonEmpty, b + 1, totalBatches);

    let ri = 0;
    for (let i = 0; i < batch.length; i++) {
      if (batch[i].trim()) {
        translated[batchStart + i] = results[ri] || batch[i];
        ri++;
      } else {
        translated[batchStart + i] = batch[i];
      }
    }

    translatedCount += nonEmpty.length;
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = translatedCount / elapsed;
    const remaining = paragraphs.length - translatedCount;
    const eta = rate > 0 ? Math.ceil(remaining / rate) : '?';
    const pct = Math.round((translatedCount / paragraphs.length) * 100);

    process.stdout.write(`\r    Batch ${b + 1}/${totalBatches} | ${pct}% | ${translatedCount}/${paragraphs.length} | ETA: ${eta}s    `);

    if (b < totalBatches - 1) await new Promise(r => setTimeout(r, PAUSE_MS));
  }

  const totalTime = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n    Done in ${totalTime}s (${Math.round(paragraphs.length / totalTime * 60)} paragraphs/min)\n`);

  // ── Second pass: find and retranslate any paragraphs still in English ──
  console.log('  [3/5] Verification pass...');
  const stillEnglish = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const orig = paragraphs[i]?.trim();
    const trans = translated[i]?.trim();
    if (!orig || orig.length < 10) continue;
    // Skip if it's all numbers/codes/abbreviations
    if (/^[\d\s\.\(\)\-,A-Z\/:%→]+$/.test(orig)) continue;
    // Check if translation is same as original (not translated)
    if (trans === orig) {
      stillEnglish.push(i);
    } else if (!trans) {
      stillEnglish.push(i);
    }
  }

  if (stillEnglish.length > 0) {
    console.log(`    ${stillEnglish.length} paragraphs still in English. Retranslating individually...`);
    let fixed = 0;
    // Batch the retranslations in groups of 10
    for (let b = 0; b < stillEnglish.length; b += 10) {
      const batch = stillEnglish.slice(b, b + 10);
      const batchTexts = batch.map(i => paragraphs[i]);
      try {
        const results = await translateBatch(batchTexts, 'fix', 'fix');
        for (let j = 0; j < batch.length; j++) {
          const idx = batch[j];
          const result = results[j];
          // Only use if it's actually different (translated)
          if (result && result.trim() && result.trim() !== paragraphs[idx].trim()) {
            translated[idx] = result;
            fixed++;
          }
        }
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) {
        console.warn(`    Retry batch failed: ${e.message?.slice(0, 60)}`);
      }
    }
    console.log(`    Fixed ${fixed}/${stillEnglish.length} paragraphs\n`);
  } else {
    console.log('    All paragraphs translated. No fixes needed.\n');
  }

  // Final safety: ensure no empty translations
  for (let i = 0; i < paragraphs.length; i++) {
    if (!translated[i] || !translated[i].trim()) {
      translated[i] = paragraphs[i]; // keep original, never blank
    }
  }

  console.log('  [4/5] Generating Hindi DOCX...');
  await cloneAndTranslateDOCX(inputPath, translated, outputPath);

  const untranslated = translated.filter((t, i) => t === paragraphs[i] && paragraphs[i].trim().length > 10).length;
  console.log(`\n  [5/5] Summary:`);
  console.log(`    Translated: ${paragraphs.length - untranslated}/${paragraphs.length}`);
  console.log(`    Kept as original: ${untranslated} (${Math.round(untranslated / paragraphs.length * 100)}%)`);
  console.log(`    Output: ${outputPath}`);
  console.log(`    Size: ${(fs.statSync(outputPath).size / 1024).toFixed(0)} KB\n`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
