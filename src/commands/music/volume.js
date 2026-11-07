const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const log = require('../../utils/logger');

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
    // setVolume returns false when the audio pipeline has no volume stage; never claim a change that did not happen.
    const applied = queue.node.setVolume(vol);
    log.info(`volume: requested ${vol}, applied=${applied}, now ${queue.node.volume}`);
    require('../../music/card').refresh(queue);

    if (!applied) {
      interaction.failure = 'setVolume returned false';
      return interaction.reply({ embeds: [response({ client: interaction.client, description: "I couldn't change the volume on this stream. Use the volume control on the bot in Discord (right-click it in the voice channel) for now.", color: colors.error })] });
    }
    await interaction.reply({ embeds: [response({ client: interaction.client, description: `Volume set to **${vol}%**`, color: colors.success })] });
  },
};
