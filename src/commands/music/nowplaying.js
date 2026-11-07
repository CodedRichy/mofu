const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');
const { colors } = require('../../utils/constants');
const { base, response } = require('../../utils/embed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Show the currently playing track'),

  async execute(interaction) {
    const queue = useQueue(interaction.guild.id);
    if (!queue?.currentTrack) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Nothing is playing.', color: colors.muted })], ephemeral: true });
    }

    const track = queue.currentTrack;
    const progress = queue.node.createProgressBar({ timecodes: true, length: 15 });

    const embed = base(interaction.client, colors.primary)
      .setAuthor({ name: 'Now Playing' })
      .setDescription(`**[${track.title}](${track.url})**\n${track.author}${progress ? `\n\n${progress}` : ''}`)
      .setThumbnail(track.thumbnail || null);

    await interaction.reply({ embeds: [embed] });
  },
};
