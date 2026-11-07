const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');

// Resume only ever resumes. `pause` is a toggle, so "mofu resume" used to pause a playing track.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume paused playback'),

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
    if (!queue?.currentTrack) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Nothing is playing.', color: colors.error })], ephemeral: true });
    }

    if (!queue.node.isPaused()) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Playback is not paused.', color: colors.muted })], ephemeral: true });
    }

    queue.node.setPaused(false);
    require('../../music/card').refresh(queue);
    await interaction.reply({ embeds: [response({ client: interaction.client, description: 'Resumed playback.', color: colors.success })] });
  },
};
