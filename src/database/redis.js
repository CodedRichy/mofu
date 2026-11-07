const Redis = require('ioredis');
const config = require('../config');
const log = require('../utils/logger');

let redis = null;

// Redis is optional: without REDIS_URL, skip it entirely (no connection attempts, no boot-time warning).
try {
  if (!process.env.REDIS_URL) throw new Error('not configured');
  redis = new Redis(config.redis.url, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    retryStrategy(times) {
      if (times > 3) return null;
      return Math.min(times * 200, 2000);
    },
  });

  // ioredis emits 'error' on every retry attempt; warn once per outage
  // instead of once per attempt.
  let warned = false;
  redis.on('connect', () => {
    warned = false;
    log.info('Redis connected');
  });
  redis.on('error', (err) => {
    if (warned) return;
    warned = true;
    log.warn('Redis unavailable — running without cache:', err.message);
  });
  redis.connect().catch(() => {});
} catch {
  redis = null;
}

module.exports = redis;
