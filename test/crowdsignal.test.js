const test = require('node:test');
const assert = require('node:assert');
const cs = require('../src/utils/crowdsignal');

const T0 = 1_700_000_000_000;
const MIN = 60 * 1000;

// Give a channel several minutes of ordinary, lowercase, slow chat so the baseline is ready.
function warm(tracker, channelId, minutes = 5) {
  for (let m = 0; m < minutes; m++) {
    tracker.observeMessage({ channelId, messageId: `w${m}a`, authorId: 'u1', content: 'just chatting about the game today', now: T0 + m * MIN });
    tracker.observeMessage({ channelId, messageId: `w${m}b`, authorId: 'u2', content: 'yeah agreed, sounds fun to me', now: T0 + m * MIN + 20000 });
  }
  return T0 + minutes * MIN + 5000;
}

test('classifyText: shock and mod calls in English, Hinglish and Spanish', () => {
  assert.equal(cs.classifyText('WTFFFFF').shock, true);
  assert.equal(cs.classifyText('bro what').shock, true);
  assert.equal(cs.classifyText('yeh kya hai bhai').shock, true);
  assert.equal(cs.classifyText('que carajo es eso').shock, true);
  assert.equal(cs.classifyText('que asco, borren eso').modCall, true);
  assert.equal(cs.classifyText('where are the mods').modCall, true);
  assert.equal(cs.classifyText('mods kaha hain').modCall, true);
  assert.equal(cs.classifyText('ban him please').modCall, true);
  assert.equal(cs.classifyText('delete that').modCall, true);
  assert.equal(cs.classifyText('nice picture, love the colours').shock, false);
  assert.equal(cs.classifyText('nice picture, love the colours').modCall, false);
  assert.deepEqual(cs.classifyText(''), { shock: false, modCall: false });
});

test('capsRatio ignores short text and measures shouting', () => {
  assert.equal(cs.capsRatio('lol'), null);
  assert.equal(cs.capsRatio('WHAT THE'), 1);
  assert.ok(cs.capsRatio('hello there friend') < 0.05);
});

test('hasImagePost: attachment, embed, sticker and gif link', () => {
  assert.equal(cs.hasImagePost({ attachments: [{ contentType: 'image/png' }] }), true);
  assert.equal(cs.hasImagePost({ attachments: [{ name: 'x.JPG' }] }), true);
  assert.equal(cs.hasImagePost({ attachments: [{ contentType: 'application/pdf', name: 'a.pdf' }] }), false);
  assert.equal(cs.hasImagePost({ embeds: [{ image: { url: 'https://x/y.png' } }] }), true);
  assert.equal(cs.hasImagePost({ stickerCount: 1 }), true);
  assert.equal(cs.hasImagePost({ content: 'look https://tenor.com/view/cat-gif-123' }), true);
  assert.equal(cs.hasImagePost({ content: 'just text here' }), false);
});

test('emojiWeight: alarm emoji count, variation selector ignored, others do not', () => {
  assert.equal(cs.emojiWeight('🚩'), 1);
  assert.equal(cs.emojiWeight('⚠️'), 1);
  assert.ok(cs.emojiWeight('💀') < 1);
  assert.equal(cs.emojiWeight('👍'), 0);
  assert.equal(cs.emojiWeight(null), 0);
});

test('crowd of shock and mod-call replies fires, once', () => {
  const t = new cs.CrowdTracker();
  const now = warm(t, 'c1');
  t.observeMessage({ channelId: 'c1', messageId: 'img', authorId: 'poster', content: '', isImage: true, now });
  const fired = [];
  const say = (id, content, dt, extra = {}) => fired.push(...t.observeMessage({ channelId: 'c1', messageId: `m-${id}`, authorId: id, content, now: now + dt, ...extra }));
  say('a', 'WTF', 1000);
  say('b', 'bro what', 2000);
  say('c', 'where are the mods', 3000, { replyToId: 'img' });
  say('d', 'MODS?? delete that', 4000);
  assert.equal(fired.length, 1);
  assert.equal(fired[0].messageId, 'img');
  assert.equal(fired[0].via, 'crowd');
  assert.ok(fired[0].score >= cs.FIRE_THRESHOLD);
  assert.ok(fired[0].reasons.length >= 2);
  say('e', 'wtf wtf', 5000);
  assert.equal(fired.length, 1, 'a window fires once');
});

test('one loud person is not a crowd', () => {
  const t = new cs.CrowdTracker();
  const now = warm(t, 'c1');
  t.observeMessage({ channelId: 'c1', messageId: 'img', authorId: 'poster', isImage: true, now });
  let fired = [];
  for (let i = 0; i < 12; i++) fired.push(...t.observeMessage({ channelId: 'c1', messageId: `s${i}`, authorId: 'loud', content: 'WTF where are the mods', now: now + 500 * i }));
  assert.equal(fired.length, 0);
});

test('ordinary chat after an image does not fire', () => {
  const t = new cs.CrowdTracker();
  const now = warm(t, 'c1');
  t.observeMessage({ channelId: 'c1', messageId: 'img', authorId: 'poster', isImage: true, now });
  let fired = [];
  fired.push(...t.observeMessage({ channelId: 'c1', messageId: 'a', authorId: 'a', content: 'nice one, love it', now: now + 2000 }));
  fired.push(...t.observeMessage({ channelId: 'c1', messageId: 'b', authorId: 'b', content: 'haha good meme', now: now + 4000, replyToId: 'img' }));
  assert.equal(fired.length, 0);
});

test('window expires after WINDOW_MS', () => {
  const t = new cs.CrowdTracker();
  const now = warm(t, 'c1');
  t.observeMessage({ channelId: 'c1', messageId: 'img', authorId: 'poster', isImage: true, now });
  const late = now + cs.WINDOW_MS + 1000;
  const f = [];
  for (const [i, who] of ['a', 'b', 'c', 'd', 'e'].entries()) f.push(...t.observeMessage({ channelId: 'c1', messageId: `m${i}`, authorId: who, content: 'wtf mods', now: late + i }));
  assert.equal(f.length, 0);
});

test('reactions alone fire without any message text (no Message Content intent)', () => {
  const t = new cs.CrowdTracker();
  const now = warm(t, 'c1');
  t.observeMessage({ channelId: 'c1', messageId: 'img', authorId: 'poster', content: '', isImage: true, now });
  let fired = [];
  for (const [i, u] of ['r1', 'r2', 'r3', 'r4'].entries()) fired.push(...t.observeReaction({ channelId: 'c1', messageId: 'img', userId: u, emoji: '🚩', now: now + 1000 * (i + 1) }));
  assert.equal(fired.length, 1);
  assert.equal(fired[0].via, 'reactions');
  assert.ok(fired[0].reactionScore >= cs.REACTION_FIRE);
});

test('reactions: harmless emoji, the poster and repeats do not count', () => {
  const t = new cs.CrowdTracker();
  const now = warm(t, 'c1');
  t.observeMessage({ channelId: 'c1', messageId: 'img', authorId: 'poster', isImage: true, now });
  const f = [];
  for (let i = 0; i < 10; i++) f.push(...t.observeReaction({ channelId: 'c1', messageId: 'img', userId: `u${i}`, emoji: '👍', now: now + 100 }));
  for (let i = 0; i < 10; i++) f.push(...t.observeReaction({ channelId: 'c1', messageId: 'img', userId: 'poster', emoji: '🚩', now: now + 100 }));
  for (let i = 0; i < 10; i++) f.push(...t.observeReaction({ channelId: 'c1', messageId: 'img', userId: 'same', emoji: '🚩', now: now + 100 }));
  assert.equal(f.length, 0);
  assert.equal(t.peek('c1', 'img', now + 200).reactionScore, 1);
});

test('reaction on an untracked message is ignored until a window is opened', () => {
  const t = new cs.CrowdTracker();
  assert.deepEqual(t.observeReaction({ channelId: 'nope', messageId: 'x', userId: 'u', emoji: '🚩' }), []);
  t.openWindow({ channelId: 'c9', messageId: 'x', authorId: 'p', now: T0 });
  assert.equal(t.hasWindow('c9', 'x'), true);
});

test('scoreWindow reports capital and rate jumps explicitly', () => {
  const b = new cs.Baseline();
  for (let m = 0; m < 5; m++) { b.record(T0 + m * MIN, 'quiet lowercase chat here'); b.record(T0 + m * MIN + 1000, 'more quiet words from me'); }
  b.record(T0 + 5 * MIN, 'x');
  assert.equal(b.ready(), true);
  const w = cs.newWindow({ messageId: 'i', authorId: 'p', now: T0 + 6 * MIN });
  w.messages = 8; w.capsSum = 8 * 0.9; w.capsN = 8; ['a', 'b', 'c', 'd'].forEach((x) => w.authors.add(x));
  const s = cs.scoreWindow(w, b, T0 + 6 * MIN + 10000);
  assert.ok(s.reasons.some((r) => /capital/.test(r)));
  assert.ok(s.reasons.some((r) => /rate/.test(r)));
  const cold = cs.scoreWindow(w, new cs.Baseline(), T0 + 6 * MIN + 10000);
  assert.equal(cold.score, 0, 'no baseline history means no caps or rate points');
});

test('adaptive threshold: false alarms raise the bar, confirmations lower it, both clamped', () => {
  assert.equal(cs.thresholdFor(null), cs.FIRE_THRESHOLD);
  assert.ok(cs.thresholdFor({ falseAlarm: 4 }) > cs.FIRE_THRESHOLD);
  assert.ok(cs.thresholdFor({ confirmed: 4 }) < cs.FIRE_THRESHOLD);
  assert.ok(cs.thresholdFor({ falseAlarm: 999 }) <= cs.MAX_THRESHOLD);
  assert.ok(cs.thresholdFor({ confirmed: 999 }) >= cs.MIN_THRESHOLD);
  assert.deepEqual(cs.normalizeCounters({ confirmed: 'x', falseAlarm: -3 }), { confirmed: 0, falseAlarm: 0 });
});

test('bumpCounters halves both at the cap and ignores unknown kinds', () => {
  let c = { confirmed: cs.COUNTER_CAP - 1, falseAlarm: 10 };
  c = cs.bumpCounters(c, 'confirmed');
  assert.ok(c.confirmed < cs.COUNTER_CAP && c.falseAlarm <= 5);
  assert.deepEqual(cs.bumpCounters({ confirmed: 1, falseAlarm: 2 }, 'bogus'), { confirmed: 1, falseAlarm: 2 });
});

test('moderator feedback changes whether the same crowd fires', () => {
  const run = (counters) => {
    const t = new cs.CrowdTracker();
    t.setCounters('c1', counters);
    const now = warm(t, 'c1');
    t.observeMessage({ channelId: 'c1', messageId: 'img', authorId: 'poster', isImage: true, now });
    const f = [];
    f.push(...t.observeMessage({ channelId: 'c1', messageId: 'a', authorId: 'a', content: 'wtf', now: now + 1000 }));
    f.push(...t.observeMessage({ channelId: 'c1', messageId: 'b', authorId: 'b', content: 'mods?', now: now + 2000 }));
    f.push(...t.observeMessage({ channelId: 'c1', messageId: 'c', authorId: 'c', content: 'what the hell', now: now + 3000 }));
    return f.length;
  };
  assert.equal(run({ falseAlarm: 12 }), 0, 'a channel with many false alarms needs more');
  assert.equal(run({ confirmed: 12 }), 1, 'a channel with confirmed hits needs less');
});

test('feedback() returns counters to persist', () => {
  const t = new cs.CrowdTracker();
  assert.deepEqual(t.feedback('c1', 'falseAlarm'), { confirmed: 0, falseAlarm: 1 });
  assert.deepEqual(t.feedback('c1', 'confirmed'), { confirmed: 1, falseAlarm: 1 });
  assert.deepEqual(t.getCounters('c1'), { confirmed: 1, falseAlarm: 1 });
});

test('tracker memory is bounded', () => {
  const t = new cs.CrowdTracker({ maxChannels: 3 });
  for (let i = 0; i < 10; i++) t.observeMessage({ channelId: `c${i}`, messageId: 'm', authorId: 'u', content: 'hi there', isImage: true, now: T0 });
  assert.ok(t.channels.size <= 3);
});

test('no message text is retained by a window', () => {
  const t = new cs.CrowdTracker();
  t.observeMessage({ channelId: 'c1', messageId: 'img', authorId: 'p', isImage: true, now: T0 });
  t.observeMessage({ channelId: 'c1', messageId: 'a', authorId: 'a', content: 'SECRETPHRASE wtf', now: T0 + 1000 });
  const dump = JSON.stringify([...t.channels.get('c1').windows.values()].map((w) => ({ ...w, shock: [...w.shock], modCall: [...w.modCall], repliers: [...w.repliers], reactors: [...w.reactors], authors: [...w.authors] })));
  assert.equal(/secretphrase/i.test(dump), false);
});
