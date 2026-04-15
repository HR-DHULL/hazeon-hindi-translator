FROM node:20-slim
WORKDIR /app

# Install server dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Install client dependencies and build frontend
COPY client/ ./client/
RUN cd client && npm install && npm run build && rm -rf node_modules

# Copy server code
COPY server/ ./server/

# Create required directories
RUN mkdir -p uploads/output

EXPOSE 3001
ENV NODE_ENV=production
ENV PORT=3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/index.js"]
