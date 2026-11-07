// Voice Case File: evidence without recording. mofu never hears audio. This module keeps only who joined, left,
// moved, was server-muted/deafened, or started/stopped a stream or camera, with user ids and timestamps, in memory,
// for a short window. /reportvc turns that window into a numbered case.
//
// Memory is bounded three ways: events older than WINDOW_MS are dropped, each channel keeps at most MAX_EVENTS,
// a channel with no activity for IDLE_DROP_MS is forgotten, and at most MAX_CHANNELS channels are tracked.
// A restart starts empty (nothing is written to disk by the buffer).
//
// Also holds the two small tables behind /vc: timed voice bans and channel lockdowns (both carry guild_id, so the
// 30-day retention purge covers them), and the Discord-side apply/lift for them.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_EVENTS = 200;
const IDLE_DROP_MS = 30 * 60 * 1000;
const MAX_CHANNELS = 1000;
const PRUNE_EVERY_MS = 60 * 1000;
const SNAPSHOT_MAX_LEN = 480; // mod_cases.reason is capped at 512 characters
const SNAPSHOT_MEMBERS = 10;
const NO_AUDIO_NOTE = 'mofu never hears audio. This is only who joined, left, moved or toggled, with times.';

const CODES = {
  join: 'j', leave: 'l', move_in: 'mi', move_out: 'mo', smute: 'sm', sdeaf: 'sd', stream: 'st', video: 'vd',
};
const CODE_TO_TYPE = Object.fromEntries(Object.entries(CODES).map(([k, v]) => [v, k]));

// Turn a before/after pair of voice states (plain objects) into events. Self-mute and self-deafen are left out on
// purpose: they are noisy and say nothing about abuse.
function diffEvents(o, n) {
  const out = [];
  const oc = o?.channelId || null;
  const nc = n?.channelId || null;
  if (!oc && nc) out.push({ type: 'join', channelId: nc });
  else if (oc && !nc) out.push({ type: 'leave', channelId: oc });
  else if (oc && nc && oc !== nc) {
    out.push({ type: 'move_out', channelId: oc, other: nc });
    out.push({ type: 'move_in', channelId: nc, other: oc });
  }
  if (nc) {
    if (!!o?.serverMute !== !!n?.serverMute) out.push({ type: 'smute', channelId: nc, on: !!n.serverMute });
    if (!!o?.serverDeaf !== !!n?.serverDeaf) out.push({ type: 'sdeaf', channelId: nc, on: !!n.serverDeaf });
    if (!!o?.streaming !== !!n?.streaming) out.push({ type: 'stream', channelId: nc, on: !!n.streaming });
    if (!!o?.selfVideo !== !!n?.selfVideo) out.push({ type: 'video', channelId: nc, on: !!n.selfVideo });
  }
  return out;
}

const stateOf = (s) => ({
  channelId: s?.channelId || null,
  serverMute: !!s?.serverMute,
  serverDeaf: !!s?.serverDeaf,
  streaming: !!s?.streaming,
  selfVideo: !!s?.selfVideo,
});

function createBuffer({ windowMs = WINDOW_MS, maxEvents = MAX_EVENTS, idleDropMs = IDLE_DROP_MS, maxChannels = MAX_CHANNELS } = {}) {
  const channels = new Map(); // `${guildId}:${channelId}` -> { events: [], lastAt }
  let lastPrune = 0;

  function prune(now = Date.now()) {
    lastPrune = now;
    for (const [key, ch] of channels) {
      while (ch.events.length && now - ch.events[0].t > windowMs) ch.events.shift();
      if (now - ch.lastAt > idleDropMs) channels.delete(key);
    }
    if (channels.size > maxChannels) {
      const byAge = [...channels.entries()].sort((a, b) => a[1].lastAt - b[1].lastAt);
      for (const [key] of byAge.slice(0, channels.size - maxChannels)) channels.delete(key);
    }
  }

  function record(guildId, userId, ev, now = Date.now()) {
    if (!guildId || !userId || !ev?.channelId) return;
    if (now - lastPrune >= PRUNE_EVERY_MS) prune(now);
    const key = `${guildId}:${ev.channelId}`;
    let ch = channels.get(key);
    if (!ch) {
      ch = { events: [], lastAt: now };
      channels.set(key, ch);
    }
    const e = { t: now, type: ev.type, uid: String(userId) };
    if (ev.other) e.other = ev.other;
    if (ev.on !== undefined) e.on = !!ev.on;
    ch.events.push(e);
    if (ch.events.length > maxEvents) ch.events.splice(0, ch.events.length - maxEvents);
    ch.lastAt = now;
  }

  // Feed a raw old/new pair. Returns the events recorded (handy for the detectors).
  function recordStates(guildId, userId, oldS, newS, now = Date.now()) {
    const evs = diffEvents(stateOf(oldS), stateOf(newS));
    for (const ev of evs) record(guildId, userId, ev, now);
    return evs;
  }

  function snapshot(guildId, channelId, now = Date.now()) {
    const ch = channels.get(`${guildId}:${channelId}`);
    if (!ch) return [];
    return ch.events.filter((e) => now - e.t <= windowMs).map((e) => ({ ...e }));
  }

  return { record, recordStates, snapshot, prune, size: () => channels.size, _channels: channels };
}

const buffer = createBuffer();

// Compact JSON for the case row: users are indexed once, events are [secondsAgo, code, userIndex, on?].
// Oldest events are dropped first until it fits; `dropped` says how many.
function compactSnapshot({ channelId, at, memberIds = [], events = [], note = null }, maxLen = SNAPSHOT_MAX_LEN) {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const n = note ? String(note).replace(/\s+/g, ' ').slice(0, 60) : null;
  const build = (evs, members) => {
    const users = [];
    const idx = (id) => { let i = users.indexOf(id); if (i < 0) { users.push(id); i = users.length - 1; } return i; };
    const present = members.map(idx);
    const e = evs.map((x) => {
      const row = [Math.max(0, Math.round((at - x.t) / 1000)), CODES[x.type] || x.type, idx(x.uid)];
      if (x.on !== undefined) row.push(x.on ? 1 : 0);
      return row;
    });
    const obj = { v: 1, ch: channelId, at: Math.floor(at / 1000), u: users, p: present, e };
    if (n) obj.n = n;
    return JSON.stringify(obj);
  };
  let members = memberIds.slice(0, SNAPSHOT_MEMBERS);
  for (let keep = sorted.length; keep >= 0; keep--) {
    const json = build(sorted.slice(sorted.length - keep), members);
    if (json.length <= maxLen) return { json, kept: keep, dropped: sorted.length - keep, members: members.length };
  }
  while (members.length) {
    members = members.slice(0, -1);
    const json = build([], members);
    if (json.length <= maxLen) return { json, kept: 0, dropped: sorted.length, members: members.length };
  }
  const json = JSON.stringify({ v: 1, ch: channelId, at: Math.floor(at / 1000), u: [], p: [], e: [] });
  return { json, kept: 0, dropped: sorted.length, members: 0 };
}

// Inverse of compactSnapshot, for reading a case back. Returns null for anything that is not a voice snapshot.
function parseCaseSnapshot(text) {
  let o;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || o.v !== 1 || !Array.isArray(o.u) || !Array.isArray(o.e)) return null;
  const at = o.at * 1000;
  return {
    channelId: o.ch,
    at,
    note: o.n || null,
    memberIds: (o.p || []).map((i) => o.u[i]).filter(Boolean),
    events: o.e.map((r) => ({
      t: at - r[0] * 1000,
      type: CODE_TO_TYPE[r[1]] || r[1],
      uid: o.u[r[2]],
      ...(r.length > 3 ? { on: !!r[3] } : {}),
    })),
  };
}

const VERB = {
  join: () => 'joined',
  leave: () => 'left',
  move_in: (e) => (e.other ? `moved in from <#${e.other}>` : 'moved in'),
  move_out: (e) => (e.other ? `moved out to <#${e.other}>` : 'moved out'),
  smute: (e) => (e.on ? 'was server muted' : 'was server unmuted'),
  sdeaf: (e) => (e.on ? 'was server deafened' : 'was server undeafened'),
  stream: (e) => (e.on ? 'started a stream' : 'stopped a stream'),
  video: (e) => (e.on ? 'turned the camera on' : 'turned the camera off'),
};

// One line per event, newest last. Mentions inside embeds do not ping.
function renderTimeline(events, limit = 25) {
  return [...events].sort((a, b) => a.t - b.t).slice(-limit).map((e) => {
    const verb = (VERB[e.type] || (() => e.type))(e);
    return `<t:${Math.floor(e.t / 1000)}:T> <@${e.uid}> ${verb}`;
  });
}

// Sliding-window limiter per key (guild:member).
function createLimiter({ max = 3, windowMs = 15 * 60 * 1000 } = {}) {
  const hits = new Map();
  return {
    max, windowMs,
    // true and records the hit when allowed; false when over the limit
    take(key, now = Date.now()) {
      const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
      if (recent.length >= max) { hits.set(key, recent); return false; }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
      return true;
    },
    size: () => hits.size,
  };
}
const reportLimiter = createLimiter({ max: 3, windowMs: 15 * 60 * 1000 });

// ---------------------------------------------------------------------------------------------------------
// Voice bans and lockdowns (tables). create(db) works on any better-sqlite3 handle; module functions use the bot db.
// ---------------------------------------------------------------------------------------------------------
function create(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS voice_bans (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      method TEXT NOT NULL,
      role_id TEXT,
      case_id INTEGER,
      moderator_id TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_voice_bans_due ON voice_bans(expires_at);
    CREATE TABLE IF NOT EXISTS voice_lockdowns (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      prev TEXT NOT NULL,
      case_id INTEGER,
      moderator_id TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, channel_id)
    );
  `);
  const s = {
    putBan: db.prepare(`INSERT OR REPLACE INTO voice_bans (guild_id, user_id, expires_at, method, role_id, case_id, moderator_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    getBan: db.prepare('SELECT * FROM voice_bans WHERE guild_id = ? AND user_id = ?'),
    delBan: db.prepare('DELETE FROM voice_bans WHERE guild_id = ? AND user_id = ?'),
    dueBans: db.prepare('SELECT * FROM voice_bans WHERE expires_at <= ? ORDER BY expires_at ASC LIMIT ?'),
    putLock: db.prepare('INSERT OR REPLACE INTO voice_lockdowns (guild_id, channel_id, prev, case_id, moderator_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    getLock: db.prepare('SELECT * FROM voice_lockdowns WHERE guild_id = ? AND channel_id = ?'),
    delLock: db.prepare('DELETE FROM voice_lockdowns WHERE guild_id = ? AND channel_id = ?'),
  };
  return {
    addBan({ guildId, userId, expiresAt, method, roleId = null, caseId = null, moderatorId = null, now = Date.now() }) {
      s.putBan.run(String(guildId), String(userId), expiresAt, method, roleId, caseId, moderatorId, now);
    },
    getBan: (g, u) => s.getBan.get(String(g), String(u)) || null,
    removeBan: (g, u) => s.delBan.run(String(g), String(u)).changes > 0,
    dueBans: (now = Date.now(), limit = 50) => s.dueBans.all(now, limit),
    addLockdown({ guildId, channelId, prev, caseId = null, moderatorId = null, now = Date.now() }) {
      s.putLock.run(String(guildId), String(channelId), JSON.stringify(prev), caseId, moderatorId, now);
    },
    getLockdown(g, c) {
      const row = s.getLock.get(String(g), String(c));
      if (!row) return null;
      let prev = {};
      try { prev = JSON.parse(row.prev) || {}; } catch { /* keep empty */ }
      return { ...row, prev };
    },
    removeLockdown: (g, c) => s.delLock.run(String(g), String(c)).changes > 0,
  };
}

let shared = null;
function tables() {
  if (!shared) shared = create(require('../database/store').db);
  return shared;
}

// ---------------------------------------------------------------------------------------------------------
// Discord side of a voice ban.
// Approach (least invasive that is still correct):
//   1. If the server set a voice-ban role (/vc banrole), the member gets that role: one API call, it also covers
//      voice channels created later. The role must deny Connect for it to do anything; /vc banrole says so.
//   2. Otherwise a per-member permission overwrite denying Connect is placed on each voice channel the bot can
//      manage (capped). Nothing else about the member changes, and lifting it deletes exactly what we added.
//      Channels created after the ban are not covered until it is re-applied.
// Either way the member is disconnected if they are in voice right now.
// ---------------------------------------------------------------------------------------------------------
const MAX_BAN_CHANNELS = 100;

function voiceChannels(guild) {
  return [...guild.channels.cache.values()].filter((c) => c.isVoiceBased?.() && c.manageable).slice(0, MAX_BAN_CHANNELS);
}

async function applyVoiceBan(guild, member, { roleId = null, reason }) {
  const role = roleId ? guild.roles.cache.get(roleId) : null;
  if (role && role.editable) {
    await member.roles.add(role, reason);
    if (member.voice?.channelId) await member.voice.disconnect(reason).catch(() => {});
    return { method: 'role', roleId: role.id, touched: 1 };
  }
  let touched = 0;
  for (const ch of voiceChannels(guild)) {
    try {
      await ch.permissionOverwrites.edit(member.id, { Connect: false }, { reason });
      touched++;
    } catch { /* channel the bot cannot edit: skip */ }
  }
  if (!touched) throw new Error('no voice channel could be edited');
  if (member.voice?.channelId) await member.voice.disconnect(reason).catch(() => {});
  return { method: 'overwrite', roleId: null, touched };
}

async function liftVoiceBan(guild, row, reason) {
  const { PermissionFlagsBits } = require('discord.js');
  if (row.method === 'role') {
    const member = await guild.members.fetch(row.user_id).catch(() => null);
    if (member && row.role_id) await member.roles.remove(row.role_id, reason).catch(() => {});
    return;
  }
  for (const ch of guild.channels.cache.values()) {
    if (!ch.isVoiceBased?.() || !ch.manageable) continue;
    const ow = ch.permissionOverwrites?.cache?.get(row.user_id);
    if (!ow || !ow.deny.has(PermissionFlagsBits.Connect)) continue;
    try {
      // only ours (a lone Connect deny) is deleted; anything else the server set on this member is kept
      if (ow.allow.bitfield === 0n && ow.deny.bitfield === PermissionFlagsBits.Connect) await ow.delete(reason);
      else await ch.permissionOverwrites.edit(row.user_id, { Connect: null }, { reason });
    } catch { /* ignore */ }
  }
}

// Expired voice bans: lift them and write a case. Called by the minute sweep (voiceXp.js). Never throws.
async function sweepVoiceBans(client, now = Date.now()) {
  let due = [];
  try { due = tables().dueBans(now); } catch { return 0; }
  let lifted = 0;
  for (const row of due) {
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) continue; // bot not in the guild right now: retried next sweep, purged by retention if gone
    try {
      await liftVoiceBan(guild, row, 'Voice ban expired');
      tables().removeBan(row.guild_id, row.user_id);
      lifted++;
      const user = await client.users.fetch(row.user_id).catch(() => null);
      const caseId = require('./modlog').openCase(guild, { action: 'vc_unban', target: user || { id: row.user_id }, moderator: client.user, reason: 'Voice ban expired' });
      await postCaseLog(guild, {
        caseId, action: 'vc unban', color: require('./constants').colors.success,
        lines: [`**Member** <@${row.user_id}> \`${row.user_id}\``, '**Reason** Voice ban expired'],
      });
    } catch { /* retried next sweep */ }
  }
  return lifted;
}

// Modlog post for cases whose subject is not a plain user (reports, lockdowns, expiries).
async function postCaseLog(guild, { caseId, action, color, lines, fields = [], footerText = null }) {
  const store = require('../database/store');
  const { base } = require('./embed');
  const channelId = store.getConfig(guild.id, 'modlog_channel');
  const channel = channelId && guild.channels.cache.get(channelId);
  if (!channel) return null;
  const embed = base(guild.client, color)
    .setAuthor({ name: `${String(action).toUpperCase().slice(0, 60)}${caseId ? ` | Case #${caseId}` : ''}` })
    .setDescription(lines.join('\n').slice(0, 4000));
  if (fields.length) embed.addFields(fields);
  if (footerText) embed.setFooter({ text: footerText, iconURL: guild.client?.user?.displayAvatarURL?.() || undefined });
  const msg = await channel.send({ embeds: [embed] }).catch(() => null);
  if (msg && caseId) {
    try { require('../database/infractions').attachLogMessage(guild.id, caseId, channel.id, msg.id); } catch { /* ignore */ }
  }
  return msg;
}

module.exports = {
  WINDOW_MS, MAX_EVENTS, IDLE_DROP_MS, MAX_CHANNELS, SNAPSHOT_MAX_LEN, NO_AUDIO_NOTE, MAX_BAN_CHANNELS,
  diffEvents, createBuffer, buffer, compactSnapshot, parseCaseSnapshot, renderTimeline, createLimiter, reportLimiter,
  create, tables, applyVoiceBan, liftVoiceBan, sweepVoiceBans, postCaseLog,
  // convenience used by voiceStateUpdate
  recordStates: (...a) => buffer.recordStates(...a),
};
