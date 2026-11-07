const store = require('./store');
const log = require('../utils/logger');

const joinLog = new Map();
const WINDOW = 10000;

function isEnabled(guildId) {
  return store.getConfig(guildId, 'antiraid') === true;
}

function getThreshold(guildId) {
  return store.getConfig(guildId, 'antiraid_threshold') || 5;
}

function getAccountAge(guildId) {
  return store.getConfig(guildId, 'antiraid_account_age') || 7 * 24 * 60 * 60 * 1000;
}

function getAction(guildId) {
  return store.getConfig(guildId, 'antiraid_action') || 'kick';
}

function recordJoin(guildId, member) {
  if (!joinLog.has(guildId)) joinLog.set(guildId, []);
  const joins = joinLog.get(guildId);
  const now = Date.now();
  joins.push({
    userId: member.id,
    timestamp: now,
    accountAge: now - member.user.createdTimestamp,
  });

  const filtered = joins.filter((j) => now - j.timestamp < WINDOW);
  joinLog.set(guildId, filtered);
  return filtered;
}

function check(guildId, member) {
  if (!isEnabled(guildId)) return { triggered: false };

  const joins = recordJoin(guildId, member);
  const threshold = getThreshold(guildId);
  const minAge = getAccountAge(guildId);
  const accountAge = Date.now() - member.user.createdTimestamp;

  if (joins.length >= threshold) {
    return { triggered: true, reason: 'join_flood', count: joins.length };
  }

  if (accountAge < minAge) {
    const newAccountJoins = joins.filter((j) => j.accountAge < minAge);
    if (newAccountJoins.length >= Math.max(2, Math.floor(threshold / 2))) {
      return { triggered: true, reason: 'new_account_flood', count: newAccountJoins.length };
    }
  }

  return { triggered: false };
}

module.exports = { check, isEnabled, getThreshold, getAccountAge, getAction, recordJoin, WINDOW };
