import React, { useState, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import Login from './pages/Login';
import Sidebar from './components/Sidebar';
import FileUpload from './components/FileUpload';
import ProgressTracker from './components/ProgressTracker';
import BatchProgress from './components/BatchProgress';
import Dashboard from './components/Dashboard';
import AdminUsers from './components/AdminUsers';
import GlossaryManager from './components/GlossaryManager';

function AppShell() {
  const { isLoggedIn, isAdmin, authFetch, logout } = useAuth();
  const [currentJobs, setCurrentJobs] = useState([]);   // array of active jobs
  const [jobs, setJobs]               = useState([]);
  const [view, setView]               = useState('upload');
  const pollRef = useRef(null);

  const loadJobs = () =>
    authFetch('/api/translate/jobs')
      .then(r => {
        if (r.status === 401) { logout(); return null; }
        return r.json();
      })
      .then(data => { if (data && Array.isArray(data)) setJobs(data); })
      .catch((err) => { console.error('Failed to load jobs:', err.message); });

  useEffect(() => {
    if (isLoggedIn) loadJobs();
  }, [isLoggedIn]);

  // Stale detection per job
  const staleRef = useRef({});

  // Start a queued job (no server-side job yet — needs full prepare→upload→start flow)
  const startQueuedJob = async (queuedJob) => {
    try {
      const prepRes = await authFetch('/api/translate/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: queuedJob.originalName, bookContext: queuedJob._bookContext || '' }),
      });
      if (!prepRes.ok) return null; // still busy, try again later

      const { jobId, signedUrl, storagePath } = await prepRes.json();

      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        body: queuedJob._file,
      });
      if (!uploadRes.ok) return { ...queuedJob, status: 'failed', message: 'Upload failed' };

      await authFetch('/api/translate/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, storagePath }),
      });

      return { ...queuedJob, id: jobId, status: 'processing', progress: 0, message: 'Starting...', _file: undefined };
    } catch (err) {
      return { ...queuedJob, status: 'failed', message: err.message };
    }
  };

  // Poll all active jobs
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);

    const activeJobs = currentJobs.filter(j => j.id && j.status === 'processing');
    const queuedJobs = currentJobs.filter(j => !j.id && j.status === 'queued');
    if (activeJobs.length === 0 && queuedJobs.length === 0) return;

    // Initialize stale tracking
    for (const j of activeJobs) {
      if (!staleRef.current[j.id]) {
        staleRef.current[j.id] = { lastProgress: j.progress, lastProgressAt: Date.now() };
      }
    }

    pollRef.current = setInterval(async () => {
      const updates = await Promise.all(
        currentJobs.map(async (job) => {
          // Skip queued jobs (handled below) and finished jobs
          if (!job.id || job.status !== 'processing') return job;

          try {
            const r = await authFetch(`/api/translate/status/${job.id}`);
            if (!r.ok) return job;
            const data = await r.json();

            // Stale detection — only show timeout for genuinely stuck jobs
            if (data.status === 'processing') {
              const st = staleRef.current[job.id];
              if (st && (data.progress !== st.lastProgress || data.message !== st.lastMessage)) {
                staleRef.current[job.id] = { lastProgress: data.progress, lastMessage: data.message, lastProgressAt: Date.now() };
              } else if (st && Date.now() - st.lastProgressAt > 15 * 60 * 1000) {
                data.status = 'failed';
                data.message = 'Translation timed out. The document may be too large. Please try with a smaller file.';
              }
            }

            return { ...job, ...data };
          } catch {
            return job;
          }
        })
      );

      // Auto-start queued jobs when a slot opens
      const processingCount = updates.filter(j => j.id && j.status === 'processing').length;
      const firstQueued = updates.findIndex(j => !j.id && j.status === 'queued');
      if (firstQueued !== -1 && processingCount < 3) {
        const started = await startQueuedJob(updates[firstQueued]);
        if (started) updates[firstQueued] = started;
      }

      setCurrentJobs(updates);

      // If all done, refresh job history
      const stillActive = updates.filter(j => j.status === 'processing' || j.status === 'queued');
      if (stillActive.length === 0) {
        clearInterval(pollRef.current);
        loadJobs();
        staleRef.current = {};
      }
    }, 2000);

    return () => clearInterval(pollRef.current);
  }, [currentJobs.map(j => `${j.id}:${j.status}`).join(',')]);

  if (!isLoggedIn) return <Login />;

  const handleUploadComplete = (startedJobs) => {
    setCurrentJobs(startedJobs);
    setView('progress');
  };

  const handleNewTranslation = () => {
    setCurrentJobs([]);
    staleRef.current = {};
    setView('upload');
  };

  // Single vs batch progress view
  const isBatch = currentJobs.length > 1;
  const singleJob = currentJobs.length === 1 ? currentJobs[0] : null;

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar view={view} setView={setView} />
      <main className="flex-1 overflow-y-auto">
        <div className="lg:hidden sticky top-0 z-30 bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
            </svg>
          </div>
          <span className="font-semibold text-slate-800 text-sm">Hazeon Translator</span>
        </div>
        <div className="p-4 sm:p-6 lg:p-8 pb-24 lg:pb-8">
          {view === 'upload' && <FileUpload onUploadComplete={handleUploadComplete} />}
          {view === 'progress' && isBatch && (
            <BatchProgress
              jobs={currentJobs}
              onNewTranslation={handleNewTranslation}
              onViewDashboard={() => { loadJobs(); setView('dashboard'); }}
            />
          )}
          {view === 'progress' && singleJob && (
            <ProgressTracker
              job={singleJob}
              onNewTranslation={handleNewTranslation}
              onViewDashboard={() => { loadJobs(); setView('dashboard'); }}
            />
          )}
          {view === 'glossary'  && <GlossaryManager />}
          {view === 'dashboard' && <Dashboard jobs={jobs} onNewTranslation={handleNewTranslation} onRefresh={loadJobs} authFetch={authFetch} isAdmin={isAdmin} />}
          {view === 'admin' && <AdminUsers />}
        </div>
      </main>
      <MobileNav view={view} setView={setView} />
    </div>
  );
}

function MobileNav({ view, setView }) {
  const { isAdmin } = useAuth();
  const items = [
    { id: 'upload', label: 'Translate', icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg> },
    { id: 'glossary', label: 'Glossary', icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg> },
    { id: 'dashboard', label: 'History', icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg> },
    ...(isAdmin ? [{ id: 'admin', label: 'Users', icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg> }] : []),
  ];
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200 flex">
      {items.map(item => (
        <button key={item.id} onClick={() => setView(item.id)}
          className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors ${view === item.id ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>
          {item.icon}{item.label}
        </button>
      ))}
    </nav>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider><AppShell /></AuthProvider>
    </ErrorBoundary>
  );
}
