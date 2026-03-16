import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { extractParagraphTexts } from './docxProcessor.js';

/**
 * Parse uploaded file and extract text content.
 * Supports PDF, DOCX, and plain text files.
 */
export async function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.pdf':
      return parsePDF(filePath);
    case '.docx':
      return parseDOCX(filePath);
    case '.txt':
      return parseTXT(filePath);
    default:
      throw new Error(`Unsupported file format: ${ext}. Supported: .pdf, .docx, .txt`);
  }
}

async function parsePDF(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  return {
    text: data.text,
    pageCount: data.numpages,
    metadata: {
      title: data.info?.Title || '',
      author: data.info?.Author || '',
    },
    format: 'pdf',
  };
}

async function parseDOCX(filePath) {
  const buffer = fs.readFileSync(filePath);

  // Extract raw text using mammoth (for chunking/translation)
  const result = await mammoth.extractRawText({ buffer });

  // Also extract paragraph-level texts from the XML (for accurate mapping)
  const zip = await JSZip.loadAsync(buffer);
  const docXmlFile = zip.file('word/document.xml');
  let paragraphTexts = [];
  if (docXmlFile) {
    const docXml = await docXmlFile.async('string');
    paragraphTexts = extractParagraphTexts(docXml);
  }

  const paragraphs = result.value.split('\n').filter((p) => p.trim());
  return {
    text: result.value,
    pageCount: Math.ceil(paragraphs.length / 30),
    metadata: {},
    format: 'docx',
    paragraphTexts, // Original paragraph texts for clone-and-replace mapping
  };
}

async function parseTXT(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const lines = text.split('\n');
  return {
    text,
    pageCount: Math.ceil(lines.length / 50),
    metadata: {},
    format: 'txt',
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
