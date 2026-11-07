// Blind side-by-side model comparison. Run manually, never from tests (it spends real API credit).
//   node tools/model-eval.js [prompts.json] [--limit N]
// Writes logs/model-eval-<n>.md (outputs shuffled, labelled A/B/C per prompt) and
// logs/model-eval-<n>-key.md (which label was which model, plus latency). Keys are read from the environment
// and never printed or written.
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

const config = require('../src/config');
const { BOT_SYSTEM, MODEL, CHAT_MODEL } = require('../src/utils/ai');
const gemini = require('../src/utils/gemini');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

async function groq(model, messages) {
  const apiKey = config.groq?.apiKey;
  if (!apiKey) return null;
  const body = {
    model, messages, temperature: 0.8,
    ...(model.startsWith('openai/')
      ? { max_tokens: 512, reasoning_effort: 'low', include_reasoning: false }
      : { max_tokens: 512 }),
  };
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return { error: `http ${res.status}` };
    const data = await res.json();
    return { text: data.choices?.[0]?.message?.content || '' };
  } catch (e) { return { error: e.name || 'error' }; }
}

const MODELS = [
  { id: `groq ${CHAT_MODEL}`, run: (m) => groq(CHAT_MODEL, m), ok: () => !!config.groq?.apiKey },
  { id: `groq ${MODEL}`, run: (m) => groq(MODEL, m), ok: () => !!config.groq?.apiKey },
  {
    id: `gemini ${config.gemini?.model}`,
    run: async (m) => {
      const t = await gemini.request(m, { maxTokens: 512, temperature: 0.8 });
      return t ? { text: t } : { error: 'no answer' };
    },
    ok: () => gemini.available(),
  },
];

function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

function nextN(dir) {
  let n = 1;
  while (fs.existsSync(path.join(dir, `model-eval-${n}.md`))) n++;
  return n;
}

async function main() {
  const args = process.argv.slice(2);
  const li = args.indexOf('--limit');
  const limit = li >= 0 ? parseInt(args[li + 1], 10) : Infinity;
  const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--limit')
    || path.join(__dirname, 'model-eval-prompts.json');
  const prompts = JSON.parse(fs.readFileSync(file, 'utf8')).slice(0, limit);
  const models = MODELS.filter((m) => m.ok());
  if (models.length < 1) { console.error('no provider keys configured'); process.exit(1); }

  const sys = [
    { role: 'system', content: BOT_SYSTEM },
    { role: 'system', content: `right now:\nUTC time: ${new Date().toUTCString()}\nserver prefix: ;` },
  ];
  const stats = Object.fromEntries(models.map((m) => [m.id, { n: 0, fail: 0, ms: [] }]));
  const sections = [];
  const key = [];

  for (let i = 0; i < prompts.length; i++) {
    const messages = [...sys, { role: 'user', content: prompts[i] }];
    const results = await Promise.all(models.map(async (m) => {
      const t0 = Date.now();
      const r = (await m.run(messages)) || { error: 'null' };
      const ms = Date.now() - t0;
      const s = stats[m.id];
      s.n++; s.ms.push(ms);
      if (!r.text) s.fail++;
      return { id: m.id, ms, text: r.text || `(no answer: ${r.error || 'empty'})` };
    }));
    const order = shuffle(results);
    const labels = order.map((_, k) => String.fromCharCode(65 + k));
    sections.push(`## ${i + 1}. ${prompts[i]}\n\n` + order.map((r, k) =>
      `**${labels[k]}**\n\n${r.text.split('\n').map((l) => `> ${l}`).join('\n')}\n`).join('\n'));
    key.push(`${i + 1}. ` + order.map((r, k) => `${labels[k]}=${r.id} (${r.ms}ms)`).join(', '));
    process.stdout.write(`done ${i + 1}/${prompts.length}\n`);
  }

  const dir = path.join(__dirname, '..', 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const n = nextN(dir);
  fs.writeFileSync(path.join(dir, `model-eval-${n}.md`),
    `# model eval ${n} (blind)\n\n${prompts.length} prompts, outputs shuffled per prompt. Key is in model-eval-${n}-key.md; do not open it until you have scored.\n\n${sections.join('\n')}`, 'utf8');
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const summary = Object.entries(stats).map(([id, s]) =>
    `- ${id}: median ${med(s.ms)}ms, max ${Math.max(0, ...s.ms)}ms, failures ${s.fail}/${s.n}`).join('\n');
  fs.writeFileSync(path.join(dir, `model-eval-${n}-key.md`),
    `# model eval ${n} answer key\n\n## latency\n\n${summary}\n\n## labels\n\n${key.join('\n')}\n`, 'utf8');
  console.log(`wrote logs/model-eval-${n}.md and logs/model-eval-${n}-key.md`);
  console.log(summary);
}

main().catch((e) => { console.error('model-eval failed:', e.message); process.exit(1); });
