const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set playback volume')
    .addIntegerOption((o) => o.setName('level').setDescription('Volume 1-100').setRequired(true).setMinValue(1).setMaxValue(100)),

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
    if (!queue?.isPlaying()) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Nothing is playing.', color: colors.error })], ephemeral: true });
    }

    const vol = interaction.options.getInteger('level');
    queue.node.setVolume(vol); require('../../music/card').refresh(queue);

    await interaction.reply({ embeds: [response({ client: interaction.client, description: `Volume set to **${vol}%**`, color: colors.success })] });
  },
};
