const { EmbedBuilder, Collection, ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const log = require('../utils/logger');
const { track } = require('../utils/commandTracker');
const { colors } = require('../utils/constants');
const { response, base, footer, errorCard, refId, permissionDenied } = require('../utils/embed');

const TICKET_DELETE_MS = 5000;
const config = require('../config');
const store = require('../database/store');
const giveawayDb = require('../database/giveaway');

const cooldowns = new Collection();
const ticketLocks = new Set();

const categoryEmojis = {
  moderation: '🛡️',
  utility: '🔧',
  economy: '💰',
  leveling: '📊',
  music: '🎵',
  fun: '🎮',
};

const PROCESS_START = Date.now();

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (interaction.isStringSelectMenu() && interaction.customId === 'help_category') {
      // A fresh /help message is owned by its own collector in help.js (it also offers the per-command menu).
      // This global handler only serves menus the collector can no longer see: older than 2 minutes, or from before a restart.
      const msg = interaction.message;
      if (msg && msg.createdTimestamp > PROCESS_START && Date.now() - msg.createdTimestamp < 120_000) return;
      const category = interaction.values[0];
      const prefix = store.getConfig(interaction.guild?.id, 'prefix') || config.discord.defaultPrefix;
      // Commands are tagged with their category at load time, so no disk I/O here.
      const inCategory = interaction.client.commands.filter((cmd) => cmd.category === category);
      if (!inCategory.size) return;

      const emoji = categoryEmojis[category] || '📁';

      const lines = inCategory.map((cmd) => `**\`${prefix}${cmd.data.name}\`** — ${cmd.data.description}`);

      let desc = lines.join('\n');
      if (desc.length > 4096) desc = `${desc.slice(0, 4040)}\n...list cut off at Discord's embed limit`;
      const embed = base(interaction.client, colors.primary)
        .setTitle(`${emoji} ${category.charAt(0).toUpperCase() + category.slice(1)}`)
        .setDescription(desc)
        .setFooter(footer(interaction.client, `${lines.length} commands`));

      await interaction.update({ embeds: [embed] });
      return;
    }

    // Role panel dropdowns (`rp:<panel>`). Stored in the database, so they keep working after a restart.
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('rp:')) {
      try {
        await require('../handlers/rolepanel').handleSelect(interaction);
      } catch (err) {
        log.error(`Select ${interaction.customId} failed:`, err?.stack || err?.message || err);
        const reply = { embeds: [response({ client: interaction.client, description: 'Something went wrong. Try again in a moment.', color: colors.error })], ephemeral: true };
        if (interaction.replied || interaction.deferred) await interaction.editReply(reply).catch(() => {});
        else await interaction.reply(reply).catch(() => {});
      }
      return;
    }

    // Autocomplete for commands that export autocomplete(interaction) (e.g. /tag names). Never throws.
    if (interaction.isAutocomplete()) {
      const cmd = interaction.client.commands.get(interaction.commandName);
      if (cmd?.autocomplete && interaction.guild) {
        try { await cmd.autocomplete(interaction); } catch { await interaction.respond([]).catch(() => {}); }
      }
      return;
    }

    if (interaction.isButton()) {
      try {
        await handleButton(interaction);
      } catch (err) {
        log.error(`Button ${interaction.customId} failed:`, err?.stack || err?.message || err);
        const reply = { embeds: [response({ client: interaction.client, description: 'Something went wrong. Try again in a moment.', color: colors.error })], ephemeral: true };
        if (interaction.replied || interaction.deferred) await interaction.editReply(reply).catch(() => {});
        else await interaction.reply(reply).catch(() => {});
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;

    // Slash commands are written for servers; refuse cleanly in DMs instead of throwing on interaction.guild.
    if (!interaction.guild) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'This command only works in servers.', color: colors.error })], ephemeral: true });
    }

    // Enforce required permissions in code. Discord applies default_member_permissions itself, but a server
    // admin can override that per command in Server Settings > Integrations, so never rely on it alone.
    const requiredPerms = command.data.default_member_permissions;
    if (requiredPerms && interaction.inGuild() && !interaction.memberPermissions?.has(BigInt(requiredPerms))) {
      return interaction.reply({ embeds: [permissionDenied(interaction.client, command)], ephemeral: true });
    }

    const cooldownAmount = (command.cooldown || 3) * 1000;
    if (!cooldowns.has(command.data.name)) cooldowns.set(command.data.name, new Collection());
    const timestamps = cooldowns.get(command.data.name);
    const now = Date.now();

    if (timestamps.has(interaction.user.id)) {
      const expiry = timestamps.get(interaction.user.id) + cooldownAmount;
      if (now < expiry) {
        const remaining = ((expiry - now) / 1000).toFixed(1);
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `Wait **${remaining}s** before using this again.`, color: colors.error })], ephemeral: true });
      }
    }
    timestamps.set(interaction.user.id, now);
    setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

    try {
      await command.execute(interaction);
      track(interaction.commandName, { userId: interaction.user.id, guildId: interaction.guildId, type: 'slash', feedback: interaction.failure ? 'errored' : 'ok', error: interaction.failure || null });
    } catch (err) {
      track(interaction.commandName, { userId: interaction.user.id, guildId: interaction.guildId, type: 'slash', feedback: 'errored', error: err.message });
      const ref = refId();
      log.error(`Command ${interaction.commandName} failed [ref ${ref}]:`, err.message);
      const reply = { embeds: [errorCard({ client: interaction.client, title: 'That did not work', fix: 'Try again in a moment. If it keeps happening, tell the server admins and quote the ref below.', ref })], ephemeral: true };
      // The interaction may already be expired or acknowledged elsewhere;
      // don't let the error notice itself throw.
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply).catch(() => {});
      } else {
        await interaction.reply(reply).catch(() => {});
      }
    }
  },
};

async function handleButton(interaction) {
  const { guild, user, customId } = interaction;

  if (customId.startsWith('mq:')) return require('../commands/music/queue').handleButton(interaction);
  if (customId.startsWith('mp:')) return require('../music/card').handleButton(interaction);
  if (customId.startsWith('aiact:')) return require('../ai/actions').handleButton(interaction);

  if (customId === 'ticket_open') {
    if (!guild || !store.getConfig(guild.id, 'ticket_enabled')) return;

    // Defer first (channel creation can exceed 3s), then guard double clicks. The Set is keyed per guild+user
    // and the existing-ticket check runs again after the await, so two fast clicks cannot make two tickets.
    await interaction.deferReply({ ephemeral: true });
    const lockKey = `${guild.id}:${user.id}`;
    if (ticketLocks.has(lockKey)) {
      return interaction.editReply({ embeds: [response({ client: interaction.client, description: 'Your ticket is already being created.', color: colors.error })] });
    }
    ticketLocks.add(lockKey);
    try {
      const findExisting = () => guild.channels.cache.find((c) => c.topic === `ticket-${user.id}` && c.name.startsWith('ticket-'));
      let existing = findExisting();
      if (existing) {
        return interaction.editReply({ embeds: [response({ client: interaction.client, description: `You already have an open ticket: ${existing}`, color: colors.error })] });
      }

      const supportRole = store.getConfig(guild.id, 'ticket_support_role');
      const categoryId = store.getConfig(guild.id, 'ticket_category');

      const channel = await guild.channels.create({
        name: `ticket-${user.username}`,
        type: ChannelType.GuildText,
        parent: categoryId || null,
        topic: `ticket-${user.id}`,
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] },
          { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
          ...(supportRole ? [{ id: supportRole, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] : []),
        ],
      });

      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: 'Ticket Opened', iconURL: user.displayAvatarURL() })
        .setDescription(`Welcome ${user}. Support staff can see this channel.
Describe your issue here.`);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_close').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
        new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Success).setEmoji('✋'),
      );

      await channel.send({ content: supportRole ? `<@&${supportRole}>` : '', embeds: [embed], components: [row], allowedMentions: { users: [user.id], roles: supportRole ? [supportRole] : [] } });
      await interaction.editReply({ embeds: [response({ client: interaction.client, description: `Ticket created: ${channel}`, color: colors.success })] });
    } finally {
      ticketLocks.delete(lockKey);
    }

  } else if (customId === 'ticket_close') {
    if (!interaction.channel.name.startsWith('ticket-')) return;

    // Only the opener, the support role, or staff (Manage Channels) may close.
    const supportRoleId = store.getConfig(guild.id, 'ticket_support_role');
    const isOpener = interaction.channel.topic === `ticket-${user.id}`;
    const isStaff = interaction.member?.permissions?.has(PermissionFlagsBits.ManageChannels)
      || (supportRoleId && interaction.member?.roles?.cache?.has(supportRoleId));
    if (!isOpener && !isStaff) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Only the ticket opener or support staff can close this ticket.', color: colors.error })], ephemeral: true });
    }

    await interaction.reply({ embeds: [response({ client: interaction.client, description: `Ticket closed by ${user}. Deleting in ${TICKET_DELETE_MS / 1000} seconds...`, color: colors.muted })] });

    const logsChannel = store.getConfig(guild.id, 'ticket_logs');
    if (logsChannel) {
      const ch = guild.channels.cache.get(logsChannel);
      if (ch) {
        const messages = await interaction.channel.messages.fetch({ limit: 100 });
        const transcript = messages
          .reverse()
          .filter((m) => !m.author.bot)
          .map((m) => `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content}`)
          .join('\n');

        const embed = base(interaction.client, colors.muted)
          .setAuthor({ name: `Ticket Closed — ${interaction.channel.name}` })
          .setDescription(`**Closed by** ${user.tag}\n**Messages** ${messages.size}`)
          .setTimestamp();

        const files = transcript.length > 0
          ? [{ attachment: Buffer.from(transcript, 'utf-8'), name: `${interaction.channel.name}-transcript.txt` }]
          : [];

        await ch.send({ embeds: [embed], files }).catch(() => {});
      }
    }

    setTimeout(() => interaction.channel.delete().catch(() => {}), TICKET_DELETE_MS);

  } else if (customId.startsWith('rp:')) {
    return require('../handlers/rolepanel').handleButton(interaction);

  } else if (customId.startsWith('rr_')) {
    // Panels posted before panels were stored in the database.
    return require('../handlers/rolepanel').handleLegacyButton(interaction);

  } else if (customId === 'giveaway_enter') {
    const gw = giveawayDb.get(guild.id, interaction.message.id);
    if (!gw || gw.ended) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'This giveaway has ended.', color: colors.error })], ephemeral: true });
    }
    if (gw.entries.has(user.id)) {
      giveawayDb.removeEntry(guild.id, interaction.message.id, user.id);
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'You left the giveaway.', color: colors.muted })], ephemeral: true });
    }
    giveawayDb.addEntry(guild.id, interaction.message.id, user.id);
    return interaction.reply({ embeds: [response({ client: interaction.client, description: `You entered the giveaway! (${gw.entries.size} total entries)`, color: colors.success })], ephemeral: true });

  } else if (customId === 'ticket_claim') {
    if (!interaction.channel.name.startsWith('ticket-')) return;
    const supportRole = store.getConfig(guild.id, 'ticket_support_role');
    if (supportRole && !interaction.member.roles.cache.has(supportRole)) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Only support team can claim tickets.', color: colors.error })], ephemeral: true });
    }

    await interaction.reply({ embeds: [response({ client: interaction.client, description: `Ticket claimed by ${user}`, color: colors.success })] });
  }
}
