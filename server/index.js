import 'dotenv/config';

// ── Validate required environment variables at startup ─────────────────────
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  if (process.env.NODE_ENV === 'production') {
    console.error(`FATAL: Missing required environment variables: ${missing.join(', ')}`);
    console.error('Set these in your .env file or hosting provider before starting the server.');
    process.exit(1);
  }
  console.warn(`\n  ⚠ WARNING: Missing env vars: ${missing.join(', ')}`);
  console.warn('  Create a .env file from .env.example and add your Supabase credentials.');
  console.warn('  The server will start but API calls will fail until configured.\n');
}

process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE' || err.code === 'ECONNRESET') return;
  console.error('Uncaught exception:', err);
  process.exit(1);
});

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import translateRouter from './routes/translate.js';
import authRouter from './routes/auth.js';

let __dirname = '/app';
try { __dirname = path.dirname(fileURLToPath(import.meta.url)); } catch {}

// Ensure upload dirs exist locally (Vercel uses /tmp instead)
if (process.env.NODE_ENV !== 'production') {
  const uploadsDir = path.join(__dirname, 'uploads');
  fs.mkdirSync(path.join(uploadsDir, 'output'), { recursive: true });
}

const app = express();

// ── CORS: restrict to allowed origins (default: allow all in dev) ──────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : null;

app.use(cors({
  origin: allowedOrigins
    ? function (origin, cb) {
        // Allow server-to-server (no origin) or whitelisted origins
        if (!origin || allowedOrigins.includes(origin)) cb(null, true);
        else cb(new Error('Not allowed by CORS'));
      }
    : '*', // dev fallback when ALLOWED_ORIGINS is not set
  credentials: !!allowedOrigins,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: false }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    configured: missing.length === 0,
    missing: missing.length > 0 ? missing : undefined,
  });
});

// Block API calls early if Supabase is not configured
if (missing.length > 0) {
  app.use('/api', (req, res) => {
    res.status(503).json({
      error: `Server not configured. Missing environment variables: ${missing.join(', ')}. Create a .env file from .env.example with your Supabase credentials.`,
    });
  });
} else {
  // ── One-time DB setup: ensure user_profiles table exists ───────────────
  import('./services/dbSetup.js')
    .then((m) => m.ensureTables())
    .catch((err) => console.warn('DB auto-setup skipped:', err.message));

  app.use('/api/auth', authRouter);
  app.use('/api/translate', translateRouter);
}

// Serve React build in local production mode
if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) {
  app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'client', 'dist', 'index.html'));
  });
}

// Only start a listening server in local development — not in Netlify/Vercel serverless
if (!process.env.NETLIFY && !process.env.VERCEL && !process.env.NETLIFY_DEV) {
  const PORT = process.env.PORT || 3001;
  const engine = `Claude AI (${process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001'})`;
  app.listen(PORT, () => {
    console.log(`\n  UPSC Hindi Translator running on http://localhost:${PORT}`);
    console.log(`  Translation engine: ${engine}\n`);
  });
}

export default app;
