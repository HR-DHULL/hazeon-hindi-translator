/**
 * PDF → Hindi DOCX translator.
 *
 * Uses existing parseFile (pdf-parse) + translate pipeline, then builds a
 * fresh minimal DOCX from scratch (no template to clone since the source is PDF).
 *
 * Usage:
 *   node translate_pdf.js [--subject=<name>] "path/to/file.pdf" [output.docx]
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import { parseFile } from './server/services/fileParser.js';
import { getGlossaryPrompt, applyGlossaryPostProcessing, applyHindiCorrections } from './server/services/glossary.js';
import { applyContextDisambiguation, getDisambiguationPrompt } from './server/services/contextDisambiguation.js';

const BATCH_SIZE = 20;
const PAUSE_MS = 2000;
const RATE_LIMIT_WAIT = 65000;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const FONT_NAME = process.env.TRANSLATE_FONT || 'Nirmala UI';

if (!process.env.GEMINI_API_KEY) {
  console.error('ERROR: Set GEMINI_API_KEY in .env');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const CLAUDE_MODEL = process.env.CLAUDE_FALLBACK_MODEL || 'claude-haiku-4-5';
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
if (anthropic) console.log(`  Fallback engine: Claude ${CLAUDE_MODEL}`);

const UPSC_BASE_PROMPT = `You are an expert Hindi translator for UPSC/HCS competitive exam material. Translate everything from English to formal Hindi (राजभाषा).

RULES:
1. NEVER transliterate. Always TRANSLATE to proper Hindi.
2. Keep abbreviations as-is: UPSC, GDP, RBI, IMF, WTO, UN, WHO, UNESCO, etc.
3. GLOSSARY IS MANDATORY: Use the glossary terms EXACTLY as given.
4. MCQ labels (a)(b)(c)(d) and single-letter variables (A, B, C) stay in English.
5. Roman numerals I, II, III and numbers/dates/percentages: keep unchanged.
6. Translate EVERY English sentence. Leaving English untranslated is a critical error.
7. Transliterate person names and place names to Devanagari.
8. Output ONLY the translated text. No explanations.`;

async function translateBatch(paragraphs, forcedSubject = null) {
  const batchText = paragraphs.join(' ');
  const { disambiguations, detectedSubject } = applyContextDisambiguation(batchText);
  const subjectToUse = forcedSubject || detectedSubject || null;
  const glossaryPrompt = getGlossaryPrompt(subjectToUse, batchText);
  const systemPrompt = UPSC_BASE_PROMPT + '\n\n' + glossaryPrompt;
  const disambPrompt = getDisambiguationPrompt(disambiguations);

  const numbered = paragraphs.map((p, i) => `<<<P${i + 1}>>> ${p}`).join('\n\n');
  const userMsg = `${disambPrompt ? disambPrompt + '\n\n' : ''}Translate each paragraph from English to Hindi. Preserve <<<PN>>> prefixes exactly.\n\n${numbered}`;

  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: systemPrompt,
    generationConfig: { temperature: 0.1 },
  });

  const MAX_ATTEMPTS = 6;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
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

      return parsed.map((t, i) => {
        if (!t) return paragraphs[i];
        let r = applyGlossaryPostProcessing(t, paragraphs[i]);
        r = applyHindiCorrections(r);
        return r;
      });
    } catch (err) {
      const is429 = /429|quota|exhausted|rate.?limit/i.test(err.message);
      const is503 = /503|unavailable|fetching from|ECONNRESET|ETIMEDOUT|network/i.test(err.message);
      const isTimeout = /timeout/i.test(err.message);
      const remaining = MAX_ATTEMPTS - attempt - 1;
      if ((is429 || is503 || isTimeout) && remaining > 0) {
        const wait = is429 ? RATE_LIMIT_WAIT : isTimeout ? 15000 : Math.min(30000 * (attempt + 1), 180000);
        console.log(`    [${is429 ? '429' : is503 ? '503' : 'TIMEOUT'}] Waiting ${wait/1000}s... (attempt ${attempt+1}/${MAX_ATTEMPTS})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      console.error(`    FAILED batch: ${err.message?.slice(0, 80)}`);
      const claudeResult = await tryClaudeFallback(paragraphs, systemPrompt, userMsg);
      return claudeResult || paragraphs;
    }
  }
  return paragraphs;
}

async function tryClaudeFallback(paragraphs, systemPrompt, userMsg) {
  if (!anthropic) {
    console.warn(`    No ANTHROPIC_API_KEY — keeping English.`);
    return null;
  }
  console.log(`    [FALLBACK] Trying Claude ${CLAUDE_MODEL}...`);
  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMsg }],
    });
    const raw = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const parts = raw.split(/\n*<<<P?(\d+)>>>\s*/);
    const parsed = Array(paragraphs.length).fill('');
    for (let i = 1; i < parts.length - 1; i += 2) {
      const idx = parseInt(parts[i], 10) - 1;
      if (idx >= 0 && idx < paragraphs.length) parsed[idx] = parts[i + 1].trim();
    }
    if (paragraphs.length === 1 && !parsed[0]) parsed[0] = raw.trim();
    const cacheHit = response.usage?.cache_read_input_tokens || 0;
    console.log(`    [FALLBACK] Claude succeeded (cache read ${cacheHit})`);
    return parsed.map((t, i) => {
      if (!t) return paragraphs[i];
      let r = applyGlossaryPostProcessing(t, paragraphs[i]);
      r = applyHindiCorrections(r);
      return r;
    });
  } catch (err) {
    console.warn(`    [FALLBACK] Claude also failed: ${err.message?.slice(0, 100)}`);
    return null;
  }
}

// ── DOCX builder (from scratch, no template) ─────────────────────────────────
function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function buildParagraphXml(text, fontName) {
  // Split on newlines → multiple <w:p> (one per line)
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) lines.push(''); // ensure at least one paragraph
  return lines.map(line => {
    const rPr = `<w:rPr><w:rFonts w:ascii="${fontName}" w:hAnsi="${fontName}" w:eastAsia="${fontName}" w:cs="${fontName}"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>`;
    return `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r>${rPr}<w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`;
  }).join('');
}

async function buildDocx(paragraphs, outputPath, fontName) {
  const zip = new JSZip();

  // [Content_Types].xml
  zip.file('[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);

  // _rels/.rels
  zip.file('_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  // word/_rels/document.xml.rels
  zip.file('word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);

  // word/styles.xml — minimal with Nirmala UI default
  zip.file('word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults>
<w:rPrDefault>
<w:rPr><w:rFonts w:ascii="${fontName}" w:hAnsi="${fontName}" w:eastAsia="${fontName}" w:cs="${fontName}"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
</w:rPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
</w:styles>`);

  // word/document.xml with all translated paragraphs
  const bodyXml = paragraphs.map(p => buildParagraphXml(p, fontName)).join('');
  zip.file('word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${bodyXml}
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
</w:body>
</w:document>`);

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  fs.writeFileSync(outputPath, buf);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
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
    console.error('Usage: node translate_pdf.js [--subject=<name>] "path/to/file.pdf" [output.docx]');
    process.exit(1);
  }

  const ext = path.extname(inputPath).toLowerCase();
  if (ext !== '.pdf') {
    console.error(`ERROR: Expected .pdf input, got ${ext}. Use translate_local.js for DOCX.`);
    process.exit(1);
  }

  const baseName = path.basename(inputPath, ext);
  const outputPath = positional[1] || path.join(path.dirname(inputPath), `${baseName}_hindi.docx`);
  const cachePath = path.join(path.dirname(inputPath), `.${baseName}_pdf_translations.json`);

  console.log(`\n  Input:  ${inputPath}`);
  console.log(`  Output: ${outputPath}`);
  console.log(`  Model:  ${MODEL}`);
  console.log(`  Batch:  ${BATCH_SIZE}`);
  console.log(`  Font:   ${FONT_NAME}`);
  console.log(`  Subject: ${forcedSubject || 'auto-detect'}\n`);

  console.log('  [1/4] Parsing PDF...');
  const parsed = await parseFile(inputPath);
  const paragraphs = parsed.paragraphTexts;
  console.log(`    ${paragraphs.length} paragraphs, ${parsed.pageCount} pages\n`);

  // Cache load
  let translated = new Array(paragraphs.length).fill('');
  let skipTranslation = false;
  if (fs.existsSync(cachePath)) {
    try {
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      if (cache.sourceCount === paragraphs.length && Array.isArray(cache.translated)) {
        translated = cache.translated;
        skipTranslation = true;
        console.log(`  Loaded ${translated.length} cached translations\n`);
      }
    } catch {}
  }

  console.log('  [2/4] Translating via Gemini...');
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
    const results = await translateBatch(nonEmpty, forcedSubject);
    let ri = 0;
    for (let i = 0; i < batch.length; i++) {
      if (batch[i].trim()) { translated[batchStart + i] = results[ri] || batch[i]; ri++; }
      else translated[batchStart + i] = batch[i];
    }
    translatedCount += nonEmpty.length;
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = translatedCount / elapsed;
    const eta = rate > 0 ? Math.ceil((paragraphs.length - translatedCount) / rate) : '?';
    const pct = Math.round((translatedCount / paragraphs.length) * 100);
    process.stdout.write(`\r    Batch ${b+1}/${totalBatches} | ${pct}% | ${translatedCount}/${paragraphs.length} | ETA: ${eta}s    `);
    if (b < totalBatches - 1) await new Promise(r => setTimeout(r, PAUSE_MS));
  }
  if (!skipTranslation) {
    console.log(`\n    Done in ${Math.round((Date.now() - startTime) / 1000)}s`);
    try { fs.writeFileSync(cachePath, JSON.stringify({ sourceCount: paragraphs.length, translated })); } catch {}
  }

  // Verification pass
  console.log('\n  [3/4] Verification pass...');
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
      const texts = batch.map(i => paragraphs[i]);
      try {
        const results = await translateBatch(texts, forcedSubject);
        for (let j = 0; j < batch.length; j++) {
          const idx = batch[j];
          if (results[j] && results[j].trim() && results[j].trim() !== paragraphs[idx].trim()) {
            translated[idx] = results[j];
            fixed++;
          }
        }
        await new Promise(r => setTimeout(r, 2000));
      } catch {}
    }
    console.log(`    Fixed ${fixed}/${stillEnglish.length}\n`);
    try { fs.writeFileSync(cachePath, JSON.stringify({ sourceCount: paragraphs.length, translated })); } catch {}
  } else {
    console.log('    All paragraphs translated.\n');
  }

  // Fill any remaining empties with original
  for (let i = 0; i < paragraphs.length; i++) {
    if (!translated[i] || !translated[i].trim()) translated[i] = paragraphs[i] || '';
  }

  console.log('  [4/4] Building DOCX from scratch (Nirmala UI applied)...');
  await buildDocx(translated, outputPath, FONT_NAME);

  const untranslated = translated.filter((t, i) => t === paragraphs[i] && paragraphs[i].trim().length > 10).length;
  console.log('\n  Summary:');
  console.log(`    Translated: ${paragraphs.length - untranslated}/${paragraphs.length}`);
  console.log(`    Kept as original: ${untranslated} (${Math.round(untranslated / paragraphs.length * 100)}%)`);
  console.log(`    Output: ${outputPath}`);
  console.log(`    Size: ${(fs.statSync(outputPath).size / 1024).toFixed(0)} KB\n`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
