const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response, footer } = require('../../utils/embed');
const { rateLimit } = require('../../utils/ratelimit');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('define')
    .setDescription('Look up a word on Urban Dictionary')
    .addStringOption((o) => o.setName('word').setDescription('Word to define').setRequired(true)),

  async execute(interaction) {
    const word = interaction.options.getString('word');
    if (!rateLimit(`define:${interaction.guild.id}:${interaction.user.id}`, 10, 60000)) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Rate limit reached. Try again in a minute.', color: colors.error })], ephemeral: true });
    }
    await interaction.deferReply();

    try {
      const res = await fetch(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(word)}`);
      if (!res.ok) throw new Error();
      const data = await res.json();

      if (!data.list?.length) {
        return interaction.editReply({ embeds: [response({ client: interaction.client, description: `No definition found for **${word}**`, color: colors.muted })] });
      }

      const entry = data.list[0];
      const def = entry.definition.replace(/\[|\]/g, '').slice(0, 1024);
      const example = entry.example?.replace(/\[|\]/g, '').slice(0, 512);

      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: `📖 ${entry.word}`, url: entry.permalink })
        .setDescription(def);

      if (example) embed.addFields({ name: 'Example', value: example });
      embed.setFooter(footer(interaction.client, `👍 ${entry.thumbs_up} · 👎 ${entry.thumbs_down}`));

      await interaction.editReply({ embeds: [embed] });
    } catch {
      await interaction.editReply({ embeds: [response({ client: interaction.client, description: 'Failed to fetch definition.', color: colors.error })] });
    }
  },
};
