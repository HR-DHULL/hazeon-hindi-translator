import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

const TOKEN_KEY = 'hazeon_token';
const USER_KEY  = 'hazeon_user';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user,  setUser]  = useState(() => {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
  });
  const [loading, setLoading] = useState(false);

  // Authenticated fetch — automatically adds Bearer token
  const authFetch = useCallback(async (url, options = {}) => {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    // Don't set Content-Type for FormData (browser sets it with boundary)
    if (options.body instanceof FormData) delete headers['Content-Type'];
    return fetch(url, { ...options, headers });
  }, [token]);

  // Decode JWT payload without verifying signature (server already verified it)
  const decodeJwt = (token) => {
    try {
      return JSON.parse(atob(token.split('.')[1]));
    } catch { return {}; }
  };

  const login = async (email, password) => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');

      // Read role/plan from JWT app_metadata as source of truth
      const payload = decodeJwt(data.token);
      const appMeta = payload.app_metadata || {};

      const user = {
        ...data.user,
        role:       appMeta.role       || data.user.role       || 'user',
        plan:       appMeta.plan       || data.user.plan       || 'free',
        pagesLimit: appMeta.pages_limit || data.user.pagesLimit || 500,
      };

      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      setToken(data.token);
      setUser(user);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  };

  const isAdmin = user?.role === 'admin';
  const isLoggedIn = !!token && !!user;

  return (
    <AuthContext.Provider value={{ token, user, loading, isLoggedIn, isAdmin, login, logout, authFetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
