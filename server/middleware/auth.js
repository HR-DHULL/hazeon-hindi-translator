function restHeaders(token) {
  return {
    'Content-Type': 'application/json',
    'apikey': process.env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${token || process.env.SUPABASE_SERVICE_KEY}`,
  };
}

/**
 * Middleware: verify Supabase JWT and attach user to req.
 * Uses REST API directly — reliable in both Node.js and Netlify serverless.
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.slice(7);

  try {
    // Verify token via Supabase Auth REST API
    const authRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${token}`,
      },
    });
    const user = await authRes.json();

    if (!authRes.ok || !user.id) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    // Fetch profile via REST API
    let profile = null;
    try {
      const r = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/user_profiles?id=eq.${user.id}&select=role,plan,pages_used,pages_limit,full_name`,
        { headers: restHeaders() }
      );
      const rows = await r.json();
      profile = Array.isArray(rows) ? rows[0] : null;
    } catch (e) {
      console.warn('Profile REST fetch failed in middleware:', e.message);
    }

    const appMeta = user.app_metadata || {};

    req.user = {
      id: user.id,
      email: user.email,
      fullName: profile?.full_name || '',
      role:       profile?.role       ?? appMeta.role       ?? 'user',
      plan:       profile?.plan       ?? appMeta.plan       ?? 'free',
      pagesUsed:  profile?.pages_used ?? 0,
      pagesLimit: profile?.pages_limit ?? appMeta.pages_limit ?? 500,
    };

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

/**
 * Middleware: require admin role (use after requireAuth).
 */
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
