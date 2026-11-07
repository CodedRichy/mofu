const { EmbedBuilder, Collection, ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const log = require('../utils/logger');
const { track } = require('../utils/commandTracker');
const { colors } = require('../utils/constants');
const { response, base, errorCard, refId, permissionDenied } = require('../utils/embed');
const config = require('../config');
const store = require('../database/store');
const giveawayDb = require('../database/giveaway');

const cooldowns = new Collection();

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

      const embed = new EmbedBuilder()
        .setColor(colors.primary)
        .setTitle(`${emoji} ${category.charAt(0).toUpperCase() + category.slice(1)}`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: `${lines.length} commands` });

      await interaction.update({ embeds: [embed] });
      return;
    }

    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;

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
    if (!store.getConfig(guild.id, 'ticket_enabled')) return;

    const existing = guild.channels.cache.find((c) => c.topic === `ticket-${user.id}` && c.name.startsWith('ticket-'));
    if (existing) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `You already have an open ticket: ${existing}`, color: colors.error })], ephemeral: true });
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
      .setDescription(`Welcome ${user}, a support member will be with you shortly.\nDescribe your issue and be patient.`);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_close').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
      new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Success).setEmoji('✋'),
    );

    await channel.send({ content: supportRole ? `<@&${supportRole}>` : '', embeds: [embed], components: [row] });
    await interaction.reply({ embeds: [response({ client: interaction.client, description: `Ticket created: ${channel}`, color: colors.success })], ephemeral: true });

  } else if (customId === 'ticket_close') {
    if (!interaction.channel.name.startsWith('ticket-')) return;

    await interaction.reply({ embeds: [response({ client: interaction.client, description: `Ticket closed by ${user}. Deleting in 5 seconds...`, color: colors.muted })] });

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

    setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);

  } else if (customId.startsWith('rr_')) {
    const roleId = customId.slice(3);
    const role = guild.roles.cache.get(roleId);
    if (!role) return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Role no longer exists.', color: colors.error })], ephemeral: true });

    const member = interaction.member;
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId).catch(() => {});
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `Removed **${role.name}**`, color: colors.muted })], ephemeral: true });
    }
    await member.roles.add(roleId).catch(() => {});
    return interaction.reply({ embeds: [response({ client: interaction.client, description: `Added **${role.name}**`, color: colors.success })], ephemeral: true });

  } else if (customId === 'giveaway_enter') {
    const gw = giveawayDb.get(guild.id, interaction.message.id);
    if (!gw || gw.ended) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'This giveaway has ended.', color: colors.error })], ephemeral: true });
    }
    if (gw.entries.has(user.id)) {
      gw.entries.delete(user.id);
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
