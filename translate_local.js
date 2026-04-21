/**
 * Local DOCX translator using Google Gemini.
 * Uses the SAME system prompt + glossary auto-detection as the server.
 *
 * Usage:
 *   node translate_local.js "path/to/input.docx" [output_path.docx]
 *
 * Requires: GEMINI_API_KEY in .env
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { parseFile } from './server/services/fileParser.js';
import { cloneAndTranslateDOCX } from './server/services/docxProcessor.js';
import { getGlossaryPrompt, applyGlossaryPostProcessing, applyHindiCorrections } from './server/services/glossary.js';
import { applyContextDisambiguation, getDisambiguationPrompt } from './server/services/contextDisambiguation.js';

const BATCH_SIZE = 20;        // Gemini 2.5 Flash handles larger batches well
const PAUSE_MS = 4000;        // 4s pause between batches
const RATE_LIMIT_WAIT = 65000;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const FONT_NAME = process.env.TRANSLATE_FONT || 'Nirmala UI';

if (!process.env.GEMINI_API_KEY) {
  console.error('ERROR: Set GEMINI_API_KEY in .env');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// OpenAI GPT-4o is now the PRIMARY engine — Gemini 2.5 Flash has been
// plagued by 503 outages. GPT-4o is reliable, same prompt + glossary gets applied.
const OPENAI_MODEL = process.env.OPENAI_PRIMARY_MODEL || 'gpt-4o';
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
if (openai) console.log(`  Primary engine: OpenAI ${OPENAI_MODEL}`);
if (genAI) console.log(`  Fallback engine: Gemini ${MODEL} (kicks in if OpenAI fails)`);

// Full prompt matching server/services/translator.js UPSC_BASE_PROMPT
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

async function translateBatch(paragraphs, batchNum, totalBatches, forcedSubject = null) {
  const batchText = paragraphs.join(' ');
  const { disambiguations, detectedSubject } = applyContextDisambiguation(batchText);
  const subjectToUse = forcedSubject || detectedSubject || null;
  const glossaryPrompt = getGlossaryPrompt(subjectToUse, batchText);
  const systemPrompt = UPSC_BASE_PROMPT + '\n\n' + glossaryPrompt;
  const disambPrompt = getDisambiguationPrompt(disambiguations);

  const numbered = paragraphs.map((p, i) => `<<<P${i + 1}>>> ${p}`).join('\n\n');
  const userMsg = `${disambPrompt ? disambPrompt + '\n\n' : ''}Translate each paragraph from English to Hindi. Preserve <<<PN>>> prefixes exactly. Output ALL paragraphs with <<<P1>>> through <<<P${paragraphs.length}>>>.\n\n${numbered}`;

  // ── Primary: OpenAI gpt-4o with 3 retries (reliable, so fewer retries needed) ──
  if (openai) {
    const MAX_OPENAI_ATTEMPTS = 3;
    for (let attempt = 0; attempt < MAX_OPENAI_ATTEMPTS; attempt++) {
      try {
        const response = await openai.chat.completions.create({
          model: OPENAI_MODEL,
          temperature: 0.1,
          max_tokens: 16000,  // gpt-4o supports up to 16K output
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMsg },
          ],
        });
        const raw = response.choices[0]?.message?.content || '';

        const parts = raw.split(/\n*<<<P?(\d+)>>>\s*/);
        const parsed = Array(paragraphs.length).fill('');
        for (let i = 1; i < parts.length - 1; i += 2) {
          const idx = parseInt(parts[i], 10) - 1;
          if (idx >= 0 && idx < paragraphs.length) parsed[idx] = parts[i + 1].trim();
        }
        if (paragraphs.length === 1 && !parsed[0]) parsed[0] = raw.trim();

        return parsed.map((t, i) => {
          if (!t) return paragraphs[i];
          let result = applyGlossaryPostProcessing(t, paragraphs[i]);
          result = applyHindiCorrections(result);
          return result;
        });
      } catch (err) {
        const is429 = /429|rate.?limit|quota/i.test(err.message);
        const is5xx = /5\d\d|timeout|ECONNRESET|ETIMEDOUT/i.test(err.message);
        const remaining = MAX_OPENAI_ATTEMPTS - attempt - 1;
        if ((is429 || is5xx) && remaining > 0) {
          const wait = 15000 * (attempt + 1);
          console.log(`    [OpenAI ${is429 ? '429' : '5xx'}] Waiting ${wait/1000}s... (attempt ${attempt+1}/${MAX_OPENAI_ATTEMPTS})`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        console.warn(`    OpenAI failed batch ${batchNum}: ${err.message?.slice(0, 80)}`);
        break; // fall through to Gemini fallback
      }
    }
  }

  // ── Fallback: Gemini 2.5 Flash ──
  if (genAI) {
    console.log(`    [FALLBACK] Trying Gemini ${MODEL}...`);
    try {
      const model = genAI.getGenerativeModel({
        model: MODEL,
        systemInstruction: systemPrompt,
        generationConfig: { temperature: 0.1 },
      });
      const result = await Promise.race([
        model.generateContent(userMsg),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 120000)),
      ]);
      const raw = result.response.text();

      const parts = raw.split(/\n*<<<P?(\d+)>>>\s*/);
      const parsed = Array(paragraphs.length).fill('');
      for (let i = 1; i < parts.length - 1; i += 2) {
        const idx = parseInt(parts[i], 10) - 1;
        if (idx >= 0 && idx < paragraphs.length) parsed[idx] = parts[i + 1].trim();
      }
      if (paragraphs.length === 1 && !parsed[0]) parsed[0] = raw.trim();

      console.log(`    [FALLBACK] Gemini succeeded for batch ${batchNum}`);
      return parsed.map((t, i) => {
        if (!t) return paragraphs[i];
        let r = applyGlossaryPostProcessing(t, paragraphs[i]);
        r = applyHindiCorrections(r);
        return r;
      });
    } catch (err) {
      console.warn(`    [FALLBACK] Gemini also failed: ${err.message?.slice(0, 80)}`);
    }
  }

  console.error(`    FAILED batch ${batchNum}: both OpenAI and Gemini unavailable. Keeping English.`);
  return paragraphs;
}

// (Old tryOpenAIFallback removed — OpenAI is now primary, Gemini fallback inline in translateBatch.)

async function main() {
  // Parse argv: accept --subject=<name> flag anywhere, rest are positional args.
  const args = process.argv.slice(2);
  let forcedSubject = null;
  const positional = [];
  for (const a of args) {
    const m = a.match(/^--subject=(.+)$/);
    if (m) forcedSubject = m[1].toLowerCase();
    else positional.push(a);
  }
  const inputPath = positional[0];
  if (!inputPath) {
    console.error('Usage: node translate_local.js [--subject=<name>] "path/to/file.docx" [output.docx]');
    console.error('  --subject values: history, geography, polity, economics, science, environment');
    process.exit(1);
  }

  const baseName = path.basename(inputPath, path.extname(inputPath));
  let outputPath = positional[1] || path.join(path.dirname(inputPath), `${baseName}_hindi.docx`);
  const cachePath = path.join(path.dirname(inputPath), `.${baseName}_translations.json`);

  console.log(`\n  Input:  ${inputPath}`);
  console.log(`  Output: ${outputPath}`);
  console.log(`  Model:  ${MODEL}`);
  console.log(`  Batch:  ${BATCH_SIZE} paragraphs`);
  console.log(`  Font:   ${FONT_NAME}`);
  if (forcedSubject) console.log(`  Subject: ${forcedSubject} (forced via --subject)`);
  else console.log(`  Subject: auto-detect per batch`);
  console.log('');

  console.log('  [1/5] Parsing DOCX...');
  const parsed = await parseFile(inputPath);
  const paragraphs = parsed.paragraphTexts;
  console.log(`    ${paragraphs.length} paragraphs, ${parsed.pageCount} pages\n`);

  let translated = new Array(paragraphs.length).fill('');
  let skipTranslation = false;
  if (fs.existsSync(cachePath)) {
    try {
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      if (cache.sourceCount === paragraphs.length && Array.isArray(cache.translated)) {
        translated = cache.translated;
        skipTranslation = true;
        console.log(`  Loaded ${translated.length} cached translations from prior run`);
        console.log(`  (Delete ${cachePath} to force a fresh run)\n`);
      }
    } catch {}
  }

  console.log('  [2/5] Translating via Gemini...');
  const totalBatches = Math.ceil(paragraphs.length / BATCH_SIZE);
  const startTime = Date.now();
  let translatedCount = 0;

  if (!skipTranslation) for (let b = 0; b < totalBatches; b++) {
    const batchStart = b * BATCH_SIZE;
    const batch = paragraphs.slice(batchStart, batchStart + BATCH_SIZE);
    const nonEmpty = batch.filter(p => p.trim());

    if (nonEmpty.length === 0) {
      for (let i = 0; i < batch.length; i++) translated[batchStart + i] = batch[i];
      continue;
    }

    const results = await translateBatch(nonEmpty, b + 1, totalBatches, forcedSubject);
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
    const eta = rate > 0 ? Math.ceil((paragraphs.length - translatedCount) / rate) : '?';
    const pct = Math.round((translatedCount / paragraphs.length) * 100);
    process.stdout.write(`\r    Batch ${b + 1}/${totalBatches} | ${pct}% | ${translatedCount}/${paragraphs.length} | ETA: ${eta}s    `);

    if (b < totalBatches - 1) await new Promise(r => setTimeout(r, PAUSE_MS));
  }

  if (!skipTranslation) {
    const totalTime = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n    Done in ${totalTime}s (${Math.round(paragraphs.length / totalTime * 60)} paragraphs/min)\n`);
    try {
      fs.writeFileSync(cachePath, JSON.stringify({ sourceCount: paragraphs.length, translated }, null, 0));
      console.log(`    Cached translations to ${cachePath}\n`);
    } catch (e) {
      console.warn(`    Cache write failed (non-fatal): ${e.message}`);
    }
  }

  console.log('  [3/5] Verification pass...');
  const stillEnglish = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const orig = paragraphs[i]?.trim();
    const trans = translated[i]?.trim();
    if (!orig || orig.length < 10) continue;
    if (/^[\d\s\.\(\)\-,A-Z\/:%→]+$/.test(orig)) continue;
    if (trans === orig || !trans) stillEnglish.push(i);
  }

  if (stillEnglish.length > 0) {
    console.log(`    ${stillEnglish.length} paragraphs still in English. Retranslating...`);
    let fixed = 0;
    for (let b = 0; b < stillEnglish.length; b += 10) {
      const batch = stillEnglish.slice(b, b + 10);
      const batchTexts = batch.map(i => paragraphs[i]);
      try {
        const results = await translateBatch(batchTexts, 'fix', 'fix', forcedSubject);
        for (let j = 0; j < batch.length; j++) {
          const idx = batch[j];
          const result = results[j];
          if (result && result.trim() && result.trim() !== paragraphs[idx].trim()) {
            translated[idx] = result;
            fixed++;
          }
        }
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        console.warn(`    Retry failed: ${e.message?.slice(0, 60)}`);
      }
    }
    console.log(`    Fixed ${fixed}/${stillEnglish.length} paragraphs\n`);
    // Update cache with fixed translations
    try {
      fs.writeFileSync(cachePath, JSON.stringify({ sourceCount: paragraphs.length, translated }, null, 0));
    } catch {}
  } else {
    console.log('    All paragraphs translated.\n');
  }

  for (let i = 0; i < paragraphs.length; i++) {
    if (!translated[i] || !translated[i].trim()) translated[i] = paragraphs[i];
  }

  console.log('  [4/5] Generating Hindi DOCX...');
  try {
    await cloneAndTranslateDOCX(inputPath, translated, outputPath);
  } catch (e) {
    if (/EBUSY|EPERM|locked/i.test(e.message)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const fallback = outputPath.replace(/\.docx$/, `_${ts}.docx`);
      console.warn(`    ${outputPath} is locked. Writing to ${fallback} instead.`);
      outputPath = fallback;
      await cloneAndTranslateDOCX(inputPath, translated, outputPath);
    } else {
      throw e;
    }
  }

  console.log(`  [4.5] Applying font: ${FONT_NAME}...`);
  await applyFontToDocx(outputPath, FONT_NAME);

  const untranslated = translated.filter((t, i) => t === paragraphs[i] && paragraphs[i].trim().length > 10).length;
  console.log('\n  [5/5] Summary:');
  console.log(`    Translated: ${paragraphs.length - untranslated}/${paragraphs.length}`);
  console.log(`    Kept as original: ${untranslated} (${Math.round(untranslated / paragraphs.length * 100)}%)`);
  console.log(`    Output: ${outputPath}`);
  console.log(`    Size: ${(fs.statSync(outputPath).size / 1024).toFixed(0)} KB\n`);
}

async function applyFontToDocx(docxPath, fontName) {
  const buffer = fs.readFileSync(docxPath);
  const zip = await JSZip.loadAsync(buffer);

  const setFontInXml = (xml) => {
    xml = xml.replace(/<w:rFonts\b[^/]*\/>/g, () =>
      `<w:rFonts w:ascii="${fontName}" w:hAnsi="${fontName}" w:eastAsia="${fontName}" w:cs="${fontName}"/>`);
    xml = xml.replace(/<w:rPr>(?!<w:rFonts)/g,
      `<w:rPr><w:rFonts w:ascii="${fontName}" w:hAnsi="${fontName}" w:eastAsia="${fontName}" w:cs="${fontName}"/>`);
    return xml;
  };

  for (const relPath of Object.keys(zip.files)) {
    if (/^word\/(document|styles|header\d*|footer\d*)\.xml$/.test(relPath)) {
      const file = zip.file(relPath);
      if (!file) continue;
      const xml = await file.async('string');
      zip.file(relPath, setFontInXml(xml), { compression: 'DEFLATE' });
    }
  }

  const out = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 1 },
  });
  fs.writeFileSync(docxPath, out);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
