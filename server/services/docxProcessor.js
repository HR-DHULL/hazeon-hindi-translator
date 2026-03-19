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
 * Smart run selection: instead of always putting text in the first run,
 * we put text in the LONGEST run by character count. This preserves the
 * dominant formatting (e.g. if the paragraph has a short bold label + long
 * normal body text, the translated text uses the normal formatting).
 */
function replaceParagraphTexts(xml, translatedParagraphs) {
  let paraIndex = 0;

  const modified = xml.replace(
    /<w:p[\s>][\s\S]*?<\/w:p>/g,
    (pBlock) => {
      // Collect all <w:t> elements with their text and position
      const textRuns = [];
      let idx = 0;
      pBlock.replace(/<w:t([^>]*)>([^<]*)<\/w:t>/g, (match, attrs, text, offset) => {
        textRuns.push({ idx: idx++, text, attrs, offset });
        return match;
      });

      const originalText = textRuns.map(r => r.text).join('').trim();

      // Skip paragraphs with no text
      if (!originalText) return pBlock;

      // If we've run out of translated paragraphs, keep original
      if (paraIndex >= translatedParagraphs.length) return pBlock;

      const translatedLine = translatedParagraphs[paraIndex];
      paraIndex++;

      // Find the run with the most text — that run's formatting represents
      // the dominant style of the paragraph (body text, not label).
      let longestRunIdx = 0;
      let longestLen = 0;
      for (const run of textRuns) {
        if (run.text.trim().length > longestLen) {
          longestLen = run.text.trim().length;
          longestRunIdx = run.idx;
        }
      }

      // Put ALL translated text in the longest run, empty all others
      let currentIdx = 0;
      const newBlock = pBlock.replace(
        /<w:t([^>]*)>([^<]*)<\/w:t>/g,
        (match, attrs, _text) => {
          const thisIdx = currentIdx++;
          if (thisIdx === longestRunIdx) {
            const spaceAttr = attrs.includes('xml:space')
              ? attrs
              : ` xml:space="preserve"${attrs}`;
            return `<w:t${spaceAttr}>${escapeXml(translatedLine)}</w:t>`;
          }
          return `<w:t${attrs}></w:t>`;
        }
      );

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
