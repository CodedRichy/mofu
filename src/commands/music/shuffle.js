const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Shuffle the queue'),

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
    if (!queue || !queue.tracks.size) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Queue is empty.', color: colors.error })], ephemeral: true });
    }

    queue.tracks.shuffle(); require('../../music/card').refresh(queue);
    await interaction.reply({ embeds: [response({ client: interaction.client, description: queue.tracks.size < 2 ? 'Nothing to shuffle: fewer than two tracks are queued.' : `Shuffled **${queue.tracks.size}** tracks.`, color: colors.success })] });
  },
};
