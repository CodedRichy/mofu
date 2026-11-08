const Database = require('better-sqlite3');
const path = require('path');
const store = require('./store');

const MAX_SNIPES = 10;
const MAX_AGE_MS = 2 * 60 * 60 * 1000; // snipe data is short-lived on purpose

const dbPath = path.join(__dirname, '..', '..', 'data', 'sonder.db');
require('fs').mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS snipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'delete',
    author_id TEXT NOT NULL,
    author_tag TEXT NOT NULL,
    content TEXT,
    attachment TEXT,
    timestamp INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_snipes_channel ON snipes(guild_id, channel_id, type);
  CREATE INDEX IF NOT EXISTS idx_snipes_chan_type ON snipes(channel_id, type, id);
`);

const stmts = {
  insert: db.prepare('INSERT INTO snipes (guild_id, channel_id, type, author_id, author_tag, content, attachment, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  get: db.prepare('SELECT * FROM snipes WHERE channel_id = ? AND type = ? AND timestamp >= ? ORDER BY id DESC LIMIT 1 OFFSET ?'),
  clearChannel: db.prepare('DELETE FROM snipes WHERE channel_id = ? AND type = ?'),
  clearAllChannel: db.prepare('DELETE FROM snipes WHERE channel_id = ?'),
  countByChannel: db.prepare('SELECT COUNT(*) as count FROM snipes WHERE channel_id = ? AND type = ?'),
  deleteStale: db.prepare('DELETE FROM snipes WHERE timestamp < ?'),
  deleteOld: db.prepare('DELETE FROM snipes WHERE id IN (SELECT id FROM snipes WHERE channel_id = ? AND type = ? ORDER BY id DESC LIMIT -1 OFFSET ?)'),
};

// Sniping is opt-in per guild (config key snipe_enabled, default off): nothing is stored otherwise.
function isEnabled(guildId) {
  return !!guildId && store.getConfig(guildId, 'snipe_enabled') === true;
}

// Expired rows are removed on every read too, so the 2 hour limit holds on disk even when nothing new is written.
function readRow(channelId, type, cutoff, index) {
  stmts.deleteStale.run(cutoff);
  return stmts.get.get(channelId, type, cutoff, index);
}

function insertAndCleanup(guildId, channelId, type, authorId, authorTag, content, attachment) {
  if (!isEnabled(guildId)) return;
  stmts.deleteStale.run(Date.now() - MAX_AGE_MS);
  stmts.insert.run(guildId, channelId, type, authorId, authorTag, content, attachment, Date.now());
  stmts.deleteOld.run(channelId, type, MAX_SNIPES);
}

module.exports = {
  isEnabled,
  MAX_AGE_MS,
  addDeleted(channelId, message) {
    const guildId = message.guild?.id || '';
    const attachments = [...message.attachments.values()].map((a) => a.url);
    const content = JSON.stringify({
      content: message.content,
      avatar: message.author.displayAvatarURL(),
      attachments,
    });
    insertAndCleanup(guildId, channelId, 'delete', message.author.id, message.author.tag, content, attachments[0] || null);
  },

  addEdited(channelId, oldMessage, newMessage) {
    const guildId = oldMessage.guild?.id || '';
    const content = JSON.stringify({
      oldContent: oldMessage.content,
      newContent: newMessage.content,
      avatar: newMessage.author.displayAvatarURL(),
    });
    insertAndCleanup(guildId, channelId, 'edit', newMessage.author.id, newMessage.author.tag, content, null);
  },

  addReaction(channelId, reaction, user) {
    const guildId = reaction.message.guild?.id || '';
    const content = JSON.stringify({
      emoji: reaction.emoji.toString(),
      messageAuthor: reaction.message.author ? { id: reaction.message.author.id, tag: reaction.message.author.tag } : null,
      messageContent: reaction.message.content?.slice(0, 100) || null,
    });
    insertAndCleanup(guildId, channelId, 'reaction', user.id, user.tag, content, null);
  },

  addPurged(channelId, messages, executor) {
    const firstMsg = messages.first?.() || messages.values().next().value;
    const guildId = firstMsg?.guild?.id || '';
    const msgs = [...messages.values()].map((m) => ({
      content: m.content?.slice(0, 200) || '',
      author: m.author?.tag || 'Unknown',
    }));
    const content = JSON.stringify({
      count: messages.size,
      messages: msgs.slice(0, 20),
    });
    insertAndCleanup(guildId, channelId, 'purge', executor.id, executor.tag, content, null);
  },

  getDeleted(channelId, index = 0) {
    const row = readRow(channelId, 'delete', Date.now() - MAX_AGE_MS, index);
    if (!row) return null;
    const data = JSON.parse(row.content);
    return {
      content: data.content,
      author: { id: row.author_id, tag: row.author_tag, avatar: data.avatar },
      attachments: data.attachments || [],
      timestamp: row.timestamp,
    };
  },

  getEdited(channelId, index = 0) {
    const row = readRow(channelId, 'edit', Date.now() - MAX_AGE_MS, index);
    if (!row) return null;
    const data = JSON.parse(row.content);
    return {
      oldContent: data.oldContent,
      newContent: data.newContent,
      author: { id: row.author_id, tag: row.author_tag, avatar: data.avatar },
      timestamp: row.timestamp,
    };
  },

  getReaction(channelId, index = 0) {
    const row = readRow(channelId, 'reaction', Date.now() - MAX_AGE_MS, index);
    if (!row) return null;
    const data = JSON.parse(row.content);
    return {
      emoji: data.emoji,
      messageAuthor: data.messageAuthor,
      user: { id: row.author_id, tag: row.author_tag },
      messageContent: data.messageContent,
      timestamp: row.timestamp,
    };
  },

  getPurged(channelId, index = 0) {
    const row = readRow(channelId, 'purge', Date.now() - MAX_AGE_MS, index);
    if (!row) return null;
    const data = JSON.parse(row.content);
    return {
      count: data.count,
      messages: data.messages,
      executor: { id: row.author_id, tag: row.author_tag },
      timestamp: row.timestamp,
    };
  },

  clearDeleted(channelId) { stmts.clearChannel.run(channelId, 'delete'); },
  clearEdited(channelId) { stmts.clearChannel.run(channelId, 'edit'); },
  clearReactions(channelId) { stmts.clearChannel.run(channelId, 'reaction'); },
  clearPurged(channelId) { stmts.clearChannel.run(channelId, 'purge'); },
};
