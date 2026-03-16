import React, { useState, useRef } from 'react';
import { Upload, FileText, File, AlertCircle, Languages } from 'lucide-react';

function FileUpload({ onUploadComplete }) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const allowedExts = ['.pdf', '.docx', '.txt'];

  const validateFile = (file) => {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!allowedExts.includes(ext)) {
      return `Unsupported file type: ${ext}. Allowed: ${allowedExts.join(', ')}`;
    }
    if (file.size > 50 * 1024 * 1024) {
      return 'File too large. Maximum size: 50MB';
    }
    return null;
  };

  const handleFile = (file) => {
    setError('');
    const err = validateFile(file);
    if (err) {
      setError(err);
      return;
    }
    setSelectedFile(file);
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const res = await fetch('/api/translate/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Upload failed');
      }

      const data = await res.json();
      onUploadComplete({
        id: data.jobId,
        originalName: data.originalName,
        status: 'processing',
        progress: 0,
        message: 'Starting...',
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const getFileIcon = (name) => {
    if (name?.endsWith('.pdf')) return <FileText size={24} className="file-icon pdf" />;
    if (name?.endsWith('.docx')) return <File size={24} className="file-icon docx" />;
    return <FileText size={24} className="file-icon txt" />;
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="upload-container">
      <div className="upload-card">
        <div className="upload-header">
          <h2>Upload Document for Translation</h2>
          <p>Upload your English UPSC/HCS study material for accurate Hindi translation</p>
        </div>

        <div
          className={`drop-zone ${dragActive ? 'active' : ''} ${selectedFile ? 'has-file' : ''}`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.txt"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            hidden
          />

          {selectedFile ? (
            <div className="selected-file">
              {getFileIcon(selectedFile.name)}
              <div className="selected-file-info">
                <span className="selected-file-name">{selectedFile.name}</span>
                <span className="selected-file-size">{formatSize(selectedFile.size)}</span>
              </div>
              <button
                className="remove-file"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedFile(null);
                }}
              >
                ×
              </button>
            </div>
          ) : (
            <div className="drop-zone-content">
              <Upload size={48} className="upload-icon" />
              <p className="drop-zone-text">
                Drag & drop your file here, or <span className="browse-link">browse</span>
              </p>
              <p className="drop-zone-hint">Supports PDF, DOCX, TXT (max 50MB)</p>
            </div>
          )}
        </div>

        {error && (
          <div className="error-message">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <button
          className="translate-btn"
          onClick={handleUpload}
          disabled={!selectedFile || uploading}
        >
          {uploading ? (
            <>
              <span className="spinner" />
              Uploading...
            </>
          ) : (
            <>
              <Languages size={20} />
              Translate to Hindi (Devanagari)
            </>
          )}
        </button>

        <div className="features-grid">
          <div className="feature">
            <div className="feature-icon">📚</div>
            <h3>UPSC/HCS Terminology</h3>
            <p>200+ standard terms with official Hindi translations</p>
          </div>
          <div className="feature">
            <div className="feature-icon">🎯</div>
            <h3>100% Accurate</h3>
            <p>AI-powered with exam-standard Devanagari Hindi</p>
          </div>
          <div className="feature">
            <div className="feature-icon">📄</div>
            <h3>Multiple Formats</h3>
            <p>Download as DOCX or PDF with Devanagari support</p>
          </div>
          <div className="feature">
            <div className="feature-icon">⚡</div>
            <h3>Real-time Progress</h3>
            <p>Track translation progress with live updates</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default FileUpload;
