import express from 'express';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// ── Rate limiters ────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // 10 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,             // 60 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

router.use(apiLimiter);

// Lazy Supabase client — only created when first API call hits (allows server to start without creds)
let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  }
  return _supabase;
}
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

// ── Helpers ──────────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(id) { return typeof id === 'string' && UUID_RE.test(id); }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ['user', 'admin'];
const VALID_PLANS = ['free', 'pro'];

// ── Direct REST helper (bypasses broken JS client DB queries) ─────────────────
function restHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': process.env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    'Prefer': 'return=representation',
  };
}

async function restGet(path) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: restHeaders(),
  });
  return r.json();
}

async function restPost(path, body) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: restHeaders(),
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) {
    const msg = data?.message || data?.error || JSON.stringify(data);
    throw new Error(`REST POST ${path} failed (${r.status}): ${msg}`);
  }
  return data;
}

async function restPatch(path, body) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...restHeaders(), 'Prefer': 'return=representation' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) {
    const msg = data?.message || data?.error || JSON.stringify(data);
    throw new Error(`REST PATCH ${path} failed (${r.status}): ${msg}`);
  }
  return data;
}

async function restDelete(path) {
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: restHeaders(),
  });
}

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
// Uses Supabase Auth REST API directly — more reliable than the JS client in serverless
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  let authData;
  try {
    const authRes = await fetch(
      `${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_SERVICE_KEY,
        },
        body: JSON.stringify({ email, password }),
      }
    );
    authData = await authRes.json();
    if (!authRes.ok || authData.error) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
  } catch (e) {
    console.error('Auth REST call failed:', e.message);
    return res.status(500).json({ error: 'Authentication service error' });
  }

  const userId = authData.user?.id;
  const accessToken = authData.access_token;

  // Fetch profile via REST API
  let profile = null;
  try {
    const profiles = await restGet(
      `user_profiles?id=eq.${userId}&select=full_name,role,plan,pages_used,pages_limit`
    );
    profile = Array.isArray(profiles) ? profiles[0] : null;
  } catch (e) {
    console.warn('Profile REST fetch failed:', e.message);
  }

  const appMeta = authData.user?.app_metadata || {};

  res.json({
    token: accessToken,
    refreshToken: authData.refresh_token,
    user: {
      id: userId,
      email: authData.user?.email,
      fullName: profile?.full_name || '',
      role:       profile?.role       ?? appMeta.role       ?? 'user',
      plan:       profile?.plan       ?? appMeta.plan       ?? 'free',
      pagesUsed:  profile?.pages_used ?? appMeta.pages_used ?? 0,
      pagesLimit: profile?.pages_limit ?? appMeta.pages_limit ?? 500,
    },
  });
});

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

  try {
    const authRes = await fetch(
      `${process.env.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_SERVICE_KEY,
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      }
    );
    const authData = await authRes.json();
    if (!authRes.ok || authData.error) {
      return res.status(401).json({ error: 'Session expired, please log in again' });
    }
    res.json({
      token: authData.access_token,
      refreshToken: authData.refresh_token,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Authentication service error' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  let profile = null;
  try {
    const profiles = await restGet(
      `user_profiles?id=eq.${req.user.id}&select=*`
    );
    profile = Array.isArray(profiles) ? profiles[0] : null;
  } catch (e) {
    console.warn('Profile REST fetch failed:', e.message);
  }

  // Get fresh pages from user_profiles (source of truth — atomically updated)
  const freshPagesUsed  = profile?.pages_used  ?? req.user.pagesUsed;
  const freshPagesLimit = profile?.pages_limit ?? req.user.pagesLimit;

  res.json({
    id: req.user.id,
    email: req.user.email,
    fullName: profile?.full_name || req.user.fullName || '',
    role: req.user.role,
    plan: req.user.plan,
    pagesUsed: freshPagesUsed,
    pagesLimit: freshPagesLimit,
  });
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', requireAuth, async (req, res) => {
  res.json({ message: 'Logged out' });
});

// ─── Admin: list all users ────────────────────────────────────────────────────
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Try user_profiles table first
    const data = await restGet(
      'user_profiles?select=*&order=created_at.desc'
    );
    if (Array.isArray(data)) {
      return res.json(data);
    }

    // Fallback: user_profiles table may not exist — fetch from Supabase Auth directly
    console.warn('user_profiles table unavailable, falling back to Supabase Auth');
    const { data: authData, error: authErr } = await supabase.auth.admin.listUsers();
    if (authErr) throw authErr;

    const users = (authData?.users || []).map((u) => {
      const meta = u.app_metadata || {};
      return {
        id: u.id,
        email: u.email,
        full_name: meta.full_name || u.user_metadata?.full_name || '',
        role: meta.role || 'user',
        plan: meta.plan || 'free',
        pages_used: meta.pages_used || 0,
        pages_limit: meta.pages_limit || 500,
        created_at: u.created_at,
      };
    });
    res.json(users);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Admin: create a new user ─────────────────────────────────────────────────
router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { email, password, fullName } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  // Sanitize role, plan, and pagesLimit to prevent privilege escalation
  const role = VALID_ROLES.includes(req.body.role) ? req.body.role : 'user';
  const plan = VALID_PLANS.includes(req.body.plan) ? req.body.plan : 'free';
  const pagesLimit = Math.max(1, Math.min(99999, parseInt(req.body.pagesLimit) || 500));

  // Create in Supabase Auth (include app_metadata so JWT carries role/plan)
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role, plan, pages_limit: pagesLimit },
  });

  if (error) return res.status(400).json({ error: error.message });

  // Create profile via REST API (non-fatal if user_profiles table doesn't exist)
  try {
    await restPost('user_profiles', {
      id: data.user.id,
      email,
      full_name: fullName || '',
      role,
      plan,
      pages_limit: pagesLimit,
      pages_used: 0,
    });
  } catch (profileErr) {
    console.warn('Profile creation failed (table may not exist):', profileErr.message);
    // User is still created in Supabase Auth with app_metadata — this is fine
  }

  res.json({ message: 'User created', userId: data.user.id });
});

// ─── Admin: update user (role, plan, limit, deactivate) ──────────────────────
router.patch('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  if (!isValidUUID(req.params.id)) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }
  const { fullName, active } = req.body;
  // Sanitize role/plan/pagesLimit/pagesUsed
  const role = req.body.role !== undefined && VALID_ROLES.includes(req.body.role) ? req.body.role : undefined;
  const plan = req.body.plan !== undefined && VALID_PLANS.includes(req.body.plan) ? req.body.plan : undefined;
  const pagesLimit = req.body.pagesLimit !== undefined ? Math.max(1, Math.min(99999, parseInt(req.body.pagesLimit) || 500)) : undefined;
  const pagesUsed = req.body.pagesUsed !== undefined ? Math.max(0, parseInt(req.body.pagesUsed) || 0) : undefined;

  const profileUpdates = {};
  if (fullName !== undefined)   profileUpdates.full_name = fullName;
  if (role !== undefined)       profileUpdates.role = role;
  if (plan !== undefined)       profileUpdates.plan = plan;
  if (pagesLimit !== undefined) profileUpdates.pages_limit = pagesLimit;
  if (pagesUsed !== undefined)  profileUpdates.pages_used = pagesUsed;

  if (Object.keys(profileUpdates).length > 0) {
    try {
      await restPatch(`user_profiles?id=eq.${req.params.id}`, profileUpdates);
    } catch (err) {
      console.warn('Profile update failed (table may not exist):', err.message);
      // Non-fatal — app_metadata sync below is the primary source of truth
    }
  }

  // Sync app_metadata in Supabase Auth so JWT stays up-to-date
  const metaUpdates = {};
  if (role !== undefined) metaUpdates.role = role;
  if (plan !== undefined) metaUpdates.plan = plan;
  if (pagesLimit !== undefined) metaUpdates.pages_limit = pagesLimit;

  if (Object.keys(metaUpdates).length > 0) {
    await supabase.auth.admin.updateUserById(req.params.id, { app_metadata: metaUpdates });
  }

  // Ban/unban user in Auth
  if (active === false) {
    await supabase.auth.admin.updateUserById(req.params.id, { ban_duration: '87600h' });
  } else if (active === true) {
    await supabase.auth.admin.updateUserById(req.params.id, { ban_duration: 'none' });
  }

  res.json({ message: 'User updated' });
});

// ─── Admin: delete user ───────────────────────────────────────────────────────
router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  if (!isValidUUID(req.params.id)) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }
  try {
    // Try to delete profile (non-fatal if table doesn't exist)
    try { await restDelete(`user_profiles?id=eq.${req.params.id}`); } catch {}
    await supabase.auth.admin.deleteUser(req.params.id);
    res.json({ message: 'User deleted' });
  } catch (err) {
    console.error('Error deleting user:', err.message);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ─── Admin: usage stats ───────────────────────────────────────────────────────
router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await restGet('user_profiles?select=*');

    const { data: jobs } = await supabase
      .from('jobs')
      .select('status, created_at')
      .order('created_at', { ascending: false })
      .limit(200);

    res.json({
      totalUsers: Array.isArray(users) ? users.length : 0,
      totalJobs: jobs?.length || 0,
      completedJobs: jobs?.filter(j => j.status === 'completed').length || 0,
      failedJobs: jobs?.filter(j => j.status === 'failed').length || 0,
      users: Array.isArray(users) ? users : [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
