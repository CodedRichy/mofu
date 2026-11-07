const { Client, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const log = require('./utils/logger');
const db = require('./database/postgres');
const redis = require('./database/redis');
const { loadCommands } = require('./handlers/commandHandler');
const { startDashboard } = require('./dashboard/server');
const { Player } = require('discord-player');
const { DefaultExtractors } = require('@discord-player/extractor');
const { YoutubeExtractor } = require('discord-player-youtubei');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.GuildMember],
  // user-authored text (autoresponders, custom commands, prizes, reminders) can never ping @everyone/@here/roles by default
  allowedMentions: { parse: ['users'], repliedUser: false },
});

// Load events
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'));

for (const file of eventFiles) {
  const event = require(path.join(eventsPath, file));
  const events = Array.isArray(event) ? event : [event];
  for (const e of events) {
    if (e.once) {
      client.once(e.name, async (...args) => {
        try {
          await e.execute(...args);
        } catch (error) {
          log.error(`Event ${e.name} error:`, error);
        }
      });
    } else {
      client.on(e.name, async (...args) => {
        try {
          await e.execute(...args);
        } catch (error) {
          log.error(`Event ${e.name} error:`, error);
        }
      });
    }
  }
}

// Load commands
loadCommands(client);

// Music player
// (ytdlOptions was a discord-player v5 option; v7 ignores it, so it is gone.
// YouTube stream tuning lives in the YoutubeiExtractor options below.)
const player = new Player(client, {
  skipFFmpeg: false,
});
player.extractors.loadMulti(DefaultExtractors).catch((err) => log.warn('Music extractors failed:', err.message));
player.extractors.register(YoutubeExtractor, {}).catch((err) => log.warn('YouTube extractor failed:', err.message));

player.events.on('error', (queue, err) => log.error(`Player error [${queue.guild.name}]:`, err.message));
player.events.on('playerError', (queue, err) => log.error(`Track error [${queue.guild.name}]:`, err.message));
player.events.on('disconnect', (queue) => queue.delete());
player.events.on('emptyChannel', (queue) => queue.delete());
const musicCard = require('./music/card');
player.events.on('playerStart', (queue) => musicCard.start(queue));
player.events.on('emptyQueue', (queue) => musicCard.clear(queue.guild.id, 'Record stopped. Queue finished.', client));
player.events.on('disconnect', (queue) => musicCard.clear(queue.guild.id, 'Record stopped.', client));
player.events.on('emptyChannel', (queue) => musicCard.clear(queue.guild.id, 'Record stopped.', client));

// Start
async function start() {
  try {
    // PostgreSQL is optional: only try it when a URL is configured, so a normal SQLite-only boot logs no warning.
    if (config.database.url) {
      try {
        await db.connect();
      } catch (err) {
        log.warn('PostgreSQL unavailable, running without it:', err.message || err.code || 'connection failed');
      }
    }

    log.info('Starting bot...');
    await client.login(config.discord.token);
    startDashboard(client);
  } catch (err) {
    log.error('Failed to start:', err.message);
    process.exit(1);
  }
}

// Global error handlers
// Log the stack, not just the message: "Cannot read properties of undefined" alone is unfindable after the fact.
process.on('unhandledRejection', (err) => {
  log.error('Unhandled rejection:', err?.stack || err?.message || err);
});
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception:', err?.stack || err?.message || err);
  process.exit(1);
});

// Gateway problems: without listeners an 'error' event becomes an uncaught exception and restarts the whole bot.
client.on('error', (err) => log.error('Client error:', err?.stack || err?.message || err));
client.on('warn', (msg) => log.warn('Client warning:', msg));
client.on('shardDisconnect', (ev, id) => log.warn(`Shard ${id} disconnected (code ${ev?.code}); discord.js will reconnect`));
client.on('shardReconnecting', (id) => log.info(`Shard ${id} reconnecting`));
client.on('shardResume', (id, replayed) => log.info(`Shard ${id} resumed (${replayed} events replayed)`));

// Graceful shutdown. docker stop sends SIGTERM (PID 1 ignores signals it has no handler for, then gets SIGKILLed
// after 10s), so handle both: leave voice cleanly, close Discord, checkpoint SQLite, then exit.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} received, shutting down...`);
  const force = setTimeout(() => process.exit(1), 15000); // never hang forever
  force.unref();
  try { await player.destroy(); } catch { /* best effort */ }
  try { client.destroy(); } catch { /* best effort */ }
  try { await db.disconnect(); } catch { /* optional postgres */ }
  try { redis?.disconnect(); } catch { /* optional redis */ }
  try { require('./database/store').close?.(); } catch { /* store may not expose close */ }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
