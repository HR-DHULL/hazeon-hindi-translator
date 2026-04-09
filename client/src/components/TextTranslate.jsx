import React, { useState, useRef } from 'react';
import { Languages, Copy, Check, Loader2, AlertCircle, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function TextTranslate() {
  const { authFetch } = useAuth();
  const [inputText, setInputText] = useState('');
  const [outputText, setOutputText] = useState('');
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState(null);
  const textareaRef = useRef(null);

  const handleTranslate = async () => {
    if (!inputText.trim()) return;
    setError('');
    setOutputText('');
    setStats(null);
    setTranslating(true);

    try {
      const res = await authFetch('/api/translate/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: inputText.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Translation failed');
      } else {
        setOutputText(data.translated);
        setStats({ paragraphs: data.paragraphCount });
      }
    } catch (err) {
      setError(err.message || 'Network error');
    } finally {
      setTranslating(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(outputText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = outputText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClear = () => {
    setInputText('');
    setOutputText('');
    setError('');
    setStats(null);
    textareaRef.current?.focus();
  };

  const charCount = inputText.length;
  const lineCount = inputText.split('\n').filter(l => l.trim()).length;

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
            <Languages className="w-5 h-5 text-emerald-600" />
          </div>
          Paste & Translate
        </h1>
        <p className="text-slate-500 text-sm mt-1">
          Paste English text below and get Hindi translation instantly. No file upload needed. No page limits.
        </p>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Input */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold text-slate-700">English Input</label>
            <span className="text-xs text-slate-400">
              {lineCount} lines | {charCount.toLocaleString()} chars
            </span>
          </div>
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Paste your English text here...&#10;&#10;Each line will be translated as a separate paragraph.&#10;&#10;Supports UPSC/HCS exam content, MCQs, statements, options - everything."
            className="flex-1 min-h-[400px] p-4 rounded-xl border border-slate-200 bg-white text-slate-800 text-sm leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder:text-slate-300"
            disabled={translating}
          />
        </div>

        {/* Output */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold text-slate-700">Hindi Output</label>
            {stats && (
              <span className="text-xs text-emerald-600 font-medium">
                {stats.paragraphs} paragraphs translated
              </span>
            )}
          </div>
          <div className="flex-1 min-h-[400px] p-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm leading-relaxed overflow-auto whitespace-pre-wrap"
            style={{ fontFamily: "'Nirmala UI', 'Mangal', 'Devanagari MT', sans-serif" }}>
            {translating ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                <p className="text-sm">Translating {lineCount} paragraphs...</p>
                <p className="text-xs text-slate-300">This may take a minute for large texts</p>
              </div>
            ) : outputText ? (
              outputText
            ) : (
              <p className="text-slate-300 italic">Hindi translation will appear here...</p>
            )}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={handleTranslate}
          disabled={translating || !inputText.trim()}
          className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {translating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Translating...
            </>
          ) : (
            <>
              <Languages className="w-4 h-4" />
              Translate to Hindi
            </>
          )}
        </button>

        {outputText && (
          <button
            onClick={handleCopy}
            className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors flex items-center gap-2"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-emerald-500" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Copy Output
              </>
            )}
          </button>
        )}

        {(inputText || outputText) && (
          <button
            onClick={handleClear}
            className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-500 text-sm font-medium hover:bg-slate-50 hover:text-red-500 transition-colors flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
