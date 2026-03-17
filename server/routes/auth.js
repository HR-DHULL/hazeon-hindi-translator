import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
  return r.json();
}

async function restPatch(path, body) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...restHeaders(), 'Prefer': 'return=representation' },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function restDelete(path) {
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: restHeaders(),
  });
}

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
// Uses Supabase Auth REST API directly — more reliable than the JS client in serverless
router.post('/login', async (req, res) => {
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
      pagesUsed:  profile?.pages_used ?? 0,
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

  res.json({
    id: req.user.id,
    email: req.user.email,
    fullName: profile?.full_name || req.user.fullName || '',
    role: req.user.role,
    plan: req.user.plan,
    pagesUsed: req.user.pagesUsed,
    pagesLimit: req.user.pagesLimit,
  });
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', requireAuth, async (req, res) => {
  res.json({ message: 'Logged out' });
});

// ─── Admin: list all users ────────────────────────────────────────────────────
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const data = await restGet(
      'user_profiles?select=*&order=created_at.desc'
    );
    if (!Array.isArray(data)) {
      console.error('user_profiles REST returned non-array:', data);
      return res.status(500).json({ error: 'Failed to fetch users' });
    }
    res.json(data);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Admin: create a new user ─────────────────────────────────────────────────
router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { email, password, fullName, role = 'user', plan = 'free', pagesLimit = 500 } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // Create in Supabase Auth
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) return res.status(400).json({ error: error.message });

  // Create profile via REST API
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
    console.error('Profile creation failed:', profileErr);
    return res.status(500).json({ error: 'User created but profile setup failed' });
  }

  res.json({ message: 'User created', userId: data.user.id });
});

// ─── Admin: update user (role, plan, limit, deactivate) ──────────────────────
router.patch('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { fullName, role, plan, pagesLimit, active } = req.body;

  const profileUpdates = {};
  if (fullName !== undefined)   profileUpdates.full_name = fullName;
  if (role !== undefined)       profileUpdates.role = role;
  if (plan !== undefined)       profileUpdates.plan = plan;
  if (pagesLimit !== undefined) profileUpdates.pages_limit = pagesLimit;

  if (Object.keys(profileUpdates).length > 0) {
    try {
      await restPatch(`user_profiles?id=eq.${req.params.id}`, profileUpdates);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
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
  await restDelete(`user_profiles?id=eq.${req.params.id}`);
  await supabase.auth.admin.deleteUser(req.params.id);
  res.json({ message: 'User deleted' });
});

// ─── Admin: usage stats ───────────────────────────────────────────────────────
router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await restGet('user_profiles?select=*');

    const { data: jobs } = await supabase
      .from('jobs')
      .select('status, user_id, created_at')
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
