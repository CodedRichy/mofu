const { Events, ChannelType, PermissionFlagsBits } = require('discord.js');
const store = require('../database/store');
const { base } = require('../utils/embed');
const { BRAND } = require('../utils/constants');
const retention = require('../database/retention');
const log = require('../utils/logger');

async function sendWelcome(guild) {
  try {
    if (store.getConfig(guild.id, 'welcomed_at')) return;
    const client = guild.client;
    const hasQuick = !!client.commands?.has('quicksetup');
    const steps = [
      hasQuick ? '**`/quicksetup`**: pick sensible defaults for logs, welcome and moderation in one go.' : '**`/setup`**: configure logs, welcome and moderation.',
      `**\`/migrate scan\`**: see which other bots and channels ${BRAND} can reuse. It changes nothing.`,
      `Admins can say **\`${BRAND} what can you do\`** in chat. Until you pick roles with \`/airoles\`, members with Manage Messages can too.`,
    ];
    const embed = base(client)
      .setTitle(`Thanks for adding ${BRAND}`)
      .setDescription('Three steps to get going:\n\n' + steps.map((t, i) => `**${i + 1}.** ${t}`).join('\n'));
    // Add a link button here once a real support-server invite or domain exists.
    const payload = { embeds: [embed] };

    const me = guild.members.me;
    const canSend = (ch) => ch && ch.type === ChannelType.GuildText && me
      && ch.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
    const channel = canSend(guild.systemChannel) ? guild.systemChannel : guild.channels.cache.find(canSend);

    let sent = false;
    if (channel) sent = await channel.send(payload).then(() => true).catch(() => false);
    if (!sent) {
      const owner = await guild.fetchOwner().catch(() => null);
      sent = !!owner && await owner.send(payload).then(() => true).catch(() => false);
    }
    // Only mark welcomed once delivered, so a failed first attempt can retry on a rejoin.
    if (sent) store.setConfig(guild.id, 'welcomed_at', Date.now());
  } catch (err) {
    log.warn(`Welcome message failed for ${guild?.id}:`, err.message);
  }
}

// Starts / cancels the 30-day data-retention clock described in the privacy policy.
module.exports = [
  {
    name: Events.GuildDelete,
    execute(guild) {
      if (!guild.available) return; // an outage, not a removal
      retention.markLeft(guild.id);
      log.info(`Removed from ${guild.name || guild.id}; data scheduled for deletion in ${retention.RETENTION_DAYS} days`);
    },
  },
  {
    name: Events.GuildCreate,
    async execute(guild) {
      retention.markReturned(guild.id);
      await sendWelcome(guild);
    },
  },
];
