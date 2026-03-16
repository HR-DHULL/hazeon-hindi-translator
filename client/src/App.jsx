import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import FileUpload from './components/FileUpload';
import ProgressTracker from './components/ProgressTracker';
import Dashboard from './components/Dashboard';
import Header from './components/Header';

// In production on Netlify, Socket.IO is proxied through netlify.toml redirects
// so we connect to the same origin. In dev, Vite proxy handles it.
const socket = io(window.location.origin, { path: '/socket.io' });

function App() {
  const [currentJob, setCurrentJob] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [view, setView] = useState('upload');

  useEffect(() => {
    fetch('/api/translate/jobs')
      .then((r) => r.json())
      .then(setJobs)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!currentJob?.id) return;

    const handler = (data) => {
      setCurrentJob(data);
      if (data.status === 'completed' || data.status === 'failed') {
        fetch('/api/translate/jobs')
          .then((r) => r.json())
          .then(setJobs)
          .catch(() => {});
      }
    };

    socket.on(`job:${currentJob.id}`, handler);
    return () => socket.off(`job:${currentJob.id}`, handler);
  }, [currentJob?.id]);

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
        <p>UPSC/HCS Hindi Translation Tool — Powered by Claude Code Agent SDK</p>
      </footer>
    </div>
  );
}

export default App;
