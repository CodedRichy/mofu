const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response, base } = require('../../utils/embed');
const store = require('../../database/store');
const rules = require('../../utils/automodRules');

// What turns detection on for each trigger, besides a rule.
function detectionNote(guildId, trigger, hasRule) {
  if (trigger === 'links') return store.getConfig(guildId, 'antilink') || hasRule ? 'on' : 'off (`/antilink` or a rule turns it on)';
  if (trigger === 'spam') return store.getConfig(guildId, 'antispam') || hasRule ? 'on (5 messages in 3s)' : 'off (`/antispam` or a rule turns it on)';
  if (trigger === 'badwords') return (store.getConfig(guildId, 'word_filter') || []).length ? 'on' : 'off (add words with `/wordfilter`)';
  if (trigger === 'mentions') return hasRule ? `on (${rules.MENTION_LIMIT}+ mentions)` : 'off';
  if (trigger === 'caps') return hasRule ? 'on (70%+ capitals, 12+ letters)' : 'off';
  return hasRule ? 'on' : 'off';
}

const legacy = { links: 'delete', badwords: 'delete', spam: '1 minute timeout' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Escalating punishments for repeat automod offenders')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('rule').setDescription('Set the punishment ladder for one trigger')
      .addStringOption((o) => o.setName('trigger').setDescription('What to catch').setRequired(true)
        .addChoices(...rules.TRIGGERS.map((t) => ({ name: t, value: t }))))
      .addStringOption((o) => o.setName('action').setDescription('Highest step: warn first, then timeout, then this').setRequired(true)
        .addChoices(...rules.ACTIONS.map((a) => ({ name: a, value: a }))))
      .addIntegerOption((o) => o.setName('timeout_minutes').setDescription(`Timeout length on the 2nd strike (default ${rules.DEFAULT_TIMEOUT_MIN})`)
        .setMinValue(1).setMaxValue(rules.MAX_TIMEOUT_MIN))
      .addIntegerOption((o) => o.setName('window_minutes').setDescription(`Strikes older than this are forgotten (default ${rules.DEFAULT_WINDOW_MIN})`)
        .setMinValue(1).setMaxValue(rules.MAX_WINDOW_MIN)))
    .addSubcommand((s) => s.setName('status').setDescription('Show every trigger and its ladder')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const current = rules.normalizeRules(store.getConfig(guildId, 'automod_rules'));

    if (sub === 'rule') {
      const trigger = interaction.options.getString('trigger');
      const action = interaction.options.getString('action');
      if (!rules.TRIGGERS.includes(trigger) || !rules.ACTIONS.includes(action)) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Unknown trigger or action.', color: colors.error })], ephemeral: true });
      }
      const next = { ...current };
      if (action === 'off') delete next[trigger];
      else {
        next[trigger] = rules.normalizeRule({
          action,
          timeoutMin: interaction.options.getInteger('timeout_minutes') ?? current[trigger]?.timeoutMin,
          windowMin: interaction.options.getInteger('window_minutes') ?? current[trigger]?.windowMin,
        });
      }
      store.setConfig(guildId, 'automod_rules', Object.keys(next).length ? next : null);
      const desc = action === 'off'
        ? `Rule for **${trigger}** removed.${legacy[trigger] ? ` It falls back to the basic behaviour (${legacy[trigger]}) when its filter is on.` : ' That trigger is now off.'}`
        : `**${trigger}**: ${rules.describeRule(next[trigger])}\nDetection: ${detectionNote(guildId, trigger, true)}.\nStaff with Manage Messages are never affected.`;
      return interaction.reply({ embeds: [response({ client: interaction.client, description: desc, color: action === 'off' ? colors.muted : colors.success })] });
    }

    const lines = rules.TRIGGERS.map((t) => {
      const r = current[t];
      const ladder = r ? rules.describeRule(r) : (legacy[t] ? `basic (${legacy[t]})` : 'no rule');
      return `**${t}**: ${ladder}\n  detection ${detectionNote(guildId, t, !!r)}`;
    });
    const embed = base(interaction.client, colors.primary)
      .setAuthor({ name: 'Automod' })
      .setDescription(`${lines.join('\n')}\n\nAutomod warnings are saved to the member's record but do not count toward \`/warnconfig\` thresholds.\nSet a ladder:\`/automod rule <trigger> <action> [timeout_minutes] [window_minutes]\``);
    return interaction.reply({ embeds: [embed] });
  },
};
