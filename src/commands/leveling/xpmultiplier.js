const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const { joinClipped } = require('../../utils/modguard');
const store = require('../../database/store');
const lv = require('../../utils/xp');

const { MULT_MIN, MULT_MAX, MULTS_MAX, TOTAL_MULT_MAX } = lv.LIMITS;
const CHANNEL_TYPES = [
  ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory,
  ChannelType.GuildAnnouncement, ChannelType.GuildStageVoice, ChannelType.GuildForum,
];

const reply = (i, description, color, ephemeral = false) =>
  i.reply({ embeds: [response({ client: i.client, description, color })], ephemeral, allowedMentions: { parse: [] } });
const fail = (i, description) => reply(i, description, colors.error, true);
const fmt = (x) => `${Math.round(x * 100) / 100}x`;

// x from the command, rounded to 2 decimals, or null when out of range.
function readX(interaction) {
  const x = interaction.options.getNumber('x');
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  const r = Math.round(x * 100) / 100;
  return r >= MULT_MIN && r <= MULT_MAX ? r : null;
}

// Set (or with x = 1, clear) one entry of a { id: x } map. Returns an error string or null.
function setEntry(guildId, key, id, x) {
  const map = { ...(store.getConfig(guildId, key) || {}) };
  if (x === 1) delete map[id];
  else {
    if (!(id in map) && Object.keys(map).length >= MULTS_MAX) return `You can have at most ${MULTS_MAX} of these. Remove one first.`;
    map[id] = x;
  }
  store.setConfig(guildId, key, Object.keys(map).length ? map : null);
  return null;
}

const xOpt = (o) => o.setName('x').setDescription(`Multiplier from ${MULT_MIN} to ${MULT_MAX} (1 = normal, clears it)`).setRequired(true).setMinValue(MULT_MIN).setMaxValue(MULT_MAX);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('xpmultiplier')
    .setDescription('Earn more (or less) XP by role, channel, or server-wide')
    .addSubcommand((sub) => sub.setName('role').setDescription('Multiplier for members with a role (highest role wins)')
      .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
      .addNumberOption(xOpt))
    .addSubcommand((sub) => sub.setName('channel').setDescription('Multiplier for a channel or category')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel or category').setRequired(true).addChannelTypes(...CHANNEL_TYPES))
      .addNumberOption(xOpt))
    .addSubcommand((sub) => sub.setName('global').setDescription('Server-wide multiplier')
      .addNumberOption(xOpt))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a multiplier')
      .addStringOption((o) => o.setName('target').setDescription('A role or channel (mention or id), or "global"').setRequired(true).setMaxLength(40)))
    .addSubcommand((sub) => sub.setName('list').setDescription('Show every XP multiplier'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;

    if (sub === 'role') {
      const role = interaction.options.getRole('role');
      const x = readX(interaction);
      if (!role) return fail(interaction, 'That role no longer exists.');
      if (x === null) return fail(interaction, `The multiplier must be from ${MULT_MIN} to ${MULT_MAX}.`);
      const err = setEntry(guild.id, lv.KEYS.roleMults, role.id, x);
      if (err) return fail(interaction, err);
      return reply(interaction, x === 1 ? `Cleared the multiplier for ${role}.` : `Members with ${role} earn **${fmt(x)}** XP.`, colors.success);
    }

    if (sub === 'channel') {
      const channel = interaction.options.getChannel('channel');
      const x = readX(interaction);
      if (!channel || !CHANNEL_TYPES.includes(channel.type)) return fail(interaction, 'Pick a text, voice, forum or announcement channel, or a category.');
      if (x === null) return fail(interaction, `The multiplier must be from ${MULT_MIN} to ${MULT_MAX}.`);
      const err = setEntry(guild.id, lv.KEYS.channelMults, channel.id, x);
      if (err) return fail(interaction, err);
      return reply(interaction, x === 1 ? `Cleared the multiplier for <#${channel.id}>.` : `XP in <#${channel.id}> is now **${fmt(x)}**.`, colors.success);
    }

    if (sub === 'global') {
      const x = readX(interaction);
      if (x === null) return fail(interaction, `The multiplier must be from ${MULT_MIN} to ${MULT_MAX}.`);
      store.setConfig(guild.id, lv.KEYS.global, x === 1 ? null : x);
      return reply(interaction, x === 1 ? 'Server-wide multiplier reset to **1x**.' : `Everyone now earns **${fmt(x)}** XP.`, colors.success);
    }

    if (sub === 'remove') {
      const t = lv.parseTarget(interaction.options.getString('target'));
      if (t.type === 'global') {
        store.setConfig(guild.id, lv.KEYS.global, null);
        return reply(interaction, 'Server-wide multiplier reset to **1x**.', colors.success);
      }
      if (!['role', 'channel', 'id'].includes(t.type)) return fail(interaction, 'Give a role or channel (mention or id), or `global`.');
      const keys = t.type === 'role' ? [lv.KEYS.roleMults] : t.type === 'channel' ? [lv.KEYS.channelMults] : [lv.KEYS.roleMults, lv.KEYS.channelMults];
      let hit = false;
      for (const key of keys) {
        const map = store.getConfig(guild.id, key) || {};
        if (t.id in map) { setEntry(guild.id, key, t.id, 1); hit = true; }
      }
      return hit
        ? reply(interaction, 'Multiplier removed.', colors.success)
        : reply(interaction, 'No multiplier is set for that. See `/xpmultiplier list`.', colors.muted, true);
    }

    // list
    const roleMults = store.getConfig(guild.id, lv.KEYS.roleMults) || {};
    const chMults = store.getConfig(guild.id, lv.KEYS.channelMults) || {};
    const g = lv.validMult(store.getConfig(guild.id, lv.KEYS.global), 0, TOTAL_MULT_MAX);
    const lines = [`**Server-wide** ${fmt(g === null ? 1 : g)}`];
    const roles = Object.entries(roleMults).filter(([, v]) => lv.validMult(v) !== null);
    const chans = Object.entries(chMults).filter(([, v]) => lv.validMult(v) !== null);
    if (roles.length) lines.push('', `**Roles** (${roles.length}/${MULTS_MAX}, highest wins)`, ...roles.sort((a, b) => b[1] - a[1]).map(([id, v]) => `<@&${id}> ${fmt(v)}`));
    if (chans.length) lines.push('', `**Channels** (${chans.length}/${MULTS_MAX})`, ...chans.sort((a, b) => b[1] - a[1]).map(([id, v]) => `<#${id}> ${fmt(v)}`));
    lines.push('', `Role x channel x server-wide, capped at ${TOTAL_MULT_MAX}x.`);
    return reply(interaction, joinClipped(lines, 4000), colors.info);
  },
};
