// Uses an in-memory SQLite database with the same schemas; never opens data/sonder.db.
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const privacy = require('../src/database/privacy');

const U = '111111111111111111';
const OTHER = '222222222222222222';
const G1 = '333333333333333333';
const G2 = '444444444444444444';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE config (guild_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY (guild_id, key));
    CREATE TABLE warnings (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, user_id TEXT, moderator TEXT, reason TEXT, timestamp TEXT);
    CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, user_id TEXT, moderator TEXT, content TEXT, timestamp TEXT);
    CREATE TABLE infractions (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, user_id TEXT, action TEXT);
    CREATE TABLE economy (guild_id TEXT, user_id TEXT, wallet INTEGER, bank INTEGER, PRIMARY KEY (guild_id, user_id));
    CREATE TABLE xp (guild_id TEXT, user_id TEXT, xp INTEGER, level INTEGER, total_xp INTEGER, last_message INTEGER, PRIMARY KEY (guild_id, user_id));
    CREATE TABLE cooldowns (guild_id TEXT, user_id TEXT, key TEXT, expires_at INTEGER, PRIMARY KEY (guild_id, user_id, key));
    CREATE TABLE reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, channel_id TEXT, user_id TEXT, message TEXT, remind_at INTEGER, created_at INTEGER);
    CREATE TABLE snipes (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, channel_id TEXT, type TEXT, author_id TEXT, author_tag TEXT, content TEXT, attachment TEXT, timestamp INTEGER);
    CREATE TABLE invites (guild_id TEXT, user_id TEXT, inviter_id TEXT, joined_at INTEGER, PRIMARY KEY (guild_id, user_id));
    CREATE TABLE quotes (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, content TEXT, author TEXT, added_by TEXT, timestamp TEXT);
    CREATE TABLE ai_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, invoker_id TEXT, target_id TEXT, kind TEXT, reason TEXT, duration_ms INTEGER, prompt TEXT, status TEXT, note TEXT, created_at INTEGER, resolved_at INTEGER);
  `);
  for (const g of [G1, G2]) {
    for (const u of [U, OTHER]) {
      db.prepare('INSERT INTO economy VALUES (?, ?, 10, 20)').run(g, u);
      db.prepare('INSERT INTO xp VALUES (?, ?, 1, 1, 1, 0)').run(g, u);
      db.prepare("INSERT INTO cooldowns VALUES (?, ?, 'daily', 1)").run(g, u);
      db.prepare("INSERT INTO reminders (guild_id, channel_id, user_id, message, remind_at, created_at) VALUES (?, 'c', ?, 'm', 1, 1)").run(g, u);
      db.prepare("INSERT INTO snipes (guild_id, channel_id, type, author_id, author_tag, content, timestamp) VALUES (?, 'c', 'delete', ?, 't', 'secret', 1)").run(g, u);
      db.prepare("INSERT INTO warnings (guild_id, user_id, moderator, reason, timestamp) VALUES (?, ?, 'm', 'r', 't')").run(g, u);
      db.prepare("INSERT INTO notes (guild_id, user_id, moderator, content, timestamp) VALUES (?, ?, 'm', 'n', 't')").run(g, u);
      db.prepare("INSERT INTO infractions (guild_id, user_id, action) VALUES (?, ?, 'ban')").run(g, u);
      db.prepare("INSERT INTO ai_actions (guild_id, invoker_id, target_id, kind, prompt, status, created_at) VALUES (?, 'x', ?, 'mute', 'p', 'executed', 1)").run(g, u);
      db.prepare('INSERT INTO quotes (guild_id, content, author, timestamp) VALUES (?, ?, ?, ?)').run(g, 'q', JSON.stringify({ id: u, tag: 't' }), 't');
      for (const p of ['afk_', 'inv_', 'tz_', 'lastfm_', 'forcenick_', 'jail_roles_']) db.prepare('INSERT INTO config VALUES (?, ?, ?)').run(g, p + u, '"v"');
    }
    db.prepare('INSERT INTO invites VALUES (?, ?, ?, 1)').run(g, OTHER, U); // U invited OTHER
    db.prepare('INSERT INTO invites VALUES (?, ?, NULL, 1)').run(g, U);
    db.prepare("INSERT INTO quotes (guild_id, content, author, timestamp) VALUES (?, 'q', 'plain text author', 't')").run(g);
  }
  return db;
}

const count = (db, sql, ...a) => db.prepare(sql).get(...a).n;

test('forgetme (this server) deletes personal rows for that user in that server only', () => {
  const db = freshDb();
  const r = privacy.forgetUser(db, U, { guildId: G1 });
  assert.ok(r.total > 0);
  for (const t of ['economy', 'xp', 'cooldowns', 'reminders']) {
    assert.equal(count(db, `SELECT COUNT(*) n FROM ${t} WHERE user_id = ? AND guild_id = ?`, U, G1), 0, t);
    assert.equal(count(db, `SELECT COUNT(*) n FROM ${t} WHERE user_id = ? AND guild_id = ?`, U, G2), 1, `${t} other guild kept`);
    assert.equal(count(db, `SELECT COUNT(*) n FROM ${t} WHERE user_id = ? AND guild_id = ?`, OTHER, G1), 1, `${t} other user kept`);
  }
  assert.equal(count(db, 'SELECT COUNT(*) n FROM snipes WHERE author_id = ? AND guild_id = ?', U, G1), 0);
  assert.equal(count(db, "SELECT COUNT(*) n FROM quotes WHERE guild_id = ? AND json_valid(author) AND json_extract(author, '$.id') = ?", G1, U), 0);
  assert.equal(count(db, "SELECT COUNT(*) n FROM quotes WHERE guild_id = ? AND author = 'plain text author'", G1), 1, 'non-JSON author rows are untouched');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM invites WHERE guild_id = ? AND user_id = ?', G1, U), 0);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM invites WHERE guild_id = ? AND user_id = ? AND inviter_id IS NULL', G1, OTHER), 1, 'inviter link dropped, record kept');
  assert.equal(r.unlinked, 1);
  assert.deepEqual(r.guilds, [G1]);
  // personal config keys gone, moderation config kept
  for (const p of ['afk_', 'inv_', 'tz_', 'lastfm_']) assert.equal(count(db, 'SELECT COUNT(*) n FROM config WHERE guild_id = ? AND key = ?', G1, p + U), 0, p);
  for (const p of ['forcenick_', 'jail_roles_']) assert.equal(count(db, 'SELECT COUNT(*) n FROM config WHERE guild_id = ? AND key = ?', G1, p + U), 1, p);
});

test('moderation records survive forgetme', () => {
  const db = freshDb();
  privacy.forgetUser(db, U, { guildId: null });
  for (const t of ['warnings', 'notes', 'infractions']) assert.equal(count(db, `SELECT COUNT(*) n FROM ${t} WHERE user_id = ?`, U), 2, t);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM ai_actions WHERE target_id = ?', U), 2);
});

test('forgetme everywhere covers every server', () => {
  const db = freshDb();
  const r = privacy.forgetUser(db, U, { guildId: null });
  assert.equal(count(db, 'SELECT COUNT(*) n FROM economy WHERE user_id = ?', U), 0);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM economy WHERE user_id = ?', OTHER), 2);
  assert.deepEqual(r.guilds.sort(), [G1, G2]);
  assert.equal(privacy.forgetUser(db, U).total, 0, 'second run finds nothing');
});

test('forgetUser validates ids and tolerates missing tables', () => {
  const db = freshDb();
  assert.throws(() => privacy.forgetUser(db, "1' OR 1=1 --"));
  assert.throws(() => privacy.forgetUser(db, U, { guildId: 'abc' }));
  const empty = new Database(':memory:');
  assert.equal(privacy.forgetUser(empty, U).total, 0);
});

test('retention scrub clears AI prompt text older than 30 days and keeps the row', () => {
  const db = freshDb();
  const now = 100 * 86400000;
  db.prepare("INSERT INTO ai_actions (guild_id, invoker_id, target_id, kind, prompt, status, created_at) VALUES ('g', 'a', 'b', 'mute', 'recent', 'executed', ?)").run(now - 86400000);
  const n = privacy.scrubAiPrompts(db, { now });
  assert.equal(n, 4); // the four seeded rows at created_at = 1
  assert.equal(count(db, 'SELECT COUNT(*) n FROM ai_actions WHERE prompt IS NULL'), 4);
  assert.equal(db.prepare("SELECT prompt FROM ai_actions WHERE prompt = 'recent'").get().prompt, 'recent');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM ai_actions'), 5, 'rows themselves kept');
  assert.equal(privacy.scrubAiPrompts(new Database(':memory:')), 0);
});

test('forgetme authorization: self always; admins only for others in this server', () => {
  const { authorize, summarize } = require('../src/commands/utility/forgetme');
  assert.equal(authorize({ invokerId: U, targetId: U, scope: 'everywhere', canManageGuild: false }), null);
  assert.ok(authorize({ invokerId: U, targetId: OTHER, scope: 'server', canManageGuild: false }));
  assert.equal(authorize({ invokerId: U, targetId: OTHER, scope: 'server', canManageGuild: true }), null);
  assert.ok(authorize({ invokerId: U, targetId: OTHER, scope: 'everywhere', canManageGuild: true }));
  const big = { byLabel: Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`label${i}`, i + 1])), unlinked: 0 };
  assert.ok(summarize(big).length <= 1500);
  assert.equal(summarize({ byLabel: {}, unlinked: 0 }), 'Nothing was stored.');
});

test('privacy and forgetme are valid commands with slash/prefix parity', () => {
  const PrefixContext = require('../src/utils/prefixContext');
  const privacyCmd = require('../src/commands/utility/privacy');
  const forget = require('../src/commands/utility/forgetme');
  assert.equal(privacyCmd.LINES.length, 3);
  assert.ok(privacyCmd.LINES.join('\n\n').length < 4096);
  for (const c of [privacyCmd, forget]) {
    const json = c.data.toJSON();
    assert.ok(json.name && json.description.length <= 100);
    assert.equal(typeof c.execute, 'function');
  }
  const users = new Map([[OTHER, { id: OTHER }]]);
  const msg = { guild: { channels: { cache: new Map() }, roles: { cache: new Map() } }, author: { id: U }, client: { users: { cache: users } }, attachments: new Map() };
  const ctx = new PrefixContext(msg, ['everywhere'], forget);
  assert.equal(ctx.options.getString('scope'), 'everywhere');
  const ctx2 = new PrefixContext(msg, ['server', `<@${OTHER}>`], forget);
  assert.equal(ctx2.options.getUser('user').id, OTHER);
  const bad = new PrefixContext(msg, ['nowhere'], forget);
  assert.equal(bad.options.getString('scope'), null);
  assert.equal(bad._invalid.length, 1);
});
