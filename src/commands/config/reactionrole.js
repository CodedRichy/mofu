const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, escapeMarkdown } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response, base } = require('../../utils/embed');
const { roleProblem, clip, joinClipped } = require('../../utils/modguard');
const rp = require('../../utils/rolepanel');
const panels = require('../../database/rolepanels');
const runtime = require('../../handlers/rolepanel');

const TYPE_CHOICES = [
  { name: 'Buttons (recommended)', value: 'button' },
  { name: 'Dropdown menu', value: 'select' },
  { name: 'Emoji reactions', value: 'reaction' },
];
const MODE_CHOICES = [
  { name: 'Normal: toggle on and off', value: 'normal' },
  { name: 'Unique: one role at a time', value: 'unique' },
  { name: 'Verify: add only', value: 'verify' },
  { name: 'Drop: remove only', value: 'drop' },
];
const SLOTS = 4;

// Posting / editing a panel (and adding reactions) can outlast Discord's 3s window, so those paths defer first.
const send = (interaction, description, color) => {
  const payload = { embeds: [response({ client: interaction.client, description, color })], ephemeral: true };
  return interaction.deferred ? interaction.editReply(payload) : interaction.reply(payload);
};
const fail = (interaction, description) => send(interaction, description, colors.error);
const done = (interaction, description, color = colors.success) => send(interaction, description, color);

const panelOpt = (o) => o.setName('panel').setDescription('Panel number (see list)').setRequired(true).setMinValue(1).setMaxValue(999999);

// Validates one entry for a panel of `type`. Returns { entry } (db shape) or { error }.
function buildEntry(interaction, type, { role, label, emoji, description, allowDangerous }) {
  const check = rp.createCheck(interaction.guild, interaction.member, role, { allowDangerous, roleProblem });
  if (check.error) return { error: `**${escapeMarkdown(role?.name || 'Role')}**: ${check.error}` };
  let parsed = null;
  if (emoji) {
    parsed = rp.parseEmoji(emoji, { client: interaction.client });
    if (parsed.error) return { error: `**${escapeMarkdown(role.name)}**: ${parsed.error}` };
  }
  if (type === 'reaction' && !parsed) return { error: `**${escapeMarkdown(role.name)}**: reaction panels need an emoji for every role.` };
  const maxLabel = type === 'select' ? rp.LIMITS.optionLabel : rp.LIMITS.buttonLabel;
  return {
    entry: {
      roleId: role.id,
      label: label ? clip(label.trim(), maxLabel) : null,
      emoji: parsed?.emoji || null,
      emojiKey: parsed?.key || null,
      description: description ? clip(description.trim(), rp.LIMITS.optionDescription) : null,
      dangerOk: check.dangerOk,
    },
  };
}

function duplicateEmoji(entries) {
  const seen = new Set();
  for (const e of entries) {
    const k = e.emojiKey ?? e.emoji_key;
    if (!k) continue;
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}

function summary(panel) {
  return `#${panel.panel_id} **${escapeMarkdown(clip(panel.title, 60))}** - ${panel.type}, ${panel.mode}, ${panel.entries.length} role(s)${panel.channel_id ? ` in <#${panel.channel_id}>` : ''}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Role panels: buttons, dropdowns or reactions')
    .addSubcommand((sub) => {
      sub.setName('create').setDescription('Post a new role panel')
        .addStringOption((o) => o.setName('title').setDescription('Panel title').setRequired(true).setMaxLength(rp.LIMITS.title))
        .addRoleOption((o) => o.setName('role1').setDescription('First role').setRequired(true));
      for (let i = 1; i <= SLOTS; i++) {
        if (i > 1) sub.addRoleOption((o) => o.setName(`role${i}`).setDescription(`Role ${i}`));
        sub.addStringOption((o) => o.setName(`label${i}`).setDescription(`Label for role ${i}`).setMaxLength(rp.LIMITS.buttonLabel));
        sub.addStringOption((o) => o.setName(`emoji${i}`).setDescription(`Emoji for role ${i}`).setMaxLength(64));
      }
      return sub
        .addStringOption((o) => o.setName('type').setDescription('Panel style').addChoices(...TYPE_CHOICES))
        .addStringOption((o) => o.setName('mode').setDescription('How picks behave').addChoices(...MODE_CHOICES))
        .addChannelOption((o) => o.setName('channel').setDescription('Where to post (default: here)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addBooleanOption((o) => o.setName('allow_dangerous').setDescription('Admins: allow roles with staff permissions'))
        .addStringOption((o) => o.setName('description').setDescription('Text above the roles').setMaxLength(rp.LIMITS.description));
    })
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a role to a panel, or update its label/emoji')
      .addIntegerOption(panelOpt)
      .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
      .addStringOption((o) => o.setName('emoji').setDescription('Emoji').setMaxLength(64))
      .addBooleanOption((o) => o.setName('allow_dangerous').setDescription('Admins: allow staff permissions'))
      .addStringOption((o) => o.setName('detail').setDescription('Dropdown option description').setMaxLength(rp.LIMITS.optionDescription))
      .addStringOption((o) => o.setName('label').setDescription('Label').setMaxLength(rp.LIMITS.optionLabel)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Take a role off a panel')
      .addIntegerOption(panelOpt)
      .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand((sub) => sub.setName('edit').setDescription('Change a panel\'s title, text, mode or style')
      .addIntegerOption(panelOpt)
      .addStringOption((o) => o.setName('mode').setDescription('How picks behave').addChoices(...MODE_CHOICES))
      .addStringOption((o) => o.setName('type').setDescription('Buttons or dropdown').addChoices(TYPE_CHOICES[0], TYPE_CHOICES[1]))
      .addStringOption((o) => o.setName('title').setDescription('New title').setMaxLength(rp.LIMITS.title))
      .addStringOption((o) => o.setName('description').setDescription('New text (- clears it)').setMaxLength(rp.LIMITS.description)))
    .addSubcommand((sub) => sub.setName('refresh').setDescription('Redraw a panel, or repost it if deleted')
      .addIntegerOption(panelOpt))
    .addSubcommand((sub) => sub.setName('delete').setDescription('Delete a panel')
      .addIntegerOption(panelOpt)
      .addBooleanOption((o) => o.setName('keep_message').setDescription('Leave the message up (it stops working)')))
    .addSubcommand((sub) => sub.setName('list').setDescription('List panels, or show one')
      .addIntegerOption((o) => o.setName('panel').setDescription('Panel number').setMinValue(1).setMaxValue(999999)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;
    const opt = interaction.options;

    if (sub === 'create') {
      const type = opt.getString('type') || 'button';
      const mode = opt.getString('mode') || 'normal';
      if (!rp.TYPES.includes(type) || !rp.MODES.includes(mode)) return fail(interaction, 'Unknown panel type or mode.');
      if (panels.countPanels(guild.id) >= rp.MAX_PANELS) return fail(interaction, `This server has ${rp.MAX_PANELS} panels, the maximum. Delete one first.`);
      const channel = opt.getChannel('channel') || interaction.channel;
      const problem = runtime.channelProblem(channel, guild.members.me, type);
      if (problem) return fail(interaction, problem);

      const entries = [];
      for (let i = 1; i <= SLOTS; i++) {
        const role = opt.getRole(`role${i}`);
        if (!role) continue;
        if (entries.some((e) => e.roleId === role.id)) return fail(interaction, 'Each role can only appear once on a panel.');
        const built = buildEntry(interaction, type, { role, label: opt.getString(`label${i}`), emoji: opt.getString(`emoji${i}`), allowDangerous: !!opt.getBoolean('allow_dangerous') });
        if (built.error) return fail(interaction, built.error);
        entries.push(built.entry);
      }
      if (!entries.length) return fail(interaction, 'Provide at least one role.');
      if (duplicateEmoji(entries)) return fail(interaction, 'Each emoji can only be used once per panel.');

      const title = clip(opt.getString('title').trim(), rp.LIMITS.title) || 'Roles';
      const description = opt.getString('description')?.trim() || null;
      const panelId = panels.createPanel({ guildId: guild.id, channelId: channel.id, type, mode, title, description, createdBy: interaction.user.id, entries });
      await interaction.deferReply({ ephemeral: true });
      const synced = await runtime.syncMessage(guild, panelId, { repost: true });
      if (!synced.ok) {
        panels.deletePanel(guild.id, panelId);
        return fail(interaction, synced.error);
      }
      return done(interaction, `Panel #${panelId} posted in ${channel} with ${entries.length} role(s). Add more with \`/reactionrole add panel:${panelId}\` (max ${rp.MAX_ENTRIES[type]}).`);
    }

    if (sub === 'list') {
      const id = opt.getInteger('panel');
      if (id) {
        const panel = panels.getPanel(guild.id, id);
        if (!panel) return fail(interaction, `There is no panel #${id}.`);
        const lines = panel.entries.map((e) => {
          const role = guild.roles.cache.get(e.role_id);
          const em = rp.emojiText(e.emoji ? JSON.parse(e.emoji) : null);
          const warn = !role ? ' - **deleted**' : rp.grantProblem(guild, role, e) ? ' - **cannot be granted right now**' : '';
          return `${em ? `${em} ` : ''}<@&${e.role_id}>${e.label ? ` "${escapeMarkdown(e.label)}"` : ''}${warn}`;
        });
        const link = panel.message_id ? `https://discord.com/channels/${guild.id}/${panel.channel_id}/${panel.message_id}` : null;
        const embed = base(interaction.client, colors.info)
          .setTitle(clip(`Panel #${panel.panel_id}: ${panel.title}`, 256))
          .setDescription(joinClipped([`${panel.type}, ${panel.mode}${link ? ` - [jump](${link})` : ''}`, '', ...(lines.length ? lines : ['No roles.'])], 4000));
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
      const all = panels.listPanels(guild.id);
      if (!all.length) return done(interaction, 'No role panels yet. Make one with `/reactionrole create`.', colors.muted);
      const embed = base(interaction.client, colors.info)
        .setTitle(`Role panels (${all.length}/${rp.MAX_PANELS})`)
        .setDescription(joinClipped(all.map(summary), 4000));
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const panelId = opt.getInteger('panel');
    const panel = panels.getPanel(guild.id, panelId);
    if (!panel) return fail(interaction, `There is no panel #${panelId}. See \`/reactionrole list\`.`);

    if (sub === 'add') {
      const role = opt.getRole('role');
      const max = rp.MAX_ENTRIES[panel.type] || 25;
      const exists = panel.entries.some((e) => e.role_id === role?.id);
      if (!exists && panel.entries.length >= max) return fail(interaction, `Panel #${panelId} already has ${max} roles, the most a ${panel.type} panel can hold.`);
      const built = buildEntry(interaction, panel.type, { role, label: opt.getString('label'), emoji: opt.getString('emoji'), description: opt.getString('detail'), allowDangerous: !!opt.getBoolean('allow_dangerous') });
      if (built.error) return fail(interaction, built.error);
      const others = panel.entries.filter((e) => e.role_id !== role.id);
      if (duplicateEmoji([...others, built.entry])) return fail(interaction, 'That emoji is already used by another role on this panel.');
      const what = panels.upsertEntry(guild.id, panelId, built.entry);
      await interaction.deferReply({ ephemeral: true });
      const synced = await runtime.syncMessage(guild, panelId);
      const note = synced.ok ? '' : `\nSaved, but the message was not updated: ${synced.error}`;
      return done(interaction, `${what === 'added' ? 'Added' : 'Updated'} ${role} on panel #${panelId}.${note}`, synced.ok ? colors.success : colors.warning);
    }

    if (sub === 'remove') {
      // Deleted roles cannot be picked here; /reactionrole refresh prunes those.
      const roleId = opt.getRole('role')?.id;
      if (!roleId || !panels.removeEntry(guild.id, panelId, roleId)) return fail(interaction, `That role is not on panel #${panelId}.`);
      await interaction.deferReply({ ephemeral: true });
      const synced = await runtime.syncMessage(guild, panelId);
      const note = synced.ok ? '' : `\nRemoved, but the message was not updated: ${synced.error}`;
      return done(interaction, `Removed <@&${roleId}> from panel #${panelId}.${note}`, synced.ok ? colors.success : colors.warning);
    }

    if (sub === 'edit') {
      const fields = {};
      const title = opt.getString('title');
      const description = opt.getString('description');
      const mode = opt.getString('mode');
      const type = opt.getString('type');
      if (title) fields.title = clip(title.trim(), rp.LIMITS.title) || panel.title;
      if (description) fields.description = description.trim() === '-' ? null : description.trim();
      if (mode) {
        if (!rp.MODES.includes(mode)) return fail(interaction, 'Unknown mode.');
        fields.mode = mode;
      }
      if (type && type !== panel.type) {
        if (panel.type === 'reaction' || type === 'reaction') return fail(interaction, 'Reaction panels cannot switch style. Delete this one and create a new panel.');
        if (!rp.TYPES.includes(type)) return fail(interaction, 'Unknown type.');
        fields.type = type;
      }
      if (!Object.keys(fields).length) return fail(interaction, 'Nothing to change. Give a title, description, mode or type.');
      panels.updatePanel(guild.id, panelId, fields);
      await interaction.deferReply({ ephemeral: true });
      const synced = await runtime.syncMessage(guild, panelId);
      const note = synced.ok ? '' : `\nSaved, but the message was not updated: ${synced.error}`;
      return done(interaction, `Panel #${panelId} updated (${Object.keys(fields).join(', ')}).${note}`, synced.ok ? colors.success : colors.warning);
    }

    if (sub === 'refresh') {
      // Drop entries whose role was deleted, so the panel stops showing dead buttons.
      const gone = panel.entries.filter((e) => !guild.roles.cache.has(e.role_id));
      for (const e of gone) panels.removeEntry(guild.id, panelId, e.role_id);
      await interaction.deferReply({ ephemeral: true });
      const synced = await runtime.syncMessage(guild, panelId, { repost: true });
      if (!synced.ok) return fail(interaction, synced.error);
      const pruned = gone.length ? ` Removed ${gone.length} deleted role(s).` : '';
      return done(interaction, `${synced.reposted ? `Panel #${panelId} was missing, so I posted it again in <#${synced.message.channelId}>.` : `Panel #${panelId} redrawn.`}${pruned}`);
    }

    if (sub === 'delete') {
      const keep = !!opt.getBoolean('keep_message');
      panels.deletePanel(guild.id, panelId);
      let note = '';
      if (!keep && panel.message_id) {
        const channel = guild.channels.cache.get(panel.channel_id);
        await interaction.deferReply({ ephemeral: true });
        const msg = channel ? await channel.messages.fetch(panel.message_id).catch(() => null) : null;
        if (msg) await msg.delete().catch(() => { note = ' I could not delete the message; remove it by hand.'; });
      }
      return done(interaction, `Panel #${panelId} deleted.${note}`);
    }
  },
};
