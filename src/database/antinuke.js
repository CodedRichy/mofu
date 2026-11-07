const store = require('./store');
const log = require('../utils/logger');

const actionLog = new Map();
const WINDOW = 10000;
const DEFAULTS = { ban: 3, kick: 3, channel_delete: 3, channel_create: 5, role_delete: 3, role_create: 5 };

function getActions(guildId, userId, type) {
  const key = `${guildId}:${userId}:${type}`;
  if (!actionLog.has(key)) actionLog.set(key, []);
  const actions = actionLog.get(key);
  const now = Date.now();
  const filtered = actions.filter((t) => now - t < WINDOW);
  if (filtered.length === 0) { actionLog.delete(key); return filtered; }
  actionLog.set(key, filtered);
  return filtered;
}

function recordAction(guildId, userId, type) {
  const key = `${guildId}:${userId}:${type}`;
  if (!actionLog.has(key)) actionLog.set(key, []);
  actionLog.get(key).push(Date.now());
}

function isWhitelisted(guildId, userId) {
  const whitelist = store.getConfig(guildId, 'antinuke_whitelist') || [];
  return whitelist.includes(userId);
}

function isEnabled(guildId) {
  return store.getConfig(guildId, 'antinuke') === true;
}

function getThreshold(guildId, type) {
  const thresholds = store.getConfig(guildId, 'antinuke_thresholds') || {};
  return thresholds[type] ?? DEFAULTS[type] ?? 3;
}

function check(guildId, userId, type) {
  if (!isEnabled(guildId)) return false;
  if (isWhitelisted(guildId, userId)) return false;

  recordAction(guildId, userId, type);
  const actions = getActions(guildId, userId, type);
  const threshold = getThreshold(guildId, type);

  return actions.length >= threshold;
}

module.exports = { check, isEnabled, isWhitelisted, getThreshold, recordAction, WINDOW, DEFAULTS };
