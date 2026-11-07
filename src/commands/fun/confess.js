const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response } = require('../../utils/embed');
const store = require('../../database/store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('confess')
    .setDescription('Send an anonymous confession')
    .addStringOption((o) => o.setName('message').setDescription('Your confession').setRequired(true).setMaxLength(2000)),

  async execute(interaction) {
    const channelId = store.getConfig(interaction.guild.id, 'confession_channel');
    if (!channelId) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Confessions are not set up in this server.', color: colors.error })], ephemeral: true });
    }

    const channel = interaction.guild.channels.cache.get(channelId);
    if (!channel) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Confession channel no longer exists.', color: colors.error })], ephemeral: true });
    }

    const message = interaction.options.getString('message').slice(0, 4000);
    // Stored per server so the number does not reset when the bot restarts.
    const number = (Number(store.getConfig(interaction.guild.id, 'confession_count')) || 0) + 1;

    const embed = base(interaction.client, colors.primary)
      .setAuthor({ name: `Anonymous Confession #${number}` })
      .setDescription(message)
      .setTimestamp();

    try {
      await channel.send({ embeds: [embed] });
    } catch {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Failed to send confession.', color: colors.error })], ephemeral: true });
    }
    store.setConfig(interaction.guild.id, 'confession_count', number);

    // Prefix use leaves "<prefix>confess ..." in chat under your name. Delete it, and say so if that fails.
    const cmdMsg = interaction.message;
    if (cmdMsg && typeof cmdMsg.delete === 'function') {
      const gone = await cmdMsg.delete().then(() => true, () => false);
      if (!gone) {
        await interaction.reply({ embeds: [response({ client: interaction.client, description: 'Posted, but I could not delete your command message, so people can see you sent it. Delete it yourself.', color: colors.warning })] }).catch(() => {});
      }
      return;
    }
    await interaction.reply({ embeds: [response({ client: interaction.client, description: 'Your confession has been posted anonymously.', color: colors.success })], ephemeral: true });
  },
};
