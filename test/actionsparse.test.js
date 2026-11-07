const test = require('node:test');
const assert = require('node:assert');
const { parseMuteIntent, usageHint } = require('../src/ai/actions');

// Regression corpus from the QA pass: hand-labelled conversation that must never become an action,
// and a generated set of real requests that must keep parsing.
const BOT = '900000000000000001';
const U = '<@111111111111111111>';
const V = '<@222222222222222222>';
const B = `<@${BOT}>`;
const ROLE = '<@&333333333333333333>';
const OB = '<@999999999999999999>';

// The bot answers to its new name 'mofu' and its old name 'sonder'. The corpus is written with 'sonder' and
// every case also runs with 'mofu' in its place, so each guard holds for both names.
const asMofu = (s) => s.replace(/sonder/g, 'mofu').replace(/SONDER/g, 'MOFU').replace(/Sonder/g, 'Mofu');
const both = (list) => list.flatMap((s) => [s, asMofu(s)]);

const NOT_REQUESTS = both([
'sonder stop being weird', 'sonder, play it cool', 'mute that tv lol sonder', 'sonder mute that tv lol', 'sonder can you mute the music', 'sonder i will kick your ass', 'sonder, why did kai kick the bucket',
 'kick off the stream sonder', 'sonder silence is golden', 'the sonder mute button is broken', 'sonder why did you kick kai', 'sonder how do i warn someone', 'sonder what does timeout do', 'sonder tell me how to mute',
 'sonder he got kicked yesterday', 'sonder who got muted', 'sonder i muted him already', 'sonder do not mute me', 'sonder dont kick me please', 'sonder lets play, kick back and relax',
 'sonder warn me before you roast me', 'sonder warn me', 'sonder mute yourself', 'sonder shut up lol', 'sonder you should be muted lol', 'sonder is a good bot, kick ass', 'sonder kick it into gear',
 'sonder, i need to mute my mic', 'sonder my mic is muted', 'sonder my mom will kick me out of vc', 'sonder warn level high today', 'sonder the timeout was too long yesterday', 'my timeout ends soon sonder',
 'sonder time out for a sec brb', 'sonder silence', 'sonder, mute', 'sonder mute?', 'sonder kick', 'sonder warn', 'sonder mute everyone', 'sonder mute everybody for 10m', 'sonder mute all of them',
 'sonder mute people who spam', 'sonder mute whoever is talking', 'sonder mute the chat', 'sonder mute #general', 'sonder mute my friend', 'sonder kick them all', 'sonder kick the habit', 'sonder warn the team about the update',
 'sonder kick the tires', 'sonder mute 10m', 'sonder kick 123456', 'sonder kick lol', 'sonder warn lmao', 'sonder mute ok', 'sonder mute pls', 'sonder kick idk', 'sonder warn xd', 'sonder timeout lol', 'sonder mute haha',
 'sonder mute dude', 'sonder kick bro', 'sonder warn fam', 'sonder mute guys', 'sonder kick him', 'sonder mute me lol', 'sonder mute plz', 'sonder kick butt', 'sonder kick asses', 'sonder warn them', 'sonder kick gently',
 `sonder never kick ${U}`, `sonder please dont mute ${U}`, `sonder do not warn ${U}`, `sonder don't kick ${U}`, `sonder you should not mute ${U}`, `sonder unmute ${U}?`, `sonder did you mute ${U}?`, `sonder can you kick ${U}?`,
 `sonder ${U} said mute is cringe`, `sonder if ${U} spams again then mute`, `sonder i wanted to kick ${U} but nvm`, `sonder ${U} got muted by ${V}`, `sonder why was ${U} kicked`, `sonder tell ${U} to mute his mic`, `sonder ${U} should mute his mic`,
 `sonder ${U} was warned already`, `sonder what happens if I kick ${U}`, `sonder i would never kick ${U}`, `sonder ${U} told me to kick rocks`, `sonder ${U} asked how to mute`, `sonder ${U} mute your mic lol`, `sonder hey ${U} mute your mic`,
 `${OB} mute ${U}`, `${OB} sonder mute ${U}`, `sonder is better than ${OB}, ${OB} kick ${U}`, `@everyone sonder mute`, `sonder mute @everyone`, `sonder mute @here`, `sonder kick @everyone`, `sonder warn ${ROLE}`, `sonder mute ${ROLE}`,
 `sonder mute ${ROLE} 10m`, `sonder kick ${B}`, `sonder mute ${B} lol`, `${B} warn ${B}`, 
 'sonder silencia a kai', 'sonder mutea a kai', 'sonder expulsa a kai', 'sonder kick karo kai ko', 'sonder kai ko mute kar', 'sonder isko mute karo', 'sonder bhai kick mat karna', 'sonder no me mutees', 'sonder ne me kick pas', 'sonder 请 mute 我',
 'sonder tu peux kick kai', 'sonder kannst du kai kicken', 'sonder, ¿puedes mute a kai?', 'sonder mute-kai', 'sonder kick-flip is a skateboard trick', 'sonder drop kick', 'sonder kick-off at 5', 'sonder time-out',
 'sonder, timeout. I need a break', 'sonder timeout, we need to talk', 'sonder warn, I think this is a bad idea', 'sonder kick, snare, hat', 'sonder mute button position', 'sonder play it again, kick the bass up',
 // both names in one line: still conversation
 'the sonder mute button is broken mofu', 'mofu the sonder mute button is broken', `${OB} mofu mute ${U}`,

]);

const REQUESTS = [];
const lead = [...new Set(both(['sonder', 'yo sonder', 'hey sonder,', 'sonder,', B, `${B},`, 'sonder please', 'can you', 'sonder pls']))];
const durs = ['', ' 10m', ' 2 hours', ' 1d', ' 30 seconds', ' for 5 minutes', ' 1w'];
const reas = ['', ' spamming', ' for being toxic', ' because he is annoying'];
for (const l of lead) for (const d of durs) for (const r of reas) REQUESTS.push([`${l} mute ${U}${d}${r}`, 'mute']);
for (const l of lead.slice(0, 5)) {
  REQUESTS.push([`${l} kick ${U} for spam`, 'kick'], [`${l} warn ${U} bad language`, 'warn'], [`${l} unmute ${U}`, 'unmute'],
    [`${l} timeout ${U} 5m`, 'mute'], [`${l} mute ${U} ${V} 10m`, 'mute']);
}
const EXTRA = [['sonder mute kai 30s', 'mute'], ['sonder kick kai', 'kick'], ['sonder warn kai spamming', 'warn'], ['sonder unmute kai', 'unmute'], ['sonder timeout kai 5m', 'mute'],
  [`sonder warn ${U} and mute ${V}`, 'warn'], [`sonder mute <@!111111111111111111>`, 'mute'],
  [`sonder can you please mute ${U} 5m`, 'mute'], [`sonder i want you to kick ${U}`, 'kick'], [`SONDER MUTE ${U}`, 'mute'], [`mute ${U} 10m sonder`, 'mute'],
  [`Sonder mute ${U}`, 'mute']];
for (const [s, k] of EXTRA) REQUESTS.push([s, k], [asMofu(s), k]);
// either name, in any order, as long as the verb follows the last one
REQUESTS.push([`sonder mofu mute ${U}`, 'mute'], [`mofu sonder kick ${U}`, 'kick'], [`yo mofu, sonder please warn ${U}`, 'warn']);

test('the corpus really covers both names', () => {
  assert.ok(REQUESTS.some(([s]) => /^mofu /.test(s)) && REQUESTS.some(([s]) => /^sonder /.test(s)));
  assert.ok(NOT_REQUESTS.includes('the mofu mute button is broken') && NOT_REQUESTS.includes('the sonder mute button is broken'));
});

test('real requests keep parsing as the right action', () => {
  for (const [s, kind] of REQUESTS) {
    const r = parseMuteIntent(s, BOT);
    assert.ok(r, `should parse: ${s}`);
    assert.strictEqual(r.kind, kind, s);
  }
});

test('conversation that merely contains a verb is not an action', () => {
  const fp = NOT_REQUESTS.filter((s) => parseMuteIntent(s, BOT));
  assert.deepStrictEqual(fp, []);
});

test('negations never become requests', () => {
  for (const s of both([`sonder dont kick ${U}`, `sonder don't mute ${U}`, `sonder do not warn ${U}`, `sonder never kick ${U}`, `sonder no need to mute ${U}`,
    `sonder you shouldn't mute ${U}`, `sonder you should not kick ${U}`, `sonder wont mute ${U}`, `sonder you cannot kick ${U}`, `sonder please dont mute ${U} 5m`])) {
    assert.strictEqual(parseMuteIntent(s, BOT), null, s);
  }
});

test('questions without a question mark are not requests', () => {
  for (const s of both([`sonder why did you kick ${U}`, `sonder how do i mute ${U}`, `sonder what happens if i kick ${U}`, `sonder who muted ${U}`, `sonder did you mute ${U}`,
    `sonder have you kicked ${U}`, `sonder is it ok to warn ${U}`, `sonder when do you kick ${U}`, `sonder he asked how to mute ${U}`, 'sonder how to mute kai', 'sonder why did you kick kai'])) {
    assert.strictEqual(parseMuteIntent(s, BOT), null, s);
  }
});

test('typed names that are common words never resolve to a lookup', () => {
  for (const w of ['your', 'button', 'was', 'lol', 'dude', 'ends', 'level', 'high', 'today', 'it', 'him', 'her', 'them', 'that', 'this', 'everyone', 'someone', 'karo', 'mat', 'idk', 'lmao', 'haha', '#general']) {
    for (const verb of ['mute', 'kick', 'warn', 'unmute', 'timeout']) {
      for (const name of ['sonder', 'mofu']) assert.strictEqual(parseMuteIntent(`${name} ${verb} ${w}`, BOT), null, `${name} ${verb} ${w}`);
    }
  }
  // the bot's own names are never a typed target either
  for (const name of ['sonder', 'mofu']) {
    for (const verb of ['mute', 'kick', 'warn']) assert.strictEqual(parseMuteIntent(`mofu ${verb} ${name}`, BOT), null, `${verb} ${name}`);
  }
  // ...but ordinary names still work
  for (const name of ['sonder', 'mofu']) {
    assert.strictEqual(parseMuteIntent(`${name} kick emily for spam`, BOT).targetName, 'emily');
    assert.strictEqual(parseMuteIntent(`${name} mute Hollyhock 10m`, BOT).targetName, 'Hollyhock');
  }
});

test('the usage placeholder "someone" gets the usage hint, not an action', () => {
  for (const name of ['sonder', 'mofu']) {
    for (const verb of ['mute', 'kick', 'warn', 'unmute']) {
      assert.strictEqual(parseMuteIntent(`${name} ${verb} someone`, BOT), null);
      assert.ok(usageHint(`${name} ${verb} someone`, BOT), verb);
    }
    assert.ok(usageHint(`${name} mute @someone 10m reason`, BOT));
    assert.strictEqual(usageHint(`${name} how do i mute someone`, BOT), null);
    assert.strictEqual(usageHint(`${name} tell someone to kick rocks`, BOT), null);
  }
});

test('usage hints show the new name, whichever name was used', () => {
  for (const s of ['sonder mute', 'mofu mute', 'mofu kick', 'sonder warn', 'MOFU UNMUTE', `${B} timeout`]) {
    const hint = usageHint(s, BOT);
    assert.ok(hint, s);
    assert.match(hint, /`mofu (mute|kick|warn|unmute) @someone/, s);
    assert.doesNotMatch(hint, /sonder/i, s);
  }
});

test('oversized and hostile input is rejected quickly', () => {
  assert.strictEqual(parseMuteIntent('sonder mute ' + 'a'.repeat(100000), BOT), null);
  assert.strictEqual(parseMuteIntent('mofu mute ' + 'a'.repeat(100000), BOT), null);
  assert.strictEqual(parseMuteIntent('', BOT), null);
  assert.strictEqual(parseMuteIntent(undefined, BOT), null);
});
