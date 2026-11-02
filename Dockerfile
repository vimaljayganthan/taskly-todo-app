# ==============================================================================
# Production Dockerfile for Taskly
# Optimized for Google Cloud Run (Distroless/Alpine, non-root, fast startup)
# ==============================================================================

FROM node:20-alpine AS production

# Set working directory
WORKDIR /app

# Set production environment flags
ENV NODE_ENV=production
ENV PORT=8080

# Install dependencies first for optimal Docker layer caching
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source files
COPY server.js ./
COPY public/ ./public/
COPY storage/ ./storage/
COPY scripts/ ./scripts/

# Ensure runtime data directory exists with correct permissions for the non-root node user
RUN mkdir -p /app/data && chown -R node:node /app

# Run as non-root user for container security compliance
USER node

# Expose standard Cloud Run port
EXPOSE 8080

# Container liveness check probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/healthz').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the production server
CMD ["node", "server.js"]
