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
const { YoutubeiExtractor } = require('discord-player-youtubei');

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
player.extractors.register(YoutubeiExtractor, {}).catch((err) => log.warn('YouTube extractor failed:', err.message));

player.events.on('error', (queue, err) => log.error(`Player error [${queue.guild.name}]:`, err.message));
player.events.on('playerError', (queue, err) => log.error(`Track error [${queue.guild.name}]:`, err.message));
player.events.on('disconnect', (queue) => queue.delete());
player.events.on('emptyChannel', (queue) => queue.delete());

// Start
async function start() {
  try {
    try {
      await db.connect();
    } catch (err) {
      log.warn('PostgreSQL unavailable — running without database:', err.message);
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
process.on('unhandledRejection', (err) => {
  log.error('Unhandled rejection:', err?.message || err);
});
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception:', err.message);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  log.info('Shutting down...');
  client.destroy();
  await db.disconnect();
  redis?.disconnect();
  process.exit(0);
});

start();
