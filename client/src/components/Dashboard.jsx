import React from 'react';
import {
  CheckCircle,
  XCircle,
  Loader,
  Download,
  Clock,
  FileText,
  PlusCircle,
} from 'lucide-react';

function Dashboard({ jobs, onNewTranslation }) {
  const completedJobs = jobs.filter((j) => j.status === 'completed');
  const failedJobs = jobs.filter((j) => j.status === 'failed');
  const processingJobs = jobs.filter((j) => j.status === 'processing');

  const handleDownload = (jobId, format) => {
    window.open(`/api/translate/download/${jobId}/${format}`, '_blank');
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="dashboard-container">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{jobs.length}</div>
          <div className="stat-label">Total Translations</div>
        </div>
        <div className="stat-card success">
          <div className="stat-value">{completedJobs.length}</div>
          <div className="stat-label">Completed</div>
        </div>
        <div className="stat-card warning">
          <div className="stat-value">{processingJobs.length}</div>
          <div className="stat-label">In Progress</div>
        </div>
        <div className="stat-card danger">
          <div className="stat-value">{failedJobs.length}</div>
          <div className="stat-label">Failed</div>
        </div>
      </div>

      <div className="jobs-section">
        <div className="jobs-header">
          <h2>Translation History</h2>
          <button className="primary-btn" onClick={onNewTranslation}>
            <PlusCircle size={18} />
            New Translation
          </button>
        </div>

        {jobs.length === 0 ? (
          <div className="empty-state">
            <FileText size={48} />
            <h3>No translations yet</h3>
            <p>Upload your first document to get started</p>
            <button className="primary-btn" onClick={onNewTranslation}>
              Start Translating
            </button>
          </div>
        ) : (
          <div className="jobs-list">
            {jobs.map((job) => (
              <div key={job.id} className={`job-card ${job.status}`}>
                <div className="job-info">
                  <div className="job-status-icon">
                    {job.status === 'completed' && <CheckCircle size={20} />}
                    {job.status === 'failed' && <XCircle size={20} />}
                    {job.status === 'processing' && <Loader size={20} className="spin" />}
                  </div>
                  <div className="job-details">
                    <span className="job-name">{job.originalName}</span>
                    <div className="job-meta">
                      <Clock size={12} />
                      <span>{formatDate(job.createdAt)}</span>
                      {job.pageCount && <span> | {job.pageCount} pages</span>}
                    </div>
                  </div>
                </div>

                {job.status === 'processing' && (
                  <div className="job-progress-mini">
                    <div className="mini-bar">
                      <div className="mini-fill" style={{ width: `${job.progress}%` }} />
                    </div>
                    <span>{job.progress}%</span>
                  </div>
                )}

                {job.status === 'completed' && (
                  <div className="job-actions">
                    <button
                      className="icon-btn"
                      onClick={() => handleDownload(job.id, 'docx')}
                      title="Download DOCX"
                    >
                      <Download size={16} />
                      <span>DOCX</span>
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => handleDownload(job.id, 'pdf')}
                      title="Download PDF"
                    >
                      <Download size={16} />
                      <span>PDF</span>
                    </button>
                  </div>
                )}

                {job.status === 'failed' && (
                  <span className="job-error-hint" title={job.message}>
                    Error
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
