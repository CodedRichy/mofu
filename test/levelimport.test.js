const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

// Never touch data/sonder.db: isolated XP db, and the config store replaced before any command module loads it.
process.env.SONDER_XP_DB = path.join(os.tmpdir(), `sonder-xp-import-${process.pid}-${Date.now()}.db`);
const config = new Map();
const fakeStore = {
  getConfig: (g, k) => config.get(`${g}:${k}`) ?? null,
  setConfig: (g, k, v) => config.set(`${g}:${k}`, v),
};
const storePath = require.resolve('../src/database/store');
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: fakeStore };

const { PermissionFlagsBits } = require('discord.js');
const xp = require('../src/database/xp');
const { parseLevelsFile, planImport, toCount } = require('../src/utils/levelImport');
const importCmd = require('../src/commands/config/import');

const U1 = '123456789012345678';
const U2 = '223456789012345678';
const U3 = '323456789012345678';
const BOT = '423456789012345678';
const GONE = '523456789012345678';
let gidSeq = 0;
const newGuildId = () => `39${String(++gidSeq).padStart(17, '0')}`;

// ---------- curve helpers ----------

test('totalXpForLevel and levelFromTotal round-trip on the same curve', () => {
  assert.strictEqual(xp.totalXpForLevel(0), 0);
  assert.strictEqual(xp.totalXpForLevel(1), 100);
  assert.strictEqual(xp.totalXpForLevel(2), 100 + 155);
  for (const lv of [0, 1, 5, 20, 100]) {
    assert.deepStrictEqual(xp.levelFromTotal(xp.totalXpForLevel(lv)), { level: lv, xp: 0 });
  }
  assert.deepStrictEqual(xp.levelFromTotal(xp.totalXpForLevel(20) + 7), { level: 20, xp: 7 });
});

// ---------- parsing ----------

test('toCount accepts whole numbers only', () => {
  assert.strictEqual(toCount('1200'), 1200);
  assert.strictEqual(toCount('1 200'), 1200);
  assert.strictEqual(toCount(42), 42);
  for (const bad of ['', '-3', '12.5', '1e5', 'abc', -1, 1.5, null]) assert.strictEqual(toCount(bad), null);
});

test('CSV with user_id,xp, semicolons, BOM and bad lines', () => {
  const r = parseLevelsFile(`﻿User ID;XP\n${U1};4200\nnot-an-id;5\n${U2};12.5\n${U3};0`);
  assert.strictEqual(r.mode, 'xp');
  assert.deepStrictEqual(r.records.map((x) => [x.userId, x.xp]), [[U1, 4200], [U3, 0]]);
  assert.strictEqual(r.errors.length, 2);
  assert.match(r.errors[0], /line 3/);
});

test('CSV with user_id,level', () => {
  const r = parseLevelsFile(`member_id,lvl\n${U1},20`);
  assert.strictEqual(r.mode, 'level');
  assert.deepStrictEqual(r.records, [{ userId: U1, xp: null, level: 20 }]);
});

test('xp wins when a file has both xp and level', () => {
  const r = parseLevelsFile(`user_id,level,xp\n${U1},3,999`);
  assert.strictEqual(r.mode, 'xp');
  assert.strictEqual(r.records[0].xp, 999);
});

test('a headerless or unrelated file is refused with a clear message', () => {
  assert.match(parseLevelsFile(`${U1},4200`).errors[0], /header/);
  assert.match(parseLevelsFile('name,score\nx,1').errors[0], /header/);
  assert.match(parseLevelsFile('').errors[0], /empty/);
});

test('JSON array and wrapped JSON are read', () => {
  const a = parseLevelsFile(JSON.stringify([{ user_id: U1, xp: 10 }, { user_id: U2, xp: '20' }, 'junk']));
  assert.deepStrictEqual(a.records.map((x) => x.xp), [10, 20]);
  assert.strictEqual(a.errors.length, 1);
  const b = parseLevelsFile(JSON.stringify({ members: [{ id: U1, level: 4 }] }));
  assert.strictEqual(b.mode, 'level');
  assert.strictEqual(b.records[0].level, 4);
  assert.match(parseLevelsFile('{oops').errors[0], /not valid JSON/);
  assert.match(parseLevelsFile('{"a":1}').errors[0], /JSON array/);
});

// ---------- planning ----------

const planOpts = (current = {}, extra = {}) => ({
  isMember: (id) => id !== GONE,
  isBot: (id) => id === BOT,
  currentTotal: (id) => current[id] || 0,
  totalXpForLevel: xp.totalXpForLevel,
  ...extra,
});

test('plan skips bots and departed members, keeps the higher value, folds duplicates', () => {
  const records = [
    { userId: U1, xp: 500, level: null },
    { userId: U1, xp: 900, level: null }, // duplicate, higher wins
    { userId: U2, xp: 100, level: null }, // already has more
    { userId: BOT, xp: 50, level: null },
    { userId: GONE, xp: 50, level: null },
    { userId: U3, xp: null, level: 2 },
  ];
  const p = planImport(records, planOpts({ [U2]: 300 }));
  assert.strictEqual(p.duplicates, 1);
  assert.strictEqual(p.bots, 1);
  assert.strictEqual(p.notInServer, 1);
  assert.strictEqual(p.unchanged, 1);
  assert.strictEqual(p.lower, 0);
  assert.deepStrictEqual(p.changes.map((c) => [c.userId, c.to]), [[U1, 900], [U3, 255]]);
  assert.strictEqual(p.totalXp, 900 + 255);
});

test('overwrite plans a lower value', () => {
  const p = planImport([{ userId: U2, xp: 100, level: null }], planOpts({ [U2]: 300 }, { overwrite: true }));
  assert.strictEqual(p.lower, 1);
  assert.deepStrictEqual(p.changes[0], { userId: U2, from: 300, to: 100, incoming: 100 });
});

// ---------- database write ----------

test('importTotals never lowers by default and is idempotent', () => {
  const G = newGuildId();
  xp.setXp(G, U2, 5000);
  const entries = [{ userId: U1, totalXp: xp.totalXpForLevel(20) }, { userId: U2, totalXp: 100 }];
  const first = xp.importTotals(G, entries);
  assert.deepStrictEqual(first, { written: 1, unchanged: 1, lowered: 0 });
  assert.strictEqual(xp.getStats(G, U1).level, 20);
  assert.strictEqual(xp.getStats(G, U2).totalXp, 5000);
  const second = xp.importTotals(G, entries);
  assert.deepStrictEqual(second, { written: 0, unchanged: 2, lowered: 0 });
});

test('importTotals overwrite lowers and recomputes the level', () => {
  const G = newGuildId();
  xp.setXp(G, U1, 50000);
  const r = xp.importTotals(G, [{ userId: U1, totalXp: 255 }], { overwrite: true });
  assert.deepStrictEqual(r, { written: 1, unchanged: 0, lowered: 1 });
  assert.deepStrictEqual(xp.getStats(G, U1), { level: 2, xp: 0, needed: xp.xpForLevel(2), totalXp: 255 });
});

test('importTotals rejects bad values and writes nothing (all or nothing)', () => {
  const G = newGuildId();
  assert.throws(() => xp.importTotals(G, [{ userId: U1, totalXp: 10 }, { userId: U2, totalXp: -1 }]), RangeError);
  assert.strictEqual(xp.getStats(G, U1).totalXp, 0);
});

// ---------- command flow (stubbed fetch and Discord objects) ----------

function fakeInteraction({ guildId, fileText, mode = null, canManage = true, members }) {
  const sent = { edits: [], modlog: [] };
  let collector = null;
  const msg = {
    createMessageComponentCollector() { collector = new EventEmitter(); return collector; },
  };
  const memberMap = new Map(members.map(([id, bot]) => [id, { id, user: { id, bot } }]));
  const modlogChannel = { send: async (p) => { sent.modlog.push(p); return {}; } };
  const guild = {
    id: guildId,
    memberCount: memberMap.size,
    members: { cache: memberMap, fetch: async () => memberMap },
    channels: { cache: new Map([['modlogchan', modlogChannel]]) },
    client: { user: { username: 'mofu', displayAvatarURL: () => null } },
  };
  const user = { id: U1, tag: 'example_admin' };
  const perms = { has: (p) => p === PermissionFlagsBits.ManageGuild && canManage };
  const interaction = {
    guild,
    client: guild.client,
    user,
    memberPermissions: perms,
    options: {
      getSubcommand: () => 'levels',
      getString: (n) => (n === 'mode' ? mode : null),
      getAttachment: () => ({ url: 'https://cdn.discordapp.com/attachments/1/2/levels.csv', size: fileText.length }),
    },
    deferReply: async () => {},
    editReply: async (p) => { sent.edits.push(p); return msg; },
  };
  const press = async (kind, { stillManage = true, by = U1 } = {}) => {
    const updates = [];
    const btn = {
      user: { id: by },
      customId: `importlevels:${kind}:${sent.edits.at(-1).components[0].components[0].data.custom_id.split(':')[2]}`,
      memberPermissions: { has: () => stillManage },
      update: async (p) => { updates.push(p); },
    };
    const handlers = collector.listeners('collect');
    for (const h of handlers) await h(btn);
    collector.emit('end');
    return updates;
  };
  return { interaction, sent, press, getCollector: () => collector };
}

const textOf = (payload) => payload.embeds[0].data.description;

async function withFetch(body, fn, status = 200) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url) => { calls.push(String(url)); return { ok: status === 200, status, text: async () => body }; };
  try { return await fn(calls); } finally { global.fetch = original; }
}

test('/import levels: dry run first, confirm writes, second run changes nothing', async () => {
  const G = newGuildId();
  config.set(`${G}:modlog_channel`, 'modlogchan');
  xp.setXp(G, U3, 99999);
  const csv = `user_id,xp\n${U2},${xp.totalXpForLevel(20)}\n${U3},10\n${BOT},500\n${GONE},500`;
  const members = [[U1, false], [U2, false], [U3, false], [BOT, true]];

  await withFetch(csv, async (calls) => {
    const f = fakeInteraction({ guildId: G, fileText: csv, members });
    await importCmd.execute(f.interaction);
    assert.deepStrictEqual(calls, ['https://cdn.discordapp.com/attachments/1/2/levels.csv']);
    const preview = textOf(f.sent.edits.at(-1));
    assert.match(preview, /Nothing has been written yet/);
    assert.match(preview, /Will update: \*\*1\*\* member/);
    assert.match(preview, /No longer in this server: 1/);
    assert.match(preview, /Bots: 1/);
    assert.match(preview, /MEE6 level 20 \(.+ total XP\) becomes mofu level 20/);
    assert.doesNotMatch(preview, /sonder\.gg/);
    assert.strictEqual(xp.getStats(G, U2).totalXp, 0, 'dry run writes nothing');
    assert.ok(importCmd._importing.has(G), 'lock held while the prompt is open');

    const updates = await f.press('yes');
    assert.match(textOf(updates[0]), /Done\. 1 member updated, 0 unchanged/);
    assert.strictEqual(xp.getStats(G, U2).level, 20);
    assert.strictEqual(xp.getStats(G, U3).totalXp, 99999, 'never lowered');
    assert.strictEqual(f.sent.modlog.length, 1);
    assert.doesNotMatch(f.sent.modlog[0].embeds[0].data.author.name, /Case/);
    assert.ok(!importCmd._importing.has(G), 'lock released');
  });

  await withFetch(csv, async () => {
    const f = fakeInteraction({ guildId: G, fileText: csv, members });
    await importCmd.execute(f.interaction);
    const last = f.sent.edits.at(-1);
    assert.match(textOf(last), /Nothing to change/);
    assert.deepStrictEqual(last.components, []);
    assert.ok(!importCmd._importing.has(G));
  });
});

test('/import levels: permission lost before the press writes nothing', async () => {
  const G = newGuildId();
  const csv = `user_id,level\n${U2},5`;
  await withFetch(csv, async () => {
    const f = fakeInteraction({ guildId: G, fileText: csv, members: [[U2, false]] });
    await importCmd.execute(f.interaction);
    const updates = await f.press('yes', { stillManage: false });
    assert.match(textOf(updates[0]), /no longer have \*\*Manage Server\*\*/);
    assert.strictEqual(xp.getStats(G, U2).totalXp, 0);
  });
});

test('/import levels: cancel writes nothing; overwrite lowers', async () => {
  const G = newGuildId();
  xp.setXp(G, U2, 10000);
  const csv = `user_id,xp\n${U2},100`;
  await withFetch(csv, async () => {
    const f = fakeInteraction({ guildId: G, fileText: csv, members: [[U2, false]] });
    await importCmd.execute(f.interaction);
    assert.match(textOf(f.sent.edits.at(-1)), /Nothing to change/); // keep-higher: nothing to do
  });
  await withFetch(csv, async () => {
    const f = fakeInteraction({ guildId: G, fileText: csv, mode: 'overwrite', members: [[U2, false]] });
    await importCmd.execute(f.interaction);
    assert.match(textOf(f.sent.edits.at(-1)), /go down/);
    const cancelled = await f.press('no');
    assert.match(textOf(cancelled[0]), /Cancelled/);
    assert.strictEqual(xp.getStats(G, U2).totalXp, 10000);
  });
  await withFetch(csv, async () => {
    const f = fakeInteraction({ guildId: G, fileText: csv, mode: 'overwrite', members: [[U2, false]] });
    await importCmd.execute(f.interaction);
    const updates = await f.press('yes');
    assert.match(textOf(updates[0]), /1 lowered/);
    assert.strictEqual(xp.getStats(G, U2).totalXp, 100);
  });
});

test('/import levels: refuses without Manage Server, bad host, failed download, bad file', async () => {
  const G = newGuildId();
  const csv = `user_id,xp\n${U2},100`;
  await withFetch(csv, async (calls) => {
    const f = fakeInteraction({ guildId: G, fileText: csv, canManage: false, members: [[U2, false]] });
    await importCmd.execute(f.interaction);
    assert.match(textOf(f.sent.edits.at(-1)), /Manage Server/);
    assert.strictEqual(calls.length, 0);
  });
  await withFetch(csv, async (calls) => {
    const f = fakeInteraction({ guildId: G, fileText: csv, members: [[U2, false]] });
    f.interaction.options.getAttachment = () => ({ url: 'https://example.com/levels.csv', size: 10 });
    await importCmd.execute(f.interaction);
    assert.match(textOf(f.sent.edits.at(-1)), /Couldn't read that attachment/);
    assert.strictEqual(calls.length, 0);
  });
  await withFetch('', async () => {
    const f = fakeInteraction({ guildId: G, fileText: csv, members: [[U2, false]] });
    await importCmd.execute(f.interaction);
    assert.match(textOf(f.sent.edits.at(-1)), /Couldn't download/);
  }, 404);
  await withFetch('name,score\nx,1', async () => {
    const f = fakeInteraction({ guildId: G, fileText: 'x', members: [[U2, false]] });
    await importCmd.execute(f.interaction);
    assert.match(textOf(f.sent.edits.at(-1)), /Nothing to import/);
    assert.ok(!importCmd._importing.has(G), 'lock released on early return');
  });
});

test('/import levels: member list failure aborts honestly', async () => {
  const G = newGuildId();
  const csv = `user_id,xp\n${U2},100`;
  await withFetch(csv, async () => {
    const f = fakeInteraction({ guildId: G, fileText: csv, members: [[U2, false]] });
    f.interaction.guild.memberCount = 50; // cache incomplete -> fetch
    f.interaction.guild.members.fetch = async () => { throw new Error('gateway timeout'); };
    await importCmd.execute(f.interaction);
    assert.match(textOf(f.sent.edits.at(-1)), /Couldn't load this server's member list/);
    assert.ok(!importCmd._importing.has(G));
  });
});
