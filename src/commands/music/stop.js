const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback and clear the queue'),

  async execute(interaction) {
    const channel = interaction.member.voice.channel;
    if (!channel) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Join a voice channel first.', color: colors.error })], ephemeral: true });
    }

    const botVc = interaction.guild.members.me.voice.channel;
    if (botVc && botVc.id !== channel.id) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `Already playing in ${botVc}. Join that channel or wait.`, color: colors.error })], ephemeral: true });
    }

    const queue = useQueue(interaction.guild.id);
    if (!queue) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Nothing is playing.', color: colors.error })], ephemeral: true });
    }

    queue.delete();
    require('../../music/card').clear(interaction.guild.id, 'Record stopped.', interaction.client);
    await interaction.reply({ embeds: [response({ client: interaction.client, description: 'Stopped playback and cleared queue.', color: colors.muted })] });
  },
};
