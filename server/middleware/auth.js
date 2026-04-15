// JWT verification cache - 5 minute TTL to reduce Supabase API calls
const tokenCache = new Map();
const TOKEN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedUser(token) {
  const key = token.slice(0, 32);
  const cached = tokenCache.get(key);
  if (cached && Date.now() < cached.expires) return cached.user;
  if (cached) tokenCache.delete(key);
  return null;
}

function setCachedUser(token, user) {
  const key = token.slice(0, 32);
  tokenCache.set(key, { user, expires: Date.now() + TOKEN_CACHE_TTL });
  // Evict old entries if cache grows too large
  if (tokenCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of tokenCache) {
      if (now >= v.expires) tokenCache.delete(k);
    }
  }
}

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

  const cachedUser = getCachedUser(token);
  if (cachedUser) {
    req.user = cachedUser;
    return next();
  }

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

    // Use profile (source of truth for pages_used) with app_metadata fallback for role/plan.
    // For page limits: profile is authoritative — if missing, use app_metadata,
    // but default pagesUsed to pagesLimit (block) instead of 0 (allow-all) to be safe.
    const fallbackLimit = appMeta.pages_limit ?? 500;
    req.user = {
      id: user.id,
      email: user.email,
      fullName: profile?.full_name || '',
      role:       profile?.role        ?? appMeta.role       ?? 'user',
      plan:       profile?.plan        ?? appMeta.plan       ?? 'free',
      pagesUsed:  profile?.pages_used  ?? appMeta.pages_used ?? fallbackLimit,
      pagesLimit: profile?.pages_limit ?? fallbackLimit,
    };

    setCachedUser(token, req.user);
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
