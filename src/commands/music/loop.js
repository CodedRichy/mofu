const { SlashCommandBuilder } = require('discord.js');
const { useQueue, QueueRepeatMode } = require('discord-player');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');

const MODES = {
  off: QueueRepeatMode.OFF,
  track: QueueRepeatMode.TRACK,
  queue: QueueRepeatMode.QUEUE,
  autoplay: QueueRepeatMode.AUTOPLAY,
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Set loop mode')
    .addStringOption((o) =>
      o.setName('mode').setDescription('Loop mode').setRequired(true)
        .addChoices(
          { name: 'Off', value: 'off' },
          { name: 'Track', value: 'track' },
          { name: 'Queue', value: 'queue' },
          { name: 'Autoplay', value: 'autoplay' },
        )
    ),

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

    const mode = interaction.options.getString('mode');
    queue.setRepeatMode(MODES[mode]); require('../../music/card').refresh(queue);

    await interaction.reply({ embeds: [response({ client: interaction.client, description: `Loop mode set to **${mode}**`, color: colors.success })] });
  },
};
