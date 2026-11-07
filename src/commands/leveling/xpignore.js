const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const { joinClipped } = require('../../utils/modguard');
const store = require('../../database/store');
const lv = require('../../utils/xp');

const CHANNEL_TYPES = [
  ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory,
  ChannelType.GuildAnnouncement, ChannelType.GuildStageVoice, ChannelType.GuildForum,
];
const ACTIONS = [{ name: 'Add (no XP)', value: 'add' }, { name: 'Remove (earn XP again)', value: 'remove' }];

const reply = (i, description, color, ephemeral = false) =>
  i.reply({ embeds: [response({ client: i.client, description, color })], ephemeral, allowedMentions: { parse: [] } });
const fail = (i, description) => reply(i, description, colors.error, true);

// Add or remove one id in a list config key. Returns { ok, message }.
function toggle(guildId, key, id, action) {
  const list = (store.getConfig(guildId, key) || []).filter((x) => typeof x === 'string');
  const has = list.includes(id);
  if (action === 'add') {
    if (has) return { ok: false, message: 'Already on the no-XP list.' };
    if (list.length >= lv.LIMITS.IGNORE_MAX) return { ok: false, message: `The no-XP list is full (max ${lv.LIMITS.IGNORE_MAX}).` };
    store.setConfig(guildId, key, [...list, id]);
    return { ok: true };
  }
  if (!has) return { ok: false, message: 'That is not on the no-XP list.' };
  const next = list.filter((x) => x !== id);
  store.setConfig(guildId, key, next.length ? next : null);
  return { ok: true };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('xpignore')
    .setDescription('Channels and roles that never earn XP') // claim-ok: utils/xp.js isIgnored gates every XP grant
    .addSubcommand((sub) => sub.setName('channel').setDescription('No XP in a channel or category')
      .addStringOption((o) => o.setName('action').setDescription('Add or remove').setRequired(true).addChoices(...ACTIONS))
      .addChannelOption((o) => o.setName('channel').setDescription('Channel or category').setRequired(true).addChannelTypes(...CHANNEL_TYPES)))
    .addSubcommand((sub) => sub.setName('role').setDescription('No XP for members with a role')
      .addStringOption((o) => o.setName('action').setDescription('Add or remove').setRequired(true).addChoices(...ACTIONS))
      .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand((sub) => sub.setName('list').setDescription('Show the no-XP channels and roles'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;

    if (sub === 'channel' || sub === 'role') {
      const action = interaction.options.getString('action');
      if (action !== 'add' && action !== 'remove') return fail(interaction, 'Action must be `add` or `remove`.');
      let id; let label; let key;
      if (sub === 'channel') {
        const channel = interaction.options.getChannel('channel');
        if (!channel || !CHANNEL_TYPES.includes(channel.type)) return fail(interaction, 'Pick a text, voice, forum or announcement channel, or a category.');
        id = channel.id; label = `<#${channel.id}>`; key = lv.KEYS.ignoreChannels;
      } else {
        const role = interaction.options.getRole('role');
        if (!role) return fail(interaction, 'That role no longer exists.');
        if (role.id === guild.id) return fail(interaction, "@everyone can't be ignored; turn leveling off with `/leveling toggle` instead.");
        id = role.id; label = `<@&${role.id}>`; key = lv.KEYS.ignoreRoles;
      }
      const r = toggle(guild.id, key, id, action);
      if (!r.ok) return reply(interaction, r.message, colors.muted, true);
      const who = sub === 'channel' ? `in ${label}` : `for members with ${label}`;
      return reply(interaction, action === 'add' ? `No XP ${who} any more.` : `XP is earned ${who} again.`, colors.success);
    }

    // list
    const chans = (store.getConfig(guild.id, lv.KEYS.ignoreChannels) || []).filter((x) => typeof x === 'string');
    const roles = (store.getConfig(guild.id, lv.KEYS.ignoreRoles) || []).filter((x) => typeof x === 'string');
    if (!chans.length && !roles.length) return reply(interaction, 'Nothing is on the no-XP list.', colors.muted);
    const lines = [];
    if (chans.length) lines.push(`**Channels** (${chans.length})`, ...chans.map((id) => `<#${id}>`));
    if (roles.length) lines.push(...(chans.length ? [''] : []), `**Roles** (${roles.length})`, ...roles.map((id) => `<@&${id}>`));
    return reply(interaction, joinClipped(lines, 4000), colors.info);
  },
};
