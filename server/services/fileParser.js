import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { extractParagraphTexts, extractDocumentStats } from './docxProcessor.js';

/**
 * Parse uploaded DOCX file and extract text content.
 */
export async function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.docx') {
    return parseDOCX(filePath);
  }
  throw new Error(`Unsupported file format: ${ext}. Only .docx files are accepted.`);
}

async function parseDOCX(filePath) {
  const buffer = fs.readFileSync(filePath);

  // Extract raw text using mammoth (for chunking/translation)
  const result = await mammoth.extractRawText({ buffer });

  // Also extract paragraph-level texts from the XML (for accurate mapping)
  const zip = await JSZip.loadAsync(buffer);
  const docXmlFile = zip.file('word/document.xml');
  let paragraphTexts = [];
  let docStats = { tableCount: 0, imageCount: 0, paragraphMeta: [] };
  if (docXmlFile) {
    const docXml = await docXmlFile.async('string');
    paragraphTexts = extractParagraphTexts(docXml);
    docStats = extractDocumentStats(docXml);
  }

  // Try to read actual page count from DOCX metadata (docProps/app.xml)
  let pageCount = null;
  try {
    const appXmlFile = zip.file('docProps/app.xml');
    if (appXmlFile) {
      const appXml = await appXmlFile.async('string');
      const pagesMatch = appXml.match(/<Pages>(\d+)<\/Pages>/);
      if (pagesMatch) pageCount = parseInt(pagesMatch[1], 10);
    }
  } catch {}

  // Fallback: estimate from character count (~2000 chars per page for UPSC content)
  if (!pageCount || pageCount < 1) {
    const totalChars = result.value.length;
    pageCount = Math.max(1, Math.ceil(totalChars / 2000));
  }

  return {
    text: result.value,
    pageCount,
    metadata: {},
    format: 'docx',
    paragraphTexts,
    docStats, // { tableCount, imageCount, paragraphMeta[] }
  };
}

/**
 * Split text into translatable chunks (to respect token limits).
 * Splits on paragraph boundaries to maintain context.
 */
export function splitIntoChunks(text, maxCharsPerChunk = 4500) {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks = [];
  let current = '';

  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length > maxCharsPerChunk && current) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}
