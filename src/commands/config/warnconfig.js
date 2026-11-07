const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response, base } = require('../../utils/embed');
const store = require('../../database/store');
const policy = require('../../utils/warnpolicy');

const actionChoices = policy.ACTIONS.map((a) => ({ name: a, value: a }));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warnconfig')
    .setDescription('Automatic punishments when a member reaches a number of warnings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('add').setDescription('Set what happens at a warning count')
      .addIntegerOption((o) => o.setName('count').setDescription('Active warnings that trigger it').setRequired(true).setMinValue(1).setMaxValue(100))
      .addStringOption((o) => o.setName('action').setDescription('What to do').setRequired(true).addChoices(...actionChoices))
      .addStringOption((o) => o.setName('duration').setDescription('For mute (default 1h) or ban (empty = permanent): 30m, 1h, 1d, 1w').setMaxLength(10)))
    .addSubcommand((s) => s.setName('list').setDescription('Show the warning thresholds'))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove the threshold at a warning count')
      .addIntegerOption((o) => o.setName('count').setDescription('Warning count to remove').setRequired(true).setMinValue(1).setMaxValue(100)))
    .addSubcommand((s) => s.setName('expiry').setDescription('Warnings older than this stop counting (0 = never expire)')
      .addIntegerOption((o) => o.setName('days').setDescription('Days, 0-365').setRequired(true).setMinValue(0).setMaxValue(365))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const say = (description, color = colors.success, ephemeral = false) =>
      interaction.reply({ embeds: [response({ client: interaction.client, description, color })], ephemeral });
    const fail = (d) => say(d, colors.error, true);
    const current = policy.normalizeThresholds(store.getConfig(guildId, 'warn_thresholds'));

    if (sub === 'add') {
      const v = policy.validateThreshold({
        count: interaction.options.getInteger('count'),
        action: interaction.options.getString('action'),
        duration: interaction.options.getString('duration'),
      });
      if (v.error) return fail(v.error);
      const others = current.filter((t) => t.count !== v.value.count);
      if (others.length >= policy.MAX_THRESHOLDS) return fail(`You can have at most ${policy.MAX_THRESHOLDS} thresholds. Remove one first.`);
      const replaced = others.length !== current.length;
      store.setConfig(guildId, 'warn_thresholds', policy.normalizeThresholds([...others, v.value]));
      return say(`${replaced ? 'Updated' : 'Added'}: **${policy.describe(v.value)}**. Triggers when a member reaches exactly ${v.value.count} active warnings.\nThe reason is logged as \`Auto: N warnings\`.`);
    }

    if (sub === 'remove') {
      const count = interaction.options.getInteger('count');
      const next = current.filter((t) => t.count !== count);
      if (next.length === current.length) return fail(`There is no threshold at **${count}** warnings.`);
      store.setConfig(guildId, 'warn_thresholds', next.length ? next : null);
      return say(`Removed the threshold at **${count}** warnings.`, colors.muted);
    }

    if (sub === 'expiry') {
      const days = interaction.options.getInteger('days');
      store.setConfig(guildId, 'warn_expiry_days', days > 0 ? days : null);
      return say(days > 0 ? `Warnings older than **${days}** day(s) no longer count toward thresholds.` : 'Warnings never expire.');
    }

    const expiry = policy.normalizeExpiryDays(store.getConfig(guildId, 'warn_expiry_days'));
    const lines = current.length
      ? current.map((t) => `**${policy.describe(t)}**: triggers when a member reaches exactly ${t.count} active warnings`)
      : ['No thresholds set. Add one with `/warnconfig add <count> <action> [duration]`.'];
    const embed = base(interaction.client, colors.primary)
      .setAuthor({ name: 'Warning thresholds' })
      .setDescription(`${lines.join('\n')}\n\nCounts in between do nothing extra.`)
      .addFields({ name: 'Expiry', value: expiry ? `${expiry} day(s)` : 'never', inline: true });
    return interaction.reply({ embeds: [embed] });
  },
};
