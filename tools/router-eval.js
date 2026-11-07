// Eyeball the chat command router without a model or Discord: node tools/router-eval.js
// For each sentence prints whether the model would be asked at all, the top shortlist entries, and the tier
// of the top one. A stub "model" picks the top shortlisted command (no args), so this checks the shortlist and
// the tier table, not the real model's choices. Database modules are stubbed; nothing is written.
const fs = require('fs');
const path = require('path');

const dbDir = path.join(__dirname, '..', 'src', 'database');
const inert = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : inert), apply: () => undefined });
for (const f of fs.readdirSync(dbDir).filter((x) => x.endsWith('.js'))) {
  const p = path.join(dbDir, f);
  const exports = f === 'store.js' ? new Proxy({ getConfig: () => null }, { get: (t, k) => (k in t ? t[k] : inert) }) : inert;
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const { loadCommands } = require('../src/handlers/commandHandler');
const router = require('../src/ai/router');

const client = {};
loadCommands(client);
const reg = router.buildRegistry(client.commands, client.aliases);

const SENTENCES = [
  "mofu what's my balance", 'mofu show my rank', 'mofu remind me in 10m to drink water', 'mofu give riri 100 coins',
  'mofu ban @x spam', 'mofu kick riri for being rude', 'mofu kya mera balance dikhao', 'mofu mera level batao',
  'mofu clear 50 messages', 'mofu lock this channel', 'mofu set slowmode to 10', 'mofu show riri avatar',
  'mofu flip a coin for 100 on heads', 'mofu play lofi beats', 'mofu skip this song', 'mofu whats playing',
  'mofu define rizz', 'mofu translate hola to english', 'mofu calc 12*7', 'mofu claim my daily',
  'mofu deposit 500', 'mofu who is riri', 'mofu give riri the vip role', 'mofu set riri level to 10',
  'mofu backup the server', 'mofu forget me', 'mofu setup antinuke', 'mofu how are you',
  'mofu good morning', 'mofu what time is it in tokyo', 'mofu rnak', 'mofuuu ban everyone',
];

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
for (const s of SENTENCES) {
  const list = router.shortlist(s, reg);
  const asks = list.length > 0 && list[0].strong;
  const top = list[0]?.entry;
  const tier = !asks ? 'chat' : router.BLOCKED.has(top.name) ? 'typed-only reply' : router.tierOf(top);
  console.log(`${pad(s, 42)} | ${pad(asks ? 'model' : 'no model', 8)} | ${pad(tier, 16)} | ${list.slice(0, 3).map((x) => `${x.entry.key}(${x.total})`).join(', ')}`);
}
