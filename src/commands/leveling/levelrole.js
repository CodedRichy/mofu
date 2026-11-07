const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const { roleProblem, joinClipped } = require('../../utils/modguard');
const store = require('../../database/store');
const xpDb = require('../../database/xp');
const lv = require('../../utils/xp');
const log = require('../../utils/logger');

const SYNC_MAX = 1000; // members checked per /levelrole sync run
const syncing = new Set(); // guild ids with a sync in progress

const reply = (i, description, color, ephemeral = false) =>
  i.reply({ embeds: [response({ client: i.client, description, color })], ephemeral, allowedMentions: { parse: [] } });
const fail = (i, description) => reply(i, description, colors.error, true);

module.exports = {
  cooldown: 5,
  data: new SlashCommandBuilder()
    .setName('levelrole')
    .setDescription('Give roles automatically when members reach a level')
    .addSubcommand((sub) => sub.setName('add').setDescription('Reward a role at a level')
      .addIntegerOption((o) => o.setName('level').setDescription('Level that earns the role').setRequired(true).setMinValue(1).setMaxValue(1000))
      .addRoleOption((o) => o.setName('role').setDescription('Role to give').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Stop rewarding a role')
      .addStringOption((o) => o.setName('reward').setDescription('The role (mention or id), or a level to remove every reward at it').setRequired(true).setMaxLength(40)))
    .addSubcommand((sub) => sub.setName('list').setDescription('Show the level rewards'))
    .addSubcommand((sub) => sub.setName('mode').setDescription('Keep every earned reward, or only the highest one')
      .addStringOption((o) => o.setName('mode').setDescription('stack: keep all earned rewards; replace: only the highest').setRequired(true).addChoices(
        { name: 'Stack (keep all)', value: 'stack' },
        { name: 'Replace (highest only)', value: 'replace' },
      )))
    .addSubcommand((sub) => sub.setName('sync').setDescription('Give missing rewards to members already past a level'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;
    const rewards = lv.normalizeRewards(store.getConfig(guild.id, lv.KEYS.rewards));

    if (sub === 'add') {
      const level = interaction.options.getInteger('level');
      const role = interaction.options.getRole('role');
      if (!Number.isSafeInteger(level) || level < 1 || level > 1000) return fail(interaction, 'Level must be a whole number from 1 to 1000.');
      // invoker + bot hierarchy, managed roles, @everyone
      const problem = roleProblem(guild, interaction.member, role) || lv.rewardRoleProblem(guild, role);
      if (problem) return fail(interaction, problem);
      const existing = rewards.find((r) => r.role === role.id);
      if (existing && existing.level === level) return reply(interaction, `${role} is already the reward for level **${level}**.`, colors.muted, true);
      const next = rewards.filter((r) => r.role !== role.id);
      if (next.length >= lv.LIMITS.REWARDS_MAX) return fail(interaction, `You can have at most ${lv.LIMITS.REWARDS_MAX} level rewards. Remove one first.`);
      next.push({ level, role: role.id });
      store.setConfig(guild.id, lv.KEYS.rewards, lv.normalizeRewards(next));
      const moved = existing ? ` (moved from level ${existing.level})` : '';
      return reply(interaction, `Members reaching level **${level}** now get ${role}${moved}.\nRun \`/levelrole sync\` to give it to members already past that level.`, colors.success);
    }

    if (sub === 'remove') {
      const t = lv.parseTarget(interaction.options.getString('reward'));
      let next;
      let what;
      if (t.type === 'level') {
        next = rewards.filter((r) => r.level !== t.level);
        what = `every reward at level **${t.level}**`;
      } else if (t.type === 'role' || t.type === 'id') {
        next = rewards.filter((r) => r.role !== t.id);
        what = `<@&${t.id}>`;
      } else {
        return fail(interaction, 'Give a role (mention or id) or a level number.');
      }
      if (next.length === rewards.length) return reply(interaction, 'That is not a level reward. See `/levelrole list`.', colors.muted, true);
      store.setConfig(guild.id, lv.KEYS.rewards, next.length ? next : null);
      return reply(interaction, `Removed ${what} from the level rewards. Members keep roles they already have.`, colors.success);
    }

    if (sub === 'mode') {
      const mode = lv.normalizeMode(interaction.options.getString('mode'));
      store.setConfig(guild.id, lv.KEYS.mode, mode);
      return reply(interaction, mode === 'replace'
        ? 'Mode: **replace**. Members keep only their highest earned reward; lower ones are taken off on level-up.'
        : 'Mode: **stack**. Members keep every reward they earn.', colors.success);
    }

    if (sub === 'list') {
      if (!rewards.length) return reply(interaction, 'No level rewards yet. Add one with `/levelrole add`.', colors.muted);
      const mode = lv.normalizeMode(store.getConfig(guild.id, lv.KEYS.mode));
      const lines = rewards.map((r) => {
        const role = guild.roles.cache.get(r.role);
        const problem = lv.rewardRoleProblem(guild, role);
        return `Level **${r.level}** - <@&${r.role}>${problem ? ` (not assignable: ${role ? 'move my role above it' : 'role deleted'})` : ''}`;
      });
      const head = `**Level rewards** (${rewards.length}/${lv.LIMITS.REWARDS_MAX}, mode: ${mode})\n`;
      return reply(interaction, head + joinClipped(lines, 4000 - head.length), colors.info);
    }

    // sync
    if (!rewards.length) return reply(interaction, 'No level rewards to sync. Add one with `/levelrole add`.', colors.muted, true);
    if (syncing.has(guild.id)) return fail(interaction, 'A sync is already running for this server.');
    syncing.add(guild.id);
    try {
      await interaction.deferReply();
      const minLevel = rewards[0].level;
      const rows = xpDb.getMembersAtLevel(guild.id, minLevel, SYNC_MAX);
      const config = lv.readConfig(guild.id, store);
      let checked = 0; let added = 0; let removed = 0; let failed = 0; let gone = 0;
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100);
        let members;
        try {
          members = await guild.members.fetch({ user: chunk.map((r) => r.userId) });
        } catch (err) {
          log.warn(`levelrole sync fetch failed in ${guild.id}:`, err?.message || err);
          members = new Map();
        }
        for (const row of chunk) {
          const member = members.get(row.userId);
          if (!member) { gone++; continue; }
          checked++;
          const r = await lv.applyLevelRoles(member, row.level, { config });
          added += r.added.length; removed += r.removed.length; failed += r.failed.length;
        }
      }
      const lines = [
        `**Level reward sync done**`,
        `Checked **${checked}** member${checked === 1 ? '' : 's'} at level ${minLevel}+`,
        `Roles given **${added}**${removed ? ` | taken off **${removed}**` : ''}${failed ? ` | failed **${failed}** (check my role is above the rewards)` : ''}`,
      ];
      if (gone) lines.push(`${gone} no longer in the server`);
      if (rows.length >= SYNC_MAX) lines.push(`Only the top ${SYNC_MAX} members by level were checked; everyone else gets their rewards on their next level-up.`);
      await interaction.editReply({ embeds: [response({ client: interaction.client, description: lines.join('\n'), color: failed ? colors.warning : colors.success })] });
    } finally {
      syncing.delete(guild.id);
    }
  },
};
