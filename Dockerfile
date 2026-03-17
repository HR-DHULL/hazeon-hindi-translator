FROM node:20-slim

WORKDIR /app

# Install dependencies for server (use ci for reproducible builds)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Build React frontend
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci

COPY client/ ./client/
RUN cd client && npm run build

# Copy server code
COPY server/ ./server/
COPY api/ ./api/

# Ensure uploads dir exists at runtime
RUN mkdir -p uploads/output

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

CMD ["node", "server/index.js"]
