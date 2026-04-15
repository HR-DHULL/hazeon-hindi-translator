# Stage 1: Build React frontend
FROM node:20-slim AS builder
WORKDIR /app
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci
COPY client/ ./client/
RUN cd client && npm run build

# Stage 2: Production runtime
FROM node:20-slim
WORKDIR /app

# Install only production server dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built frontend from builder stage
COPY --from=builder /app/client/dist ./client/dist

# Copy server code
COPY server/ ./server/

# Create required directories
RUN mkdir -p uploads/output

EXPOSE 3001
ENV NODE_ENV=production
ENV PORT=3001

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/index.js"]
