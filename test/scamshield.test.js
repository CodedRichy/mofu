const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/utils/scamshield');

const perms = (...flags) => ({ has: (f) => flags.includes(f) });

test('normalizeText strips zero-width chars, case, urls query and spacing', () => {
  assert.strictEqual(S.normalizeText('  FREE​  Nitro!! '), 'free nitro!!');
  assert.strictEqual(S.normalizeText('go https://www.Evil.com/x?id=1 now'), 'go evil.com/x now');
  assert.strictEqual(S.textHash('hi'), null); // too short to fingerprint
  assert.strictEqual(S.textHash('Free NITRO here http://a.io/z?q=1'), S.textHash('free​ nitro   here http://a.io/z?q=2'));
});

test('attachment fingerprint ignores url, keys on size+name+type', () => {
  const a = { size: 1234, name: 'Scam.PNG', contentType: 'image/png', url: 'https://cdn/1' };
  const b = { size: 1234, name: 'scam.png', contentType: 'image/png', url: 'https://cdn/2' };
  assert.strictEqual(S.attachmentFingerprint(a), S.attachmentFingerprint(b));
  assert.notStrictEqual(S.attachmentFingerprint(a), S.attachmentFingerprint({ ...b, size: 1235 }));
  assert.strictEqual(S.attachmentFingerprint({ size: 0 }), null);
});

function post(t, ch, id, fps, ts, user = 'u1') {
  return t.record({ guildId: 'g', userId: user, channelId: ch, messageId: id, fingerprints: fps, now: ts });
}

test('burst: 3 channels inside 30s triggers and returns all copies', () => {
  const t = new S.BurstTracker();
  const fp = S.messageFingerprints({ content: 'claim your free nitro at evil.com' });
  assert.strictEqual(post(t, 'c1', 'm1', fp, 1000).triggered, false);
  assert.strictEqual(post(t, 'c2', 'm2', fp, 5000).triggered, false);
  const r = post(t, 'c3', 'm3', fp, 9000);
  assert.strictEqual(r.triggered, true);
  assert.deepStrictEqual(r.copies.map((c) => c.messageId).sort(), ['m1', 'm2', 'm3']);
});

test('burst thresholds: same channel, too slow, other user, other text do not trigger', () => {
  const fp = S.messageFingerprints({ content: 'claim your free nitro at evil.com' });
  let t = new S.BurstTracker();
  for (let i = 0; i < 6; i++) assert.strictEqual(post(t, 'c1', `m${i}`, fp, 1000 + i).triggered, false); // one channel
  t = new S.BurstTracker();
  post(t, 'c1', 'm1', fp, 0); post(t, 'c2', 'm2', fp, 20000);
  assert.strictEqual(post(t, 'c3', 'm3', fp, 31000).triggered, false); // first copy aged out
  t = new S.BurstTracker();
  post(t, 'c1', 'm1', fp, 0, 'a'); post(t, 'c2', 'm2', fp, 1, 'b');
  assert.strictEqual(post(t, 'c3', 'm3', fp, 2, 'c').triggered, false); // different users
  t = new S.BurstTracker();
  post(t, 'c1', 'm1', S.messageFingerprints({ content: 'one distinct message' }), 0);
  post(t, 'c2', 'm2', S.messageFingerprints({ content: 'another distinct message' }), 1);
  assert.strictEqual(post(t, 'c3', 'm3', S.messageFingerprints({ content: 'a third distinct one' }), 2).triggered, false);
});

test('burst works on the same attachment with different text', () => {
  const t = new S.BurstTracker();
  const att = (n) => S.messageFingerprints({ content: `text ${n} varies`, attachments: [{ size: 99, name: 'qr.png', contentType: 'image/png' }] });
  post(t, 'c1', 'm1', att(1), 0); post(t, 'c2', 'm2', att(2), 100);
  const r = post(t, 'c3', 'm3', att(3), 200);
  assert.strictEqual(r.triggered, true);
  assert.ok(r.fingerprint.startsWith('a:'));
});

test('tracker memory is bounded', () => {
  const t = new S.BurstTracker({ maxUsers: 50 });
  const fp = S.messageFingerprints({ content: 'some repeated content here' });
  for (let i = 0; i < 500; i++) t.record({ guildId: 'g', userId: `u${i}`, channelId: 'c', messageId: `m${i}`, fingerprints: fp, now: i });
  assert.ok(t.size <= 50);
});

test('remote auth links are detected, normal discord links are not', () => {
  assert.strictEqual(S.hasRemoteAuthLink('scan: https://discord.com/ra/AbCdEf123456'), true);
  assert.strictEqual(S.hasRemoteAuthLink('https://discordapp.com/ra/AbCdEf123456'), true);
  assert.strictEqual(S.hasRemoteAuthLink('https://discord.com/ra/AbCd​Ef123456'), true);
  assert.strictEqual(S.hasRemoteAuthLink('https://discord.com/channels/1/2'), false);
  assert.strictEqual(S.hasRemoteAuthLink('https://notdiscord.com/ra/AbCdEf123456'), false);
});

test('staff and trusted roles are exempt, ordinary members are not', () => {
  const cfg = S.normalizeConfig({ enabled: true, trustedRoles: ['r9'] });
  assert.strictEqual(S.isExempt({ permissions: perms('ManageMessages'), roleIds: [] }, cfg), true);
  assert.strictEqual(S.isExempt({ permissions: perms('Administrator'), roleIds: [] }, cfg), true);
  assert.strictEqual(S.isExempt({ permissions: perms(), roleIds: ['r9'] }, cfg), true);
  assert.strictEqual(S.isExempt({ permissions: perms('SendMessages'), roleIds: ['r1'] }, cfg), false);
});

test('config defaults off and clamps the timeout', () => {
  assert.strictEqual(S.normalizeConfig(undefined).enabled, false);
  assert.strictEqual(S.normalizeConfig({}).timeoutMs, S.DEFAULT_TIMEOUT_MS);
  assert.strictEqual(S.normalizeConfig({ timeoutMs: 5 }).timeoutMs, S.MIN_TIMEOUT_MS);
  assert.strictEqual(S.normalizeConfig({ timeoutMs: 1e12 }).timeoutMs, S.MAX_TIMEOUT_MS);
});

test('name skeleton folds confusables, zero-width, case and fullwidth', () => {
  const target = S.nameSkeleton('Moderator');
  assert.strictEqual(S.nameSkeleton('Mодerator'.replace('д', 'd')), target); // cyrillic o
  assert.strictEqual(S.nameSkeleton('M0derat0r'), target);
  assert.strictEqual(S.nameSkeleton('Mod​erator'), target);
  assert.strictEqual(S.nameSkeleton('Ｍｏｄｅｒａｔｏｒ'), target);
  assert.strictEqual(S.nameSkeleton('Möderator'), target);
});

test('impersonation: lookalike name or same avatar flagged, unrelated and staff themselves not', () => {
  const staff = [{ id: 's1', names: ['Admiral Rook'], avatar: 'abc' }];
  const hit = S.findImpersonation({ id: 'x', names: ['Admіral R00k'], avatar: null }, staff);
  assert.strictEqual(hit.length, 1);
  assert.strictEqual(hit[0].staffId, 's1');
  assert.strictEqual(S.findImpersonation({ id: 'x', names: ['Someone Else'], avatar: 'abc' }, staff)[0].reasons[0], 'same avatar image');
  assert.strictEqual(S.findImpersonation({ id: 'x', names: ['Admiral Rookk'], avatar: null }, staff).length, 1); // one char away
  assert.strictEqual(S.findImpersonation({ id: 'x', names: ['Totally Different'], avatar: 'zzz' }, staff).length, 0);
  assert.strictEqual(S.findImpersonation({ id: 's1', names: ['Admiral Rook'], avatar: 'abc' }, staff).length, 0);
  assert.strictEqual(S.findImpersonation({ id: 'x', names: ['Al'] }, [{ id: 's2', names: ['Al'], avatar: null }]).length, 0); // too short
});

test('qrscan reports unavailable cleanly when jsqr is missing', async () => {
  const q = require('../src/utils/qrscan');
  if (!q.available()) {
    assert.deepStrictEqual(await q.scanAttachment({ url: 'https://cdn.discordapp.com/x.png', size: 10, contentType: 'image/png' }), { status: 'unavailable', urls: [] });
  } else {
    assert.strictEqual((await q.scanAttachment({ url: 'https://evil.example/x.png', size: 10, contentType: 'image/png' })).status, 'skipped');
  }
});

test('recovery checklist covers the key steps', () => {
  const t = S.recoveryChecklist('Test Guild', 7, 3600000);
  for (const w of ['password', 'devices', 'QR', 'two-factor', '#7']) assert.ok(t.includes(w), w);
});
