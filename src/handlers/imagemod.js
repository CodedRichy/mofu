// Discord glue for image checks (logic lives in src/utils/crowdsignal.js and src/utils/imagemod.js).
//
// Flow: a message or alarm reaction feeds the crowd tracker. When a window fires (or a brand-new account posts an
// image and the server turned on scan-all), the ONE image is analysed and, if it matches an enabled category,
// an alert goes to the modlog channel with Delete / Timeout / Dismiss buttons. The alert links to the message;
// the image is never re-sent, stored or forwarded. Button state lives in the shared pending map from
// src/ai/actions.js (same double-click guard), the presser's permissions are read fresh at press time, and every
// press is audit-tagged in the same ai_actions table.
const crypto = require('crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const store = require('../database/store');
const { shared } = require('../ai/actions');
const { base, response, dmNotice } = require('../utils/embed');
const { colors, BRAND } = require('../utils/constants');
const duration = require('../utils/duration');
const modlog = require('../utils/modlog');
const crowd = require('../utils/crowdsignal');
const imagemod = require('../utils/imagemod');
const scamshield = require('../utils/scamshield');
const log = require('../utils/logger');

const { pending, audit } = shared;
const NO_PINGS = { parse: [], repliedUser: false };
const TIMEOUT_MS = 60 * 60 * 1000;
const ALERT_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ALERTED = 500;

const tracker = new crowd.CrowdTracker();
const countersLoaded = new Set(); // `${guildId}:${channelId}`, bounded
const alerted = new Set();        // message ids that already got an alert, bounded
const handledInteractions = new Set();

function remember(set, value, max) {
  set.delete(value);
  set.add(value);
  while (set.size > max) set.delete(set.values().next().value);
}

// ---------- message data ----------

// Plain image refs from a Discord message: attachments, embed images (Discord's proxy copy) and PNG stickers.
function gatherImages(message) {
  const out = [];
  for (const a of message.attachments?.values?.() || []) {
    if (a.contentType ? /^image\//i.test(a.contentType) : /\.(png|jpe?g|webp|gif)$/i.test(a.name || '')) {
      out.push({ url: a.url, size: a.size, contentType: a.contentType || '' });
    }
  }
  for (const e of message.embeds || []) {
    const u = e.image?.proxyURL || e.thumbnail?.proxyURL;
    if (u) out.push({ url: u, size: 0, contentType: '' });
  }
  for (const s of message.stickers?.values?.() || []) {
    if (s.format === 1 || s.format === 2) out.push({ url: s.url, size: 0, contentType: '' }); // PNG / APNG; Lottie is not an image
  }
  return out.slice(0, imagemod.MAX_IMAGES_PER_MESSAGE);
}

function isImageMessage(message) {
  return crowd.hasImagePost({
    attachments: [...(message.attachments?.values?.() || [])].map((a) => ({ contentType: a.contentType, name: a.name, url: a.url })),
    embeds: (message.embeds || []).map((e) => ({ image: e.image, thumbnail: e.thumbnail, type: e.type, video: e.video })),
    stickerCount: message.stickers?.size || 0,
    content: message.content,
  });
}

function ensureCounters(guildId, channelId) {
  const key = `${guildId}:${channelId}`;
  if (countersLoaded.has(key)) return;
  remember(countersLoaded, key, 2000);
  tracker.setCounters(channelId, imagemod.loadFeedback(guildId)[channelId]);
}

// ---------- alert ----------

const pct = (n) => `${Math.round(n * 100)}%`;
const jump = (guildId, channelId, messageId) => `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

function buttons(id, { del = true, to = true, no = true } = {}) {
  const row = new ActionRowBuilder();
  if (del) row.addComponents(new ButtonBuilder().setCustomId(`imgmod:${id}:del`).setLabel('Delete message').setStyle(ButtonStyle.Danger));
  if (to) row.addComponents(new ButtonBuilder().setCustomId(`imgmod:${id}:to`).setLabel(`Timeout author ${duration.format(TIMEOUT_MS)}`).setStyle(ButtonStyle.Secondary));
  if (no) row.addComponents(new ButtonBuilder().setCustomId(`imgmod:${id}:no`).setLabel('Dismiss').setStyle(ButtonStyle.Secondary));
  return row.components.length ? [row] : [];
}

function alertEmbed({ client, guildId, message, decision, trigger, autoDeleted }) {
  const lines = [
    `**Possible ${imagemod.CATEGORY_LABEL[decision.category] || decision.category}** (${pct(decision.confidence)} confidence, ${decision.source})`,
    `**Author** <@${message.author.id}> \`${message.author.id}\``,
    `**Where** <#${message.channelId}> [jump to message](${jump(guildId, message.channelId, message.id)})`,
    `**Why it was checked** ${trigger.reasons.length ? trigger.reasons.join('; ') : trigger.label}`,
  ];
  if (autoDeleted) lines.push('**Status** Deleted automatically (auto-delete is on for this server).');
  lines.push('', decision.source === 'model' ? imagemod.PROCESSED_LINE : 'The QR code was decoded on the bot host and the image was not sent to a model.');
  lines.push(imagemod.REPORT_LINE, 'The image is not copied, stored or re-posted here.');
  return base(client, autoDeleted ? colors.muted : colors.warning)
    .setAuthor({ name: 'IMAGE CHECK' })
    .setDescription(lines.join('\n').slice(0, 4000));
}

async function postAlert(guild, message, decision, trigger, { autoDeleted = false } = {}) {
  const channelId = store.getConfig(guild.id, 'modlog_channel');
  const channel = channelId && guild.channels.cache.get(channelId);
  if (!channel) return false;

  const id = crypto.randomUUID();
  const embed = alertEmbed({ client: guild.client, guildId: guild.id, message, decision, trigger, autoDeleted });
  const sent = await channel.send({
    embeds: [embed],
    components: buttons(id, { del: !autoDeleted }),
    allowedMentions: NO_PINGS,
  }).catch(() => null);
  if (!sent) return false;

  const timer = setTimeout(() => {
    if (!pending.delete(id)) return;
    sent.edit({ components: [], allowedMentions: NO_PINGS }).catch(() => {});
  }, ALERT_TTL_MS);
  timer.unref();

  pending.set(id, {
    kind: 'imagemod', guildId: guild.id, invokerId: null, timer,
    channelId: message.channelId, messageId: message.id, authorId: message.author.id,
    category: decision.category, crowdChannel: trigger.crowd ? message.channelId : null,
    deleted: autoDeleted, timedOut: false, busy: false,
  });

  // Buttons are handled here too, so no change to the interaction router is needed. The router may also call
  // handleButton(); handledInteractions makes sure a press runs once either way.
  const collector = sent.createMessageComponentCollector({ time: ALERT_TTL_MS });
  collector.on('collect', (i) => { handleButton(i).catch((err) => log.warn(`[imagemod] button failed: ${err.message}`)); });
  return true;
}

// ---------- scan ----------

async function scanMessage(message, trigger) {
  const guild = message.guild;
  const cfg = imagemod.getConfig(guild.id);
  if (!cfg.enabled || alerted.has(message.id)) return false;
  if (!store.getConfig(guild.id, 'modlog_channel')) return false; // nowhere to alert: do nothing
  const images = gatherImages(message);
  if (!images.length) return false;
  remember(alerted, message.id, MAX_ALERTED);

  let best = null;
  for (const img of images) {
    const res = await imagemod.analyzeImage(guild.id, img, cfg);
    if (res.decision.flagged && (!best || res.decision.confidence > best.confidence)) best = res.decision;
  }
  if (!best) return false;

  imagemod.bumpUsage(guild.id, 'flagged');
  let autoDeleted = false;
  if (imagemod.shouldAutoDelete(best, cfg)) {
    autoDeleted = await message.delete().then(() => true).catch(() => false);
    if (autoDeleted) imagemod.bumpUsage(guild.id, 'deleted');
  }
  const ok = await postAlert(guild, message, best, trigger, { autoDeleted });
  log.info(`[imagemod] ${guild.id}: flagged ${best.category} (${pct(best.confidence)}) via ${trigger.label}, alert ${ok ? 'sent' : 'not sent'}`);
  return true;
}

async function handleFire(guild, ev) {
  const channel = guild.channels.cache.get(ev.channelId);
  if (!channel?.messages) return;
  const message = await channel.messages.fetch(ev.messageId).catch(() => null);
  if (!message || !message.author || message.author.bot) return;
  const label = ev.via === 'reactions' ? 'alarm reactions on the image' : 'chat reacted to the image';
  await scanMessage(message, { crowd: true, label, reasons: ev.reasons });
}

// ---------- events ----------

async function onMessage(message) {
  try {
    const { guild, author } = message;
    if (!guild || !author || author.bot || message.webhookId) return;
    const cfg = imagemod.getConfig(guild.id);
    if (!cfg.enabled) return;

    ensureCounters(guild.id, message.channelId);
    const isImage = isImageMessage(message);
    const events = tracker.observeMessage({
      channelId: message.channelId, messageId: message.id, authorId: author.id,
      content: message.content, isImage, replyToId: message.reference?.messageId || null,
    });
    for (const ev of events) await handleFire(guild, ev);

    if (cfg.scanAll && isImage && message.member && imagemod.isNewAccount(author.createdTimestamp)) {
      const exempt = scamshield.isExempt({ permissions: message.member.permissions, roleIds: [...message.member.roles.cache.keys()] }, null);
      if (!exempt) await scanMessage(message, { crowd: false, label: 'new account (under 7 days) posted an image', reasons: [] });
    }
  } catch (err) {
    log.warn(`[imagemod] message hook failed: ${err.message}`);
  }
}

async function onReaction(reaction, user) {
  try {
    if (!user || user.bot) return;
    const emoji = reaction.emoji?.name;
    if (!crowd.emojiWeight(emoji)) return;
    let message = reaction.message;
    if (!message.guildId) return;
    const guild = message.guild || reaction.client.guilds.cache.get(message.guildId);
    if (!guild) return;
    const cfg = imagemod.getConfig(guild.id);
    if (!cfg.enabled) return;
    if (Date.now() - message.createdTimestamp > crowd.WINDOW_MS) return;

    ensureCounters(guild.id, message.channelId);
    if (!tracker.hasWindow(message.channelId, message.id)) {
      if (message.partial || !message.author) message = await message.fetch().catch(() => null);
      if (!message?.author || message.author.bot || !isImageMessage(message)) return;
      tracker.openWindow({ channelId: message.channelId, messageId: message.id, authorId: message.author.id, now: message.createdTimestamp });
    }
    const events = tracker.observeReaction({ channelId: message.channelId, messageId: message.id, userId: user.id, emoji });
    for (const ev of events) await handleFire(guild, ev);
  } catch (err) {
    log.warn(`[imagemod] reaction hook failed: ${err.message}`);
  }
}

// ---------- buttons ----------

function statusLine(text) {
  return `${text}`.slice(0, 1000);
}

async function handleButton(interaction) {
  if (handledInteractions.has(interaction.id)) return;
  remember(handledInteractions, interaction.id, 200);

  const [, id, verb] = String(interaction.customId).split(':');
  const ephemeral = (description, color = colors.muted) =>
    interaction.reply({ embeds: [response({ client: interaction.client, description, color })], ephemeral: true }).catch(() => {});

  const p = pending.get(id);
  if (!p || p.kind !== 'imagemod') {
    return interaction.update({ components: [], allowedMentions: NO_PINGS }).catch(() => ephemeral('That alert has expired. Nothing was done.'));
  }
  const { guild } = interaction;
  if (!guild || guild.id !== p.guildId) return ephemeral('That alert belongs to another server.', colors.error);
  if (p.busy) return ephemeral('That button is already being handled.');

  // Fresh permission read, every press.
  const member = await guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
  if (!member) return ephemeral("Couldn't verify your permissions.", colors.error);
  const channel = guild.channels.cache.get(p.channelId);
  const canMessages = channel ? member.permissionsIn(channel).has('ManageMessages') : member.permissions.has('ManageMessages');
  const need = verb === 'to' ? { ok: member.permissions.has('ModerateMembers'), label: 'Moderate Members' } : { ok: canMessages, label: 'Manage Messages' };
  if (!['del', 'to', 'no'].includes(verb)) return ephemeral('Unknown button.', colors.error);
  if (!need.ok) return ephemeral(`You need the **${need.label}** permission to do that.`, colors.error);

  let target = null;
  if (verb === 'to') {
    target = await guild.members.fetch(p.authorId).catch(() => null);
    if (!target) return ephemeral("That member isn't in the server.", colors.error);
    if (target.id === interaction.user.id) return ephemeral("You can't time yourself out.", colors.error);
    if (target.id === guild.ownerId || target.id === guild.client.user.id) return ephemeral("That member can't be timed out.", colors.error);
    if (!target.moderatable) return ephemeral("I can't time that member out (their role is above mine, or I'm missing a permission).", colors.error);
    if (interaction.user.id !== guild.ownerId && target.roles.highest.position >= member.roles.highest.position) {
      return ephemeral("You can't time out someone with a higher or equal role.", colors.error);
    }
  }

  p.busy = true; // double-click guard: released below
  try {
    await interaction.deferUpdate();
  } catch {
    p.busy = false;
    return;
  }

  const auditKind = { del: 'image_delete', to: 'image_timeout', no: 'image_dismiss' }[verb];
  const auditId = audit.record({ guildId: guild.id, invokerId: interaction.user.id, targetId: p.authorId, kind: auditKind, reason: `[${BRAND} imagemod] ${p.category}`, durationMs: verb === 'to' ? TIMEOUT_MS : null });
  const finish = (status, note) => audit.resolve(auditId, status, note);
  let line;

  if (verb === 'del') {
    try {
      await guild.channels.cache.get(p.channelId)?.messages.delete(p.messageId);
      line = 'Message deleted.';
    } catch (err) {
      if (err?.code === 10008) line = 'Message was already gone.';
      else { finish('failed', err.message); p.busy = false; return interaction.followUp({ embeds: [response({ client: interaction.client, description: "Couldn't delete it. Check my permissions.", color: colors.error })], ephemeral: true }).catch(() => {}); }
    }
    p.deleted = true;
    finish('executed');
    imagemod.bumpUsage(guild.id, 'deleted');
    feedback(guild.id, p, 'confirmed');
  } else if (verb === 'to') {
    const reason = `[${BRAND} imagemod] ${imagemod.CATEGORY_LABEL[p.category] || p.category}, confirmed by ${interaction.user.tag}`;
    try {
      await target.timeout(TIMEOUT_MS, reason.slice(0, 512));
    } catch (err) {
      finish('failed', err.message);
      p.busy = false;
      return interaction.followUp({ embeds: [response({ client: interaction.client, description: "Couldn't time that member out. Check my permissions.", color: colors.error })], ephemeral: true }).catch(() => {});
    }
    p.timedOut = true;
    finish('executed');
    const caseId = modlog.openCase(guild, { action: 'mute', target: target.user, moderator: interaction.user, reason, duration: duration.format(TIMEOUT_MS) });
    await target.user.send({ embeds: [dmNotice({ guild, action: 'muted', reason: 'an image you posted was flagged and a moderator confirmed it', color: colors.warning, duration: duration.format(TIMEOUT_MS), caseId })] }).catch(() => {});
    await modlog.send(guild, { action: 'mute', target: target.user, moderator: interaction.user, reason, duration: duration.format(TIMEOUT_MS), extra: 'Image check alert', caseId }).catch(() => {});
    line = `Author timed out for ${duration.format(TIMEOUT_MS)}${caseId ? ` (case #${caseId})` : ''}.`;
  } else {
    p.dismissed = true;
    finish('cancelled');
    imagemod.bumpUsage(guild.id, 'dismissed');
    feedback(guild.id, p, 'falseAlarm');
    line = 'Dismissed as a false alarm.';
  }

  const done = verb === 'no' || (p.deleted && p.timedOut);
  p.busy = false;
  if (done) { pending.delete(id); clearTimeout(p.timer); }

  const prior = interaction.message?.embeds?.[0];
  const embed = prior ? EmbedBuilder.from(prior) : base(interaction.client, colors.muted);
  embed.addFields({ name: statusLine(`Handled by ${interaction.user.tag}`), value: line });
  await interaction.editReply({
    embeds: [embed],
    components: done ? [] : buttons(id, { del: !p.deleted, to: !p.timedOut, no: true }),
    allowedMentions: NO_PINGS,
  }).catch(() => {});
}

// Moderator feedback tunes the crowd threshold of the channel where the image appeared. Counters only.
function feedback(guildId, p, kind) {
  if (!p.crowdChannel) return;
  const counters = tracker.feedback(p.crowdChannel, kind);
  imagemod.saveFeedback(guildId, p.crowdChannel, counters);
}

function statusFor(guildId) {
  return { usage: imagemod.getUsage(guildId), cfg: imagemod.getConfig(guildId), modlog: Boolean(store.getConfig(guildId, 'modlog_channel')) };
}

module.exports = { onMessage, onReaction, handleButton, gatherImages, isImageMessage, statusFor, _tracker: tracker };
