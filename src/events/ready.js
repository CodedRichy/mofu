const { Events, ActivityType } = require('discord.js');
const log = require('../utils/logger');
const { registerCommands } = require('../handlers/commandHandler');
const giveawayDb = require('../database/giveaway');
const { setLongTimeout } = require('../utils/longTimeout');
const { response } = require('../utils/embed');
const { colors } = require('../utils/constants');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    log.info(`Logged in as ${client.user.tag}`);
    log.info(`Serving ${client.guilds.cache.size} servers`);
    client.user.setPresence({
      status: 'online',
      activities: [{ type: ActivityType.Custom, name: 'custom', state: 'sonder.gg · /help' }],
    });
    // A failed registration (429, bad id, network) must not stop the rest of startup.
    try {
      await registerCommands(client);
    } catch (err) {
      log.error('Slash command registration failed:', err?.message || err);
    }
    restoreGiveaways(client);
    require('../database/reminders').startSweep(client);
    require('../utils/announceUpdate').announceUpdate(client);

    // Enforce the data-retention promise: purge servers that removed the bot over 30 days ago.
    const retention = require('../database/retention');
    retention.sweep(client);
    setInterval(() => retention.sweep(client), 6 * 60 * 60 * 1000).unref();
  },
};

function restoreGiveaways(client) {
  const active = giveawayDb.getAllActive();
  let restored = 0;

  for (const gw of active) {
    const remaining = gw.endsAt - Date.now();
    if (remaining <= 0) {
      endGiveaway(client, gw);
    } else {
      setLongTimeout(() => endGiveaway(client, gw), remaining);
      restored++;
    }
  }

  if (restored > 0) log.info(`Restored ${restored} giveaway timer(s)`);
}

async function endGiveaway(client, gw) {
  const ended = giveawayDb.end(gw.guildId, gw.messageId);
  if (!ended) return;

  const guild = client.guilds.cache.get(gw.guildId);
  if (!guild) return;

  const channel = guild.channels.cache.get(gw.channelId);
  if (!channel) return;

  const winners = giveawayDb.pickWinners(ended, ended.winnerCount || 1);
  const winnerText = winners.length ? winners.map((id) => `<@${id}>`).join(', ') : 'No valid entries';

  const msg = await channel.messages.fetch(gw.messageId).catch(() => null);
  if (msg) {
    await msg.edit({
      embeds: [response({ client, description: `**🎉 Giveaway Ended**\n\n**Prize:** ${ended.prize}\n**Winner(s):** ${winnerText}`, color: colors.primary })],
      components: [],
    }).catch(() => {});
  }

  channel.send({ content: `🎉 Congratulations ${winnerText}! You won **${ended.prize}**!`, allowedMentions: { users: winners } }).catch(() => {});
}
