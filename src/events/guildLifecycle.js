const { Events, ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const store = require('../database/store');
const { base } = require('../utils/embed');
const retention = require('../database/retention');
const log = require('../utils/logger');

async function sendWelcome(guild) {
  try {
    if (store.getConfig(guild.id, 'welcomed_at')) return;
    const client = guild.client;
    const hasQuick = !!client.commands?.has('quicksetup');
    const steps = [
      hasQuick ? '**`/quicksetup`**: pick sensible defaults for logs, welcome and moderation in one go.' : '**`/setup`**: configure logs, welcome and moderation.',
      '**`/migrate scan`**: see which other bots and channels Sonder can reuse. It changes nothing.',
      'Say **`sonder what can you do`** in chat and ask me anything.',
    ];
    const embed = base(client)
      .setTitle('Thanks for adding Sonder')
      .setDescription('Three steps to get going:\n\n' + steps.map((t, i) => `**${i + 1}.** ${t}`).join('\n'));
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('sonder.gg').setURL('https://sonder.gg'),
    );
    const payload = { embeds: [embed], components: [row] };

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
