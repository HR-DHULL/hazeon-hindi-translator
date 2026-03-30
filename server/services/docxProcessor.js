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
  const inputBuffer = fs.readFileSync(inputPath);
  const zip = await JSZip.loadAsync(inputBuffer);

  // Process main document body
  const docXmlFile = zip.file('word/document.xml');
  if (docXmlFile) {
    const docXml = await docXmlFile.async('string');
    const modifiedXml = replaceParagraphTexts(docXml, translatedParagraphs);
    zip.file('word/document.xml', modifiedXml);
  }

  // Headers and footers are preserved as-is from the original DOCX.
  // Watermarks, logos, page numbers all remain unchanged.

  // Generate output
  const outputBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
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
  let paraIndex = 0;

  const modified = xml.replace(
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

      const originalText = runs.map(r => r.text).join('').trim();

      // Skip paragraphs with no text
      if (!originalText) return pBlock;

      // If we've run out of translated paragraphs, keep original
      if (paraIndex >= translatedParagraphs.length) return pBlock;

      let translatedLine = translatedParagraphs[paraIndex];
      paraIndex++;

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

      for (let i = 0; i < runs.length; i++) {
        const len = runs[i].text.trim().length;
        if (len > maxOverallLen) { maxOverallLen = len; maxOverallIdx = i; }
        if (!runs[i].isBold && len > maxNonBoldLen) { maxNonBoldLen = len; targetIdx = i; }
      }
      if (targetIdx === -1) targetIdx = maxOverallIdx;

      // Replace: put translated text in targetIdx run, empty all others
      let runCount = 0;
      const newBlock = pBlock.replace(/<w:r[\s>][\s\S]*?<\/w:r>/g, (rBlock) => {
        const tMatch = rBlock.match(/<w:t([^>]*)>([^<]*)<\/w:t>/);
        if (!tMatch) return rBlock; // run has no <w:t>, keep as-is (e.g. image run)

        const thisIdx = runCount++;
        if (thisIdx === targetIdx) {
          const tAttrs = tMatch[1];
          const spaceAttr = tAttrs.includes('xml:space')
            ? tAttrs
            : ` xml:space="preserve"${tAttrs}`;
          return rBlock.replace(
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
 */
export function extractParagraphTexts(xml) {
  const paragraphs = [];
  xml.replace(/<w:p[\s>][\s\S]*?<\/w:p>/g, (pBlock) => {
    const textParts = [];
    pBlock.replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, (_, text) => {
      textParts.push(text);
      return _;
    });
    const fullText = unescapeXml(textParts.join('').trim());
    if (fullText) {
      paragraphs.push(fullText);
    }
    return pBlock;
  });
  return paragraphs;
}

function escapeXml(str) {
  // Only & < > need escaping in XML text nodes.
  // " and ' do NOT need escaping in text content (only in attribute values).
  // Escaping " causes HTML entities to double-encode → visible &quot; in Word.
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
