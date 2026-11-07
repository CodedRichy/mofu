const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response } = require('../../utils/embed');
const store = require('../../database/store');

let confessionCounter = 0;

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
    confessionCounter++;

    const embed = base(interaction.client, colors.primary)
      .setAuthor({ name: `Anonymous Confession #${confessionCounter}` })
      .setDescription(message)
      .setTimestamp();

    try {
      await channel.send({ embeds: [embed] });
      await interaction.reply({ embeds: [response({ client: interaction.client, description: 'Your confession has been sent anonymously.', color: colors.success })], ephemeral: true });
    } catch {
      await interaction.reply({ embeds: [response({ client: interaction.client, description: 'Failed to send confession.', color: colors.error })], ephemeral: true });
    }
  },
};
