import React, { useState, useRef } from 'react';
import { Upload, File, AlertCircle, Languages, BookOpen, Info, X, Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

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
  const { authFetch } = useAuth();
  const [dragActive, setDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [pdfWarning, setPdfWarning] = useState(false);
  const [bookContext, setBookContext] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef(null);

  const estimatePages = (bytes) => Math.round(bytes / 30000);

  const getPageWarning = (file) => {
    const est = estimatePages(file.size);
    if (est > 80) return { level: 'error', est, msg: `~${est} pages — very likely to timeout. Split into 30-page files.` };
    if (est > 30) return { level: 'warn', est, msg: `~${est} pages — accuracy is best under 30 pages.` };
    return null;
  };

  const validateFile = (file) => {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (ext === '.pdf' || ext === '.txt') {
      setPdfWarning(true);
      return `${file.name}: Only DOCX files are supported.`;
    }
    if (ext !== '.docx') return `${file.name}: Unsupported file type ${ext}.`;
    if (file.size > 100 * 1024 * 1024) return `${file.name}: File too large (max 100MB).`;
    return null;
  };

  const addFiles = (fileList) => {
    setError('');
    setPdfWarning(false);
    const newFiles = [];
    const errors = [];
    for (const file of fileList) {
      // Skip duplicates
      if (selectedFiles.some(f => f.name === file.name && f.size === file.size)) continue;
      const err = validateFile(file);
      if (err) { errors.push(err); continue; }
      newFiles.push(file);
    }
    if (errors.length) setError(errors.join(' '));
    if (newFiles.length) setSelectedFiles(prev => [...prev, ...newFiles]);
  };

  const removeFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    setError('');
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
    if (e.dataTransfer.files?.length) addFiles(Array.from(e.dataTransfer.files));
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;
    setUploading(true);
    setError('');

    const startedJobs = [];

    for (const file of selectedFiles) {
      try {
        // Step 1: Prepare — get signed URL
        const prepRes = await authFetch('/api/translate/prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, bookContext: bookContext.trim() }),
        });
        if (!prepRes.ok) {
          const d = await prepRes.json();
          // If rate-limited (too many concurrent), mark as queued and continue
          if (prepRes.status === 429) {
            startedJobs.push({ id: null, originalName: file.name, status: 'queued', progress: 0, message: 'Queued — waiting for slot', _file: file, _bookContext: bookContext.trim() });
            continue;
          }
          throw new Error(d.error || `Failed to prepare ${file.name}`);
        }
        const { jobId, signedUrl, storagePath, originalName } = await prepRes.json();

        // Step 2: Upload to Supabase
        const uploadRes = await fetch(signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
          body: file,
        });
        if (!uploadRes.ok) throw new Error(`Upload failed for ${file.name}`);

        // Step 3: Start translation
        const startRes = await authFetch('/api/translate/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId, storagePath }),
        });
        if (!startRes.ok) {
          const d = await startRes.json();
          throw new Error(d.error || `Failed to start ${file.name}`);
        }

        startedJobs.push({ id: jobId, originalName, status: 'processing', progress: 0, message: 'Starting...' });
      } catch (err) {
        startedJobs.push({ id: null, originalName: file.name, status: 'failed', progress: 0, message: err.message });
      }
    }

    // If any jobs were queued (rate-limited), retry them after a short delay
    const queuedJobs = startedJobs.filter(j => j.status === 'queued');
    if (queuedJobs.length > 0) {
      // We'll let the batch progress view handle retries via polling
      // For now, mark them as queued in the UI
    }

    setUploading(false);
    onUploadComplete(startedJobs);
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

  const totalSize = selectedFiles.reduce((s, f) => s + f.size, 0);
  const hasLargeFile = selectedFiles.some(f => estimatePages(f.size) > 80);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Upload Documents for Translation</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Upload one or more English UPSC/HCS DOCX files — formatting fully preserved in Hindi output
          </p>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* DOCX-only notice */}
          <div className="flex items-start gap-2.5 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
            <Info size={15} className="text-indigo-500 mt-0.5 shrink-0" />
            <p className="text-xs text-indigo-700">
              Only <strong>.docx</strong> files are accepted. You can select multiple files at once. Formatting is preserved in output.
            </p>
          </div>

          {/* Drop zone */}
          <div
            className={`relative rounded-xl border-2 border-dashed cursor-pointer transition-all duration-150 ${
              dragActive
                ? 'border-indigo-400 bg-indigo-50'
                : selectedFiles.length > 0
                ? 'border-green-300 bg-green-50'
                : 'border-slate-200 bg-slate-50 hover:border-indigo-300 hover:bg-indigo-50/40'
            }`}
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
              multiple
              onChange={(e) => {
                if (e.target.files?.length) addFiles(Array.from(e.target.files));
                e.target.value = ''; // allow re-selecting same files
              }}
              className="hidden"
            />

            {selectedFiles.length > 0 ? (
              <div className="px-4 py-3 space-y-2" onClick={(e) => e.stopPropagation()}>
                {selectedFiles.map((file, i) => {
                  const warn = getPageWarning(file);
                  return (
                    <div key={`${file.name}-${i}`} className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 border border-slate-100">
                      <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                        <File size={16} className="text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{file.name}</p>
                        <p className="text-xs text-slate-400">{formatSize(file.size)}
                          {warn && <span className={warn.level === 'error' ? ' text-red-500' : ' text-amber-500'}> · {warn.msg}</span>}
                        </p>
                      </div>
                      <button
                        onClick={() => removeFile(i)}
                        className="p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
                {/* Add more button */}
                <button
                  onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
                  className="w-full flex items-center justify-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 py-2 rounded-lg border border-dashed border-indigo-200 transition"
                >
                  <Plus size={13} />
                  Add more files
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mb-3">
                  <Upload size={22} className="text-slate-400" />
                </div>
                <p className="text-sm font-medium text-slate-700">
                  Drag &amp; drop your DOCX files, or <span className="text-indigo-600">browse</span>
                </p>
                <p className="text-xs text-slate-400 mt-1">DOCX only · Select multiple files · Best accuracy: under 30 pages each · max 100MB</p>
              </div>
            )}
          </div>

          {/* PDF/TXT warning */}
          {pdfWarning && (
            <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <AlertCircle size={15} className="text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-amber-800">PDF &amp; TXT files are not supported</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Convert your PDF to DOCX using Microsoft Word or an online converter, then upload.
                </p>
              </div>
            </div>
          )}

          {/* Generic error */}
          {error && !pdfWarning && (
            <div className="flex items-center gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertCircle size={15} className="text-red-500 shrink-0" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          {/* Book context */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <BookOpen size={14} className="text-slate-400" />
              <label htmlFor="bookContext" className="text-sm font-medium text-slate-700">
                Source / Book Context
                <span className="ml-1.5 text-xs font-normal text-slate-400">(optional — applies to all files)</span>
              </label>
            </div>
            <p className="text-xs text-slate-500">
              Mention the book or topic so translation uses correct UPSC terminology. Add custom terms like <em>SC=Supreme Court</em>.
            </p>
            <div className="space-y-2">
              <textarea
                id="bookContext"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent resize-none"
                placeholder="e.g. M. Laxmikanth - Indian Polity, Chapter 5 — Parliament. Custom: SC=Supreme Court, HC=High Court"
                value={bookContext}
                onChange={(e) => setBookContext(e.target.value)}
                rows={2}
              />
              <button
                type="button"
                onClick={() => setShowSuggestions((v) => !v)}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium transition"
              >
                {showSuggestions ? 'Hide suggestions' : '+ Suggest popular books'}
              </button>
            </div>

            {showSuggestions && (
              <div className="flex flex-wrap gap-1.5">
                {POPULAR_BOOKS.map((book) => (
                  <button
                    key={book}
                    onClick={() => selectBook(book)}
                    className="px-2.5 py-1 text-xs rounded-full bg-slate-100 text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200 transition"
                  >
                    {book}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Submit button */}
          <button
            onClick={handleUpload}
            disabled={selectedFiles.length === 0 || uploading || hasLargeFile}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-semibold text-sm px-5 py-3 rounded-xl transition-all duration-150 shadow-sm shadow-indigo-200"
          >
            {uploading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Uploading {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''}...
              </>
            ) : (
              <>
                <Languages size={18} />
                Translate {selectedFiles.length > 1 ? `${selectedFiles.length} Files` : ''} to Hindi
              </>
            )}
          </button>

          {/* File count summary */}
          {selectedFiles.length > 1 && (
            <p className="text-xs text-center text-slate-400">
              {selectedFiles.length} files · {formatSize(totalSize)} total · ~{estimatePages(totalSize)} pages estimated
            </p>
          )}
        </div>

        {/* Feature strip */}
        <div className="border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4">
          {[
            { icon: '📄', title: 'Formatting Preserved', desc: 'Fonts, bullets, tables, headers' },
            { icon: '🔤', title: 'Abbreviations Kept', desc: 'SC, IAS, GDP stay in English' },
            { icon: '📚', title: 'UPSC Glossary', desc: '600+ official Hindi terms' },
            { icon: '📦', title: 'Batch Upload', desc: 'Multiple files at once' },
          ].map((f) => (
            <div key={f.title} className="px-4 py-4 border-r last:border-r-0 border-slate-100">
              <div className="text-xl mb-1">{f.icon}</div>
              <p className="text-xs font-semibold text-slate-700">{f.title}</p>
              <p className="text-xs text-slate-400 mt-0.5">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default FileUpload;
