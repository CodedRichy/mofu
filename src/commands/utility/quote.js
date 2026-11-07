const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response, footer } = require('../../utils/embed');
const { cmdRef } = require('../../utils/invocation');
const quoteStore = require('../../database/quotes');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quote')
    .setDescription('Server quote book')
    .addSubcommand((s) =>
      s.setName('save')
        .setDescription('Save a quote')
        .addStringOption((o) => o.setName('text').setDescription('The quote').setRequired(true).setMaxLength(500))
        .addUserOption((o) => o.setName('author').setDescription('Who said it'))
    )
    .addSubcommand((s) => s.setName('random').setDescription('Get a random quote'))
    .addSubcommand((s) =>
      s.setName('search')
        .setDescription('Search quotes')
        .addStringOption((o) => o.setName('query').setDescription('Search term').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('get')
        .setDescription('Get a specific quote')
        .addIntegerOption((o) => o.setName('id').setDescription('Quote number').setRequired(true).setMinValue(1))
    )
    .addSubcommand((s) =>
      s.setName('remove')
        .setDescription('Remove a quote')
        .addIntegerOption((o) => o.setName('id').setDescription('Quote number').setRequired(true).setMinValue(1))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'save') {
      const text = interaction.options.getString('text');
      const author = interaction.options.getUser('author');
      const id = quoteStore.add(guildId, {
        content: text,
        quotedUser: author ? { id: author.id, tag: author.tag } : null,
        savedBy: { id: interaction.user.id, tag: interaction.user.tag },
      });

      return interaction.reply({
        embeds: [response({
          client: interaction.client,
          description: `Quote **#${id}** saved.${author ? ` — ${author}` : ''}`,
          color: colors.success,
        })],
      });
    }

    if (sub === 'random') {
      const q = quoteStore.random(guildId);
      if (!q) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `No quotes saved yet. Use ${cmdRef(guildId, 'quote save')} to add one.`, color: colors.muted })], ephemeral: true });
      }

      const embed = base(interaction.client, colors.primary)
        .setDescription(`> ${q.content}`)
        .setFooter(footer(interaction.client, `Quote #${q.id}${q.quotedUser ? ` — ${q.quotedUser.tag}` : ''} · saved by ${q.savedBy.tag}`));

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'get') {
      const id = interaction.options.getInteger('id');
      const q = quoteStore.get(guildId, id);
      if (!q) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `Quote #${id} not found.`, color: colors.error })], ephemeral: true });
      }

      const embed = base(interaction.client, colors.primary)
        .setDescription(`> ${q.content}`)
        .setFooter(footer(interaction.client, `Quote #${q.id}${q.quotedUser ? ` — ${q.quotedUser.tag}` : ''} · saved by ${q.savedBy.tag}`));

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'search') {
      const query = interaction.options.getString('query');
      const results = quoteStore.search(guildId, query);
      if (!results.length) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `No quotes matching "${query}"`, color: colors.muted })], ephemeral: true });
      }

      const desc = results.map((q) => `**#${q.id}** "${q.content.slice(0, 80)}${q.content.length > 80 ? '...' : ''}"${q.quotedUser ? ` — ${q.quotedUser.tag}` : ''}`).join('\n');

      return interaction.reply({ embeds: [response({ client: interaction.client, description: `**Search Results**\n\n${desc}`, color: colors.primary })] });
    }

    if (sub === 'remove') {
      const id = interaction.options.getInteger('id');
      const removed = quoteStore.remove(guildId, id);
      if (!removed) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `Quote #${id} not found.`, color: colors.error })], ephemeral: true });
      }
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `Quote **#${id}** removed.`, color: colors.success })] });
    }
  },
};
