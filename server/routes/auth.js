import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
// Public: exchange email+password for a session token
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Fetch profile
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', data.user.id)
    .single();

  res.json({
    token: data.session.access_token,
    user: {
      id: data.user.id,
      email: data.user.email,
      fullName: profile?.full_name || '',
      role: profile?.role || 'user',
      plan: profile?.plan || 'free',
      pagesUsed: profile?.pages_used || 0,
      pagesLimit: profile?.pages_limit || 500,
    },
  });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
// Get current user info
router.get('/me', requireAuth, async (req, res) => {
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', req.user.id)
    .single();

  res.json({
    id: req.user.id,
    email: req.user.email,
    fullName: profile?.full_name || '',
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
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
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

  // Create profile
  const { error: profileErr } = await supabase.from('user_profiles').insert({
    id: data.user.id,
    email,
    full_name: fullName || '',
    role,
    plan,
    pages_limit: pagesLimit,
  });

  if (profileErr) return res.status(500).json({ error: profileErr.message });

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
    const { error } = await supabase
      .from('user_profiles')
      .update(profileUpdates)
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
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
  await supabase.from('user_profiles').delete().eq('id', req.params.id);
  await supabase.auth.admin.deleteUser(req.params.id);
  res.json({ message: 'User deleted' });
});

// ─── Admin: usage stats ───────────────────────────────────────────────────────
router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  const { data: users } = await supabase.from('user_profiles').select('*');
  const { data: jobs } = await supabase
    .from('jobs')
    .select('status, user_id, created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  res.json({
    totalUsers: users?.length || 0,
    totalJobs: jobs?.length || 0,
    completedJobs: jobs?.filter(j => j.status === 'completed').length || 0,
    failedJobs: jobs?.filter(j => j.status === 'failed').length || 0,
    users: users || [],
  });
});

export default router;
