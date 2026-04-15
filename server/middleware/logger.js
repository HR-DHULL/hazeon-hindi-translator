/**
 * Request logging middleware.
 * Logs: timestamp | userId | method | path | status | duration_ms
 * Output goes to stdout (Render captures it in dashboard logs).
 */
export function requestLogger(req, res, next) {
  // Skip logging for health checks and static files
  if (req.path === '/api/health' || !req.path.startsWith('/api/')) {
    return next();
  }

  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const userId = req.user?.id?.slice(0, 8) || 'anon';
    const status = res.statusCode;
    const method = req.method;
    const path = req.path;

    // Compact log format
    console.log(`  [API] ${method} ${path} ${status} ${duration}ms user:${userId}`);
  });

  next();
}
