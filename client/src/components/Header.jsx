import React from 'react';
import { Languages, LayoutDashboard, PlusCircle } from 'lucide-react';

function Header({ view, onNewTranslation, onViewDashboard }) {
  return (
    <header className="header">
      <div className="header-inner">
        <div className="header-brand" onClick={onNewTranslation}>
          <div className="logo-icon">
            <Languages size={28} />
          </div>
          <div>
            <h1 className="header-title">UPSC/HCS Hindi Translator</h1>
            <p className="header-subtitle">AI-Powered Exam Content Translation</p>
          </div>
        </div>
        <nav className="header-nav">
          <button
            className={`nav-btn ${view === 'upload' ? 'active' : ''}`}
            onClick={onNewTranslation}
          >
            <PlusCircle size={18} />
            <span>New Translation</span>
          </button>
          <button
            className={`nav-btn ${view === 'dashboard' ? 'active' : ''}`}
            onClick={onViewDashboard}
          >
            <LayoutDashboard size={18} />
            <span>Dashboard</span>
          </button>
        </nav>
      </div>
    </header>
  );
}

export default Header;
