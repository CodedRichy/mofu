const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { base } = require('./embed');
const { colors } = require('./constants');
const log = require('./logger');

// Posts "what changed" to the owner's update channel (UPDATE_CHANNEL_ID) once per new version.
// A plain restart with no new commits stays silent. Only ever posts to the one configured channel.
const STATE = path.join(__dirname, '../../data/last-announced.txt');
const ROOT = path.join(__dirname, '../..');

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
}

function readLast() {
  try { return fs.readFileSync(STATE, 'utf-8').trim(); } catch { return ''; }
}

function describe(last) {
  let head;
  try { head = git('rev-parse', '--short', 'HEAD'); } catch { return null; } // no git (e.g. container): nothing to say
  if (head === last) return null;
  let lines = [];
  try {
    const range = last ? `${last}..HEAD` : '-8';
    lines = git('log', ...(last ? [range] : ['-8']), '--pretty=format:%s').split('\n').filter(Boolean);
  } catch { /* last sha unknown after a rebase: fall back to the latest few */
    try { lines = git('log', '-5', '--pretty=format:%s').split('\n').filter(Boolean); } catch { /* none */ }
  }
  let dirty = false;
  try { dirty = git('status', '--porcelain', '--untracked-files=no').length > 0; } catch { /* ignore */ }
  return { head, lines: lines.slice(0, 12), dirty };
}

async function announceUpdate(client) {
  const id = process.env.UPDATE_CHANNEL_ID;
  if (!id) return;
  try {
    const info = describe(readLast());
    if (!info) return;
    const channel = await client.channels.fetch(id).catch(() => null);
    if (!channel?.isTextBased?.() || !channel.send) { log.warn('UPDATE_CHANNEL_ID is set but that channel is not reachable'); return; }

    const pkg = require('../../package.json');
    const list = info.lines.length ? info.lines.map((l) => `- ${l.slice(0, 180)}`).join('\n') : 'Maintenance restart.';
    const embed = base(client, colors.primary)
      .setAuthor({ name: `Sonder updated - v${pkg.version} (${info.head}${info.dirty ? '+local' : ''})` })
      .setDescription(list.slice(0, 4000))
      .setTimestamp();
    await channel.send({ embeds: [embed] });

    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    fs.writeFileSync(STATE, info.head, 'utf-8');
  } catch (err) {
    log.warn(`update announcement failed: ${err.message}`);
  }
}

module.exports = { announceUpdate, _describe: describe };
