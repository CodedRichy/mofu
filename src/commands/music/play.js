const { SlashCommandBuilder } = require('discord.js');
const { useMainPlayer } = require('discord-player');
const { colors } = require('../../utils/constants');
const { response, base } = require('../../utils/embed');
const log = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song or add to queue')
    .addStringOption((o) => o.setName('query').setDescription('Song name or URL').setRequired(true)),

  async execute(interaction) {
    const channel = interaction.member.voice.channel;
    if (!channel) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Join a voice channel first.', color: colors.error })], ephemeral: true });
    }

    const botVc = interaction.guild.members.me.voice.channel;
    if (botVc && botVc.id !== channel.id) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `Already playing in ${botVc}. Join that channel or wait.`, color: colors.error })], ephemeral: true });
    }

    await interaction.deferReply();

    const player = useMainPlayer();
    const query = interaction.options.getString('query');

    try {
      const { track, searchResult } = await player.play(channel, query, {
        nodeOptions: {
          metadata: { channel: interaction.channel },
          bufferingTimeout: 15000,
          leaveOnStop: true,
          leaveOnEmpty: true,
          leaveOnEmptyCooldown: 300000,
          leaveOnEnd: true,
          leaveOnEndCooldown: 300000,
        },
        requestedBy: interaction.user,
      });

      const embed = base(interaction.client, colors.success)
        .setAuthor({ name: 'Added to queue' })
        .setDescription(`**[${track.title}](${track.url})**\n${track.author} · ${track.duration}`)
        .setThumbnail(track.thumbnail);

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      // Surface extractor/stream failures in logs; the user message is unchanged.
      log.warn(`play failed for "${query}":`, err?.message || err);
      await interaction.editReply({ embeds: [response({ client: interaction.client, description: 'No results found or failed to play.', color: colors.error })] });
    }
  },
};
