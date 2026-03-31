import React, { useState } from 'react';
import { Download, CheckCircle, XCircle, FileText, Loader, Plus, History, StopCircle, Clock, Eye } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import SideBySidePreview from './SideBySidePreview';

function BatchProgress({ jobs, onNewTranslation, onViewDashboard }) {
  const { authFetch } = useAuth();
  const [cancellingId, setCancellingId] = useState(null);
  const [previewJob, setPreviewJob] = useState(null);

  const completedCount = jobs.filter(j => j.status === 'completed').length;
  const failedCount    = jobs.filter(j => j.status === 'failed').length;
  const cancelledCount = jobs.filter(j => j.status === 'cancelled').length;
  const processingCount = jobs.filter(j => j.status === 'processing').length;
  const queuedCount    = jobs.filter(j => j.status === 'queued').length;
  const allDone = processingCount === 0 && queuedCount === 0;

  const overallProgress = jobs.length > 0
    ? Math.round(jobs.reduce((sum, j) => sum + (j.progress || 0), 0) / jobs.length)
    : 0;

  const handleCancel = async (jobId) => {
    if (!confirm('Stop this translation?')) return;
    setCancellingId(jobId);
    try {
      await authFetch(`/api/translate/cancel/${jobId}`, { method: 'POST' });
    } catch {}
    setCancellingId(null);
  };

  const handleDownload = (job) => {
    const file = job.outputFiles?.find(f => f.format === 'docx');
    const url = file?.url || `/api/translate/download/${job.id}`;
    window.open(url, '_blank');
  };

  const statusIcon = (job) => {
    switch (job.status) {
      case 'completed': return <CheckCircle size={15} className="text-green-500" />;
      case 'failed':    return <XCircle size={15} className="text-red-500" />;
      case 'cancelled': return <StopCircle size={15} className="text-slate-400" />;
      case 'queued':    return <Clock size={15} className="text-slate-400" />;
      default:          return <Loader size={15} className="text-indigo-500 animate-spin" />;
    }
  };

  const statusBadge = (job) => {
    const cls = {
      completed:  'text-green-700 bg-green-50 border-green-100',
      failed:     'text-red-700 bg-red-50 border-red-100',
      cancelled:  'text-slate-600 bg-slate-100 border-slate-200',
      queued:     'text-slate-600 bg-slate-50 border-slate-200',
      processing: 'text-amber-700 bg-amber-50 border-amber-100',
    }[job.status] || 'text-slate-600 bg-slate-50 border-slate-200';
    let label = {
      completed: 'Done', failed: 'Failed', cancelled: 'Cancelled',
      queued: 'Queued', processing: `${job.progress || 0}%`,
    }[job.status] || job.status;
    // Show quality score for completed jobs
    if (job.status === 'completed' && job.qualityScore != null) {
      label = `${job.qualityScore}/100`;
      const qCls = job.qualityScore >= 90 ? 'text-green-700 bg-green-50 border-green-100'
        : job.qualityScore >= 70 ? 'text-amber-700 bg-amber-50 border-amber-100'
        : 'text-red-700 bg-red-50 border-red-100';
      return <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${qCls}`}>{label}</span>;
    }
    return <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>;
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

        {/* Batch header */}
        <div className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Batch Translation — {jobs.length} file{jobs.length !== 1 ? 's' : ''}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {allDone
                  ? `${completedCount} completed${failedCount ? `, ${failedCount} failed` : ''}${cancelledCount ? `, ${cancelledCount} cancelled` : ''}`
                  : `${completedCount} done · ${processingCount} translating${queuedCount ? ` · ${queuedCount} queued` : ''}`
                }
              </p>
            </div>
            {allDone && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-100 px-2.5 py-1 rounded-full">
                <CheckCircle size={13} />
                All Done
              </span>
            )}
          </div>

          {/* Overall progress bar */}
          {!allDone && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-slate-500">Overall progress</span>
                <span className="text-xs font-bold text-indigo-600">{overallProgress}%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-700"
                  style={{ width: `${overallProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Job list */}
        <div className="divide-y divide-slate-100">
          {jobs.map(job => (
            <div key={job.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/50 transition">
              {/* Icon */}
              <div className="shrink-0">{statusIcon(job)}</div>

              {/* File info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{job.originalName}</p>
                {job.status === 'processing' && job.message && (
                  <p className="text-xs text-slate-400 truncate mt-0.5">{job.message}</p>
                )}
                {job.status === 'failed' && job.message && (
                  <p className="text-xs text-red-500 truncate mt-0.5">{job.message}</p>
                )}
              </div>

              {/* Progress bar (processing only) */}
              {job.status === 'processing' && (
                <div className="w-20 shrink-0">
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                      style={{ width: `${job.progress || 0}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Status badge */}
              {statusBadge(job)}

              {/* Actions */}
              {job.status === 'completed' && (
                <div className="shrink-0 flex items-center gap-1">
                  {job.outputFiles?.find(f => f.format === 'preview')?.url && (
                    <button
                      onClick={() => setPreviewJob(job)}
                      className="text-xs text-slate-500 hover:text-indigo-600 p-1 rounded-lg hover:bg-indigo-50 transition"
                      title="Preview"
                    >
                      <Eye size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => handleDownload(job)}
                    className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 px-2.5 py-1 rounded-lg transition"
                  >
                    <Download size={12} />
                    DOCX
                  </button>
                </div>
              )}
              {job.status === 'processing' && (
                <button
                  onClick={() => handleCancel(job.id)}
                  disabled={cancellingId === job.id}
                  className="shrink-0 text-xs text-red-500 hover:text-red-700 p-1 rounded-lg hover:bg-red-50 transition disabled:opacity-50"
                  title="Cancel"
                >
                  <StopCircle size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Download All button (when multiple completed) */}
        {completedCount > 1 && (
          <div className="px-5 py-3 border-t border-slate-100 bg-green-50/50">
            <button
              onClick={() => jobs.filter(j => j.status === 'completed').forEach(j => handleDownload(j))}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold py-2.5 rounded-xl transition shadow-sm"
            >
              <Download size={16} />
              Download All ({completedCount} files)
            </button>
          </div>
        )}

        {/* Bottom actions */}
        <div className="px-5 py-4 border-t border-slate-100 flex gap-2">
          <button
            onClick={onNewTranslation}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 py-2.5 rounded-xl transition"
          >
            <Plus size={13} />
            New Translation
          </button>
          <button
            onClick={onViewDashboard}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 py-2.5 rounded-xl transition"
          >
            <History size={13} />
            View History
          </button>
        </div>
      </div>

      {/* Side-by-side preview modal */}
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

export default BatchProgress;
