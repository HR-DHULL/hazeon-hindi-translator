import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const AuthContext = createContext(null);

const TOKEN_KEY   = 'hazeon_token';
const USER_KEY    = 'hazeon_user';
const REFRESH_KEY = 'hazeon_refresh_token';

export function AuthProvider({ children }) {
  const [token,        setToken]        = useState(() => localStorage.getItem(TOKEN_KEY));
  const [refreshToken, setRefreshToken] = useState(() => localStorage.getItem(REFRESH_KEY));
  const [user,         setUser]         = useState(() => {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
  });
  const [loading, setLoading] = useState(false);

  // Refs so authFetch always sees the latest values without stale closures
  const tokenRef        = useRef(token);
  const refreshTokenRef = useRef(refreshToken);
  useEffect(() => { tokenRef.current = token; },        [token]);
  useEffect(() => { refreshTokenRef.current = refreshToken; }, [refreshToken]);

  const clearAuth = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(REFRESH_KEY);
    setToken(null);
    setUser(null);
    setRefreshToken(null);
    tokenRef.current = null;
    refreshTokenRef.current = null;
  };

  // Mutex to prevent multiple concurrent refresh attempts
  const refreshPromiseRef = useRef(null);

  // Authenticated fetch — automatically adds Bearer token and handles expiry
  const authFetch = useCallback(async (url, options = {}) => {
    const makeRequest = (tkn) => {
      const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
      if (tkn) headers['Authorization'] = `Bearer ${tkn}`;
      // Don't set Content-Type for FormData (browser sets it with boundary)
      if (options.body instanceof FormData) delete headers['Content-Type'];
      return fetch(url, { ...options, headers });
    };

    let res = await makeRequest(tokenRef.current);

    // On 401, try to silently refresh the token once (with mutex to prevent race condition)
    if (res.status === 401 && refreshTokenRef.current) {
      try {
        // If a refresh is already in flight, wait for it instead of starting another
        if (!refreshPromiseRef.current) {
          refreshPromiseRef.current = fetch('/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: refreshTokenRef.current }),
          }).then(async (refreshRes) => {
            if (refreshRes.ok) {
              const data = await refreshRes.json();
              localStorage.setItem(TOKEN_KEY, data.token);
              localStorage.setItem(REFRESH_KEY, data.refreshToken);
              tokenRef.current = data.token;
              refreshTokenRef.current = data.refreshToken;
              setToken(data.token);
              setRefreshToken(data.refreshToken);
              return data.token;
            } else {
              clearAuth();
              return null;
            }
          }).finally(() => {
            refreshPromiseRef.current = null;
          });
        }

        const newToken = await refreshPromiseRef.current;
        if (newToken) {
          res = await makeRequest(newToken);
        }
      } catch {
        // Network error — don't force-logout, let the original 401 propagate
      }
    }

    return res;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Decode JWT payload without verifying signature (server already verified it)
  const decodeJwt = (t) => {
    try { return JSON.parse(atob(t.split('.')[1])); } catch { return {}; }
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

      const userData = {
        ...data.user,
        role:       appMeta.role        || data.user.role       || 'user',
        plan:       appMeta.plan        || data.user.plan       || 'free',
        pagesLimit: appMeta.pages_limit || data.user.pagesLimit || 500,
      };

      localStorage.setItem(TOKEN_KEY,   data.token);
      localStorage.setItem(USER_KEY,    JSON.stringify(userData));
      localStorage.setItem(REFRESH_KEY, data.refreshToken || '');
      setToken(data.token);
      setUser(userData);
      setRefreshToken(data.refreshToken || '');
      tokenRef.current        = data.token;
      refreshTokenRef.current = data.refreshToken || '';
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  const logout = () => { clearAuth(); };

  // Refresh user data (pagesUsed, pagesLimit, etc.) from the server
  const refreshUser = useCallback(async () => {
    try {
      const res = await authFetch('/api/auth/me');
      if (res.ok) {
        const freshData = await res.json();
        const updated = { ...user, ...freshData };
        setUser(updated);
        localStorage.setItem(USER_KEY, JSON.stringify(updated));
      }
    } catch {
      // Non-fatal — keep existing user data
    }
  }, [authFetch, user]);

  const isAdmin    = user?.role === 'admin';
  const isLoggedIn = !!token && !!user;

  return (
    <AuthContext.Provider value={{ token, user, loading, isLoggedIn, isAdmin, login, logout, authFetch, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
