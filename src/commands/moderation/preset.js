const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response } = require('../../utils/embed');
const { joinClipped } = require('../../utils/modguard');
const presets = require('../../utils/presets');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('preset')
    .setDescription('Punishment presets: a rule name mapped to an action, duration and reason')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('add').setDescription('Add or replace a preset')
      .addStringOption((o) => o.setName('name').setDescription('Rule name, e.g. spam').setRequired(true).setMaxLength(24))
      .addStringOption((o) => o.setName('action').setDescription('What to do').setRequired(true)
        .addChoices(...presets.ACTIONS.map((a) => ({ name: a, value: a }))))
      .addStringOption((o) => o.setName('duration').setDescription('For mute and tempban: 30m, 12h, 7d. For others: none').setRequired(true).setMaxLength(10))
      // free-text reason must stay LAST: the prefix parser gives every earlier string option a single word
      .addStringOption((o) => o.setName('reason').setDescription('Default reason used with this preset').setMaxLength(512)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a preset')
      .addStringOption((o) => o.setName('name').setDescription('Rule name').setRequired(true).setMaxLength(24)))
    .addSubcommand((s) => s.setName('list').setDescription('Show this server\'s presets')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const fail = (description) => interaction.reply({ embeds: [response({ client: interaction.client, description, color: colors.error })], ephemeral: true });
    if (sub !== 'add' && sub !== 'remove' && sub !== 'list') return; // the prefix dispatcher prints usage
    // Discord applies default_member_permissions, but a server can override it per command; check the real permission.
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) return fail('You need the **Manage Server** permission to manage presets.');

    const guildId = interaction.guild.id;
    const table = presets.listPresets(guildId);

    if (sub === 'list') {
      const names = Object.keys(table).sort();
      if (!names.length) return interaction.reply({ embeds: [response({ client: interaction.client, description: 'No presets yet. Add one with the `preset add` command, e.g. name `spam`, action `mute`, duration `1h`.', color: colors.muted })], ephemeral: true });
      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: `Punishment presets (${names.length}/${presets.MAX_PRESETS})` })
        .setDescription(joinClipped(names.map((n) => presets.describePreset(n, table[n])), 4000));
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'remove') {
      const res = presets.removeFromTable(table, interaction.options.getString('name'));
      if (res.error) return fail(res.error);
      presets.savePresets(guildId, res.table);
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `Removed preset \`${res.name}\`.`, color: colors.success })] });
    }

    const res = presets.addToTable(table, interaction.options.getString('name'), {
      action: interaction.options.getString('action'),
      duration: interaction.options.getString('duration'),
      reason: interaction.options.getString('reason'),
    });
    if (res.error) return fail(res.error);
    presets.savePresets(guildId, res.table);
    return interaction.reply({ embeds: [response({ client: interaction.client, description: `${res.replaced ? 'Updated' : 'Saved'} preset ${presets.describePreset(res.name, res.preset)}`, color: colors.success })] });
  },
};
