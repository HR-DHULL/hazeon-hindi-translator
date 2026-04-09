import fs from 'fs';
import JSZip from 'jszip';

/**
 * Clone a DOCX file and replace text paragraph-by-paragraph.
 * Preserves ALL formatting: colors, fonts, styles, bullets, numbering,
 * watermarks, headers, footers, images, tables.
 *
 * @param {string} inputPath - Path to original DOCX
 * @param {string[]} translatedParagraphs - Array of translated texts, one per XML paragraph
 * @param {string} outputPath - Where to save the cloned DOCX
 */
// Hindi font to use for Devanagari text in translated output
const HINDI_FONT = 'Nirmala UI';

export async function cloneAndTranslateDOCX(inputPath, translatedParagraphs, outputPath) {
  // Copy the original DOCX file first, then replace only document.xml
  // This avoids loading + re-compressing ALL entries (images, fonts, etc.)
  // which causes OOM on Render's 512MB limit for large DOCX files.
  fs.copyFileSync(inputPath, outputPath);

  // Read only document.xml from the copy, modify it, and put it back
  const buffer = fs.readFileSync(outputPath);
  const zip = await JSZip.loadAsync(buffer);

  const docXmlFile = zip.file('word/document.xml');
  if (docXmlFile) {
    const docXml = await docXmlFile.async('string');
    const modifiedXml = replaceParagraphTexts(docXml, translatedParagraphs);

    // Replace only document.xml — all other entries (images, fonts, styles)
    // remain as original compressed bytes, never decompressed into memory
    zip.file('word/document.xml', modifiedXml, { compression: 'DEFLATE' });
  }

  // Inject Hindi font into styles.xml so Devanagari renders correctly
  const stylesFile = zip.file('word/styles.xml');
  if (stylesFile) {
    let stylesXml = await stylesFile.async('string');
    stylesXml = injectHindiFontInStyles(stylesXml);
    zip.file('word/styles.xml', stylesXml, { compression: 'DEFLATE' });
  }

  // Generate output — JSZip re-uses original compressed data for untouched files
  const outputBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 1 },
  });
  fs.writeFileSync(outputPath, outputBuffer);

  return outputPath;
}

/**
 * Inject Hindi font (Nirmala UI) into styles.xml default run properties.
 * Sets the complex-script (cs) font for Devanagari rendering.
 * Also sets ascii/hAnsi so mixed English+Hindi text stays consistent.
 */
function injectHindiFontInStyles(stylesXml) {
  // Target: <w:docDefaults><w:rPrDefault><w:rPr> section
  // Add or update <w:rFonts> with cs (complex script) attribute for Hindi

  // Case 1: <w:rFonts> already exists in docDefaults — add/update w:cs attribute
  if (/<w:docDefaults>[\s\S]*?<w:rFonts[^>]*>/.test(stylesXml)) {
    stylesXml = stylesXml.replace(
      /(<w:docDefaults>[\s\S]*?<w:rFonts)([^>]*)(\/?>)/,
      (match, prefix, attrs, suffix) => {
        // Remove existing w:cs if present, then add ours
        attrs = attrs.replace(/\s*w:cs="[^"]*"/g, '');
        // Also set w:cstheme if present
        attrs = attrs.replace(/\s*w:cstheme="[^"]*"/g, '');
        return `${prefix}${attrs} w:cs="${HINDI_FONT}"${suffix}`;
      }
    );
  }
  // Case 2: <w:rPr> exists in <w:rPrDefault> but no <w:rFonts>
  else if (/<w:rPrDefault>\s*<w:rPr>/.test(stylesXml)) {
    stylesXml = stylesXml.replace(
      /(<w:rPrDefault>\s*<w:rPr>)/,
      `$1<w:rFonts w:cs="${HINDI_FONT}"/>`
    );
  }
  // Case 3: <w:rPrDefault> exists but empty — inject rPr with rFonts
  else if (/<w:rPrDefault\s*\/>/.test(stylesXml)) {
    stylesXml = stylesXml.replace(
      /<w:rPrDefault\s*\/>/,
      `<w:rPrDefault><w:rPr><w:rFonts w:cs="${HINDI_FONT}"/></w:rPr></w:rPrDefault>`
    );
  }
  // Case 4: No <w:docDefaults> at all — inject at the beginning of styles
  else if (!/<w:docDefaults>/.test(stylesXml)) {
    stylesXml = stylesXml.replace(
      /(<w:styles[^>]*>)/,
      `$1<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:cs="${HINDI_FONT}"/></w:rPr></w:rPrDefault></w:docDefaults>`
    );
  }

  // Also adjust default paragraph spacing for Hindi text.
  // Hindi Devanagari glyphs are taller and wider - increase line spacing slightly
  // to prevent clipping and improve readability. Set to 1.15x (276 twips for 12pt base).
  // Only add if <w:pPrDefault> doesn't already have custom spacing.
  if (/<w:pPrDefault>/.test(stylesXml)) {
    if (!/<w:pPrDefault>[\s\S]*?<w:spacing/.test(stylesXml)) {
      stylesXml = stylesXml.replace(
        /(<w:pPrDefault>\s*<w:pPr>)/,
        `$1<w:spacing w:line="276" w:lineRule="auto"/>`
      );
    }
  } else if (/<w:docDefaults>/.test(stylesXml)) {
    // Add pPrDefault after rPrDefault
    stylesXml = stylesXml.replace(
      /(<\/w:rPrDefault>)/,
      `$1<w:pPrDefault><w:pPr><w:spacing w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>`
    );
  }

  return stylesXml;
}

/**
 * Check if a <w:r> run element has bold formatting (<w:b/> or <w:b w:val="true"/>).
 */
function runIsBold(runXml) {
  return /<w:b[\s/>]/.test(runXml) && !/<w:b\s+w:val\s*=\s*"(false|0|off)"/.test(runXml);
}

/**
 * Replace paragraph texts in DOCX XML with translated paragraphs (1-to-1 mapping).
 *
 * Works at the <w:r> run level (not just <w:t>) so we can inspect bold formatting.
 * Target run selection:
 *   1. Prefer the longest NON-BOLD run — this is the body text, not the label.
 *   2. If all runs are bold (e.g. a heading), fall back to the longest run overall.
 * All other runs are emptied. This preserves the dominant body-text formatting
 * and avoids making entire translated paragraphs bold just because the question
 * number label "Q.1" happened to be the longest run.
 */
function replaceParagraphTexts(xml, translatedParagraphs) {
  let paraIndex = 0;

  // Negative lookahead (?!<w:p[\s>]) ensures we only match INNERMOST paragraphs.
  // Without this, text boxes (mc:AlternateContent/w:txbxContent) that nest <w:p>
  // inside <w:p> cause the lazy regex to match wrong pairs, corrupting the XML.
  const modified = xml.replace(
    /<w:p[\s>](?:(?!<w:p[\s>])[\s\S])*?<\/w:p>/g,
    (pBlock) => {
      // Collect all <w:r> runs that contain a <w:t> element
      const runs = [];
      pBlock.replace(/<w:r[\s>][\s\S]*?<\/w:r>/g, (rBlock) => {
        const tMatch = rBlock.match(/<w:t([^>]*)>([^<]*)<\/w:t>/);
        if (tMatch) {
          runs.push({
            tAttrs: tMatch[1],
            text: tMatch[2],
            isBold: runIsBold(rBlock),
          });
        }
        return rBlock;
      });

      const originalText = runs.map(r => r.text).join('').trim();

      // Skip paragraphs with no text
      if (!originalText) return pBlock;

      // If we've run out of translated paragraphs, keep original
      if (paraIndex >= translatedParagraphs.length) return pBlock;

      let translatedLine = translatedParagraphs[paraIndex];
      paraIndex++;

      // Safety: strip any §§ placeholder and <<<PN>>> marker artifacts before writing to DOCX
      if (translatedLine) {
        translatedLine = translatedLine.replace(/§\s*§?\s*\d+\s*§?\s*§/g, '');
        translatedLine = translatedLine.replace(/<<<P?\d+>>>/g, '');
        // Strip leading/trailing newlines that can create empty <w:t> elements
        translatedLine = translatedLine.replace(/^\n+|\n+$/g, '').trim();
      }

      // If this paragraph uses Word's automatic list numbering (<w:numPr>), the letter
      // label (a, b, c, d) is already rendered by the list style — strip any manual
      // (a)/(b)/(c)/(d) prefix from the translated text to avoid double labels like
      // "a)  (a) 1 और 2 केवल".
      if (/<w:numPr/.test(pBlock)) {
        translatedLine = translatedLine.replace(/^\([a-d]\)\s+/i, '');
      }

      // Find target run: prefer longest non-bold run (body text over label).
      // Fallback: longest run overall (for all-bold paragraphs like headings).
      let targetIdx = -1;
      let maxNonBoldLen = 0;
      let maxOverallLen = 0;
      let maxOverallIdx = 0;
      let hasBoldRuns = false;
      let hasNonBoldRuns = false;

      for (let i = 0; i < runs.length; i++) {
        const len = runs[i].text.trim().length;
        if (runs[i].isBold) hasBoldRuns = true; else hasNonBoldRuns = true;
        if (len > maxOverallLen) { maxOverallLen = len; maxOverallIdx = i; }
        if (!runs[i].isBold && len > maxNonBoldLen) { maxNonBoldLen = len; targetIdx = i; }
      }
      if (targetIdx === -1) targetIdx = maxOverallIdx;
      // If we fell back to a bold run but no non-bold runs exist,
      // strip bold from the target run so translated body text isn't falsely bold.
      // Exception: keep bold for short headings/labels (under 50 chars).
      const stripBold = !hasNonBoldRuns && runs[targetIdx]?.isBold
        && translatedLine && translatedLine.length > 50;

      // Replace: put translated text in targetIdx run, empty all others
      // Hindi font (Nirmala UI) is set globally via styles.xml — Word auto-applies
      // it for Devanagari characters via the w:cs (complex script) font fallback.
      let runCount = 0;
      const newBlock = pBlock.replace(/<w:r[\s>][\s\S]*?<\/w:r>/g, (rBlock) => {
        const tMatch = rBlock.match(/<w:t([^>]*)>([^<]*)<\/w:t>/);
        if (!tMatch) return rBlock; // run has no <w:t>, keep as-is (e.g. image run)

        const thisIdx = runCount++;
        if (thisIdx === targetIdx) {
          let runXml = rBlock;
          // Strip bold from long body text that inherited bold from label formatting
          if (stripBold) {
            runXml = runXml.replace(/<w:b\/>/g, '');
            runXml = runXml.replace(/<w:b\s[^>]*\/>/g, '');
            runXml = runXml.replace(/<w:b><\/w:b>/g, '');
          }
          const tAttrs = tMatch[1];
          const spaceAttr = tAttrs.includes('xml:space')
            ? tAttrs
            : ` xml:space="preserve"${tAttrs}`;
          // Handle newlines in translated text — convert \n to <w:br/> in DOCX
          if (translatedLine.includes('\n')) {
            const lines = translatedLine.split('\n');
            const xmlParts = lines.map((line, li) => {
              const escaped = escapeXml(line);
              if (li === 0) return `<w:t${spaceAttr}>${escaped}</w:t>`;
              return `<w:br/><w:t${spaceAttr}>${escaped}</w:t>`;
            });
            return runXml.replace(
              /<w:t[^>]*>[^<]*<\/w:t>/,
              xmlParts.join('')
            );
          }
          return runXml.replace(
            /<w:t[^>]*>[^<]*<\/w:t>/,
            `<w:t${spaceAttr}>${escapeXml(translatedLine)}</w:t>`
          );
        }
        return rBlock.replace(/<w:t[^>]*>[^<]*<\/w:t>/, `<w:t${tMatch[1]}></w:t>`);
      });

      return newBlock;
    }
  );

  return modified;
}

/**
 * Unescape XML entities back to plain text.
 * DOCX XML stores & as &amp;, < as &lt;, etc.
 * We must decode these before sending text to the translation engine,
 * otherwise "Research &amp; Training" → translator sees literal "&amp;" →
 * translates & to "एवं" but leaves "amp;" as remnant garbage.
 */
function unescapeXml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

/**
 * Extract paragraph texts from DOCX XML in order.
 * Only returns paragraphs that have actual text content.
 * XML entities are unescaped to plain text for translation.
 *
 * IMPORTANT: Must use the same paragraph-counting logic as replaceParagraphTexts.
 * Both functions must agree on which paragraphs are "non-empty" so the 1-to-1
 * index mapping between extracted and translated paragraphs stays in sync.
 * We collect text ONLY from <w:t> elements inside <w:r> runs (matching replaceParagraphTexts).
 */
export function extractParagraphTexts(xml) {
  const paragraphs = [];
  // Use same negative-lookahead regex as replaceParagraphTexts to handle nested <w:p> in text boxes
  xml.replace(/<w:p[\s>](?:(?!<w:p[\s>])[\s\S])*?<\/w:p>/g, (pBlock) => {
    // Collect text only from <w:t> inside <w:r> runs - must match replaceParagraphTexts logic
    const textParts = [];
    pBlock.replace(/<w:r[\s>][\s\S]*?<\/w:r>/g, (rBlock) => {
      const tMatch = rBlock.match(/<w:t[^>]*>([^<]*)<\/w:t>/);
      if (tMatch) {
        textParts.push(tMatch[1]);
      }
      return rBlock;
    });
    const rawText = textParts.join('').trim();
    if (rawText) {
      paragraphs.push(normalizeSpecialChars(unescapeXml(rawText)));
    }
    return pBlock;
  });
  return paragraphs;
}

/**
 * Extract document structure stats from DOCX XML.
 * Counts tables, images, and maps paragraph indices to context (table/body).
 */
export function extractDocumentStats(xml) {
  let tableCount = 0;
  let imageCount = 0;
  const paragraphMeta = []; // parallel to extractParagraphTexts output

  // Count tables
  const tableMatches = xml.match(/<w:tbl[\s>]/g);
  tableCount = tableMatches ? tableMatches.length : 0;

  // Count images (drawings + VML pictures)
  const drawingMatches = xml.match(/<w:drawing[\s>]/g);
  const pictMatches = xml.match(/<w:pict[\s>]/g);
  imageCount = (drawingMatches ? drawingMatches.length : 0) + (pictMatches ? pictMatches.length : 0);

  // Track which paragraphs are inside tables and which have images
  // Build a simple context map by scanning the XML linearly
  let inTable = false;
  let paraIdx = 0;

  // Split XML by significant tags to track context
  const tokens = xml.split(/(<\/?w:tbl[\s>][^>]*>|<w:p[\s>](?:(?!<w:p[\s>])[\s\S])*?<\/w:p>)/g);
  for (const token of tokens) {
    if (/<w:tbl[\s>]/.test(token)) {
      inTable = true;
    } else if (/<\/w:tbl>/.test(token)) {
      inTable = false;
    } else if (/<w:p[\s>]/.test(token)) {
      // Check if this paragraph has text
      const textParts = [];
      token.replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, (_, text) => { textParts.push(text); return _; });
      const fullText = textParts.join('').trim();

      if (fullText) {
        const hasImage = /<w:drawing[\s>]/.test(token) || /<w:pict[\s>]/.test(token);
        paragraphMeta.push({
          index: paraIdx,
          inTable,
          hasImage,
        });
        paraIdx++;
      }
    }
  }

  return { tableCount, imageCount, paragraphMeta };
}

/**
 * Normalize special Unicode characters that cause garbled translations.
 * Replaces math symbols, unusual separators, and other characters that
 * confuse the translation engine or produce corrupt Hindi output.
 */
function normalizeSpecialChars(str) {
  return str
    // Math/set symbols used as separators → space-dash-space
    .replace(/\s*[∩∪∈∉⊂⊃⊆⊇∧∨⊕⊗⊙]\s*/g, ' – ')
    // Bullet-like symbols → proper bullet or dash
    .replace(/\s*[▪▫◆◇○●◎■□▲△▼▽►◄★☆✦✧]\s*/g, ' • ')
    // Various dashes/hyphens → standard en-dash with spaces
    .replace(/\s*[‒―⁃⎯⸺⸻]\s*/g, ' – ')
    // Remove zero-width space and BOM (but keep ZWNJ U+200C and ZWJ U+200D — needed for Devanagari)
    .replace(/[\u200B\uFEFF]/g, '')
    // Multiple consecutive spaces → single space
    .replace(/  +/g, ' ');
}

function escapeXml(str) {
  // Only & < > need escaping in XML text nodes.
  // " and ' do NOT need escaping in text content (only in attribute values).
  // Escaping " causes HTML entities to double-encode → visible &quot; in Word.
  return str
    // Strip XML 1.0 invalid control characters (U+0000-U+0008, U+000B-U+000C, U+000E-U+001F, U+FFFE-U+FFFF)
    // These can come from Gemini output and make the DOCX XML invalid, causing "corrupted" errors in Word.
    // Keep tab (0x09), LF (0x0A), CR (0x0D) as they are valid.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
