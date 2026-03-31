/**
 * Translation Quality Scorer
 * Evaluates each translated paragraph and assigns a confidence score (0–100).
 * Flags specific issues so the user knows what to review.
 */

// Abbreviations that are allowed in English within Hindi text
const ALLOWED_ENGLISH = /^(UPSC|IAS|HCS|GDP|RBI|GST|SEBI|ISRO|UN|NATO|CRR|SLR|FDI|PIL|CAG|ATM|EMI|DNA|RNA|NOTA|NCL|CSR|IMF|NGO|NRI|UNESCO|UNICEF|WHO|FIFA|BRICS|IGMDP|OMR|CSAT|PCS|NDA|BJP|INC|CBI|ED|IPC|CPC|NITI|NHRC|NHPC|NDMA|NCPCR|UIDAI|RTE|RTI|CAA|NRC|NPR|JPC|PAC|ECI|CVC|CIC|pH|UV|AM|PM|MCQ|WTO|ILO|IAEA|OPCW|ICC|ICJ|UNSC|UNGA|UNDP|FAO|IDA|IBRD|ADB|NDB|AIIB|WB|NABARD|SIDBI|MUDRA|MSME|PSU|LPG|CNG|LED|GPS|AI|ML|NLP|IoT|EV|TRAI|IRDA|PFRDA|IRDAI|IBC|NCLT|CCI|SSC|BPSC|MPPSC|RPSC|CGPSC|JPSC|HPSC|OPSC|WBPSC|KPSC|TNPSC|APPSC|TSPSC|MPSC|GPSC|UKPSC|RAS|CDS|CAPF|CPO|CGL|CHSL|GATE|NET|CTET|DSSSB)$/i;

/**
 * Score a single translated paragraph.
 * @param {string} original - English source text
 * @param {string} translated - Hindi translated text
 * @returns {{ score: number, flags: string[] }}
 *   score: 0–100 (100 = perfect, <70 = needs review)
 *   flags: array of issue descriptions
 */
export function scoreParagraph(original, translated) {
  if (!original?.trim()) return { score: 100, flags: [] };
  if (!translated?.trim()) return { score: 0, flags: ['Empty translation'] };

  const orig = original.trim();
  const trans = translated.trim();
  let score = 100;
  const flags = [];

  // ── 1. Untranslated English (-5 to -40) ──────────────────────────────────
  const engWords = (trans.match(/\b[A-Za-z]{3,}\b/g) || [])
    .filter(w => !ALLOWED_ENGLISH.test(w));
  const engCharCount = engWords.join('').length;
  const totalChars = trans.replace(/\s/g, '').length || 1;
  const engRatio = engCharCount / totalChars;

  if (engRatio > 0.5) {
    score -= 40;
    flags.push(`Mostly untranslated (${Math.round(engRatio * 100)}% English)`);
  } else if (engRatio > 0.2) {
    score -= 20;
    flags.push(`Partially untranslated (${engWords.length} English words)`);
  } else if (engWords.length > 0) {
    score -= Math.min(10, engWords.length * 3);
    if (engWords.length >= 2) flags.push(`${engWords.length} English words remaining`);
  }

  // ── 2. Length ratio check (-5 to -15) ─────────────────────────────────────
  // Hindi translations are typically 0.8x to 2.5x the length of English
  const origLen = orig.length;
  const transLen = trans.length;
  const lengthRatio = transLen / origLen;

  if (lengthRatio < 0.3 && origLen > 30) {
    score -= 15;
    flags.push('Translation much shorter than original');
  } else if (lengthRatio < 0.5 && origLen > 50) {
    score -= 8;
    flags.push('Translation seems truncated');
  } else if (lengthRatio > 4 && origLen > 20) {
    score -= 10;
    flags.push('Translation unusually long');
  }

  // ── 3. MCQ label check (-10) ─────────────────────────────────────────────
  // If original has (a)(b)(c)(d) labels, translation should too
  const origLabels = (orig.match(/\([a-d]\)/gi) || []).length;
  const transLabels = (trans.match(/\([a-d]\)/gi) || []).length;
  if (origLabels > 0 && transLabels < origLabels) {
    score -= 10;
    flags.push(`Missing MCQ labels (${transLabels}/${origLabels})`);
  }

  // ── 4. Exam tag preserved (-10) ───────────────────────────────────────────
  const origExamTags = orig.match(/\[[A-Z][^\]]*(?:19|20)\d{2}[^\]]*\]/g) || [];
  for (const tag of origExamTags) {
    if (!trans.includes(tag)) {
      score -= 10;
      flags.push(`Exam tag missing: ${tag}`);
      break; // one flag is enough
    }
  }

  // ── 5. Number preservation (-5) ───────────────────────────────────────────
  // Important numbers/years in original should appear in translation
  const origNumbers = orig.match(/\b(19|20)\d{2}\b/g) || [];
  for (const num of origNumbers) {
    if (!trans.includes(num)) {
      score -= 5;
      flags.push(`Year ${num} missing from translation`);
      break;
    }
  }

  // ── 6. Garbled characters (-15) ───────────────────────────────────────────
  if (/[∩∪∈∉⊂⊃⊆⊇]/.test(trans)) {
    score -= 15;
    flags.push('Contains garbled symbols');
  }

  // ── 7. Identical to original (-30) ────────────────────────────────────────
  if (trans === orig && orig.length > 20) {
    score -= 30;
    flags.push('Not translated (identical to original)');
  }

  return { score: Math.max(0, Math.min(100, score)), flags };
}

/**
 * Score all paragraph pairs and compute overall quality.
 * @param {Array<{en: string, hi: string}>} pairs
 * @returns {{ overall: number, paragraphs: Array<{score: number, flags: string[]}>, summary: object }}
 */
export function scoreDocument(pairs) {
  const results = pairs.map(p => scoreParagraph(p.en, p.hi));

  const scores = results.map(r => r.score);
  const overall = scores.length > 0
    ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length)
    : 100;

  const perfect = scores.filter(s => s >= 95).length;
  const good = scores.filter(s => s >= 70 && s < 95).length;
  const needsReview = scores.filter(s => s < 70).length;

  return {
    overall,
    paragraphs: results,
    summary: {
      total: pairs.length,
      perfect,
      good,
      needsReview,
    },
  };
}
