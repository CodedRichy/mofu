// mofu does not request the GuildPresences intent, so member.presence is empty for everyone. Reading it and
// defaulting to 'offline' would show every member as offline, which is false. These helpers say so honestly.
const UNAVAILABLE = 'status unavailable';

// True only when Discord actually sent presence data for this member.
function hasPresence(member) {
  return Boolean(member && member.presence && typeof member.presence.status === 'string');
}

// 'online' | 'idle' | 'dnd' | 'offline' | null (null = unknown, never a guess)
function statusOf(member) {
  return hasPresence(member) ? member.presence.status : null;
}

// Short text for prompts and embeds.
function statusText(member) {
  return statusOf(member) || UNAVAILABLE;
}

// Count of members known to be not offline, or null when no member carries presence data.
function onlineCount(members) {
  const list = [...(members?.values ? members.values() : members || [])];
  if (!list.some(hasPresence)) return null;
  return list.filter((m) => hasPresence(m) && m.presence.status !== 'offline').length;
}

module.exports = { UNAVAILABLE, hasPresence, statusOf, statusText, onlineCount };
