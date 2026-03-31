import React, { useState } from 'react';
import {
  CheckCircle, XCircle, Loader, Download, Clock, FileText,
  Plus, RefreshCw, Trash2, X, BarChart3, TrendingUp, Eye,
} from 'lucide-react';
import SideBySidePreview from './SideBySidePreview';

function Dashboard({ jobs, onNewTranslation, onRefresh, authFetch }) {
  const [deleting, setDeleting] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);
  const [previewJob, setPreviewJob] = useState(null);

  const completedJobs  = jobs.filter(j => j.status === 'completed');
  const failedJobs     = jobs.filter(j => j.status === 'failed');
  const processingJobs = jobs.filter(j => j.status === 'processing');

  // ── Analytics ─────────────────────────────────────────────────────────────
  const totalPages = completedJobs.reduce((s, j) => s + (j.pageCount || 0), 0);
  const avgQuality = completedJobs.length > 0
    ? Math.round(completedJobs.reduce((s, j) => s + (j.qualityScore || 0), 0) / completedJobs.filter(j => j.qualityScore).length) || 0
    : 0;

  // Monthly breakdown (last 6 months)
  const monthlyData = (() => {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
      const monthJobs = completedJobs.filter(j => j.createdAt?.startsWith(key));
      const pages = monthJobs.reduce((s, j) => s + (j.pageCount || 0), 0);
      const count = monthJobs.length;
      months.push({ key, label, pages, count });
    }
    return months;
  })();
  const maxMonthPages = Math.max(...monthlyData.map(m => m.pages), 1);

  // Quality distribution
  const qualityDist = (() => {
    const scored = completedJobs.filter(j => j.qualityScore != null);
    return {
      excellent: scored.filter(j => j.qualityScore >= 90).length,
      good: scored.filter(j => j.qualityScore >= 70 && j.qualityScore < 90).length,
      needsReview: scored.filter(j => j.qualityScore < 70).length,
      total: scored.length,
    };
  })();

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleDownload = (job) => {
    const file = job.outputFiles?.find(f => f.format === 'docx');
    const url = file?.url || `/api/translate/download/${job.id}`;
    window.open(url, '_blank');
  };

  const handleDelete = async (jobId) => {
    if (!confirm('Delete this translation? This cannot be undone.')) return;
    setDeleting(jobId);
    try {
      const res = await authFetch(`/api/translate/jobs/${jobId}`, { method: 'DELETE' });
      if (res.ok) onRefresh?.();
      else { const d = await res.json().catch(() => ({})); alert(d.error || 'Failed to delete'); }
    } catch { alert('Network error.'); }
    finally { setDeleting(null); }
  };

  const handleClearAll = async () => {
    const nonProcessing = jobs.filter(j => j.status !== 'processing');
    if (nonProcessing.length === 0) return;
    if (!confirm(`Delete ${nonProcessing.length} completed/failed translation(s)?`)) return;
    for (const job of nonProcessing) {
      try { await authFetch(`/api/translate/jobs/${job.id}`, { method: 'DELETE' }); } catch {}
    }
    onRefresh?.();
  };

  const handleCancel = async (jobId) => {
    setCancellingId(jobId);
    try { await authFetch(`/api/translate/cancel/${jobId}`, { method: 'POST' }); onRefresh?.(); }
    catch { alert('Network error.'); }
    finally { setCancellingId(null); }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return dateStr; }
  };

  const stats = [
    { label: 'Total Translations', value: jobs.length, color: 'text-slate-700', bg: 'bg-slate-50', icon: <FileText size={16} className="text-slate-400" /> },
    { label: 'Pages Translated', value: totalPages, color: 'text-indigo-700', bg: 'bg-indigo-50', icon: <BarChart3 size={16} className="text-indigo-400" /> },
    { label: 'Completed', value: completedJobs.length, color: 'text-green-700', bg: 'bg-green-50', icon: <CheckCircle size={16} className="text-green-400" /> },
    { label: 'Avg Quality', value: avgQuality ? `${avgQuality}/100` : '—', color: avgQuality >= 90 ? 'text-green-700' : avgQuality >= 70 ? 'text-amber-700' : 'text-slate-700', bg: avgQuality >= 90 ? 'bg-green-50' : avgQuality >= 70 ? 'bg-amber-50' : 'bg-slate-50', icon: <TrendingUp size={16} className={avgQuality >= 90 ? 'text-green-400' : avgQuality >= 70 ? 'text-amber-400' : 'text-slate-400'} /> },
  ];

  const statusConfig = {
    completed:  { icon: <CheckCircle size={16} className="text-green-500" />, badge: 'bg-green-50 text-green-700 border-green-100' },
    failed:     { icon: <XCircle    size={16} className="text-red-500"   />, badge: 'bg-red-50 text-red-700 border-red-100' },
    processing: { icon: <Loader     size={16} className="text-amber-500 animate-spin" />, badge: 'bg-amber-50 text-amber-700 border-amber-100' },
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map(s => (
          <div key={s.label} className={`${s.bg} rounded-xl px-4 py-3 border border-slate-100`}>
            <div className="flex items-center gap-2 mb-1">{s.icon}<span className="text-xs text-slate-500">{s.label}</span></div>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Charts row */}
      {completedJobs.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

          {/* Monthly pages chart */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <h3 className="text-xs font-bold text-slate-700 mb-4 flex items-center gap-2">
              <BarChart3 size={14} className="text-indigo-500" />
              Pages per Month
            </h3>
            <div className="flex items-end gap-2 h-28">
              {monthlyData.map(m => (
                <div key={m.key} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-bold text-indigo-600">{m.pages || ''}</span>
                  <div className="w-full bg-slate-100 rounded-t-lg overflow-hidden" style={{ height: '80px' }}>
                    <div
                      className="w-full bg-indigo-500 rounded-t-lg transition-all duration-500"
                      style={{ height: `${(m.pages / maxMonthPages) * 100}%`, marginTop: `${100 - (m.pages / maxMonthPages) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-400">{m.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quality distribution */}
          {qualityDist.total > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <h3 className="text-xs font-bold text-slate-700 mb-4 flex items-center gap-2">
                <TrendingUp size={14} className="text-green-500" />
                Quality Distribution
              </h3>
              <div className="space-y-3">
                {[
                  { label: 'Excellent (90+)', count: qualityDist.excellent, color: 'bg-green-500', text: 'text-green-700' },
                  { label: 'Good (70–89)', count: qualityDist.good, color: 'bg-amber-400', text: 'text-amber-700' },
                  { label: 'Needs Review (<70)', count: qualityDist.needsReview, color: 'bg-red-400', text: 'text-red-700' },
                ].map(q => (
                  <div key={q.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-slate-600">{q.label}</span>
                      <span className={`text-xs font-bold ${q.text}`}>{q.count}</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full ${q.color} rounded-full transition-all`} style={{ width: `${(q.count / qualityDist.total) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-3">{qualityDist.total} scored translations</p>
            </div>
          )}
        </div>
      )}

      {/* Jobs list panel */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900">Translation History</h2>
          <div className="flex items-center gap-2">
            {jobs.length > 0 && (
              <button onClick={handleClearAll} className="flex items-center gap-1 p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition text-xs" title="Clear all">
                <Trash2 size={13} /><span className="hidden sm:inline">Clear All</span>
              </button>
            )}
            {onRefresh && (
              <button onClick={onRefresh} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition" title="Refresh">
                <RefreshCw size={14} />
              </button>
            )}
            <button onClick={onNewTranslation} className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition shadow-sm shadow-indigo-200">
              <Plus size={13} />New Translation
            </button>
          </div>
        </div>

        {jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mb-3">
              <FileText size={22} className="text-slate-400" />
            </div>
            <h3 className="text-sm font-semibold text-slate-700">No translations yet</h3>
            <p className="text-xs text-slate-400 mt-1 mb-4">Upload your first document to get started</p>
            <button onClick={onNewTranslation} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition">
              Start Translating
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {jobs.map(job => {
              const cfg = statusConfig[job.status] || statusConfig.processing;
              const previewUrl = job.outputFiles?.find(f => f.format === 'preview')?.url;
              return (
                <li key={job.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition group">
                  <div className="shrink-0">{cfg.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{job.originalName}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-400">
                      <Clock size={10} />
                      <span>{formatDate(job.createdAt)}</span>
                      {job.pageCount && <><span>·</span><span>{job.pageCount}p</span></>}
                      {job.qualityScore != null && (
                        <>
                          <span>·</span>
                          <span className={job.qualityScore >= 90 ? 'text-green-600 font-medium' : job.qualityScore >= 70 ? 'text-amber-600 font-medium' : 'text-red-600 font-medium'}>
                            Q: {job.qualityScore}
                          </span>
                        </>
                      )}
                    </div>
                    {job.status === 'processing' && (
                      <div className="flex items-center gap-2 mt-1.5">
                        <div className="flex-1 h-1 bg-slate-200 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-400 rounded-full transition-all duration-500" style={{ width: `${job.progress}%` }} />
                        </div>
                        <span className="text-xs text-amber-600 font-medium shrink-0">{job.progress}%</span>
                      </div>
                    )}
                    {job.status === 'failed' && job.message && (
                      <p className="text-xs text-red-500 mt-0.5 truncate">{job.message}</p>
                    )}
                  </div>

                  <span className={`hidden sm:inline-flex shrink-0 text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.badge}`}>
                    {job.status === 'completed' ? 'Done' : job.status === 'failed' ? 'Failed' : 'Processing'}
                  </span>

                  {/* Actions */}
                  {job.status === 'completed' && (
                    <div className="shrink-0 flex items-center gap-1">
                      {previewUrl && (
                        <button onClick={() => setPreviewJob(job)} className="p-1 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition" title="Preview">
                          <Eye size={14} />
                        </button>
                      )}
                      <button onClick={() => handleDownload(job)} className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg transition border border-indigo-100" title="Download">
                        <Download size={12} />DOCX
                      </button>
                    </div>
                  )}
                  {job.status === 'processing' && (
                    <button onClick={() => handleCancel(job.id)} disabled={cancellingId === job.id} className="flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 px-2.5 py-1 rounded-lg transition border border-red-100 shrink-0 disabled:opacity-50">
                      {cancellingId === job.id ? <Loader size={12} className="animate-spin" /> : <X size={12} />}Cancel
                    </button>
                  )}
                  {job.status !== 'processing' && (
                    <button onClick={() => handleDelete(job.id)} disabled={deleting === job.id} className="shrink-0 p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition opacity-0 group-hover:opacity-100 disabled:opacity-50" title="Delete">
                      {deleting === job.id ? <Loader size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Preview modal */}
      {previewJob && (
        <SideBySidePreview
          previewUrl={previewJob.outputFiles?.find(f => f.format === 'preview')?.url}
          onClose={() => setPreviewJob(null)}
          onDownload={() => handleDownload(previewJob)}
        />
      )}
    </div>
  );
}

export default Dashboard;
