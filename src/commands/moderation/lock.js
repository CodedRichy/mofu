const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const store = require('../../database/store');
const { reasonError, clip, overwriteState, stateToValue, sendChannelLog } = require('../../utils/modguard');

// What @everyone's SendMessages overwrite looked like before /lock on ('allow' | 'deny' | 'none'), per channel, so
// /lock off restores it instead of wiping an explicit allow/deny that existed.
const key = (channelId) => `lock_prev_${channelId}`;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Lock or unlock a channel')
    .addSubcommand((s) =>
      s.setName('on')
        .setDescription('Lock a channel — prevents members from sending messages')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel to lock (defaults to current)'))
        .addStringOption((o) => o.setName('reason').setDescription('Reason for locking'))
    )
    .addSubcommand((s) =>
      s.setName('off')
        .setDescription('Unlock a channel — allows members to send messages again')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel to unlock (defaults to current)'))
        .addStringOption((o) => o.setName('reason').setDescription('Reason for unlocking'))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const guild = interaction.guild;
    const everyone = guild.roles.everyone;
    const fail = (msg) =>
      interaction.reply({ embeds: [response({ client: interaction.client, description: msg, color: colors.error })], ephemeral: true });

    const reasonErr = reasonError(reason);
    if (reasonErr) return fail(reasonErr);
    if (!channel?.permissionOverwrites) return fail("That channel can't be locked.");

    if (sub === 'on') {
      const current = overwriteState(channel, everyone.id, 'SendMessages');
      const hadStored = !!store.getConfig(guild.id, key(channel.id));
      const shouldStore = current !== 'deny' && !hadStored;
      if (shouldStore) store.setConfig(guild.id, key(channel.id), current);
      try {
        await channel.permissionOverwrites.edit(everyone, { SendMessages: false }, { reason: clip(reason, 512) });
      } catch {
        if (shouldStore) store.setConfig(guild.id, key(channel.id), null);
        return fail("Couldn't lock that channel. Check my permissions.");
      }

      const embed = response({
        client: interaction.client,
        description: `**${channel}** has been locked\n**Reason** ${reason}`,
        color: colors.muted,
      });

      await interaction.reply({ embeds: [embed] });
      await sendChannelLog(guild, { action: 'lock', channel, moderator: interaction.user, reason, color: colors.muted });
    } else if (sub === 'off') {
      const prev = store.getConfig(guild.id, key(channel.id)) || 'none';
      try {
        await channel.permissionOverwrites.edit(everyone, { SendMessages: stateToValue(prev) }, { reason: clip(reason, 512) });
      } catch {
        return fail("Couldn't unlock that channel. Check my permissions.");
      }
      store.setConfig(guild.id, key(channel.id), null);

      const embed = response({
        client: interaction.client,
        description: `**${channel}** has been unlocked\n**Reason** ${reason}`,
        color: colors.success,
      });

      await interaction.reply({ embeds: [embed] });
      await sendChannelLog(guild, { action: 'unlock', channel, moderator: interaction.user, reason, color: colors.success });
    }
  },
};
