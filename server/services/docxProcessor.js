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

  // Generate output — do NOT set global compression options here.
  // JSZip re-uses original compressed data for untouched files only when
  // no top-level compression override is set. Forcing DEFLATE on all entries
  // can corrupt DOCX structure (Content_Types, rels, etc.)
  const outputBuffer = await zip.generateAsync({
    type: 'nodebuffer',
  });
  fs.writeFileSync(outputPath, outputBuffer);

  return outputPath;
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
  // Mask containers that nest <w:p> inside <w:p> (text boxes, alt content, SDTs).
  // Without this, the lazy regex matches outer-open to inner-close, corrupting XML.
  const { masked, masks } = maskNestedContainers(xml);

  let paraIndex = 0;

  const modified = masked.replace(
    /<w:p[\s>][\s\S]*?<\/w:p>/g,
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

      const rawText = runs.map(r => r.text).join('').trim();
      // Apply the same normalization as extractParagraphTexts to keep paragraph
      // indices in sync. Without this, paragraphs containing only zero-width
      // spaces or special chars get counted here but skipped during extraction,
      // shifting all subsequent translated texts to the wrong paragraphs.
      const originalText = normalizeSpecialChars(unescapeXml(rawText));

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

  // Restore masked containers back into the XML
  return unmaskContainers(modified, masks);
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
 */
export function extractParagraphTexts(xml) {
  // Mask nested containers so the regex doesn't break on nested <w:p>
  const { masked } = maskNestedContainers(xml);
  const paragraphs = [];
  masked.replace(/<w:p[\s>][\s\S]*?<\/w:p>/g, (pBlock) => {
    const textParts = [];
    pBlock.replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, (_, text) => {
      textParts.push(text);
      return _;
    });
    const fullText = normalizeSpecialChars(unescapeXml(textParts.join('').trim()));
    if (fullText) {
      paragraphs.push(fullText);
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
  // Count tables and images from the ORIGINAL xml (before masking)
  // since drawings/images live inside the containers we mask
  let tableCount = 0;
  let imageCount = 0;
  const paragraphMeta = []; // parallel to extractParagraphTexts output

  const tableMatches = xml.match(/<w:tbl[\s>]/g);
  tableCount = tableMatches ? tableMatches.length : 0;

  const drawingMatches = xml.match(/<w:drawing[\s>]/g);
  const pictMatches = xml.match(/<w:pict[\s>]/g);
  imageCount = (drawingMatches ? drawingMatches.length : 0) + (pictMatches ? pictMatches.length : 0);

  // Use masked XML for paragraph tracking (same masking as extract/replace)
  const { masked } = maskNestedContainers(xml);
  let inTable = false;
  let paraIdx = 0;

  const tokens = masked.split(/(<\/?w:tbl[\s>][^>]*>|<w:p[\s>][\s\S]*?<\/w:p>)/g);
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
    // Strip XML-invalid control characters (0x00-0x08, 0x0B-0x0C, 0x0E-0x1F)
    // These are forbidden in XML 1.0 and corrupt the DOCX if present in Gemini output
    // Keep 0x09 (tab), 0x0A (LF), 0x0D (CR) as they are valid
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Mask XML containers that can nest <w:p> elements inside other <w:p> elements.
 * Without masking, the lazy regex /<w:p[\s>][\s\S]*?<\/w:p>/g matches from the
 * outer <w:p> to the inner </w:p>, leaving the outer </w:p> orphaned and
 * corrupting the XML. Common containers: text boxes, alternate content, SDTs.
 *
 * Returns { masked, masks } where masked is the XML with placeholders and
 * masks is an array of the original content for restoration.
 */
function maskNestedContainers(xml) {
  const masks = [];
  // Order matters: mask outermost containers first.
  // mc:AlternateContent can contain w:txbxContent inside it.
  const containers = ['mc:AlternateContent', 'w:txbxContent', 'w:sdtContent'];

  let result = xml;
  for (const tag of containers) {
    const openTag = `<${tag}`;
    const closeTag = `</${tag}>`;
    let processed = '';
    let pos = 0;

    while (pos < result.length) {
      const openIdx = result.indexOf(openTag, pos);
      if (openIdx === -1) {
        processed += result.slice(pos);
        break;
      }

      processed += result.slice(pos, openIdx);

      // Find matching close tag, tracking nesting depth
      let depth = 1;
      let searchPos = openIdx + openTag.length;
      while (depth > 0 && searchPos < result.length) {
        const nextOpen = result.indexOf(openTag, searchPos);
        const nextClose = result.indexOf(closeTag, searchPos);

        if (nextClose === -1) { searchPos = result.length; break; }

        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          searchPos = nextOpen + openTag.length;
        } else {
          depth--;
          searchPos = nextClose + closeTag.length;
        }
      }

      const block = result.slice(openIdx, searchPos);
      const maskId = masks.length;
      masks.push(block);
      processed += `<!--NMASK_${maskId}-->`;
      pos = searchPos;
    }

    result = processed;
  }

  return { masked: result, masks };
}

/** Restore masked containers back into the XML. */
function unmaskContainers(xml, masks) {
  let result = xml;
  for (let i = masks.length - 1; i >= 0; i--) {
    result = result.replace(`<!--NMASK_${i}-->`, masks[i]);
  }
  return result;
}

/** Check if translated text contains Devanagari characters. */
function hasDevanagari(str) {
  return /[\u0900-\u097F]/.test(str);
}

/**
 * Inject a Devanagari-capable font (Mangal) into a <w:r> run's <w:rPr> so
 * Hindi text renders correctly even if the original font is English-only.
 * Uses <w:rFonts w:cs="Mangal" w:hint="cs"/> + <w:cs/> to activate complex script.
 */
function injectHindiFont(runXml) {
  const hindiFont = '<w:rFonts w:cs="Mangal" w:hint="cs"/><w:cs/>';

  // If <w:rPr> exists, inject font inside it (avoid duplicating if already present)
  if (/<w:rPr>/.test(runXml) || /<w:rPr[\s>]/.test(runXml)) {
    if (/w:cs="Mangal"/.test(runXml)) return runXml; // already has it
    // Remove any existing w:rFonts to avoid conflict, then add ours
    let modified = runXml.replace(/<w:rFonts[^>]*\/>/g, '');
    modified = modified.replace(/<w:rFonts[^>]*>[\s\S]*?<\/w:rFonts>/g, '');
    return modified.replace(/(<w:rPr[\s>][^>]*>)/, `$1${hindiFont}`);
  }
  // No <w:rPr> exists - add one after the opening <w:r> tag
  return runXml.replace(/(<w:r[\s>][^>]*>)/, `$1<w:rPr>${hindiFont}</w:rPr>`);
}
