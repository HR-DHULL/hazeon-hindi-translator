import React, { useState, useRef } from 'react';
import { Upload, File, AlertCircle, Languages, BookOpen, Info } from 'lucide-react';

const POPULAR_BOOKS = [
  'M. Laxmikanth - Indian Polity',
  'Bipan Chandra - Modern India',
  'Spectrum - A Brief History of Modern India',
  'Ramesh Singh - Indian Economy',
  'Majid Husain - Geography of India',
  'D.D. Basu - Introduction to the Constitution of India',
  'Nitin Singhania - Indian Art & Culture',
  'R.C. Sharma - Environment & Ecology',
  'Kiran Desai - Ethics, Integrity & Aptitude',
  'ARC Reports - Governance',
  'Economic Survey (Latest)',
  'India Year Book (Latest)',
];

function FileUpload({ onUploadComplete }) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [pdfWarning, setPdfWarning] = useState(false);
  const [bookContext, setBookContext] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef(null);

  const validateFile = (file) => {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (ext === '.pdf' || ext === '.txt') {
      setPdfWarning(true);
      return `Only DOCX files are supported. PDF and TXT files cannot preserve formatting. Please convert your file to DOCX.`;
    }
    if (ext !== '.docx') {
      return `Unsupported file type: ${ext}. Only .docx files are accepted.`;
    }
    if (file.size > 100 * 1024 * 1024) {
      return 'File too large. Maximum size: 100MB';
    }
    setPdfWarning(false);
    return null;
  };

  const handleFile = (file) => {
    setError('');
    setPdfWarning(false);
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
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      if (bookContext.trim()) {
        formData.append('bookContext', bookContext.trim());
      }

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

  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const selectBook = (book) => {
    setBookContext((prev) => {
      const existing = prev.trim();
      return existing ? `${existing}, ${book}` : book;
    });
    setShowSuggestions(false);
  };

  return (
    <div className="upload-container">
      <div className="upload-card">
        <div className="upload-header">
          <h2>Upload DOCX Document for Translation</h2>
          <p>Upload your English UPSC/HCS study material (DOCX only) for accurate Hindi translation with formatting preserved</p>
        </div>

        {/* DOCX-only notice */}
        <div className="docx-only-notice">
          <Info size={16} />
          <span>Only <strong>.docx</strong> files are accepted. Formatting, styles, bullets, headers and footers are fully preserved in the output.</span>
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
            accept=".docx"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            hidden
          />

          {selectedFile ? (
            <div className="selected-file">
              <File size={24} className="file-icon docx" />
              <div className="selected-file-info">
                <span className="selected-file-name">{selectedFile.name}</span>
                <span className="selected-file-size">{formatSize(selectedFile.size)}</span>
              </div>
              <button
                className="remove-file"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedFile(null);
                  setError('');
                  setPdfWarning(false);
                }}
              >
                ×
              </button>
            </div>
          ) : (
            <div className="drop-zone-content">
              <Upload size={48} className="upload-icon" />
              <p className="drop-zone-text">
                Drag & drop your DOCX file here, or <span className="browse-link">browse</span>
              </p>
              <p className="drop-zone-hint">DOCX only · max 100MB · formatting preserved</p>
            </div>
          )}
        </div>

        {/* PDF/TXT warning */}
        {pdfWarning && (
          <div className="pdf-warning">
            <AlertCircle size={18} />
            <div>
              <strong>PDF & TXT files are not supported</strong>
              <p>PDF files cannot preserve formatting (fonts, bullets, tables, colors). Please convert your PDF to DOCX using Microsoft Word or an online converter, then upload the DOCX file.</p>
            </div>
          </div>
        )}

        {error && !pdfWarning && (
          <div className="error-message">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Book context input */}
        <div className="book-context-section">
          <div className="book-context-header">
            <BookOpen size={16} />
            <label htmlFor="bookContext">Source / Book Context <span className="optional-tag">(optional)</span></label>
          </div>
          <p className="book-context-hint">
            Mention the book or topic so translation uses the right UPSC terminology. You can also add custom terms like <em>SC=Supreme Court</em>.
          </p>
          <div className="book-context-input-wrap">
            <textarea
              id="bookContext"
              className="book-context-input"
              placeholder="e.g. M. Laxmikanth - Indian Polity, Chapter 5 — Parliament. Custom: SC=Supreme Court, HC=High Court"
              value={bookContext}
              onChange={(e) => setBookContext(e.target.value)}
              rows={3}
            />
            <button
              type="button"
              className="suggest-btn"
              onClick={() => setShowSuggestions((v) => !v)}
            >
              {showSuggestions ? 'Hide suggestions' : 'Suggest books'}
            </button>
          </div>

          {showSuggestions && (
            <div className="book-suggestions">
              {POPULAR_BOOKS.map((book) => (
                <button
                  key={book}
                  className="book-chip"
                  onClick={() => selectBook(book)}
                >
                  {book}
                </button>
              ))}
            </div>
          )}
        </div>

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
            <div className="feature-icon">📄</div>
            <h3>Formatting Preserved</h3>
            <p>Fonts, colors, bullets, tables, headers & footers stay intact</p>
          </div>
          <div className="feature">
            <div className="feature-icon">🔤</div>
            <h3>Abbreviations Kept</h3>
            <p>SC, HC, IAS, GDP etc. stay in English — not translated</p>
          </div>
          <div className="feature">
            <div className="feature-icon">📚</div>
            <h3>UPSC/HCS Glossary</h3>
            <p>200+ standard terms with official Hindi translations</p>
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
