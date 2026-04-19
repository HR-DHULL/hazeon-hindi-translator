import React, { useState } from 'react';
import { Download, CheckCircle, XCircle, FileText, Loader, Plus, History, Mail, Send, StopCircle, Eye } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import SideBySidePreview from './SideBySidePreview';

const STAGES = [
  { label: 'Document Parsing',  threshold: 10  },
  { label: 'Text Chunking',     threshold: 15  },
  { label: 'AI Translation',    threshold: 85  },
  { label: 'DOCX Generation',   threshold: 92  },
  { label: 'Complete',          threshold: 100 },
];

function ProgressTracker({ job, onNewTranslation, onViewDashboard }) {
  const { authFetch, refreshUser } = useAuth();
  const isComplete   = job.status === 'completed';
  const isFailed     = job.status === 'failed';
  const isProcessing = job.status === 'processing';
  const progress     = job.progress || 0;

  const isCancelled  = job.status === 'cancelled';

  // Refresh user data (page counts) when translation finishes
  const refreshedRef = React.useRef(false);
  React.useEffect(() => {
    if ((isComplete || isFailed) && !refreshedRef.current) {
      refreshedRef.current = true;
      refreshUser();
    }
  }, [isComplete, isFailed, refreshUser]);

  const [shareEmail, setShareEmail]   = useState('');
  const [sharing, setSharing]         = useState(false);
  const [shareMsg, setShareMsg]       = useState('');
  const [shareErr, setShareErr]       = useState('');
  const [cancelling, setCancelling]   = useState(false);
  const [cancelErr, setCancelErr]     = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [cloudUploadStatus, setCloudUploadStatus] = useState(''); // '', 'uploading', 'done', 'failed'

  const previewUrl = job.outputFiles?.find(f => f.format === 'preview')?.url;
  const docxFile = job.outputFiles?.find(f => f.format === 'docx');
  const hasCloudUrl = !!docxFile?.url;

  // Client-side relay: when job completes without a cloud URL, download from
  // server and re-upload to Supabase Storage via signed URL (browser → Supabase
  // works reliably, unlike Render → Supabase which hangs on large files).
  const relayAttemptedRef = React.useRef(false);
  React.useEffect(() => {
    if (!isComplete || hasCloudUrl || relayAttemptedRef.current || !job.id) return;
    relayAttemptedRef.current = true;

    (async () => {
      try {
        setCloudUploadStatus('uploading');

        // 1. Get signed upload URL from server
        const urlRes = await authFetch(`/api/translate/signed-upload-url/${job.id}`);
        if (!urlRes.ok) throw new Error('Failed to get upload URL');
        const { signedUrl, publicUrl } = await urlRes.json();

        // 2. Download the DOCX from server as blob
        const dlRes = await authFetch(`/api/translate/download/${job.id}`);
        if (!dlRes.ok) throw new Error('Failed to download file');
        const blob = await dlRes.blob();

        // 3. Upload blob to Supabase via signed URL (browser → Supabase = fast & reliable)
        const uploadRes = await fetch(signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
          body: blob,
        });
        if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);

        // 4. Save cloud URL back to the job in DB
        await authFetch(`/api/translate/upload-output/${job.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: publicUrl }),
        });

        setCloudUploadStatus('done');
        console.log('Cloud upload complete:', publicUrl);
      } catch (err) {
        console.warn('Cloud relay upload failed (download still works):', err.message);
        setCloudUploadStatus('failed');
      }
    })();
  }, [isComplete, hasCloudUrl, job.id, authFetch]);

  const handleCancel = async () => {
    if (!confirm('Stop this translation? Progress so far will be lost.')) return;
    setCancelling(true); setCancelErr('');
    try {
      const r = await authFetch(`/api/translate/cancel/${job.id}`, { method: 'POST' });
      if (!r.ok) {
        const d = await r.json();
        setCancelErr(d.error || 'Could not cancel');
      }
    } catch {
      setCancelErr('Network error. Try again.');
    } finally {
      setCancelling(false);
    }
  };

  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    const file = job.outputFiles?.find((f) => f.format === 'docx');

    // If cloud URL exists, open directly (no auth needed for public Supabase URLs)
    if (file?.url) {
      window.open(file.url, '_blank');
      return;
    }

    // Otherwise download from server with auth token, then trigger save
    setDownloading(true);
    try {
      const res = await authFetch(`/api/translate/download/${job.id}`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = file?.name || `${job.originalName.replace('.docx', '')}_hindi.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Download error:', err);
      alert('Download failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const handleShare = async (e) => {
    e.preventDefault();
    if (!shareEmail) return;
    setSharing(true); setShareMsg(''); setShareErr('');
    try {
      const r = await authFetch(`/api/translate/share/${job.id}`, {
        method: 'POST',
        body: JSON.stringify({ toEmail: shareEmail }),
      });
      const d = await r.json();
      if (!r.ok) { setShareErr(d.error || 'Failed to send'); return; }
      setShareMsg(`Sent to ${shareEmail}`);
      setShareEmail('');
    } catch {
      setShareErr('Network error. Try again.');
    } finally {
      setSharing(false);
    }
  };

  const getStageStatus = (threshold) => {
    if (progress >= threshold) return 'done';
    if (progress >= threshold - 15) return 'active';
    return 'pending';
  };

  return (
    <div className="max-w-xl mx-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

        {/* File header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
          <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
            <FileText size={18} className="text-slate-500" />
          </div>
          <p className="text-sm font-semibold text-slate-800 truncate flex-1">{job.originalName}</p>

          {/* Status badge + quality score */}
          {isComplete && job.qualityScore != null && (
            <span className={`shrink-0 flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border ${
              job.qualityScore >= 90 ? 'text-green-700 bg-green-50 border-green-100' :
              job.qualityScore >= 70 ? 'text-amber-700 bg-amber-50 border-amber-100' :
              'text-red-700 bg-red-50 border-red-100'
            }`}>
              Quality: {job.qualityScore}/100
            </span>
          )}
          {isComplete   && <span className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-100 px-2.5 py-1 rounded-full"><CheckCircle size={13} />Complete</span>}
          {isFailed     && <span className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-100 px-2.5 py-1 rounded-full"><XCircle size={13} />Failed</span>}
          {isCancelled  && <span className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-slate-600 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-full"><StopCircle size={13} />Cancelled</span>}
          {isProcessing && (
            <div className="shrink-0 flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-full"><Loader size={13} className="animate-spin" />Translating</span>
              <button
                onClick={handleCancel}
                disabled={cancelling}
                title="Cancel translation"
                className="flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 border border-red-200 px-2.5 py-1 rounded-full transition disabled:opacity-50"
              >
                <StopCircle size={13} />
                {cancelling ? 'Stopping…' : 'Cancel'}
              </button>
            </div>
          )}
        </div>

        <div className="px-5 py-5 space-y-5">

          {/* Progress bar */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-slate-600">{job.message || 'Processing...'}</p>
              <span className={`text-xs font-bold ${isComplete ? 'text-green-600' : isFailed ? 'text-red-500' : 'text-indigo-600'}`}>
                {progress}%
              </span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ease-out ${
                  isComplete ? 'bg-green-500' : isFailed ? 'bg-red-400' : 'bg-indigo-500'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
            {job.eta && job.status === 'processing' && (
              <p className="text-xs text-slate-400 mt-1.5">
                {job.eta > 60
                  ? `~${Math.floor(job.eta / 60)} min ${job.eta % 60} sec remaining`
                  : `~${job.eta} sec remaining`
                }
              </p>
            )}
          </div>

          {/* Chunk progress (when chunking) */}
          {job.currentChunk && job.totalChunks && (
            <div className="bg-slate-50 rounded-xl px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500">Translating chunks</span>
                <span className="text-xs font-semibold text-slate-700">{job.currentChunk} / {job.totalChunks}</span>
              </div>
              {job.totalChunks <= 30 && (
                <div className="flex gap-1 flex-wrap">
                  {Array.from({ length: job.totalChunks }, (_, i) => (
                    <div
                      key={i}
                      className={`h-1.5 flex-1 min-w-[8px] rounded-full transition-all duration-300 ${
                        i < job.currentChunk - 1
                          ? 'bg-indigo-500'
                          : i === job.currentChunk - 1
                          ? 'bg-indigo-300 animate-pulse'
                          : 'bg-slate-200'
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Stage tracker */}
          <div className="space-y-2">
            {STAGES.map((stage, i) => {
              const status = getStageStatus(stage.threshold);
              return (
                <div key={i} className="flex items-center gap-3">
                  <div className="shrink-0">
                    {status === 'done'   && <CheckCircle size={15} className="text-green-500" />}
                    {status === 'active' && <Loader      size={15} className="text-indigo-500 animate-spin" />}
                    {status === 'pending' && <div className="w-[15px] h-[15px] rounded-full border-2 border-slate-200" />}
                  </div>
                  <span className={`text-xs ${
                    status === 'done'   ? 'text-slate-600'
                    : status === 'active' ? 'text-indigo-700 font-semibold'
                    : 'text-slate-400'
                  }`}>
                    {stage.label}
                  </span>
                  {i < STAGES.length - 1 && (
                    <div className={`flex-1 h-px ${status === 'done' ? 'bg-green-200' : 'bg-slate-100'}`} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Download + share section */}
          {isComplete && (
            <div className="space-y-3">
              {/* Cloud upload status */}
              {cloudUploadStatus === 'uploading' && (
                <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5">
                  <Loader size={13} className="text-blue-500 animate-spin" />
                  <p className="text-xs text-blue-700">Saving to cloud for permanent download link...</p>
                </div>
              )}
              {cloudUploadStatus === 'done' && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-100 rounded-xl px-4 py-2.5">
                  <CheckCircle size={13} className="text-green-500" />
                  <p className="text-xs text-green-700">Saved to cloud — download link is permanent</p>
                </div>
              )}

              {/* Summary stats — read from outputFiles entry with format='summary' */}
              {(() => {
                const summary = (job.outputFiles || []).find(f => f.format === 'summary');
                if (!summary) return null;
                const rateColor = summary.translationRate >= 99 ? 'text-green-600'
                  : summary.translationRate >= 95 ? 'text-amber-600'
                  : 'text-red-600';
                return (
                  <div className="bg-white border border-slate-200 rounded-xl px-4 py-4">
                    <p className="text-xs font-semibold text-slate-700 mb-3">Translation Summary</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-slate-50 rounded-lg px-3 py-2">
                        <span className="text-slate-500 block">Translated</span>
                        <p className={`font-semibold ${rateColor}`}>{summary.translated}/{summary.total} ({summary.translationRate}%)</p>
                      </div>
                      <div className="bg-slate-50 rounded-lg px-3 py-2">
                        <span className="text-slate-500 block">Kept as original</span>
                        <p className="font-semibold text-slate-700">{summary.keptAsOriginal}</p>
                      </div>
                      <div className="bg-slate-50 rounded-lg px-3 py-2">
                        <span className="text-slate-500 block">Subject</span>
                        <p className="font-semibold text-slate-700 capitalize">{summary.subject}</p>
                      </div>
                      <div className="bg-slate-50 rounded-lg px-3 py-2">
                        <span className="text-slate-500 block">Pages / Size</span>
                        <p className="font-semibold text-slate-700">{summary.pageCount} / {summary.sizeKB} KB</p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Download + Preview */}
              <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-4">
                <p className="text-xs font-semibold text-green-800 mb-3">Translation complete</p>
                <div className="flex gap-2">
                  <button
                    onClick={handleDownload}
                    disabled={downloading}
                    className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-semibold py-3 rounded-xl transition shadow-sm shadow-indigo-200"
                  >
                    {downloading ? <Loader size={16} className="animate-spin" /> : <Download size={16} />}
                    {downloading ? 'Downloading...' : 'Download Hindi DOCX'}
                  </button>
                  {previewUrl && (
                    <button
                      onClick={() => setShowPreview(true)}
                      className="flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold py-3 px-4 rounded-xl border border-slate-200 transition"
                    >
                      <Eye size={16} />
                      Preview
                    </button>
                  )}
                </div>
              </div>

              {/* Email share */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <Mail size={14} className="text-slate-500" />
                  <p className="text-xs font-semibold text-slate-700">Share via Email</p>
                </div>
                <form onSubmit={handleShare} className="flex gap-2">
                  <input
                    type="email"
                    value={shareEmail}
                    onChange={(e) => setShareEmail(e.target.value)}
                    placeholder="recipient@example.com"
                    required
                    className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  <button
                    type="submit"
                    disabled={sharing || !shareEmail}
                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold px-3 py-2 rounded-xl transition shrink-0"
                  >
                    {sharing
                      ? <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                      : <Send size={13} />
                    }
                    Send
                  </button>
                </form>
                {shareMsg && <p className="text-xs text-green-600 font-medium mt-2">✓ {shareMsg}</p>}
                {shareErr && <p className="text-xs text-red-500 mt-2">{shareErr}</p>}
              </div>
            </div>
          )}

          {/* Cancel error */}
          {cancelErr && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-xl px-4 py-2">{cancelErr}</p>
          )}

          {/* Cancelled section */}
          {isCancelled && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-4 space-y-3">
              <p className="text-sm font-semibold text-slate-700">Translation cancelled</p>
              <p className="text-xs text-slate-500">The translation was stopped. No pages were deducted from your limit.</p>
              <button
                onClick={onNewTranslation}
                className="flex items-center gap-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg transition"
              >
                <Plus size={13} />
                Start New Translation
              </button>
            </div>
          )}

          {/* Error section */}
          {isFailed && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-4 space-y-3">
              <p className="text-sm font-semibold text-red-800">Translation failed</p>
              {job.message && <p className="text-xs text-red-600">{job.message}</p>}
              <button
                onClick={onNewTranslation}
                className="text-xs font-semibold text-white bg-red-500 hover:bg-red-600 px-4 py-2 rounded-lg transition"
              >
                Try Again
              </button>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
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
      </div>

      {/* Side-by-side preview modal */}
      {showPreview && previewUrl && (
        <SideBySidePreview
          previewUrl={previewUrl}
          jobId={job.id}
          onClose={() => setShowPreview(false)}
          onDownload={handleDownload}
        />
      )}
    </div>
  );
}

export default ProgressTracker;
