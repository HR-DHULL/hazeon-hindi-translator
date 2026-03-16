import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import PDFDocument from 'pdfkit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Devanagari font paths for PDF rendering
const FONT_REGULAR = path.join(__dirname, '..', 'fonts', 'NotoSansDevanagari-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '..', 'fonts', 'NotoSansDevanagari-Bold.ttf');

/**
 * Generate a DOCX file from translated Hindi text.
 */
export async function generateDOCX(translatedText, outputPath, metadata = {}) {
  const lines = translatedText.split('\n');
  const children = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      children.push(new Paragraph({ text: '' }));
      continue;
    }

    // Detect headings (marked with # in the translated text)
    if (trimmed.startsWith('### ')) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: [
            new TextRun({
              text: trimmed.replace('### ', ''),
              bold: true,
              size: 28,
              font: 'Noto Sans Devanagari',
            }),
          ],
        })
      );
    } else if (trimmed.startsWith('## ')) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [
            new TextRun({
              text: trimmed.replace('## ', ''),
              bold: true,
              size: 32,
              font: 'Noto Sans Devanagari',
            }),
          ],
        })
      );
    } else if (trimmed.startsWith('# ')) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [
            new TextRun({
              text: trimmed.replace('# ', ''),
              bold: true,
              size: 36,
              font: 'Noto Sans Devanagari',
            }),
          ],
        })
      );
    } else if (trimmed.match(/^[\d]+\.\s/)) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: trimmed,
              size: 24,
              font: 'Noto Sans Devanagari',
            }),
          ],
          spacing: { before: 100, after: 100 },
        })
      );
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: '• ' + trimmed.replace(/^[-•]\s/, ''),
              size: 24,
              font: 'Noto Sans Devanagari',
            }),
          ],
          spacing: { before: 80, after: 80 },
          indent: { left: 400 },
        })
      );
    } else {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: trimmed,
              size: 24,
              font: 'Noto Sans Devanagari',
            }),
          ],
          spacing: { before: 120, after: 120 },
          alignment: AlignmentType.JUSTIFIED,
        })
      );
    }
  }

  const titleParagraphs = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 2000, after: 400 },
      children: [
        new TextRun({
          text: metadata.title || 'UPSC/HCS अनुवादित दस्तावेज़',
          bold: true,
          size: 48,
          font: 'Noto Sans Devanagari',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: `अनुवाद तिथि: ${new Date().toLocaleDateString('hi-IN')}`,
          size: 22,
          font: 'Noto Sans Devanagari',
          color: '666666',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 1000 },
      children: [
        new TextRun({
          text: 'UPSC/HCS Hindi Translation Tool द्वारा अनुवादित',
          size: 20,
          font: 'Noto Sans Devanagari',
          color: '888888',
          italics: true,
        }),
      ],
    }),
    new Paragraph({ text: '' }),
    ...children,
  ];

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children: titleParagraphs,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

/**
 * Generate a PDF file from translated Hindi text.
 * Uses embedded Devanagari font. Handles PDFKit glyph errors gracefully
 * by rendering lines individually with fallback.
 */
export async function generatePDF(translatedText, outputPath, metadata = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
        info: {
          Title: metadata.title || 'UPSC/HCS Translated Document',
          Author: 'UPSC Hindi Translation Tool',
        },
      });

      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      // Register Devanagari fonts
      const hasRegularFont = fs.existsSync(FONT_REGULAR);
      const hasBoldFont = fs.existsSync(FONT_BOLD);

      if (hasRegularFont) {
        doc.registerFont('Hindi', FONT_REGULAR);
      }
      if (hasBoldFont) {
        doc.registerFont('Hindi-Bold', FONT_BOLD);
      }

      const regularFont = hasRegularFont ? 'Hindi' : 'Helvetica';
      const boldFont = hasBoldFont ? 'Hindi-Bold' : (hasRegularFont ? 'Hindi' : 'Helvetica-Bold');

      /**
       * Safely render text - catches PDFKit glyph errors (xCoordinate null)
       * and falls back to rendering without problematic characters.
       */
      const safeText = (text, options = {}) => {
        try {
          doc.text(text, options);
        } catch (err) {
          if (err.message && err.message.includes('xCoordinate')) {
            // Strip Zero-Width Joiner/Non-Joiner and retry
            const cleaned = text.replace(/[\u200C\u200D\u200B\uFEFF]/g, '');
            try {
              doc.text(cleaned, options);
            } catch {
              // Last resort: render with default font
              doc.font('Helvetica').text(cleaned, options);
              doc.font(options._font || regularFont);
            }
          } else {
            throw err;
          }
        }
      };

      // Title
      doc.font(boldFont).fontSize(24);
      safeText(metadata.title || 'UPSC/HCS Translated Document', { align: 'center', _font: boldFont });
      doc.moveDown(0.5);
      doc.font(regularFont).fontSize(10).fillColor('#666666');
      safeText(`Translation Date: ${new Date().toLocaleDateString('en-IN')}`, { align: 'center', _font: regularFont });
      doc.moveDown(2);
      doc.fillColor('#000000');

      // Content - render each line with error handling
      const lines = translatedText.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed) {
          doc.moveDown(0.5);
          continue;
        }

        try {
          if (trimmed.startsWith('# ')) {
            doc.moveDown(1);
            doc.font(boldFont).fontSize(20);
            safeText(trimmed.replace('# ', ''), { _font: boldFont });
            doc.moveDown(0.5);
          } else if (trimmed.startsWith('## ')) {
            doc.moveDown(0.8);
            doc.font(boldFont).fontSize(16);
            safeText(trimmed.replace('## ', ''), { _font: boldFont });
            doc.moveDown(0.3);
          } else if (trimmed.startsWith('### ')) {
            doc.moveDown(0.5);
            doc.font(boldFont).fontSize(14);
            safeText(trimmed.replace('### ', ''), { _font: boldFont });
            doc.moveDown(0.2);
          } else if (trimmed.match(/^[\d]+\.\s/) || trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
            doc.font(regularFont).fontSize(12);
            safeText(trimmed, { indent: 20, _font: regularFont });
          } else {
            doc.font(regularFont).fontSize(12);
            safeText(trimmed, { align: 'justify', _font: regularFont });
          }
        } catch (lineErr) {
          // Skip lines that cause unrecoverable errors
          console.warn('PDF: Skipped line due to rendering error:', lineErr.message?.slice(0, 100));
          doc.moveDown(0.3);
        }
      }

      // Footer
      doc.moveDown(3);
      doc.font(regularFont).fontSize(8).fillColor('#999999');
      safeText('UPSC/HCS Hindi Translation Tool', { align: 'center', _font: regularFont });

      doc.end();

      stream.on('finish', () => resolve(outputPath));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}
