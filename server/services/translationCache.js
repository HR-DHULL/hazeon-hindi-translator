/**
 * Translation Memory — caches English→Hindi paragraph translations.
 * Two layers:
 *   1. In-memory Map (instant, lost on restart, max 5000 entries)
 *   2. Supabase table (persistent, survives restarts)
 *
 * Saves Gemini API calls for repeated UPSC content across documents.
 */

import crypto from 'crypto';

// ── Glossary version — cache entries created with a different version are stale ──
// Bump this whenever glossary.js or system prompt changes significantly.
// Format: YYYYMMDD_NN (date + sequence number)
const GLOSSARY_VERSION = '20260409_01';

// ── In-memory LRU cache ─────────────────────────────────────────────────────
const MAX_MEMORY_ENTRIES = 5000;
const memoryCache = new Map();  // key: hash → { translated, ts, version }

function hashText(text) {
  return crypto.createHash('md5').update(text.trim()).digest('hex');
}

// Evict oldest entries when memory cache is full
function evictIfNeeded() {
  if (memoryCache.size <= MAX_MEMORY_ENTRIES) return;
  // Delete oldest 20% by timestamp
  const entries = [...memoryCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
  const toDelete = Math.floor(entries.length * 0.2);
  for (let i = 0; i < toDelete; i++) {
    memoryCache.delete(entries[i][0]);
  }
}

// ── Supabase persistence (lazy — only if table exists) ──────────────────────
let _supabaseUrl = null;
let _supabaseKey = null;
let _dbAvailable = null;  // null = untested, true/false after first attempt

function restHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': _supabaseKey,
    'Authorization': `Bearer ${_supabaseKey}`,
    'Prefer': 'return=minimal',
  };
}

async function dbLookup(hashes) {
  if (_dbAvailable === false || !_supabaseUrl) return {};
  try {
    _supabaseUrl = _supabaseUrl || process.env.SUPABASE_URL;
    _supabaseKey = _supabaseKey || process.env.SUPABASE_SERVICE_KEY;
    if (!_supabaseUrl || !_supabaseKey) { _dbAvailable = false; return {}; }

    // Batch lookup: fetch all matching hashes in one query
    const hashList = hashes.map(h => `"${h}"`).join(',');
    const r = await fetch(
      `${_supabaseUrl}/rest/v1/translation_cache?source_hash=in.(${hashList})&select=source_hash,translated_text`,
      { headers: { 'apikey': _supabaseKey, 'Authorization': `Bearer ${_supabaseKey}` } }
    );
    if (!r.ok) {
      if (r.status === 404 || r.status === 406) { _dbAvailable = false; }
      return {};
    }
    _dbAvailable = true;
    const rows = await r.json();
    const map = {};
    for (const row of rows) {
      map[row.source_hash] = row.translated_text;
    }
    return map;
  } catch {
    _dbAvailable = false;
    return {};
  }
}

async function dbStore(entries) {
  if (_dbAvailable === false || !_supabaseUrl || entries.length === 0) return;
  try {
    // Upsert batch — ignore conflicts (another job may have cached the same text)
    await fetch(`${_supabaseUrl}/rest/v1/translation_cache`, {
      method: 'POST',
      headers: { ...restHeaders(), 'Prefer': 'resolution=ignore-duplicates' },
      body: JSON.stringify(entries.map(e => ({
        source_hash: e.hash,
        source_text: e.source.slice(0, 2000),   // truncate for storage
        translated_text: e.translated.slice(0, 5000),
      }))),
    });
  } catch {
    // Non-fatal — cache miss next time, Gemini re-translates
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Look up cached translations for an array of source texts.
 * Returns a Map<index, translatedText> for cache hits.
 * Cache misses are not in the returned map.
 */
export async function lookupCache(texts) {
  const hits = new Map();  // index → translated text
  const dbMissHashes = [];
  const dbMissIndices = [];

  // Layer 1: in-memory (reject entries from old glossary versions)
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]?.trim();
    if (!text) continue;
    const hash = hashText(text);
    const cached = memoryCache.get(hash);
    if (cached && cached.version === GLOSSARY_VERSION) {
      hits.set(i, cached.translated);
      cached.ts = Date.now(); // refresh LRU timestamp
    } else {
      if (cached) memoryCache.delete(hash); // evict stale entry
      dbMissHashes.push(hash);
      dbMissIndices.push(i);
    }
  }

  // Layer 2: Supabase (only for memory misses)
  if (dbMissHashes.length > 0 && dbMissHashes.length <= 200) {
    const dbResults = await dbLookup(dbMissHashes);
    for (let j = 0; j < dbMissHashes.length; j++) {
      const hash = dbMissHashes[j];
      const translated = dbResults[hash];
      if (translated) {
        const idx = dbMissIndices[j];
        hits.set(idx, translated);
        // Promote to memory cache with current glossary version
        memoryCache.set(hash, { translated, ts: Date.now(), version: GLOSSARY_VERSION });
      }
    }
  }

  return hits;
}

/**
 * Store translations in cache (both memory and DB).
 * @param {Array<{source: string, translated: string}>} pairs
 */
export async function storeCache(pairs) {
  const dbEntries = [];

  for (const { source, translated } of pairs) {
    if (!source?.trim() || !translated?.trim()) continue;
    // Skip very short texts (labels, numbers) — not worth caching
    if (source.trim().length < 20) continue;
    // Skip if translated is same as source (wasn't actually translated)
    if (source.trim() === translated.trim()) continue;

    const hash = hashText(source);
    memoryCache.set(hash, { translated, ts: Date.now(), version: GLOSSARY_VERSION });
    dbEntries.push({ hash, source: source.trim(), translated: translated.trim() });
  }

  evictIfNeeded();

  // Background DB store — don't await (non-blocking)
  if (dbEntries.length > 0) {
    dbStore(dbEntries).catch(() => {});
  }
}

/**
 * Clear all cached translations.
 * Use when glossary/correction rules change significantly and you want
 * all future translations to use fresh Gemini output.
 * Clears both in-memory cache and Supabase table.
 */
export async function clearCache() {
  const memCount = memoryCache.size;
  memoryCache.clear();

  let dbCleared = false;
  if (_dbAvailable && _supabaseUrl) {
    try {
      // DELETE all rows — Supabase REST needs a filter, use created_at is not null (matches all)
      await fetch(`${_supabaseUrl}/rest/v1/translation_cache?created_at=not.is.null`, {
        method: 'DELETE',
        headers: { 'apikey': _supabaseKey, 'Authorization': `Bearer ${_supabaseKey}` },
      });
      dbCleared = true;
    } catch {}
  }

  console.log(`  Translation Memory: cleared ${memCount} in-memory entries${dbCleared ? ' + DB table' : ''}`);
  return { memoryCleared: memCount, dbCleared };
}

/**
 * Get cache stats for logging.
 */
export function getCacheStats() {
  return {
    memoryEntries: memoryCache.size,
    dbAvailable: _dbAvailable,
  };
}
