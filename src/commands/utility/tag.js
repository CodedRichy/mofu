const { SlashCommandBuilder, PermissionFlagsBits, escapeMarkdown } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response, base } = require('../../utils/embed');
const { joinClipped, clip } = require('../../utils/modguard');
const T = require('../../utils/tags');
const tags = require('../../database/tags');
const store = require('../../database/store');

const usage = T.makeCooldown(T.LIMITS.cooldownMs);
const NO_PINGS = { parse: [], repliedUser: false };

const reply = (interaction, description, color = colors.error, ephemeral = true) =>
  interaction.reply({ embeds: [response({ client: interaction.client, description, color })], ephemeral, allowedMentions: NO_PINGS });

// Prefix messages carry the raw text; the parser flattens newlines and only lets the last option hold spaces.
// (Slash command interactions have no .message; PrefixContext keeps the source message.)
const isPrefix = (interaction) => typeof interaction.message?.content === 'string';
function prefixOf(guildId) {
  return store.getConfig(guildId, 'prefix') || require('../../config').discord.defaultPrefix;
}

// "--embed" / "embed:true" / "embed:false" as the first word of prefix content.
function splitEmbedFlag(text) {
  const m = /^(--embed|embed:(true|false|yes|no))(\s+|$)/i.exec(text);
  if (!m) return { text, embed: null };
  const val = m[2] ? /^(true|yes)$/i.test(m[2]) : true;
  return { text: text.slice(m[0].length), embed: val };
}

function canManage(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const roleId = store.getConfig(interaction.guild.id, 'tag_manager_role');
  return !!(roleId && interaction.member?.roles?.cache?.has(roleId));
}

function isCommandName(client) {
  return (n) => !!(client?.commands?.has?.(n) || client?.aliases?.has?.(n));
}

// Slash text options are single-line: "\n" typed literally becomes a line break.
const unescapeNewlines = (s) => String(s).replace(/\\n/g, '\n');

async function useTag(interaction, rawName, args) {
  const { guild, user } = interaction;
  const name = T.normalizeName(rawName);
  const tag = T.NAME_RE.test(name) ? tags.getTag(guild.id, name) : null;
  if (!tag) {
    const near = T.NAME_RE.test(name.slice(0, 2)) ? tags.searchTags(guild.id, name.slice(0, 2), 5) : [];
    return reply(interaction, `No tag named \`${clip(name, 32).replace(/`/g, '')}\`.${near.length ? ` Did you mean ${near.map((n) => `\`${n}\``).join(', ')}?` : ''}`);
  }
  const wait = usage.hit(`${guild.id}:${user.id}`);
  if (wait) return reply(interaction, `Wait **${(wait / 1000).toFixed(1)}s** before using another tag.`);

  const text = T.renderTag(tag.content, { user, member: interaction.member, guild, channel: interaction.channel, args }).trim();
  if (!text) return reply(interaction, `\`${name}\` came out empty. It probably expects text after its name.`);
  tags.bumpUses(guild.id, name);
  if (tag.embed) {
    return interaction.reply({ embeds: [response({ client: interaction.client, description: clip(text, 4096), color: colors.primary })], allowedMentions: NO_PINGS });
  }
  return interaction.reply({ content: clip(text, 2000), allowedMentions: NO_PINGS });
}

module.exports = {
  cooldown: 1, // tag use has its own 3s per-user cooldown; management should not wait on it
  data: new SlashCommandBuilder()
    .setName('tag')
    .setDescription('Server tags: saved replies anyone can use')
    .addSubcommand((s) => s.setName('use').setDescription('Send a tag')
      .addStringOption((o) => o.setName('name').setDescription('Tag name').setRequired(true).setMaxLength(32).setAutocomplete(true))
      .addStringOption((o) => o.setName('args').setDescription('Text for {args}').setMaxLength(T.LIMITS.argsMax)))
    .addSubcommand((s) => s.setName('create').setDescription('Create a tag (Manage Server or tag manager role)')
      .addStringOption((o) => o.setName('name').setDescription('a-z 0-9 _ - (max 32)').setRequired(true).setMaxLength(32))
      .addStringOption((o) => o.setName('content').setDescription('Text. {user} {user.name} {server} {channel} {membercount} {random:a|b} {args}').setRequired(true).setMaxLength(T.LIMITS.contentMax))
      .addBooleanOption((o) => o.setName('embed').setDescription('Send as an embed')))
    .addSubcommand((s) => s.setName('edit').setDescription('Change a tag')
      .addStringOption((o) => o.setName('name').setDescription('Tag name').setRequired(true).setMaxLength(32).setAutocomplete(true))
      .addStringOption((o) => o.setName('content').setDescription('New text (\\n for a new line)').setRequired(true).setMaxLength(T.LIMITS.contentMax))
      .addBooleanOption((o) => o.setName('embed').setDescription('Send as an embed')))
    .addSubcommand((s) => s.setName('delete').setDescription('Delete a tag')
      .addStringOption((o) => o.setName('name').setDescription('Tag name').setRequired(true).setMaxLength(32).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('info').setDescription('Who made a tag, uses, raw text')
      .addStringOption((o) => o.setName('name').setDescription('Tag name').setRequired(true).setMaxLength(32).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List this server\'s tags'))
    .addSubcommand((s) => s.setName('manager').setDescription('Set the role that may manage tags (empty clears)')
      .addRoleOption((o) => o.setName('role').setDescription('Tag manager role'))),

  async autocomplete(interaction) {
    const focused = String(interaction.options.getFocused() || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const names = tags.searchTags(interaction.guild.id, focused, 25);
    await interaction.respond(names.map((n) => ({ name: n, value: n })));
  },

  async execute(interaction) {
    const { guild } = interaction;
    const sub = interaction.options.getSubcommand();
    const prefix = isPrefix(interaction);
    const tail = (skip) => T.rawTail(interaction.message.content, prefixOf(guild.id), skip);

    if (!sub) return reply(interaction, 'Usage: `tag <name>` to send a tag, or `tag <create|edit|delete|info|list|manager>`.', colors.muted);

    // ";tag rules hello" -> the parser saw "rules" as an unknown subcommand: that is a tag name.
    if (prefix && !T.RESERVED.has(sub)) return useTag(interaction, sub, tail(2));

    if (sub === 'use') {
      return useTag(interaction, interaction.options.getString('name'), prefix ? tail(3) : interaction.options.getString('args') || '');
    }

    if (sub === 'list') {
      const all = tags.listTags(guild.id);
      if (!all.length) return reply(interaction, 'No tags yet. Staff can add one with `/tag create`.', colors.muted, false);
      const embed = base(interaction.client, colors.info)
        .setTitle(`Tags (${all.length}/${T.LIMITS.perGuild})`)
        .setDescription(joinClipped(all.map((t) => `\`${t.name}\` (${t.uses})`), 4000, ', '));
      return interaction.reply({ embeds: [embed], allowedMentions: NO_PINGS });
    }

    if (sub === 'info') {
      const name = T.normalizeName(interaction.options.getString('name'));
      const tag = tags.getTag(guild.id, name);
      if (!tag) return reply(interaction, `No tag named \`${clip(name, 32).replace(/`/g, '')}\`.`);
      const raw = clip(tag.content, 1000).replace(/```/g, '`​``');
      const lines = [
        `**Owner** ${tag.owner_id ? `<@${tag.owner_id}>` : 'unknown'}`,
        `**Uses** ${tag.uses}`,
        `**Created** <t:${Math.floor(tag.created_at / 1000)}:R>`,
        tag.updated_at ? `**Edited** <t:${Math.floor(tag.updated_at / 1000)}:R>${tag.updated_by ? ` by <@${tag.updated_by}>` : ''}` : null,
        `**Format** ${tag.embed ? 'embed' : 'plain text'}`,
        '', '```', raw, '```',
      ].filter((l) => l !== null);
      const embed = base(interaction.client, colors.info).setTitle(`Tag: ${name}`).setDescription(lines.join('\n'));
      return interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: NO_PINGS });
    }

    if (sub === 'manager') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return reply(interaction, 'You need Manage Server to choose the tag manager role.');
      const role = interaction.options.getRole('role');
      if (role && (role.id === guild.id || role.managed)) return reply(interaction, 'Pick a normal role (not @everyone or a bot role).');
      store.setConfig(guild.id, 'tag_manager_role', role ? role.id : null);
      return reply(interaction, role ? `${role} can now create, edit and delete tags.` : 'Tag manager role cleared. Only Manage Server can manage tags now.', colors.success);
    }

    // create / edit / delete
    if (!canManage(interaction)) {
      return reply(interaction, 'You need Manage Server (or the tag manager role) to change tags. Anyone can use them.');
    }
    const name = T.normalizeName(interaction.options.getString('name'));

    if (sub === 'delete') {
      if (!tags.deleteTag(guild.id, name)) return reply(interaction, `No tag named \`${clip(name, 32).replace(/`/g, '')}\`.`);
      return reply(interaction, `Tag \`${name}\` deleted.`, colors.success);
    }

    let content = interaction.options.getString('content');
    let embed = interaction.options.getBoolean('embed');
    if (prefix) {
      const parsed = splitEmbedFlag(tail(3));
      content = parsed.text;
      embed = parsed.embed;
    } else {
      content = unescapeNewlines(content);
    }
    content = String(content ?? '').trim();
    const cErr = T.contentError(content);
    if (cErr) return reply(interaction, cErr);

    if (sub === 'create') {
      const nErr = T.nameError(name, { isCommand: isCommandName(interaction.client) });
      if (nErr) return reply(interaction, nErr);
      const res = tags.createTag(guild.id, { name, content, embed: !!embed, ownerId: interaction.user.id });
      if (res === 'exists') return reply(interaction, `\`${name}\` already exists. Use \`/tag edit\` to change it.`);
      if (res === 'cap') return reply(interaction, `This server has ${T.LIMITS.perGuild} tags, the maximum. Delete one first.`);
      return reply(interaction, `Tag \`${name}\` created. Use it with \`/tag use name:${name}\` or \`${prefixOf(guild.id)}tag ${name}\`.`, colors.success);
    }

    if (sub === 'edit') {
      if (!tags.updateTag(guild.id, name, { content, embed: embed ?? undefined, by: interaction.user.id })) {
        return reply(interaction, `No tag named \`${clip(name, 32).replace(/`/g, '')}\`.`);
      }
      return reply(interaction, `Tag \`${name}\` updated.`, colors.success);
    }
    return undefined;
  },
};
