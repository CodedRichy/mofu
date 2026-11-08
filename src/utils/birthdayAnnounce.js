// Daily birthday announcements. A server opts in by setting a channel with /birthday channel. The date is UTC, and
// the last announced day is saved per guild (config key birthday_last), so a restart never posts twice. Only members
// still in the server are named, and only that member is pinged.
const store = require('../database/store');
const birthdays = require('../database/birthday');
const log = require('./logger');

const HOUR = 3600000;

function todayKey(now) { return now.toISOString().slice(0, 10); }

async function announceGuild(guild, now = new Date()) {
  const channelId = birthdays.getChannel(guild.id);
  if (!channelId) return 0;
  const key = todayKey(now);
  if (store.getConfig(guild.id, 'birthday_last') === key) return 0;
  store.setConfig(guild.id, 'birthday_last', key); // marked first: a failed send is not retried into a double post
  const ch = guild.channels.cache.get(channelId);
  if (!ch || !ch.send) return 0;
  const ids = birthdays.getOn(guild.id, now.getUTCMonth() + 1, now.getUTCDate());
  const present = [];
  for (const id of ids) {
    let m = guild.members.cache.get(id);
    if (!m) { try { m = await guild.members.fetch(id); } catch { m = null; } }
    if (m && !m.user?.bot) present.push(id);
  }
  if (!present.length) return 0;
  const names = present.map((id) => '<@' + id + '>').join(', ');
  const text = present.length === 1 ? 'Happy birthday ' + names + '!' : 'Happy birthday to ' + names + '!';
  try {
    await ch.send({ content: text, allowedMentions: { users: present } });
  } catch (err) {
    log.warn('birthday post failed in ' + guild.id + ': ' + (err?.message || err));
    return 0;
  }
  return present.length;
}

async function sweep(client, now = new Date()) {
  let n = 0;
  for (const guild of client.guilds.cache.values()) {
    try { n += await announceGuild(guild, now); } catch (err) { log.warn('birthday sweep error: ' + (err?.message || err)); }
  }
  return n;
}

function startSweep(client) {
  setTimeout(() => sweep(client), 30000).unref();
  setInterval(() => sweep(client), HOUR).unref();
}

module.exports = { announceGuild, sweep, startSweep, todayKey };
