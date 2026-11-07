const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const store = require('../../database/store');
const config = require('../../config');

// 1-5 visible characters, no whitespace or invisible/control characters (they would make the prefix untypeable or unseeable).
function prefixProblem(p) {
  const v = String(p ?? '');
  if (!v.trim()) return 'Prefix cannot be empty or whitespace only.';
  if (/[\s\p{Cc}\p{Cf}\p{Zs}\p{Zl}\p{Zp}\u3164\u115F\u1160\u2800]/u.test(v)) return 'Prefix cannot contain spaces or invisible characters. Use 1-5 visible characters, like `;` or `!!`.';
  if ([...v].length > 5) return 'Prefix can be at most 5 characters.';
  return null;
}

module.exports = {
  prefixProblem,
  data: new SlashCommandBuilder()
    .setName('prefix')
    .setDescription('View or change the server prefix')
    .addStringOption((o) => o.setName('new_prefix').setDescription('New prefix (1-5 characters)').setMinLength(1).setMaxLength(5))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const store = require('../../database/store'); // lazy: keeps prefixProblem testable without opening the database
    const config = require('../../config');
    const newPrefix = interaction.options.getString('new_prefix');
    const { guild } = interaction;

    if (!newPrefix) {
      const current = store.getConfig(guild.id, 'prefix') || config.discord.defaultPrefix;
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `Current prefix: \`${current}\``, color: colors.info })] });
    }

    const problem = prefixProblem(newPrefix);
    if (problem) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: problem, color: colors.error })], ephemeral: true });
    }

    store.setConfig(guild.id, 'prefix', newPrefix);
    await interaction.reply({ embeds: [response({ client: interaction.client, description: `Prefix changed to \`${newPrefix}\``, color: colors.success })] });
  },
};
