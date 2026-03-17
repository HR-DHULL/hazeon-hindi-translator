import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

export default function AdminUsers() {
  const { authFetch } = useAuth();
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]       = useState({ email: '', password: '', fullName: '', plan: 'free', pagesLimit: 500 });
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]         = useState('');

  const load = async () => {
    setLoading(true); setLoadErr('');
    try {
      const r = await authFetch('/api/auth/users');
      const data = await r.json();
      if (!r.ok) { setLoadErr(data.error || 'Failed to load users'); return; }
      if (!Array.isArray(data)) { setLoadErr('Unexpected response from server'); return; }
      setUsers(data);
    } catch (e) {
      setLoadErr('Network error. Try refreshing.');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const createUser = async (e) => {
    e.preventDefault();
    setSaving(true); setMsg('');
    try {
      const r = await authFetch('/api/auth/users', {
        method: 'POST',
        body: JSON.stringify({ ...form, pagesLimit: Number(form.pagesLimit) }),
      });
      const d = await r.json();
      if (!r.ok) { setMsg(d.error || 'Failed'); return; }
      setMsg('User created!');
      setForm({ email: '', password: '', fullName: '', plan: 'free', pagesLimit: 500 });
      setShowForm(false);
      load();
    } finally { setSaving(false); }
  };

  const deleteUser = async (id, email) => {
    if (!confirm(`Delete ${email}?`)) return;
    try {
      const r = await authFetch(`/api/auth/users/${id}`, { method: 'DELETE' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setMsg(d.error || 'Failed to delete user');
        return;
      }
      load();
    } catch {
      setMsg('Network error deleting user');
    }
  };

  const toggleActive = async (id, currentlyActive) => {
    try {
      const r = await authFetch(`/api/auth/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !currentlyActive }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setMsg(d.error || 'Failed to update user');
        return;
      }
      load();
    } catch {
      setMsg('Network error updating user');
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
          <p className="text-slate-500 text-sm mt-0.5">Create and manage who can access the translator</p>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition shadow-md shadow-indigo-200"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add User
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6 shadow-sm">
          <h2 className="font-semibold text-slate-800 mb-4">New User</h2>
          <form onSubmit={createUser} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Full Name</label>
              <input value={form.fullName} onChange={e => setForm(f => ({...f, fullName: e.target.value}))}
                placeholder="Rahul Sharma" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Email *</label>
              <input type="email" required value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))}
                placeholder="user@example.com" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Password *</label>
              <input type="password" required value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))}
                placeholder="Min 6 characters" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Plan</label>
              <select value={form.plan} onChange={e => setForm(f => ({...f, plan: e.target.value}))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white">
                <option value="free">Free</option>
                <option value="pro">Pro</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Pages Limit</label>
              <input type="number" value={form.pagesLimit} onChange={e => setForm(f => ({...f, pagesLimit: e.target.value}))}
                min={1} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div className="sm:col-span-2 flex items-center gap-3">
              <button type="submit" disabled={saving}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition">
                {saving ? 'Creating...' : 'Create User'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="text-slate-500 hover:text-slate-700 text-sm px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 transition">
                Cancel
              </button>
              {msg && <span className="text-sm text-green-600 font-medium">{msg}</span>}
            </div>
          </form>
        </div>
      )}

      {/* Users table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Loading users...</div>
        ) : loadErr ? (
          <div className="p-8 text-center">
            <p className="text-red-500 text-sm font-medium">{loadErr}</p>
            <button onClick={load} className="mt-3 text-xs text-indigo-600 hover:underline">Retry</button>
          </div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">No users yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">User</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Role</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Plan</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Usage</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-xs shrink-0">
                          {(u.full_name || u.email || 'U')[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-slate-800">{u.full_name || '—'}</p>
                          <p className="text-slate-400 text-xs">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        u.plan === 'pro' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {u.plan}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500 rounded-full"
                            style={{ width: `${Math.min(100, ((u.pages_used || 0) / (u.pages_limit || 500)) * 100)}%` }} />
                        </div>
                        <span className="text-slate-500 text-xs">{u.pages_used || 0}/{u.pages_limit || 500}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      {u.role !== 'admin' && (
                        <button onClick={() => deleteUser(u.id, u.email)}
                          className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded-lg hover:bg-red-50 transition">
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
