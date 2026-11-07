// Renders the bot's REAL embed builders (with stub data) into tools/embed-preview.html, styled like Discord.
// Usage: node tools/embed-preview.js   then open tools/embed-preview.html in a browser.
// Add a scene by pushing to `scenes`: { title, note, messages: [{ embeds, components }] }. Builders run live, so
// the page always reflects the code on disk.
const fs = require('fs');
const path = require('path');

const client = { user: { displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png', tag: 'sonder#5242' } };
const guild = { name: 'DeadWax', id: '1', client };
const user = (name) => ({ username: name, tag: `${name}#0001`, id: '9', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' });

function fakeQueue({ paused = false, tracks = 3, repeatMode = 0, volume = 80 } = {}) {
  const mk = (i) => ({
    title: i === 0 ? 'Let Me Love You' : `Queued track number ${i}`,
    url: 'https://youtube.com/watch?v=x',
    author: i === 0 ? 'DJ Snake ft. Justin Bieber' : 'Some Artist',
    thumbnail: '',
    durationMS: 205000 + i * 13000,
    duration: `${3 + (i % 2)}:${String(25 + i).padStart(2, '0')}`,
    requestedBy: user('riri'),
  });
  const list = Array.from({ length: tracks }, (_, i) => mk(i + 1));
  return {
    guild, repeatMode, currentTrack: mk(0),
    tracks: { size: list.length, toArray: () => list },
    node: { isPaused: () => paused, volume, getTimestamp: () => ({ current: { value: 71000 }, total: { value: 205000 } }) },
  };
}

const json = (m) => ({
  embeds: (m.embeds || []).map((e) => (e.toJSON ? e.toJSON() : e)),
  components: (m.components || []).map((r) => (r.toJSON ? r.toJSON() : r)),
});

const scenes = [];
function scene(title, note, build) {
  try { scenes.push({ title, note, messages: [json(build())] }); }
  catch (err) { scenes.push({ title, note: `FAILED to build: ${err.message}`, messages: [] }); }
}

const card = require('../src/music/card');
scene('Now playing (playing)', 'src/music/card.js', () => card.buildCard(client, fakeQueue(), 1));
scene('Now playing (paused)', 'record stopped, no animation', () => card.buildCard(client, fakeQueue({ paused: true, repeatMode: 1 }), 0));

const queueCmd = require('../src/commands/music/queue');
scene('Queue, 25 tracks, page 1', 'src/commands/music/queue.js', () => queueCmd.buildPage(client, guild, fakeQueue({ tracks: 25 }), 0));
scene('Queue, short', 'one page: no buttons', () => queueCmd.buildPage(client, guild, fakeQueue({ tracks: 3 }), 0));

// extra scenes from other modules can be dropped in tools/preview-scenes/*.js exporting (scene, helpers) => void
const extra = path.join(__dirname, 'preview-scenes');
if (fs.existsSync(extra)) {
  for (const f of fs.readdirSync(extra).filter((n) => n.endsWith('.js')).sort()) {
    try { require(path.join(extra, f))(scene, { client, guild, user, fakeQueue }); }
    catch (err) { scenes.push({ title: f, note: `scene file failed: ${err.message}`, messages: [] }); }
  }
}

const html = fs.readFileSync(path.join(__dirname, 'embed-preview.template.html'), 'utf-8')
  .replace('/*SCENES*/[]', () => JSON.stringify(scenes).replace(/</g, '\\u003c'));
fs.writeFileSync(path.join(__dirname, 'embed-preview.html'), html, 'utf-8');
console.log(`WROTE tools/embed-preview.html (${scenes.length} scenes, ${scenes.filter((s) => !s.messages.length).length} failed)`);
