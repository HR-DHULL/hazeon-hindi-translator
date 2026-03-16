import React from 'react';
import { Download, CheckCircle, XCircle, FileText, Loader } from 'lucide-react';

function ProgressTracker({ job, onNewTranslation, onViewDashboard }) {
  const isComplete = job.status === 'completed';
  const isFailed = job.status === 'failed';
  const isProcessing = job.status === 'processing';

  const handleDownload = (format) => {
    const file = job.outputFiles?.find((f) => f.format === format);
    // Use Supabase Storage URL if available, fallback to API route
    const url = file?.url || `/api/translate/download/${job.id}/${format}`;
    window.open(url, '_blank');
  };

  const getStageStatus = (stageThreshold) => {
    if (job.progress >= stageThreshold) return 'completed';
    if (job.progress >= stageThreshold - 15) return 'active';
    return 'pending';
  };

  const stages = [
    { label: 'Document Parsing', threshold: 10 },
    { label: 'Text Chunking', threshold: 15 },
    { label: 'AI Translation', threshold: 85 },
    { label: 'DOCX Generation', threshold: 90 },
    { label: 'PDF Generation', threshold: 95 },
    { label: 'Complete', threshold: 100 },
  ];

  return (
    <div className="progress-container">
      <div className="progress-card">
        <div className="progress-file-info">
          <FileText size={20} />
          <span>{job.originalName}</span>
        </div>

        <div className={`status-badge ${job.status}`}>
          {isComplete && <CheckCircle size={20} />}
          {isFailed && <XCircle size={20} />}
          {isProcessing && <Loader size={20} className="spin" />}
          <span>
            {isComplete && 'Translation Complete'}
            {isFailed && 'Translation Failed'}
            {isProcessing && 'Translating...'}
          </span>
        </div>

        <div className="progress-bar-container">
          <div className="progress-bar">
            <div
              className={`progress-fill ${isComplete ? 'complete' : ''} ${isFailed ? 'failed' : ''}`}
              style={{ width: `${job.progress || 0}%` }}
            />
          </div>
          <span className="progress-percent">{job.progress || 0}%</span>
        </div>

        <p className="progress-message">{job.message}</p>

        {job.currentChunk && job.totalChunks && (
          <div className="chunk-progress">
            <span>
              Chunk {job.currentChunk} of {job.totalChunks}
            </span>
            <div className="chunk-dots">
              {Array.from({ length: job.totalChunks }, (_, i) => (
                <div
                  key={i}
                  className={`chunk-dot ${i < job.currentChunk ? 'done' : ''} ${i === job.currentChunk - 1 ? 'active' : ''}`}
                />
              ))}
            </div>
          </div>
        )}

        <div className="stages">
          {stages.map((stage, i) => {
            const status = getStageStatus(stage.threshold);
            return (
              <div key={i} className={`stage ${status}`}>
                <div className="stage-indicator">
                  {status === 'completed' ? (
                    <CheckCircle size={16} />
                  ) : status === 'active' ? (
                    <Loader size={16} className="spin" />
                  ) : (
                    <div className="stage-dot" />
                  )}
                </div>
                <div className="stage-label">
                  <span>{stage.label}</span>
                </div>
              </div>
            );
          })}
        </div>

        {isComplete && (
          <div className="download-section">
            <h3>Download Translated Files (Devanagari Hindi)</h3>
            <div className="download-buttons">
              <button className="download-btn docx" onClick={() => handleDownload('docx')}>
                <Download size={18} />
                <div>
                  <span className="download-format">DOCX</span>
                  <span className="download-label">Word Document</span>
                </div>
              </button>
              <button className="download-btn pdf" onClick={() => handleDownload('pdf')}>
                <Download size={18} />
                <div>
                  <span className="download-format">PDF</span>
                  <span className="download-label">PDF Document</span>
                </div>
              </button>
            </div>
          </div>
        )}

        {isFailed && (
          <div className="error-details">
            <p>{job.message}</p>
            <button className="retry-btn" onClick={onNewTranslation}>
              Try Again
            </button>
          </div>
        )}

        <div className="progress-actions">
          <button className="secondary-btn" onClick={onNewTranslation}>
            New Translation
          </button>
          <button className="secondary-btn" onClick={onViewDashboard}>
            View Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProgressTracker;
