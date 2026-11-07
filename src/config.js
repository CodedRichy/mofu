const dotenv = require('dotenv');
dotenv.config();

// Never fall back to a well-known secret in production.
function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set when NODE_ENV=production (generate one with: openssl rand -hex 32)');
  }
  console.warn('[config] SESSION_SECRET is not set; using an insecure development default. Set it before deploying.');
  return 'sonder-dev-secret';
}

module.exports = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    defaultPrefix: ';',
  },
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  lastfm: {
    apiKey: process.env.LASTFM_API_KEY,
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY,
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
  },
  dashboard: {
    port: parseInt(process.env.DASHBOARD_PORT) || 3001,
    secret: sessionSecret(),
    callbackUrl: process.env.DASHBOARD_CALLBACK_URL || 'http://localhost:3000/auth/callback',
  },
};
