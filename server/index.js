process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
    console.warn('Ignored pipe error:', err.code);
    return;
  }
  console.error('Uncaught exception:', err);
  process.exit(1);
});

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import translateRouter from './routes/translate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure upload and output directories exist
const uploadsDir = path.join(__dirname, 'uploads');
const outputDir = path.join(uploadsDir, 'output');
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());

// Make io accessible to routes
app.set('io', io);

// Serve uploaded/output files
app.use('/api/files', express.static(path.join(__dirname, 'uploads', 'output')));

// API routes
app.use('/api/translate', translateRouter);

// Serve React build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'client', 'dist', 'index.html'));
  });
}

// Socket.IO connection
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n  UPSC Hindi Translator Server running on http://localhost:${PORT}`);
  console.log(`  Socket.IO ready for real-time updates`);
  console.log(`  Translation engine: Google Translate (EN -> HI Devanagari)\n`);
});

export { io };
