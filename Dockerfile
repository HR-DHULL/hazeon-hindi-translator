FROM node:20-slim

WORKDIR /app

# Install dependencies for both server and client
COPY package.json package-lock.json* ./
RUN npm install --omit=dev 2>/dev/null || npm install

# Build React frontend
COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm install

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
