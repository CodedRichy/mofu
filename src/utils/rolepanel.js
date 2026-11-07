// Role panels: pure helpers shared by /reactionrole and the click / select / reaction handlers.
// Nothing here touches the database or the network, so every rule is unit-testable.
//
// Panel types: 'button' (modern default, max 25 = 5 rows x 5), 'select' (one menu, max 25 options),
// 'reaction' (emoji reactions, max 20: Discord's unique-reaction cap per message).
// Modes: 'normal' (toggle), 'unique' (one role from the panel at a time), 'verify' (add-only), 'drop' (remove-only).

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder,
  PermissionsBitField, escapeMarkdown,
} = require('discord.js');

const TYPES = ['button', 'select', 'reaction'];
const MODES = ['normal', 'unique', 'verify', 'drop'];
const MAX_ENTRIES = { button: 25, select: 25, reaction: 20 };
const MAX_PANELS = 50;
const LIMITS = { title: 256, description: 1000, buttonLabel: 80, optionLabel: 100, optionDescription: 100 };

// Permissions that turn a self-assign role into a moderation/admin grant. A panel may only offer a role holding
// any of these when an administrator confirms it (allow_dangerous), and only the bits confirmed at that moment:
// if the role later gains more, grants stop until someone confirms again.
const DANGEROUS = [
  'Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageWebhooks', 'BanMembers', 'KickMembers',
  'ModerateMembers', 'ManageMessages', 'MentionEveryone', 'ManageNicknames', 'ManageGuildExpressions',
  'ManageEvents', 'ManageThreads', 'ViewAuditLog',
];
const DANGER_MASK = DANGEROUS.reduce((m, n) => m | (PermissionsBitField.Flags[n] ?? 0n), 0n);

function permBits(role) {
  const p = role?.permissions;
  if (p === undefined || p === null) return 0n;
  if (typeof p === 'bigint') return p;
  if (typeof p.bitfield === 'bigint') return p.bitfield;
  try { return BigInt(p); } catch { return 0n; }
}

function dangerBits(role) {
  return permBits(role) & DANGER_MASK;
}

function dangerNames(bits) {
  const out = [];
  for (const n of DANGEROUS) if (bits & PermissionsBitField.Flags[n]) out.push(n.replace(/([a-z])([A-Z])/g, '$1 $2'));
  return out;
}

// ---------- emoji ----------

const CUSTOM_EMOJI = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/;
const KEYCAP = /^[0-9#*]️?⃣$/;
const PICTO = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

// Returns { emoji: { id?, name, animated? }, key } or { error }. key is how reactions are matched:
// the id for custom emoji, the unicode without variation selectors otherwise.
function parseEmoji(input, { client } = {}) {
  const raw = String(input ?? '').trim();
  if (!raw) return { error: 'Emoji is empty.' };
  const m = CUSTOM_EMOJI.exec(raw);
  if (m) {
    const cache = client?.emojis?.cache;
    if (cache && typeof cache.has === 'function' && !cache.has(m[3])) {
      return { error: `I can't use ${raw}: it is from a server I'm not in. Use a default emoji or one from this server.` };
    }
    return { emoji: { id: m[3], name: m[2], animated: m[1] === 'a' }, key: m[3] };
  }
  if (raw.length > 16 || /\s/.test(raw)) return { error: 'Use a single emoji (a default one, or a custom one from this server).' };
  if (!KEYCAP.test(raw) && (/[A-Za-z0-9]/.test(raw) || !PICTO.test(raw))) {
    return { error: `\`${clipText(raw, 20)}\` is not an emoji. Use a default emoji or a custom one from this server.` };
  }
  return { emoji: { name: raw }, key: reactionKeyOf(raw) };
}

function reactionKeyOf(name) {
  return String(name).replace(/️/g, '');
}

// Key of a discord.js ReactionEmoji / GuildEmoji, comparable with parseEmoji().key.
function reactionKey(emoji) {
  if (!emoji) return null;
  if (emoji.id) return String(emoji.id);
  return emoji.name ? reactionKeyOf(emoji.name) : null;
}

function emojiText(e) {
  if (!e) return '';
  if (e.id) return `<${e.animated ? 'a' : ''}:${e.name || 'e'}:${e.id}>`;
  return e.name || '';
}

function clipText(s, n) {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, Math.max(0, n - 3))}...` : t;
}

// ---------- validation ----------

// Problems with offering `role` on a panel, created by `invoker`. Wraps modguard.roleProblem (everyone, managed,
// invoker rank, bot rank) and adds the dangerous-permission gate. Returns { error } or { dangerOk } (bits string|null).
function createCheck(guild, invoker, role, { allowDangerous = false, roleProblem } = {}) {
  const problem = roleProblem(guild, invoker, role);
  if (problem) return { error: problem };
  const bits = dangerBits(role);
  if (!bits) return { dangerOk: null };
  const names = dangerNames(bits).join(', ');
  const isAdmin = guild.ownerId === invoker.id || !!invoker.permissions?.has?.(PermissionsBitField.Flags.Administrator);
  if (!allowDangerous) {
    return { error: `That role has staff permissions (${names}). Anyone who clicks would get them. If that is intended, an administrator can re-run with \`allow_dangerous: true\`.` };
  }
  if (!isAdmin) return { error: `Only an administrator can put a role with staff permissions (${names}) on a panel.` };
  return { dangerOk: bits.toString() };
}

// Why the bot must not grant/remove `role` right now, or null. `adding` false skips the danger gate:
// taking a staff role off yourself is never an escalation.
function grantProblem(guild, role, entry, { adding = true } = {}) {
  if (!role) return 'That role was deleted. Ask a moderator to update this panel.';
  if (role.id === guild.id) return 'This panel points at @everyone, which cannot be assigned.';
  if (role.managed) return `**${escapeMarkdown(role.name)}** is managed by an integration and cannot be assigned.`;
  if (!role.editable) return `I can't manage **${escapeMarkdown(role.name)}**: my highest role is below it or I lost Manage Roles. Ask a moderator to fix my role position.`;
  if (adding) {
    const bits = dangerBits(role);
    let confirmed = 0n;
    try { confirmed = entry?.danger_ok ? BigInt(entry.danger_ok) : 0n; } catch { confirmed = 0n; }
    if (bits & ~confirmed) {
      return `**${escapeMarkdown(role.name)}** now has staff permissions (${dangerNames(bits & ~confirmed).join(', ')}), so I stopped handing it out. An administrator must re-add it to the panel with \`allow_dangerous: true\`.`;
    }
  }
  return null;
}

// ---------- what a pick does ----------

// Button click or select pick. held: Set of role ids the member has. panelIds: every role id on the panel.
// picked: role ids chosen. Returns { add: [], remove: [], already: [], missing: [] }.
function planPick(mode, held, panelIds, picked) {
  const out = { add: [], remove: [], already: [], missing: [] };
  const ids = [...new Set(picked)].filter((id) => panelIds.includes(id));
  if (mode === 'unique') {
    const id = ids[0];
    if (!id) return out;
    if (held.has(id)) { out.remove.push(id); return out; }
    out.add.push(id);
    for (const other of panelIds) if (other !== id && held.has(other)) out.remove.push(other);
    return out;
  }
  for (const id of ids) {
    const has = held.has(id);
    if (mode === 'verify') (has ? out.already : out.add).push(id);
    else if (mode === 'drop') (has ? out.remove : out.missing).push(id);
    else (has ? out.remove : out.add).push(id);
  }
  return out;
}

// Emoji reaction added (added=true) or removed. Reactions are state, not toggles: adding means "I want it".
function planReaction(mode, held, panelIds, roleId, added) {
  const out = { add: [], remove: [], already: [], missing: [] };
  if (!panelIds.includes(roleId)) return out;
  const has = held.has(roleId);
  if (added) {
    if (mode === 'drop') { if (has) out.remove.push(roleId); return out; }
    if (!has) out.add.push(roleId);
    if (mode === 'unique') for (const other of panelIds) if (other !== roleId && held.has(other)) out.remove.push(other);
    return out;
  }
  if ((mode === 'normal' || mode === 'unique') && has) out.remove.push(roleId);
  return out;
}

// ---------- rendering ----------

const HINTS = {
  button: { normal: 'Click a button to get the role. Click it again to remove it.', unique: 'You can hold one role from this panel. Clicking another swaps it.', verify: 'Click to get the role. Roles here cannot be removed with the panel.', drop: 'Click a button to remove that role from yourself.' },
  select: { normal: 'Pick roles from the menu. Picking one you already have removes it.', unique: 'Pick one role. Picking another swaps it.', verify: 'Pick roles to get them. Roles here cannot be removed with the panel.', drop: 'Pick roles to remove them from yourself.' },
  reaction: { normal: 'React to get a role. Remove your reaction to drop it.', unique: 'React to pick one role. Reacting to another swaps it.', verify: 'React to get a role. Removing the reaction keeps the role.', drop: 'React to remove that role from yourself.' },
};

function entryLabel(entry, role) {
  return entry.label || role?.name || 'Deleted role';
}

// Builds { embeds, components } for a panel. resolveRole(id) -> Role|undefined (used for default labels).
function render(panel, entries, { client, resolveRole = () => undefined } = {}) {
  const { joinClipped } = require('./modguard');
  const type = TYPES.includes(panel.type) ? panel.type : 'button';
  const mode = MODES.includes(panel.mode) ? panel.mode : 'normal';
  const hint = HINTS[type][mode];
  const desc = panel.description ? clipText(panel.description, LIMITS.description) : '';
  const lines = entries.map((e) => {
    const role = resolveRole(e.role_id);
    const em = emojiText(e.emoji ? JSON.parse(e.emoji) : null);
    const label = e.label ? ` **${escapeMarkdown(e.label)}**` : '';
    return `${em}${label}${em || label ? ' - ' : ''}<@&${e.role_id}>${role ? '' : ' (deleted)'}`.trim();
  });
  const budget = 4096 - desc.length - hint.length - 8;
  const list = lines.length ? joinClipped(lines, budget) : '*No roles yet. Add one with `/reactionrole add`.*';
  const embed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle(clipText(panel.title || 'Roles', LIMITS.title))
    .setDescription([desc, list, `*${hint}*`].filter(Boolean).join('\n\n'))
    .setFooter({ text: `mofu - panel #${panel.panel_id}`, iconURL: client?.user?.displayAvatarURL?.() || undefined });

  const components = [];
  if (type === 'button' && entries.length) {
    const buttons = entries.slice(0, MAX_ENTRIES.button).map((e) => {
      const b = new ButtonBuilder()
        .setCustomId(`rp:${panel.panel_id}:${e.role_id}`)
        .setStyle(ButtonStyle.Secondary);
      const em = e.emoji ? JSON.parse(e.emoji) : null;
      if (em) b.setEmoji(em);
      const label = clipText(entryLabel(e, resolveRole(e.role_id)), LIMITS.buttonLabel);
      if (label || !em) b.setLabel(label || 'Role');
      return b;
    });
    for (let i = 0; i < buttons.length; i += 5) components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  } else if (type === 'select' && entries.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`rp:${panel.panel_id}`)
      .setPlaceholder(mode === 'unique' ? 'Pick a role' : mode === 'drop' ? 'Pick roles to remove' : 'Pick roles')
      .setMinValues(1)
      .setMaxValues(mode === 'unique' ? 1 : Math.min(entries.length, MAX_ENTRIES.select))
      .addOptions(entries.slice(0, MAX_ENTRIES.select).map((e) => {
        const o = { label: clipText(entryLabel(e, resolveRole(e.role_id)), LIMITS.optionLabel), value: e.role_id };
        if (e.description) o.description = clipText(e.description, LIMITS.optionDescription);
        const em = e.emoji ? JSON.parse(e.emoji) : null;
        if (em) o.emoji = em;
        return o;
      }));
    components.push(new ActionRowBuilder().addComponents(menu));
  }
  return { embeds: [embed], components };
}

// One-line human summary of a plan result for the ephemeral reply.
function describeResult({ added = [], removed = [], already = [], missing = [], failed = [] }, nameOf) {
  const list = (ids) => ids.map((id) => `**${escapeMarkdown(nameOf(id))}**`).join(', ');
  const parts = [];
  if (added.length) parts.push(`Added ${list(added)}.`);
  if (removed.length) parts.push(`Removed ${list(removed)}.`);
  if (already.length) parts.push(`You already have ${list(already)}.`);
  if (missing.length) parts.push(`You don't have ${list(missing)}, nothing to remove.`);
  if (failed.length) parts.push(failed.join('\n'));
  return parts.join('\n') || 'Nothing changed.';
}

module.exports = {
  TYPES, MODES, MAX_ENTRIES, MAX_PANELS, LIMITS, DANGEROUS, DANGER_MASK, HINTS,
  dangerBits, dangerNames, parseEmoji, reactionKey, reactionKeyOf, emojiText, clipText,
  createCheck, grantProblem, planPick, planReaction, render, describeResult,
};
