import React, { useState, useEffect } from 'react';
import { X, Search, ChevronLeft, ChevronRight, Download, Eye, AlertTriangle, CheckCircle, Filter, MessageSquare } from 'lucide-react';
import FeedbackForm from './FeedbackForm.jsx';

function QualityBadge({ score }) {
  if (score >= 95) return <span className="text-xs font-medium text-green-700 bg-green-50 border border-green-100 px-1.5 py-0.5 rounded-full">{score}</span>;
  if (score >= 70) return <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded-full">{score}</span>;
  return <span className="text-xs font-medium text-red-700 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded-full">{score}</span>;
}

function SideBySidePreview({ previewUrl, onClose, onDownload, jobId }) {
  const [data, setData] = useState(null);
  const [quality, setQuality] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [filterMode, setFilterMode] = useState('all'); // all | issues
  const [feedbackIndex, setFeedbackIndex] = useState(null);

  const PAGE_SIZE = 30;

  useEffect(() => {
    if (!previewUrl) return;
    setLoading(true);
    fetch(previewUrl)
      .then(r => {
        if (!r.ok) throw new Error('Failed to load preview');
        return r.json();
      })
      .then(d => {
        // Support both old format (array) and new format ({quality, paragraphs})
        if (Array.isArray(d)) {
          setData(d);
        } else {
          setData(d.paragraphs || []);
          setQuality(d.quality || null);
        }
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [previewUrl]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
        <div className="bg-white rounded-2xl p-8 text-center">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-600">Loading preview...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
        <div className="bg-white rounded-2xl p-8 text-center max-w-sm">
          <p className="text-sm text-red-600 mb-4">{error || 'Preview not available'}</p>
          <button onClick={onClose} className="text-sm text-indigo-600 font-medium hover:text-indigo-800">Close</button>
        </div>
      </div>
    );
  }

  // Filter
  let filtered = data;
  if (filterMode === 'issues') {
    filtered = data.filter(p => p.score !== undefined && p.score < 70);
  }
  if (search.trim()) {
    filtered = filtered.filter(p =>
      p.en.toLowerCase().includes(search.toLowerCase()) ||
      p.hi.toLowerCase().includes(search.toLowerCase())
    );
  }

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageData = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const scoreColor = (s) => {
    if (s >= 95) return 'border-l-green-400';
    if (s >= 70) return 'border-l-amber-400';
    return 'border-l-red-400';
  };

  const issueCount = quality?.summary?.needsReview || data.filter(p => p.score < 70).length;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200 shrink-0">
          <Eye size={18} className="text-indigo-600" />
          <h3 className="text-sm font-bold text-slate-900 flex-1">Side-by-Side Preview</h3>

          {/* Quality score badge */}
          {quality && (
            <div className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border ${
                quality.overall >= 90 ? 'text-green-700 bg-green-50 border-green-200' :
                quality.overall >= 70 ? 'text-amber-700 bg-amber-50 border-amber-200' :
                'text-red-700 bg-red-50 border-red-200'
              }`}>
                {quality.overall >= 90 ? <CheckCircle size={13} /> : <AlertTriangle size={13} />}
                Quality: {quality.overall}/100
              </div>
              {quality.summary && (
                <span className="text-xs text-slate-400">
                  {quality.summary.perfect} perfect · {quality.summary.good} good · {quality.summary.needsReview} flagged
                </span>
              )}
            </div>
          )}

          {onDownload && (
            <button
              onClick={onDownload}
              className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 px-3 py-1.5 rounded-lg transition"
            >
              <Download size={13} />
              DOCX
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search + filter */}
        <div className="px-5 py-3 border-b border-slate-100 shrink-0 flex gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder="Search in English or Hindi..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400 text-slate-800 placeholder-slate-400"
            />
          </div>
          {issueCount > 0 && (
            <button
              onClick={() => { setFilterMode(f => f === 'issues' ? 'all' : 'issues'); setPage(0); }}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl border transition ${
                filterMode === 'issues'
                  ? 'text-red-700 bg-red-50 border-red-200'
                  : 'text-slate-600 bg-white border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Filter size={13} />
              {filterMode === 'issues' ? `Showing ${issueCount} issues` : `${issueCount} issues`}
            </button>
          )}
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[1fr_1fr_auto] gap-0 border-b border-slate-200 shrink-0">
          <div className="px-5 py-2 bg-blue-50">
            <span className="text-xs font-bold text-blue-700">English (Original)</span>
          </div>
          <div className="px-5 py-2 bg-orange-50 border-l border-slate-200">
            <span className="text-xs font-bold text-orange-700">Hindi (Translation)</span>
          </div>
          <div className="px-3 py-2 bg-slate-50 border-l border-slate-200 w-16 text-center">
            <span className="text-xs font-bold text-slate-500">Score</span>
          </div>
        </div>

        {/* Paragraph pairs */}
        <div className="flex-1 overflow-y-auto">
          {pageData.map((pair, i) => {
            const hasScore = pair.score !== undefined;
            const rowBorder = hasScore ? scoreColor(pair.score) : '';
            return (
              <div
                key={page * PAGE_SIZE + i}
                className={`grid grid-cols-[1fr_1fr_auto] gap-0 border-b border-slate-100 ${
                  i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'
                } hover:bg-indigo-50/30 transition ${hasScore ? `border-l-3 ${rowBorder}` : ''}`}
                style={hasScore ? { borderLeftWidth: '3px' } : {}}
              >
                <div className="px-5 py-3">
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{pair.en}</p>
                </div>
                <div className="px-5 py-3 border-l border-slate-100">
                  <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap" style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}>
                    {pair.hi || <span className="text-slate-400 italic">— not translated —</span>}
                  </p>
                  {/* Flags */}
                  {pair.flags?.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {pair.flags.map((f, fi) => (
                        <span key={fi} className="inline-flex items-center gap-1 text-xs text-red-600 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded">
                          <AlertTriangle size={10} />
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="px-3 py-3 border-l border-slate-100 w-16 flex flex-col items-center gap-1.5 relative">
                  {hasScore && <QualityBadge score={pair.score} />}
                  <button
                    onClick={() => setFeedbackIndex(feedbackIndex === (page * PAGE_SIZE + i) ? null : (page * PAGE_SIZE + i))}
                    className="text-slate-300 hover:text-blue-500 transition-colors"
                    title="Give feedback on this translation"
                  >
                    <MessageSquare size={14} />
                  </button>
                  {feedbackIndex === (page * PAGE_SIZE + i) && (
                    <div className="absolute right-0 top-full z-10 mt-1">
                      <FeedbackForm
                        jobId={jobId}
                        paragraphIndex={page * PAGE_SIZE + i}
                        onClose={() => setFeedbackIndex(null)}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {pageData.length === 0 && (
            <div className="px-5 py-12 text-center text-slate-400 text-sm">
              {filterMode === 'issues' ? 'No issues found — all translations look good!' : search ? 'No paragraphs match your search' : 'No paragraphs to display'}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 shrink-0 bg-slate-50">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-800 disabled:text-slate-300 disabled:cursor-not-allowed transition"
            >
              <ChevronLeft size={14} />
              Previous
            </button>
            <span className="text-xs text-slate-500">
              Page {page + 1} of {totalPages} · {filtered.length} paragraphs
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-800 disabled:text-slate-300 disabled:cursor-not-allowed transition"
            >
              Next
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default SideBySidePreview;
