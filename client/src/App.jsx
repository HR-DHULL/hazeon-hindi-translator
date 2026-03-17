import React, { useState, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import Login from './pages/Login';
import Sidebar from './components/Sidebar';
import FileUpload from './components/FileUpload';
import ProgressTracker from './components/ProgressTracker';
import Dashboard from './components/Dashboard';
import AdminUsers from './components/AdminUsers';

function AppShell() {
  const { isLoggedIn, authFetch, logout } = useAuth();
  const [currentJob, setCurrentJob] = useState(null);
  const [jobs, setJobs]             = useState([]);
  const [view, setView]             = useState('upload');
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

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!currentJob?.id || currentJob.status === 'completed' || currentJob.status === 'failed') return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await authFetch(`/api/translate/status/${currentJob.id}`);
        if (!r.ok) return;
        const data = await r.json();
        setCurrentJob(data);
        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(pollRef.current);
          loadJobs();
        }
      } catch (err) {
        console.error('Polling error:', err.message);
      }
    }, 2000);
    return () => clearInterval(pollRef.current);
  }, [currentJob?.id, currentJob?.status]);

  if (!isLoggedIn) return <Login />;

  const handleUploadComplete = (job) => { setCurrentJob(job); setView('progress'); };
  const handleNewTranslation = () => { setCurrentJob(null); setView('upload'); };

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
          {view === 'upload'    && <FileUpload onUploadComplete={handleUploadComplete} />}
          {view === 'progress'  && currentJob && <ProgressTracker job={currentJob} onNewTranslation={handleNewTranslation} onViewDashboard={() => { loadJobs(); setView('dashboard'); }} />}
          {view === 'dashboard' && <Dashboard jobs={jobs} onNewTranslation={handleNewTranslation} onRefresh={loadJobs} authFetch={authFetch} />}
          {view === 'admin'     && <AdminUsers />}
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
