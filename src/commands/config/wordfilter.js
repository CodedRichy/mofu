const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const store = require('../../database/store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wordfilter')
    .setDescription('Manage blocked words list')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName('add')
        .setDescription('Add a word to the filter')
        .addStringOption((o) => o.setName('word').setDescription('Word or phrase to block').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('remove')
        .setDescription('Remove a word from the filter')
        .addStringOption((o) => o.setName('word').setDescription('Word or phrase to unblock').setRequired(true))
    )
    .addSubcommand((s) => s.setName('list').setDescription('View all blocked words'))
    .addSubcommand((s) => s.setName('clear').setDescription('Clear all blocked words')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const words = store.getConfig(guildId, 'word_filter') || [];

    if (sub === 'add') {
      const word = interaction.options.getString('word').trim().toLowerCase();
      if (!word) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Please provide a valid word or phrase.', color: colors.error })], ephemeral: true });
      }
      if (words.includes(word)) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `\`${word}\` is already filtered.`, color: colors.error })], ephemeral: true });
      }
      words.push(word);
      store.setConfig(guildId, 'word_filter', words);
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `Added \`${word}\` to filter. (${words.length} total)`, color: colors.success })] });
    }

    if (sub === 'remove') {
      const word = interaction.options.getString('word').trim().toLowerCase();
      const idx = words.indexOf(word);
      if (idx === -1) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `\`${word}\` is not in the filter.`, color: colors.error })], ephemeral: true });
      }
      words.splice(idx, 1);
      store.setConfig(guildId, 'word_filter', words);
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `Removed \`${word}\` from filter. (${words.length} remaining)`, color: colors.success })] });
    }

    if (sub === 'list') {
      if (!words.length) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'No words in filter.', color: colors.muted })] });
      }
      // Embed descriptions max out at 4096 characters: show as many words as fit and say how many were left out.
      const header = `**Blocked Words (${words.length})**\n`;
      let body = '';
      let shown = 0;
      for (const w of words) {
        const piece = `${shown ? ', ' : ''}\`${String(w).slice(0, 60)}\``;
        if (header.length + body.length + piece.length > 3900) break;
        body += piece;
        shown++;
      }
      const more = shown < words.length ? `\n...and ${words.length - shown} more not shown.` : '';
      return interaction.reply({ embeds: [response({ client: interaction.client, description: header + body + more, color: colors.primary })], ephemeral: true });
    }

    if (sub === 'clear') {
      store.setConfig(guildId, 'word_filter', []);
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `Cleared ${words.length} word(s) from filter.`, color: colors.success })] });
    }
  },
};
