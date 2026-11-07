const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const store = require('../../database/store');
const { overwriteState, stateToValue, sendChannelLog } = require('../../utils/modguard');

// What @everyone's ViewChannel overwrite looked like before /hide on ('allow' | 'deny' | 'none'), per channel, so
// /hide off puts it back instead of wiping an explicit allow/deny that existed.
const key = (channelId) => `hide_prev_${channelId}`;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hide')
    .setDescription('Hide or reveal a channel')
    .addSubcommand((s) => s.setName('on').setDescription('Hide this channel from @everyone'))
    .addSubcommand((s) => s.setName('off').setDescription('Reveal a hidden channel to @everyone'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { channel, guild } = interaction;
    const everyone = guild.roles.everyone;
    const fail = () =>
      interaction.reply({ embeds: [response({ client: interaction.client, description: "Couldn't change this channel's permissions. Check my permissions.", color: colors.error })], ephemeral: true });

    if (sub === 'on') {
      const current = overwriteState(channel, everyone.id, 'ViewChannel');
      const hadStored = !!store.getConfig(guild.id, key(channel.id));
      const shouldStore = !hadStored;
      if (shouldStore) store.setConfig(guild.id, key(channel.id), current);
      try {
        await channel.permissionOverwrites.edit(everyone, { ViewChannel: false });
      } catch {
        if (shouldStore) store.setConfig(guild.id, key(channel.id), null);
        return fail();
      }
      await interaction.reply({ embeds: [response({ client: interaction.client, description: 'Channel hidden.', color: colors.muted })], ephemeral: true });
      await sendChannelLog(guild, { action: 'hide', channel, moderator: interaction.user, reason: `Hidden #${channel.name}`, color: colors.muted });
    } else if (sub === 'off') {
      const prev = store.getConfig(guild.id, key(channel.id)) || 'none';
      try {
        await channel.permissionOverwrites.edit(everyone, { ViewChannel: stateToValue(prev) });
      } catch {
        return fail();
      }
      store.setConfig(guild.id, key(channel.id), null);
      await interaction.reply({ embeds: [response({ client: interaction.client, description: 'Channel revealed.', color: colors.success })] });
      await sendChannelLog(guild, { action: 'unhide', channel, moderator: interaction.user, reason: `Revealed #${channel.name}`, color: colors.success });
    }
  },
};
