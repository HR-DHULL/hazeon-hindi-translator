import React, { useState, useEffect, useRef } from 'react';
import FileUpload from './components/FileUpload';
import ProgressTracker from './components/ProgressTracker';
import Dashboard from './components/Dashboard';
import Header from './components/Header';

function App() {
  const [currentJob, setCurrentJob] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [view, setView] = useState('upload');
  const pollRef = useRef(null);

  useEffect(() => {
    fetch('/api/translate/jobs')
      .then((r) => r.json())
      .then(setJobs)
      .catch(() => {});
  }, []);

  // Poll job status every 2s while a job is processing
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);

    if (!currentJob?.id || currentJob.status === 'completed' || currentJob.status === 'failed') {
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/translate/status/${currentJob.id}`);
        if (!r.ok) return;
        const data = await r.json();
        setCurrentJob(data);

        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(pollRef.current);
          fetch('/api/translate/jobs')
            .then((r) => r.json())
            .then(setJobs)
            .catch(() => {});
        }
      } catch {}
    }, 2000);

    return () => clearInterval(pollRef.current);
  }, [currentJob?.id, currentJob?.status]);

  const handleUploadComplete = (job) => {
    setCurrentJob(job);
    setView('progress');
  };

  const handleNewTranslation = () => {
    setCurrentJob(null);
    setView('upload');
  };

  const handleViewDashboard = () => {
    fetch('/api/translate/jobs')
      .then((r) => r.json())
      .then(setJobs)
      .catch(() => {});
    setView('dashboard');
  };

  return (
    <div className="app">
      <Header
        view={view}
        onNewTranslation={handleNewTranslation}
        onViewDashboard={handleViewDashboard}
      />
      <main className="main-content">
        {view === 'upload' && <FileUpload onUploadComplete={handleUploadComplete} />}
        {view === 'progress' && currentJob && (
          <ProgressTracker
            job={currentJob}
            onNewTranslation={handleNewTranslation}
            onViewDashboard={handleViewDashboard}
          />
        )}
        {view === 'dashboard' && (
          <Dashboard jobs={jobs} onNewTranslation={handleNewTranslation} />
        )}
      </main>
      <footer className="footer">
        <p>Hazeon Hindi Translator — UPSC/HCS DOCX Translation Tool</p>
      </footer>
    </div>
  );
}

export default App;
