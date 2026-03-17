import React from 'react';
import {
  CheckCircle,
  XCircle,
  Loader,
  Download,
  Clock,
  FileText,
  Plus,
  RefreshCw,
} from 'lucide-react';

function Dashboard({ jobs, onNewTranslation, onRefresh, authFetch }) {
  const completedJobs  = jobs.filter((j) => j.status === 'completed');
  const failedJobs     = jobs.filter((j) => j.status === 'failed');
  const processingJobs = jobs.filter((j) => j.status === 'processing');

  const handleDownload = async (jobId) => {
    try {
      const res = await authFetch(`/api/translate/download/${jobId}`);
      if (!res.ok) {
        console.error('Download failed:', res.status);
        return;
      }
      // If server redirected to a public URL, the fetch followed it — read as blob
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disposition = res.headers.get('Content-Disposition');
      const match = disposition && disposition.match(/filename="?([^"]+)"?/);
      a.download = match ? match[1] : `translated_${jobId}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const stats = [
    { label: 'Total', value: jobs.length, color: 'text-slate-700', bg: 'bg-slate-50' },
    { label: 'Completed', value: completedJobs.length, color: 'text-green-700', bg: 'bg-green-50' },
    { label: 'In Progress', value: processingJobs.length, color: 'text-amber-700', bg: 'bg-amber-50' },
    { label: 'Failed', value: failedJobs.length, color: 'text-red-700', bg: 'bg-red-50' },
  ];

  const statusConfig = {
    completed: { icon: <CheckCircle size={16} className="text-green-500" />, badge: 'bg-green-50 text-green-700 border-green-100' },
    failed:    { icon: <XCircle    size={16} className="text-red-500"   />, badge: 'bg-red-50 text-red-700 border-red-100'     },
    processing: { icon: <Loader   size={16} className="text-amber-500 animate-spin" />, badge: 'bg-amber-50 text-amber-700 border-amber-100' },
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className={`${s.bg} rounded-xl px-4 py-3 border border-slate-100`}>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Jobs panel */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900">Translation History</h2>
          <div className="flex items-center gap-2">
            {onRefresh && (
              <button
                onClick={onRefresh}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
                title="Refresh"
              >
                <RefreshCw size={14} />
              </button>
            )}
            <button
              onClick={onNewTranslation}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition shadow-sm shadow-indigo-200"
            >
              <Plus size={13} />
              New Translation
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
            <button
              onClick={onNewTranslation}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition"
            >
              Start Translating
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {jobs.map((job) => {
              const cfg = statusConfig[job.status] || statusConfig.processing;
              return (
                <li key={job.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition">
                  {/* Status icon */}
                  <div className="shrink-0">{cfg.icon}</div>

                  {/* File info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{job.originalName}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-400">
                      <Clock size={10} />
                      <span>{formatDate(job.createdAt)}</span>
                      {job.pageCount && <><span>·</span><span>{job.pageCount} pages</span></>}
                    </div>

                    {/* Mini progress bar for processing */}
                    {job.status === 'processing' && (
                      <div className="flex items-center gap-2 mt-1.5">
                        <div className="flex-1 h-1 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-400 rounded-full transition-all duration-500"
                            style={{ width: `${job.progress}%` }}
                          />
                        </div>
                        <span className="text-xs text-amber-600 font-medium shrink-0">{job.progress}%</span>
                      </div>
                    )}

                    {/* Error hint */}
                    {job.status === 'failed' && job.message && (
                      <p className="text-xs text-red-500 mt-0.5 truncate">{job.message}</p>
                    )}
                  </div>

                  {/* Status badge */}
                  <span className={`hidden sm:inline-flex shrink-0 text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.badge}`}>
                    {job.status === 'completed' ? 'Done' : job.status === 'failed' ? 'Failed' : 'Processing'}
                  </span>

                  {/* Download button */}
                  {job.status === 'completed' && (
                    <button
                      onClick={() => handleDownload(job.id)}
                      className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg transition border border-indigo-100 shrink-0"
                      title="Download DOCX"
                    >
                      <Download size={12} />
                      DOCX
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
