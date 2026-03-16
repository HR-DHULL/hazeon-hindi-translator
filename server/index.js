import 'dotenv/config';

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

// Works in both native ESM and esbuild CJS bundle
let _dirname;
try {
  _dirname = path.dirname(fileURLToPath(import.meta.url));
} catch {
  _dirname = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
}

// Ensure upload dirs exist locally (Vercel uses /tmp instead)
if (process.env.NODE_ENV !== 'production') {
  const uploadsDir = path.join(_dirname, 'uploads');
  fs.mkdirSync(path.join(uploadsDir, 'output'), { recursive: true });
}

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

app.use('/api/translate', translateRouter);

// Serve React build in local production mode
if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) {
  app.use(express.static(path.join(_dirname, '..', 'client', 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(_dirname, '..', 'client', 'dist', 'index.html'));
  });
}

// Only listen when running as a standalone server (not serverless)
if (!process.env.NETLIFY && !process.env.VERCEL) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`\n  UPSC Hindi Translator running on http://localhost:${PORT}`);
    console.log(`  Translation engine: Google Translate (EN -> HI Devanagari)\n`);
  });
}

export default app;
