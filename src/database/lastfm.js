// Per-guild Last.fm state kept in the config table (so retention purges it with the guild):
//   lastfm_<userId>   linked username (written by `fm set`)
//   fmact_<userId>    ms timestamp of the member's last fm command (used to pick who to look up)
//   fmhide_<userId>   true when the member hides from server rankings
//   fm_crowns         { artistKey: { a: artist, u: userId, p: plays, t: ms } }
//   fm_crownrole      role id that the top crown holder receives
// Only ids, usernames and counts are stored. No listening history.
const store = require('./store');

const ID_RE = /^\d{17,20}$/;

const stmtLinked = store.db.prepare("SELECT key, value FROM config WHERE guild_id = ? AND key LIKE 'lastfm\\_%' ESCAPE '\\'");
const stmtActive = store.db.prepare("SELECT key, value FROM config WHERE guild_id = ? AND key LIKE 'fmact\\_%' ESCAPE '\\'");
const stmtHidden = store.db.prepare("SELECT key FROM config WHERE guild_id = ? AND key LIKE 'fmhide\\_%' ESCAPE '\\'");

function parseVal(v) {
  try { return JSON.parse(v); } catch { return v; }
}

// All members with a linked username: [{ userId, username, lastActive, hidden }]
function getLinkedMembers(guildId) {
  const active = new Map();
  for (const r of stmtActive.all(guildId)) {
    const id = r.key.slice('fmact_'.length);
    const n = Number(parseVal(r.value));
    if (ID_RE.test(id) && Number.isFinite(n)) active.set(id, n);
  }
  const hidden = new Set(stmtHidden.all(guildId).map((r) => r.key.slice('fmhide_'.length)));
  const out = [];
  for (const r of stmtLinked.all(guildId)) {
    const userId = r.key.slice('lastfm_'.length);
    const username = parseVal(r.value);
    if (!ID_RE.test(userId) || typeof username !== 'string' || !username) continue;
    out.push({ userId, username, lastActive: active.get(userId) || 0, hidden: hidden.has(userId) });
  }
  return out;
}

function touchActive(guildId, userId) {
  store.setConfig(guildId, `fmact_${userId}`, Date.now());
}

function isHidden(guildId, userId) {
  return store.getConfig(guildId, `fmhide_${userId}`) === true;
}

function setHidden(guildId, userId, hidden) {
  store.setConfig(guildId, `fmhide_${userId}`, hidden ? true : null);
}

function getCrowns(guildId) {
  const c = store.getConfig(guildId, 'fm_crowns');
  return c && typeof c === 'object' && !Array.isArray(c) ? c : {};
}

function setCrowns(guildId, crowns) {
  store.setConfig(guildId, 'fm_crowns', Object.keys(crowns).length ? crowns : null);
}

function getCrownRole(guildId) {
  const r = store.getConfig(guildId, 'fm_crownrole');
  return typeof r === 'string' && ID_RE.test(r) ? r : null;
}

function setCrownRole(guildId, roleId) {
  store.setConfig(guildId, 'fm_crownrole', roleId || null);
}

module.exports = {
  getLinkedMembers, touchActive, isHidden, setHidden,
  getCrowns, setCrowns, getCrownRole, setCrownRole,
};
