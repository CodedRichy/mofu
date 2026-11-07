const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { create } = require('../src/database/infractions');

const fresh = () => create(new Database(':memory:'));

test('case numbers increment per guild and are independent across guilds', () => {
  const inf = fresh();
  assert.strictEqual(inf.openCase({ guildId: 'g1', action: 'warn', targetId: 'u1' }), 1);
  assert.strictEqual(inf.openCase({ guildId: 'g1', action: 'ban', targetId: 'u2' }), 2);
  assert.strictEqual(inf.openCase({ guildId: 'g2', action: 'kick', targetId: 'u1' }), 1);
  assert.strictEqual(inf.openCase({ guildId: 'g1', action: 'mute', targetId: 'u1' }), 3);
  assert.strictEqual(inf.getCase('g1', 2).action, 'ban');
  assert.strictEqual(inf.getCase('g2', 2), null);
  assert.deepStrictEqual(inf.casesFor('g1', 'u1').map((c) => c.case_id), [3, 1]);
});

test('two handles on one file never hand out the same number', () => {
  const os = require('node:os');
  const path = require('node:path');
  const fs = require('node:fs');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sonder-cases-')), 'cases.db');
  const a = create(new Database(file));
  const b = create(new Database(file));
  const got = [];
  for (let i = 0; i < 20; i++) got.push((i % 2 ? a : b).openCase({ guildId: 'g', action: 'warn' }));
  assert.deepStrictEqual(got, Array.from({ length: 20 }, (_, i) => i + 1));
});

test('reason is capped at 512 and edits record who and when', () => {
  const inf = fresh();
  const id = inf.openCase({ guildId: 'g', action: 'warn', reason: 'x'.repeat(2000) });
  assert.strictEqual(inf.getCase('g', id).reason.length, 512);
  const row = inf.setReason('g', id, 'y'.repeat(600), 'mod1', 1234);
  assert.strictEqual(row.reason.length, 512);
  assert.strictEqual(row.updated_by, 'mod1');
  assert.strictEqual(row.updated_at, 1234);
  assert.strictEqual(inf.setReason('g', 999, 'nope', 'mod1'), null);
});

test('voidCase marks a failed action once and keeps the number used', () => {
  const inf = fresh();
  const id = inf.openCase({ guildId: 'g', action: 'ban', reason: 'r' });
  assert.ok(inf.voidCase('g', id, 'ban refused'));
  assert.ok(!inf.voidCase('g', id, 'again'));
  const c = inf.getCase('g', id);
  assert.strictEqual(c.status, 'void');
  assert.match(c.reason, /void: ban refused/);
  assert.strictEqual(inf.openCase({ guildId: 'g', action: 'warn' }), id + 1);
});

test('openCase rejects missing guild or action', () => {
  const inf = fresh();
  assert.throws(() => inf.openCase({ action: 'warn' }));
  assert.throws(() => inf.openCase({ guildId: 'g' }));
});

test('tempbans: due query, guarded delete, defer and re-tempban upsert', () => {
  const inf = fresh();
  inf.addTempban({ guildId: 'g', userId: 'u1', expiresAt: 1000, caseId: 1 });
  inf.addTempban({ guildId: 'g', userId: 'u2', expiresAt: 5000, caseId: 2 });
  assert.deepStrictEqual(inf.dueTempbans(2000).map((t) => t.user_id), ['u1']);
  // a re-tempban replaced the row: the old expiry must not delete the new one
  inf.addTempban({ guildId: 'g', userId: 'u1', expiresAt: 9000, caseId: 3 });
  assert.ok(!inf.removeTempban('g', 'u1', 1000));
  assert.strictEqual(inf.getTempban('g', 'u1').case_id, 3);
  assert.ok(inf.deferTempban('g', 'u2', 5000, 1, 7000));
  assert.deepStrictEqual(inf.dueTempbans(6000), []);
  assert.strictEqual(inf.dueTempbans(7000)[0].attempts, 1);
  assert.ok(inf.removeTempban('g', 'u2'));
  assert.throws(() => inf.addTempban({ guildId: 'g', userId: 'u3' }));
});

test('both tables carry guild_id so the retention purge covers them', () => {
  const db = new Database(':memory:');
  create(db);
  for (const t of ['mod_cases', 'tempbans']) {
    assert.ok(db.prepare(`PRAGMA table_info("${t}")`).all().some((c) => c.name === 'guild_id'), t);
  }
});
