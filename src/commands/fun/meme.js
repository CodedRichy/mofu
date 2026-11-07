const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response, footer } = require('../../utils/embed');
const { rateLimit } = require('../../utils/ratelimit');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('meme')
    .setDescription('Random meme from Reddit'),

  async execute(interaction) {
    if (!rateLimit(`meme:${interaction.guild.id}`, 10, 60000)) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Rate limit reached. Try again in a minute.', color: colors.error })], ephemeral: true });
    }

    await interaction.deferReply();

    try {
      const res = await fetch('https://meme-api.com/gimme');
      if (!res.ok) throw new Error();
      const data = await res.json();

      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: data.title, url: data.postLink })
        .setImage(data.url)
        .setFooter(footer(interaction.client, `👍 ${data.ups} · r/${data.subreddit}`));

      await interaction.editReply({ embeds: [embed] });
    } catch {
      await interaction.editReply({ embeds: [response({ client: interaction.client, description: 'Failed to fetch meme.', color: colors.error })] });
    }
  },
};
