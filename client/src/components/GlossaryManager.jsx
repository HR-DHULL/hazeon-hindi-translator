import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Upload, Download, BookOpen, AlertCircle, Search, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

function GlossaryManager() {
  const { authFetch } = useAuth();
  const [terms, setTerms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [newEn, setNewEn] = useState('');
  const [newHi, setNewHi] = useState('');
  const [adding, setAdding] = useState(false);
  const fileRef = useRef(null);

  const loadTerms = async () => {
    try {
      const r = await authFetch('/api/translate/glossary');
      if (r.ok) setTerms(await r.json());
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { loadTerms(); }, []);

  const addTerm = async (e) => {
    e.preventDefault();
    if (!newEn.trim() || !newHi.trim()) return;
    setAdding(true); setError(''); setSuccess('');
    try {
      const r = await authFetch('/api/translate/glossary', {
        method: 'POST',
        body: JSON.stringify({ terms: [{ english_term: newEn.trim(), hindi_term: newHi.trim() }] }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
      setNewEn(''); setNewHi('');
      setSuccess('Term added');
      loadTerms();
    } catch (err) { setError(err.message); }
    finally { setAdding(false); }
  };

  const deleteTerm = async (id) => {
    setError(''); setSuccess('');
    try {
      await authFetch(`/api/translate/glossary/${id}`, { method: 'DELETE' });
      setTerms(prev => prev.filter(t => t.id !== id));
      setSuccess('Term deleted');
    } catch (err) { setError(err.message); }
  };

  const clearAll = async () => {
    if (!confirm(`Delete all ${terms.length} custom terms?`)) return;
    setError(''); setSuccess('');
    try {
      await authFetch('/api/translate/glossary', { method: 'DELETE' });
      setTerms([]);
      setSuccess('All terms cleared');
    } catch (err) { setError(err.message); }
  };

  const handleCSVUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setError(''); setSuccess('');

    try {
      const text = await file.text();
      const lines = text.split('\n').filter(l => l.trim());
      const parsed = [];
      for (const line of lines) {
        // Support: "english,hindi" or "english\thindi" or "english=hindi"
        const parts = line.split(/[,\t=]/).map(s => s.trim().replace(/^["']|["']$/g, ''));
        if (parts.length >= 2 && parts[0] && parts[1]) {
          parsed.push({ english_term: parts[0], hindi_term: parts[1] });
        }
      }
      if (parsed.length === 0) throw new Error('No valid terms found. Use format: English,Hindi (one per line)');

      const r = await authFetch('/api/translate/glossary', {
        method: 'POST',
        body: JSON.stringify({ terms: parsed }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
      setSuccess(`${parsed.length} terms imported from CSV`);
      loadTerms();
    } catch (err) { setError(err.message); }
  };

  const exportCSV = () => {
    const csv = terms.map(t => `${t.english_term},${t.hindi_term}`).join('\n');
    const blob = new Blob([`English,Hindi\n${csv}`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'custom_glossary.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = search.trim()
    ? terms.filter(t =>
        t.english_term.toLowerCase().includes(search.toLowerCase()) ||
        t.hindi_term.includes(search)
      )
    : terms;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center">
              <BookOpen size={18} className="text-indigo-600" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-slate-900">Custom Glossary</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Add your own English→Hindi term overrides. These apply to all your translations.
              </p>
            </div>
            <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded-full">{terms.length} terms</span>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* Add term form */}
          <form onSubmit={addTerm} className="flex gap-2">
            <input
              type="text"
              value={newEn}
              onChange={e => setNewEn(e.target.value)}
              placeholder="English term"
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <input
              type="text"
              value={newHi}
              onChange={e => setNewHi(e.target.value)}
              placeholder="Hindi translation"
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
            />
            <button
              type="submit"
              disabled={adding || !newEn.trim() || !newHi.trim()}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold px-4 py-2 rounded-xl transition shrink-0"
            >
              <Plus size={14} />
              Add
            </button>
          </form>

          {/* Import/Export/Clear buttons */}
          <div className="flex gap-2 flex-wrap">
            <input ref={fileRef} type="file" accept=".csv,.txt,.tsv" onChange={handleCSVUpload} className="hidden" />
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg transition"
            >
              <Upload size={13} />
              Import CSV
            </button>
            {terms.length > 0 && (
              <>
                <button
                  onClick={exportCSV}
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg transition"
                >
                  <Download size={13} />
                  Export CSV
                </button>
                <button
                  onClick={clearAll}
                  className="flex items-center gap-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 px-3 py-1.5 rounded-lg transition ml-auto"
                >
                  <Trash2 size={13} />
                  Clear All
                </button>
              </>
            )}
          </div>

          {/* CSV format hint */}
          <p className="text-xs text-slate-400">
            CSV format: <code className="bg-slate-100 px-1 rounded">English term,Hindi translation</code> (one per line). Supports comma, tab, or = separator.
          </p>

          {/* Messages */}
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2">
              <AlertCircle size={14} className="text-red-500 shrink-0" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}
          {success && (
            <p className="text-xs text-green-600 font-medium">{success}</p>
          )}

          {/* Search */}
          {terms.length > 5 && (
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search terms..."
                className="w-full pl-9 pr-8 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400 text-slate-800 placeholder-slate-400"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X size={14} />
                </button>
              )}
            </div>
          )}

          {/* Terms list */}
          {loading ? (
            <div className="py-8 text-center text-sm text-slate-400">Loading glossary...</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center">
              <BookOpen size={24} className="text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">
                {search ? 'No terms match your search' : 'No custom terms yet. Add terms above or import a CSV file.'}
              </p>
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_1fr_auto] gap-0 bg-slate-50 border-b border-slate-200">
                <div className="px-4 py-2 text-xs font-bold text-slate-500">English</div>
                <div className="px-4 py-2 text-xs font-bold text-slate-500 border-l border-slate-200">Hindi</div>
                <div className="w-10" />
              </div>
              {/* Rows */}
              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                {filtered.map(term => (
                  <div key={term.id} className="grid grid-cols-[1fr_1fr_auto] gap-0 hover:bg-slate-50/50 transition">
                    <div className="px-4 py-2.5 text-sm text-slate-700">{term.english_term}</div>
                    <div className="px-4 py-2.5 text-sm text-slate-800 border-l border-slate-100" style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}>
                      {term.hindi_term}
                    </div>
                    <div className="w-10 flex items-center justify-center">
                      <button
                        onClick={() => deleteTerm(term.id)}
                        className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition"
                        title="Delete"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default GlossaryManager;
