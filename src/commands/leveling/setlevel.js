const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const xpStore = require('../../database/xp');
const store = require('../../database/store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setlevel')
    .setDescription('Set a member\'s level')
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addIntegerOption((o) => o.setName('level').setDescription('Level to set').setRequired(true).setMinValue(0).setMaxValue(1000))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const level = interaction.options.getInteger('level');

    const stats = xpStore.setLevel(interaction.guild.id, user.id, level);

    // Bring level rewards in line with the new level (never throws; failures are logged).
    // Granting several roles can take longer than the 3s reply window, so defer only when there is work to do.
    let note = '';
    const lv = require('../../utils/xp');
    const member = interaction.guild.members.cache.get(user.id);
    const hasRewards = lv.normalizeRewards(store.getConfig(interaction.guild.id, lv.KEYS.rewards)).length > 0;
    if (member && hasRewards) {
      await interaction.deferReply();
      const r = await lv.applyLevelRoles(member, stats.level);
      if (r.added.length || r.removed.length) note = `\nLevel rewards: +${r.added.length}${r.removed.length ? ` / -${r.removed.length}` : ''}`;
      if (r.failed.length) note += `\n${r.failed.length} reward role${r.failed.length === 1 ? '' : 's'} could not be given (check my role is above them).`;
    }

    const payload = {
      embeds: [response({
        client: interaction.client,
        description: `Set **${user.tag}** to level **${stats.level}**${note}`,
        color: colors.success,
      })],
    };
    await (interaction.deferred ? interaction.editReply(payload) : interaction.reply(payload));
  },
};
