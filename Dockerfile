FROM node:22-slim

# ffmpeg for music; python3/make/g++ only to compile better-sqlite3 if no prebuilt binary matches
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ src/
COPY shard.js ./
COPY .env.example .env.example

# data/ holds the SQLite database, logs/ the command telemetry. Mount both as volumes.
RUN mkdir -p data logs && chown -R node:node /app
USER node

VOLUME ["/app/data", "/app/logs"]
EXPOSE 3001
ENV NODE_ENV=production PYTHONUTF8=1

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
