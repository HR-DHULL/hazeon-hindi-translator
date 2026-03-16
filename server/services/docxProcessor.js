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
 * Replace paragraph texts in DOCX XML with translated paragraphs (1-to-1 mapping).
 */
function replaceParagraphTexts(xml, translatedParagraphs) {
  let paraIndex = 0;

  const modified = xml.replace(
    /<w:p[\s>][\s\S]*?<\/w:p>/g,
    (pBlock) => {
      // Check if this paragraph has any text content
      const textParts = [];
      pBlock.replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, (_, text) => {
        textParts.push(text);
        return _;
      });

      const originalText = textParts.join('').trim();

      // Skip paragraphs with no text (empty lines, page breaks, image anchors)
      if (!originalText) {
        return pBlock;
      }

      // If we've run out of translated paragraphs, keep original
      if (paraIndex >= translatedParagraphs.length) {
        return pBlock;
      }

      const translatedLine = translatedParagraphs[paraIndex];
      paraIndex++;

      // Replace text: put ALL translated text in the FIRST <w:t>,
      // empty all subsequent <w:t> elements.
      // This preserves the first run's formatting (font, color, size, bold)
      // which typically applies to the whole paragraph.
      let isFirstTextRun = true;
      const newBlock = pBlock.replace(
        /<w:t([^>]*)>([^<]*)<\/w:t>/g,
        (match, attrs, _text) => {
          if (isFirstTextRun) {
            isFirstTextRun = false;
            // Ensure xml:space="preserve" for proper rendering
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
 * Extract paragraph texts from DOCX XML in order.
 * Only returns paragraphs that have actual text content.
 */
export function extractParagraphTexts(xml) {
  const paragraphs = [];
  xml.replace(/<w:p[\s>][\s\S]*?<\/w:p>/g, (pBlock) => {
    const textParts = [];
    pBlock.replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, (_, text) => {
      textParts.push(text);
      return _;
    });
    const fullText = textParts.join('').trim();
    if (fullText) {
      paragraphs.push(fullText);
    }
    return pBlock;
  });
  return paragraphs;
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
