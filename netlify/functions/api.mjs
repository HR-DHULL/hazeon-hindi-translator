import 'dotenv/config';
import serverless from 'serverless-http';
import app from '../../server/index.js';

export const handler = serverless(app, {
  binary: [
    'application/octet-stream',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/pdf',
  ],
});
