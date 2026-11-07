const test = require('node:test');
const assert = require('node:assert');
const bulk = require('../src/utils/bulk');

test('runBulk respects concurrency, collects failures, never throws', async () => {
  let inFlight = 0;
  let peak = 0;
  const items = Array.from({ length: 20 }, (_, i) => i);
  const r = await bulk.runBulk(items, async (i) => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((res) => setTimeout(res, 2));
    inFlight--;
    if (i % 5 === 0) throw new Error(`no perms ${i}`);
  }, { concurrency: 3, delayMs: 0 });
  assert.ok(peak <= 3);
  assert.equal(r.total, 20);
  assert.equal(r.failed.length, 4);
  assert.equal(r.ok, 16);
  assert.deepEqual(r.failed.map((f) => f.item), [0, 5, 10, 15]);
});

test('runBulk reports progress on slow runs only, and a failing progress call is harmless', async () => {
  const clock = { t: 0 };
  const seen = [];
  await bulk.runBulk([1, 2, 3, 4], async () => { clock.t += 2000; }, {
    concurrency: 1, delayMs: 0, progressMs: 3000, now: () => clock.t,
    onProgress: (d, t) => { seen.push(`${d}/${t}`); throw new Error('edit failed'); },
  });
  assert.deepEqual(seen, ['2/4']);
  const none = [];
  await bulk.runBulk([1, 2], async () => {}, { delayMs: 0, onProgress: () => none.push(1) });
  assert.equal(none.length, 0);
});

test('failureText is capped for embeds and says how many were left out', () => {
  assert.equal(bulk.failureText([]), '');
  const names = Array.from({ length: 300 }, (_, i) => `#channel-name-${i}`);
  const t = bulk.failureText(names);
  assert.ok(t.length <= 900);
  assert.ok(t.startsWith("Couldn't update 300 channels"));
  assert.match(t, /and \d+ more$/);
  assert.ok(bulk.failureText(['#a']).includes('1 channel ('));
});

function fakeInteraction() {
  const calls = [];
  return {
    calls,
    deferred: false,
    replied: false,
    async deferReply() { this.deferred = true; calls.push(['defer']); },
    async reply(p) { this.replied = true; calls.push(['reply', p]); },
    async editReply(p) { calls.push(['edit', p]); },
  };
}

test('send replies before defer and edits after (dropping ephemeral, clearing progress text)', async () => {
  const i = fakeInteraction();
  await bulk.send(i, { embeds: [1], ephemeral: true });
  assert.equal(i.calls[0][0], 'reply');
  const j = fakeInteraction();
  await bulk.ensureDeferred(j);
  await bulk.ensureDeferred(j); // idempotent
  await bulk.send(j, { embeds: [1], ephemeral: true });
  assert.deepEqual(j.calls, [['defer'], ['edit', { content: null, embeds: [1] }]]);
});

test('applyRoleOverwrites: skips threads and channels already set, defers only when there is work, reports failures', async () => {
  const role = { id: 'r1', name: 'Hardmuted' };
  const mk = (id, name, { has = false, fail = false, thread = false } = {}) => ({
    id, name,
    isThread: () => thread,
    permissionOverwrites: thread ? undefined : {
      cache: new Map(has ? [[role.id, {}]] : []),
      edits: 0,
      async edit() { if (fail) throw new Error('Missing Permissions'); this.edits++; this.cache.set(role.id, {}); },
    },
  });
  const chans = [mk('1', 'general'), mk('2', 'secret', { fail: true }), mk('3', 'done', { has: true }), mk('4', 'thread', { thread: true })];
  const guild = { channels: { cache: new Map(chans.map((c) => [c.id, c])) } };
  const i = { ...fakeInteraction(), guild };
  const r = await bulk.applyRoleOverwrites(i, role, { SendMessages: false });
  assert.equal(r.total, 2);
  assert.deepEqual(r.failedNames, ['#secret']);
  assert.equal(i.deferred, true);
  assert.equal(chans[0].permissionOverwrites.edits, 1);
  assert.equal(chans[2].permissionOverwrites.edits, 0);

  // second run: only the failed channel is retried; nothing to do means no defer
  const fixed = [mk('1', 'general', { has: true }), mk('3', 'done', { has: true })];
  const i2 = { ...fakeInteraction(), guild: { channels: { cache: new Map(fixed.map((c) => [c.id, c])) } } };
  const r2 = await bulk.applyRoleOverwrites(i2, role, { SendMessages: false });
  assert.equal(r2.total, 0);
  assert.equal(i2.deferred, false);
});
