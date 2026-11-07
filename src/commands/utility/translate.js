const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const { rateLimit } = require('../../utils/ratelimit');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('translate')
    .setDescription('Translate text to another language')
    .addStringOption((o) => o.setName('text').setDescription('Text to translate').setRequired(true).setMaxLength(500))
    .addStringOption((o) =>
      o.setName('to').setDescription('Target language').setRequired(true)
        .addChoices(
          { name: 'English', value: 'en' },
          { name: 'Spanish', value: 'es' },
          { name: 'French', value: 'fr' },
          { name: 'German', value: 'de' },
          { name: 'Japanese', value: 'ja' },
          { name: 'Korean', value: 'ko' },
          { name: 'Chinese', value: 'zh' },
          { name: 'Portuguese', value: 'pt' },
          { name: 'Russian', value: 'ru' },
          { name: 'Arabic', value: 'ar' },
          { name: 'Hindi', value: 'hi' },
          { name: 'Italian', value: 'it' },
        )
    ),

  async execute(interaction) {
    const text = interaction.options.getString('text');
    const to = interaction.options.getString('to');

    if (!rateLimit(`translate:${interaction.guild.id}:${interaction.user.id}`, 15, 60000)) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Rate limit reached. Try again in a minute.', color: colors.error })], ephemeral: true });
    }
    await interaction.deferReply();

    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=autodetect|${to}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error();
      const data = await res.json();

      if (!data.responseData?.translatedText) throw new Error();

      const translated = data.responseData.translatedText;
      const detected = data.responseData.match?.source || '?';

      await interaction.editReply({
        embeds: [response({
          client: interaction.client,
          description: `**From** \`${detected}\` **→** \`${to}\`\n\n${translated}`,
          color: colors.primary,
        })],
      });
    } catch {
      await interaction.editReply({ embeds: [response({ client: interaction.client, description: 'Translation failed.', color: colors.error })] });
    }
  },
};
