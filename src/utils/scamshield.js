// Scam shield: hijacked-account scam waves, QR-login theft links, staff lookalikes. No AI calls anywhere.
// The detection core is pure (no Discord, no database) so test/scamshield.test.js can drive it directly.
// Only hashes, ids and timestamps are kept in memory, bounded, and never message text or image bytes.
// Config key 'scamshield' per guild: { enabled, timeoutMs, trustedRoles }. Default is OFF.
const crypto = require('crypto');
const store = require('../database/store');
const duration = require('./duration');
const log = require('./logger');
const { colors } = require('./constants');

const BURST_CHANNELS = 3;          // same content in this many different channels...
const BURST_WINDOW_MS = 30 * 1000; // ...inside this window
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const MIN_TIMEOUT_MS = 60 * 1000;
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // Discord ceiling
const MIN_TEXT_LEN = 8;            // shorter text ("lol", "gm") is never fingerprinted
const MAX_USERS = 5000;            // tracker bound (oldest user evicted)
const MAX_ENTRIES_PER_USER = 60;
const ALERT_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_ALERT_KEYS = 2000;

// ---------- config ----------

function normalizeConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const t = Number.isFinite(r.timeoutMs) ? Math.floor(r.timeoutMs) : DEFAULT_TIMEOUT_MS;
  return {
    enabled: r.enabled === true,
    timeoutMs: Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, t)),
    trustedRoles: Array.isArray(r.trustedRoles) ? r.trustedRoles.filter((x) => typeof x === 'string').slice(0, 25) : [],
  };
}

function getConfig(guildId) {
  try { return normalizeConfig(store.getConfig(guildId, 'scamshield')); } catch { return normalizeConfig(null); }
}

function setConfig(guildId, patch) {
  const next = normalizeConfig({ ...getConfig(guildId), ...patch });
  store.setConfig(guildId, 'scamshield', next);
  return next;
}

// ---------- normalisation ----------

const ZERO_WIDTH = /[​-‏⁠-⁤᠎﻿­͏؜‪-‮⁦-⁩]/g;

// Cheap, stable text key: NFKC, zero-width stripped, lowercased, urls reduced to host+path, whitespace collapsed.
function normalizeText(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .toLowerCase()
    .replace(/https?:\/\/(?:www\.)?([^\s/?#]+)([^\s?#]*)[^\s]*/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 20);

function textHash(content) {
  const n = normalizeText(content);
  return n.length >= MIN_TEXT_LEN ? `t:${sha(n)}` : null;
}

// Attachment fingerprint from metadata only: size + file name + content type.
function attachmentFingerprint(att) {
  if (!att || !att.size) return null;
  const name = String(att.name || '').toLowerCase();
  return `a:${sha(`${att.size}|${name}|${att.contentType || ''}`)}`;
}

// Embed fingerprint (link previews of the same scam page): url + title.
function embedFingerprint(e) {
  const url = e?.url || e?.image?.url || e?.thumbnail?.url;
  if (!url) return null;
  return `e:${sha(`${String(url).toLowerCase().replace(/[?#].*$/, '')}|${e.title || ''}`)}`;
}

// All fingerprints a message carries. Takes plain data so tests need no Discord objects.
function messageFingerprints({ content, attachments = [], embeds = [] }) {
  const out = new Set();
  const t = textHash(content);
  if (t) out.add(t);
  for (const a of attachments) { const f = attachmentFingerprint(a); if (f) out.add(f); }
  for (const e of embeds) { const f = embedFingerprint(e); if (f) out.add(f); }
  return [...out];
}

// ---------- burst tracker ----------

class BurstTracker {
  constructor({ windowMs = BURST_WINDOW_MS, minChannels = BURST_CHANNELS, maxUsers = MAX_USERS } = {}) {
    this.windowMs = windowMs;
    this.minChannels = minChannels;
    this.maxUsers = maxUsers;
    this.users = new Map(); // `${guildId}:${userId}` -> [{ fp, channelId, messageId, ts }]
  }

  // Record one message. Returns { triggered, fingerprint, copies: [{ channelId, messageId }] }.
  record({ guildId, userId, channelId, messageId, fingerprints, now = Date.now() }) {
    const key = `${guildId}:${userId}`;
    let list = this.users.get(key);
    if (list) this.users.delete(key); // re-insert below so Map order = recency
    list = (list || []).filter((e) => now - e.ts <= this.windowMs);
    for (const fp of fingerprints || []) list.push({ fp, channelId, messageId, ts: now });
    if (list.length > MAX_ENTRIES_PER_USER) list = list.slice(-MAX_ENTRIES_PER_USER);
    if (list.length) {
      this.users.set(key, list);
      while (this.users.size > this.maxUsers) this.users.delete(this.users.keys().next().value);
    }

    for (const fp of new Set(fingerprints || [])) {
      const hits = list.filter((e) => e.fp === fp);
      if (new Set(hits.map((e) => e.channelId)).size >= this.minChannels) {
        const seen = new Set();
        const copies = [];
        for (const h of hits) {
          if (seen.has(h.messageId)) continue;
          seen.add(h.messageId);
          copies.push({ channelId: h.channelId, messageId: h.messageId });
        }
        this.users.delete(key); // the wave is handled; a fresh one starts clean
        return { triggered: true, fingerprint: fp, copies };
      }
    }
    return { triggered: false, fingerprint: null, copies: [] };
  }

  forget(guildId, userId) { this.users.delete(`${guildId}:${userId}`); }
  get size() { return this.users.size; }
}

// ---------- remote auth (QR login) links ----------

const REMOTE_AUTH = /(?:^|[^a-z0-9.-])(?:[a-z0-9-]+\.)?discord(?:app)?\.com\/ra\/[A-Za-z0-9_-]{6,}/i;

function hasRemoteAuthLink(text) {
  return REMOTE_AUTH.test(String(text || '').normalize('NFKC').replace(ZERO_WIDTH, ''));
}

// ---------- exemptions ----------

// member: { permissions: { has(flag) }, roleIds: string[] }. Staff and trusted roles are never touched.
function isExempt(member, cfg) {
  if (!member) return false;
  const p = member.permissions;
  if (p && (p.has('Administrator') || p.has('ManageMessages') || p.has('ManageGuild'))) return true;
  const trusted = cfg?.trustedRoles || [];
  return (member.roleIds || []).some((id) => trusted.includes(id));
}

const exemptView = (member) => ({ permissions: member.permissions, roleIds: [...(member.roles?.cache?.keys?.() || [])] });

// ---------- impersonation ----------

const CONFUSABLES = {
  // Cyrillic
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i',
  'ј': 'j', 'ӏ': 'l', 'ѕ': 's', 'к': 'k', 'м': 'm', 'н': 'h', 'т': 't', 'в': 'b',
  // Greek
  'ο': 'o', 'α': 'a', 'ρ': 'p', 'ι': 'i', 'ν': 'v', 'τ': 't', 'κ': 'k', 'υ': 'u',
  'Α': 'a', 'Β': 'b', 'Ε': 'e', 'Η': 'h', 'Ι': 'i', 'Κ': 'k', 'Μ': 'm', 'Ν': 'n',
  'Ο': 'o', 'Ρ': 'p', 'Τ': 't', 'Χ': 'x',
  // digits / symbols often swapped in for letters
  '0': 'o', '1': 'l', '3': 'e', '@': 'a', '$': 's', '|': 'l', '!': 'i',
  // dotless / long-s / misc latin
  'ı': 'i', 'ſ': 's', 'ɡ': 'g', 'ɑ': 'a',
};

// Skeleton used to compare names: confusables folded, diacritics and punctuation removed, case-folded.
function nameSkeleton(s) {
  const base = String(s || '').normalize('NFKC').replace(ZERO_WIDTH, '').toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '');
  let out = '';
  for (const ch of base) out += CONFUSABLES[ch] ?? ch;
  return out.replace(/[^a-z0-9]/g, '').replace(/rn/g, 'm').replace(/vv/g, 'w');
}

function editDistance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

const MIN_SKELETON = 4;

// candidate: { id, names: string[], avatar }. staff: [{ id, names: string[], avatar }].
// Returns the matches ({ staffId, reasons[] }) for a non-staff candidate. Alert-only, never an action.
function findImpersonation(candidate, staff) {
  const out = [];
  const cSkels = (candidate.names || []).map(nameSkeleton).filter((s) => s.length >= MIN_SKELETON);
  for (const s of staff || []) {
    if (s.id === candidate.id) continue;
    const reasons = [];
    const sSkels = (s.names || []).map(nameSkeleton).filter((x) => x.length >= MIN_SKELETON);
    outer: for (const c of cSkels) {
      for (const x of sSkels) {
        if (c === x) { reasons.push('name matches after folding lookalike characters'); break outer; }
        if (Math.min(c.length, x.length) >= 6 && editDistance(c, x) <= 1) { reasons.push('name is one character away'); break outer; }
      }
    }
    if (candidate.avatar && s.avatar && candidate.avatar === s.avatar) reasons.push('same avatar image');
    if (reasons.length) out.push({ staffId: s.id, reasons });
  }
  return out;
}

// ---------- Discord glue (best effort, never throws) ----------

const tracker = new BurstTracker();
const alertSeen = new Map(); // dedupe key -> ts, bounded

function alertOnce(key, now = Date.now()) {
  const last = alertSeen.get(key);
  if (last && now - last < ALERT_COOLDOWN_MS) return false;
  alertSeen.delete(key);
  alertSeen.set(key, now);
  while (alertSeen.size > MAX_ALERT_KEYS) alertSeen.delete(alertSeen.keys().next().value);
  return true;
}

function recoveryChecklist(guildName, caseId, timeoutMs) {
  return [
    `Your account sent the same suspicious message in several channels of **${guildName}**, so it was restricted for ${duration.format(timeoutMs)}${caseId ? ` (case #${caseId})` : ''}. This usually means the account was taken over.`,
    '',
    '**To recover your account**',
    '1. Change your Discord password now.',
    '2. In User Settings, Devices, log out of all known devices.',
    '3. Check Authorized Apps and remove any you do not recognise.',
    '4. Turn on two-factor authentication.',
    '5. Do not scan QR codes or open links that ask you to log in again. Scanning a login QR code hands your account to whoever made it.',
  ].join('\n');
}

async function punish(message, { reason, copies, fingerprint, cfg }) {
  const { guild, member, author, client } = message;
  const modlog = require('./modlog');
  const { dmNotice, response } = require('./embed');

  // Delete the copies first (cross-channel), then the current message.
  let deleted = 0;
  const targets = copies.some((c) => c.messageId === message.id) ? copies : [...copies, { channelId: message.channelId, messageId: message.id }];
  for (const c of targets) {
    const ch = guild.channels.cache.get(c.channelId);
    if (!ch?.messages) continue;
    try { await ch.messages.delete(c.messageId); deleted++; } catch { /* already gone or no permission */ }
  }

  let timedOut = false;
  try {
    if (member?.moderatable) { await member.timeout(cfg.timeoutMs, `[${require('./constants').BRAND} scamshield] ${reason}`); timedOut = true; }
  } catch { /* no permission */ }

  const caseId = modlog.openCase(guild, {
    action: 'mute', target: author, moderator: client.user, reason: `[scamshield] ${reason}`, duration: timedOut ? duration.format(cfg.timeoutMs) : null,
  });
  const extra = `Automated, no AI. Deleted ${deleted} of ${targets.length} message(s). ${timedOut ? 'Member timed out.' : 'Timeout failed (check my permissions and role position).'} Fingerprint \`${String(fingerprint).slice(0, 8)}\`.`;
  await modlog.send(guild, { action: 'mute', target: author, moderator: client.user, reason: `[scamshield] ${reason}`, duration: timedOut ? duration.format(cfg.timeoutMs) : null, extra, caseId }).catch(() => {});

  try {
    await author.send({
      embeds: [
        dmNotice({ guild, action: 'restricted', reason: 'suspected hijacked account posting scam content', color: colors.warning, duration: timedOut ? duration.format(cfg.timeoutMs) : null, caseId }),
        response({ client, description: recoveryChecklist(guild.name, caseId, cfg.timeoutMs), color: colors.info }),
      ],
    });
  } catch { /* DMs closed */ }

  log.warn(`[scamshield] ${reason} in ${guild.name}: user ${author.id}, deleted ${deleted}, timeout ${timedOut}`);
}

// Entry point called from events/messageCreate.js. Resolves true when the message was removed as a scam.
async function inspectMessage(message) {
  try {
    const { guild, member, author } = message;
    if (!guild || !member || author?.bot) return false;
    const cfg = getConfig(guild.id);
    if (!cfg.enabled) return false;
    if (isExempt(exemptView(member), cfg)) return false;

    const attachments = [...(message.attachments?.values?.() || [])].map((a) => ({ size: a.size, name: a.name, contentType: a.contentType, url: a.url }));
    const embeds = (message.embeds || []).map((e) => ({ url: e.url, title: e.title, image: e.image, thumbnail: e.thumbnail }));

    // QR login theft: a remote-auth link in the text, or a QR code in an image that decodes to one.
    let remote = hasRemoteAuthLink(message.content);
    if (!remote) {
      const qr = require('./qrscan');
      if (qr.available()) {
        for (const a of attachments) {
          const res = await qr.scanAttachment(a);
          if (res.status === 'ok' && res.urls.some(hasRemoteAuthLink)) { remote = true; break; }
        }
      }
    }
    if (remote) {
      await punish(message, { reason: 'login QR code or remote-auth link (account takeover attempt)', copies: [], fingerprint: 'remote-auth', cfg });
      return true;
    }

    const fingerprints = messageFingerprints({ content: message.content, attachments, embeds });
    if (!fingerprints.length) return false;
    const hit = tracker.record({ guildId: guild.id, userId: author.id, channelId: message.channelId, messageId: message.id, fingerprints });
    if (!hit.triggered) return false;
    await punish(message, { reason: `same content posted in ${BURST_CHANNELS}+ channels within ${duration.format(BURST_WINDOW_MS)}`, copies: hit.copies, fingerprint: hit.fingerprint, cfg });
    return true;
  } catch (err) {
    log.warn(`[scamshield] inspect failed: ${err.message}`);
    return false;
  }
}

function staffSnapshot(guild) {
  const out = [];
  for (const m of guild.members.cache.values()) {
    if (m.user.bot) continue;
    if (!(m.permissions.has('Administrator') || m.permissions.has('ManageMessages'))) continue;
    out.push({ id: m.id, names: [m.displayName, m.user.username, m.user.globalName].filter(Boolean), avatar: m.user.avatar || null });
  }
  return out;
}

// Called on member join and nickname/profile change. Alert only: posts to the modlog channel, takes no action.
async function checkImpersonation(member) {
  try {
    const { guild } = member;
    if (!guild || member.user.bot) return;
    const cfg = getConfig(guild.id);
    if (!cfg.enabled) return;
    if (isExempt(exemptView(member), cfg)) return;
    const channelId = store.getConfig(guild.id, 'modlog_channel');
    const channel = channelId && guild.channels.cache.get(channelId);
    if (!channel) return;

    const cand = { id: member.id, names: [member.displayName, member.user.username, member.user.globalName].filter(Boolean), avatar: member.user.avatar || member.avatar || null };
    const matches = findImpersonation(cand, staffSnapshot(guild));
    if (!matches.length) return;
    const sig = matches.map((m) => `${m.staffId}:${m.reasons.join(',')}`).join('|');
    if (!alertOnce(`${guild.id}:${member.id}:${sig}`)) return;

    const { response } = require('./embed');
    const lines = matches.slice(0, 5).map((m) => `<@${m.staffId}>: ${m.reasons.join(', ')}`);
    await channel.send({
      embeds: [response({
        client: guild.client,
        description: `**Possible staff lookalike**\n**Member** ${member.user.tag} \`${member.id}\`\n**Display name** ${String(member.displayName).slice(0, 64)}\n${lines.join('\n')}\nAlert only, no action taken. Check the account before trusting it.`,
        color: colors.warning,
      })],
      allowedMentions: { parse: [] },
    }).catch(() => {});
  } catch (err) {
    log.warn(`[scamshield] impersonation check failed: ${err.message}`);
  }
}

module.exports = {
  BURST_CHANNELS, BURST_WINDOW_MS, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS,
  normalizeConfig, getConfig, setConfig,
  normalizeText, textHash, attachmentFingerprint, embedFingerprint, messageFingerprints,
  BurstTracker, hasRemoteAuthLink, isExempt,
  nameSkeleton, editDistance, findImpersonation, staffSnapshot,
  recoveryChecklist, inspectMessage, checkImpersonation,
};
