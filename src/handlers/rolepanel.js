// Runtime side of role panels: button clicks, select picks, emoji reactions, legacy `rr_<role>` buttons, and
// keeping a panel's Discord message in sync with its database row. Rules live in src/utils/rolepanel.js.

const { PermissionFlagsBits, escapeMarkdown } = require('discord.js');
const { colors } = require('../utils/constants');
const { response } = require('../utils/embed');
const log = require('../utils/logger');
const rp = require('../utils/rolepanel');

const db = () => require('../database/rolepanels');

// One pick at a time per member, so two fast clicks in unique mode cannot both add.
const busy = new Set();
// Reactions queue per member (promise chain) rather than being dropped while one is in flight.
const reactionChains = new Map();

const reply = (interaction, description, color = colors.error) =>
  interaction.editReply({ embeds: [response({ client: interaction.client, description, color })] });

// Apply a plan to a member. Every grant is re-checked against the live role first.
async function applyPlan(guild, member, plan, entries) {
  const byRole = new Map(entries.map((e) => [e.role_id, e]));
  const result = { added: [], removed: [], already: plan.already, missing: plan.missing, failed: [] };
  for (const id of plan.add) {
    const role = guild.roles.cache.get(id);
    const problem = rp.grantProblem(guild, role, byRole.get(id), { adding: true });
    if (problem) { result.failed.push(problem); continue; }
    try { await member.roles.add(id, 'Role panel'); result.added.push(id); } catch (err) {
      result.failed.push(`Couldn't add **${escapeMarkdown(role.name)}**: ${err.code === 50013 ? 'I am missing permission.' : 'Discord refused.'}`);
    }
  }
  // Adds go first: if one fails, skipping the removals keeps the member from ending up with nothing.
  if (result.failed.length && plan.remove.length) {
    result.failed.push('Skipped removing your other roles because a role could not be added.');
  } else for (const id of plan.remove) {
    const role = guild.roles.cache.get(id);
    const problem = rp.grantProblem(guild, role, byRole.get(id), { adding: false });
    if (problem) { result.failed.push(problem); continue; }
    try { await member.roles.remove(id, 'Role panel'); result.removed.push(id); } catch (err) {
      result.failed.push(`Couldn't remove **${escapeMarkdown(role.name)}**: ${err.code === 50013 ? 'I am missing permission.' : 'Discord refused.'}`);
    }
  }
  return result;
}

const nameOf = (guild) => (id) => guild.roles.cache.get(id)?.name || 'deleted role';

// Shared by buttons and selects. picked: role ids.
async function handlePick(interaction, panelId, picked) {
  const { guild, member, user } = interaction;
  await interaction.deferReply({ ephemeral: true });
  if (!guild || !member) return reply(interaction, 'This panel only works inside its server.');

  const panel = db().getPanel(guild.id, panelId);
  if (!panel) return reply(interaction, 'This role panel was deleted. Ask a moderator for the current one.');
  if (panel.message_id && interaction.message?.id && panel.message_id !== interaction.message.id) {
    return reply(interaction, 'This is an old copy of the panel. Use the newest one.');
  }
  const panelIds = panel.entries.map((e) => e.role_id);
  const known = picked.filter((id) => panelIds.includes(id));
  if (!known.length) return reply(interaction, 'That role is no longer on this panel.');

  const lock = `${guild.id}:${user.id}`;
  if (busy.has(lock)) return reply(interaction, 'Still working on your last pick. Try again in a second.');
  busy.add(lock);
  try {
    const held = new Set(member.roles.cache.keys());
    const plan = rp.planPick(panel.mode, held, panelIds, known);
    const result = await applyPlan(guild, member, plan, panel.entries);
    const ok = result.added.length || result.removed.length;
    const color = result.failed.length && !ok ? colors.error : result.added.length ? colors.success : colors.muted;
    return reply(interaction, rp.describeResult(result, nameOf(guild)), color);
  } finally {
    busy.delete(lock);
  }
}

async function handleButton(interaction) {
  const m = /^rp:(\d{1,9}):(\d{17,20})$/.exec(interaction.customId);
  if (!m) return;
  return handlePick(interaction, Number(m[1]), [m[2]]);
}

// The client keeps showing the last pick in the menu; re-sending the same components clears it. Debounced per
// message so a busy panel costs one edit, not one per pick.
const resetTimers = new Map();
function scheduleMenuReset(message) {
  if (!message?.edit || resetTimers.has(message.id)) return;
  const t = setTimeout(() => {
    resetTimers.delete(message.id);
    message.edit({ components: message.components }).catch(() => {});
  }, 1500);
  t.unref?.();
  resetTimers.set(message.id, t);
}

async function handleSelect(interaction) {
  const m = /^rp:(\d{1,9})$/.exec(interaction.customId);
  if (!m) return;
  const picked = (interaction.values || []).filter((v) => /^\d{17,20}$/.test(v));
  try {
    return await handlePick(interaction, Number(m[1]), picked);
  } finally {
    scheduleMenuReset(interaction.message);
  }
}

// Panels made before panels were stored: `rr_<roleId>`, plain toggle. Same live checks; no staff roles at all,
// since nobody ever confirmed one for these.
async function handleLegacyButton(interaction) {
  const { guild, member } = interaction;
  const roleId = interaction.customId.slice(3);
  await interaction.deferReply({ ephemeral: true });
  if (!guild || !member) return reply(interaction, 'This panel only works inside its server.');
  const role = guild.roles.cache.get(roleId);
  const removing = member.roles.cache.has(roleId);
  const problem = rp.grantProblem(guild, role, null, { adding: !removing });
  if (problem) return reply(interaction, problem);
  const plan = removing ? { add: [], remove: [roleId], already: [], missing: [] } : { add: [roleId], remove: [], already: [], missing: [] };
  const result = await applyPlan(guild, member, plan, []);
  const color = result.failed.length ? colors.error : removing ? colors.muted : colors.success;
  return reply(interaction, rp.describeResult(result, nameOf(guild)), color);
}

// messageReactionAdd / messageReactionRemove. Returns true when the reaction belonged to a role panel.
async function handleReaction(reaction, user, added) {
  if (user?.bot) return false;
  const message = reaction.message;
  const guild = message?.guild;
  if (!guild || !message.id) return false;
  let panel;
  try { panel = db().panelByMessage(message.id); } catch (err) { log.warn('Role panel lookup failed:', err.message); return false; }
  if (!panel || panel.guild_id !== guild.id || panel.type !== 'reaction') return false;

  const key = rp.reactionKey(reaction.emoji);
  const entry = panel.entries.find((e) => e.emoji_key === key);
  if (!entry) return true;

  const lock = `${guild.id}:${user.id}`;
  // Serialize per member instead of dropping a reaction that arrives while another is being applied.
  const prev = reactionChains.get(lock) || Promise.resolve();
  const run = prev.catch(() => {}).then(async () => {
    // fetched after waiting, so the roles are fresh
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;
    const held = new Set(member.roles.cache.keys());
    const plan = rp.planReaction(panel.mode, held, panel.entries.map((e) => e.role_id), entry.role_id, added);
    const result = await applyPlan(guild, member, plan, panel.entries);
    if (result.failed.length) log.debug(`Role panel #${panel.panel_id} in ${guild.id}: ${result.failed.join(' | ')}`);
    // Unique mode: take the member's other reactions off so the message shows their one pick.
    if (added && panel.mode === 'unique' && result.added.length) {
      for (const other of panel.entries) {
        if (other.role_id === entry.role_id || !other.emoji_key) continue;
        const r = findReaction(message, (x) => rp.reactionKey(x.emoji) === other.emoji_key);
        if (r) r.users.remove(user.id).catch(() => {});
      }
    }
    // Drop / verify reactions are one-shot: clear the member's reaction so they can use it again.
    if (added && (panel.mode === 'drop' || panel.mode === 'verify')) reaction.users.remove(user.id).catch(() => {});
  });
  reactionChains.set(lock, run);
  try {
    await run;
  } catch (err) {
    log.warn('Role panel reaction failed:', err.message);
  } finally {
    if (reactionChains.get(lock) === run) reactionChains.delete(lock);
  }
  return true;
}

// What the bot needs in a channel to post (and, for reaction panels, react on) a panel. Returns a problem or null.
function channelProblem(channel, me, type) {
  if (!channel || typeof channel.send !== 'function' || !channel.isTextBased?.()) return 'Pick a text channel for the panel.';
  const perms = channel.permissionsFor?.(me);
  if (!perms) return null;
  const need = [['ViewChannel', 'View Channel'], ['SendMessages', 'Send Messages'], ['EmbedLinks', 'Embed Links']];
  if (type === 'reaction') need.push(['AddReactions', 'Add Reactions'], ['ReadMessageHistory', 'Read Message History']);
  const missing = need.filter(([flag]) => !perms.has(PermissionFlagsBits[flag])).map(([, label]) => label);
  return missing.length ? `I need ${missing.join(', ')} in ${channel} to post this panel.` : null;
}

const findReaction = (message, pred) => {
  for (const r of message.reactions?.cache?.values?.() || []) if (pred(r)) return r;
  return null;
};

async function syncReactions(message, panel, botId) {
  for (const e of panel.entries) {
    if (!e.emoji) continue;
    const em = JSON.parse(e.emoji);
    const have = findReaction(message, (r) => rp.reactionKey(r.emoji) === e.emoji_key && r.me);
    if (!have) await message.react(em.id || em.name).catch(() => {});
  }
  const keys = new Set(panel.entries.map((e) => e.emoji_key));
  for (const r of message.reactions?.cache?.values() || []) {
    if (r.me && !keys.has(rp.reactionKey(r.emoji))) await r.users.remove(botId).catch(() => {});
  }
}

// Re-render the panel's message from the database. repost: post a new one when the old message is gone.
// Returns { ok: true, message, reposted } or { ok: false, error }.
async function syncMessage(guild, panelId, { repost = false } = {}) {
  const panel = db().getPanel(guild.id, panelId);
  if (!panel) return { ok: false, error: 'That panel does not exist.' };
  const payload = rp.render(panel, panel.entries, { client: guild.client, resolveRole: (id) => guild.roles.cache.get(id) });
  const channel = panel.channel_id ? guild.channels.cache.get(panel.channel_id) : null;
  if (!channel) return { ok: false, error: 'The panel\'s channel is gone. Delete the panel and create it again.' };

  let message = panel.message_id ? await channel.messages.fetch(panel.message_id).catch(() => null) : null;
  let reposted = false;
  if (message) {
    try { await message.edit(payload); } catch (err) {
      return { ok: false, error: `I couldn't edit the panel message (${err.code === 50013 ? 'missing permission' : 'Discord refused'}).` };
    }
  } else {
    if (!repost) return { ok: false, error: `The panel message is gone. Run \`/reactionrole refresh panel:${panel.panel_id}\` to post it again.` };
    const problem = channelProblem(channel, guild.members.me, panel.type);
    if (problem) return { ok: false, error: problem };
    try { message = await channel.send(payload); } catch {
      return { ok: false, error: `I couldn't post in ${channel}. Check my permissions there.` };
    }
    db().setMessage(guild.id, panel.panel_id, channel.id, message.id);
    reposted = true;
  }
  if (panel.type === 'reaction') await syncReactions(message, panel, guild.client.user?.id);
  return { ok: true, message, reposted };
}

module.exports = { handleButton, handleSelect, handleLegacyButton, handleReaction, syncMessage, channelProblem, syncReactions, applyPlan };
