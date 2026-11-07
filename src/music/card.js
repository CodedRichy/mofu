const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { QueueRepeatMode, useQueue } = require('discord-player');
const { base, response } = require('../utils/embed');
const { colors } = require('../utils/constants');
const log = require('../utils/logger');

// One live "record player" card per guild. It is edited every TICK_MS while a track plays and not at all while
// paused (a stopped record is not animated), which also keeps us far inside Discord's edit rate limits.
const TICK_MS = 6000;
const MAX_TICK_MS = 60000;
const EDIT_BUDGET_PER_SEC = 15; // all live cards combined
const BAR = 18;
const DISC = ['◐', '◓', '◑', '◒']; // half-filled circles: reads as a turning disc
const LOOP_LABEL = { [QueueRepeatMode.OFF]: 'off', [QueueRepeatMode.TRACK]: 'track', [QueueRepeatMode.QUEUE]: 'queue', [QueueRepeatMode.AUTOPLAY]: 'autoplay' };

const live = new Map(); // guildId -> { message, timer, frame, busy, trackId }
const startSeq = new Map(); // guildId -> latest start() call number

const fmtMs = (ms) => {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};

function bar(current, total) {
  if (!total) return '▬'.repeat(BAR);
  const pos = Math.min(BAR - 1, Math.floor((current / total) * BAR));
  return '▬'.repeat(pos) + '🔘' + '▬'.repeat(BAR - 1 - pos);
}

function buildCard(client, queue, frame = 0) {
  const track = queue.currentTrack;
  const paused = queue.node.isPaused();
  const ts = queue.node.getTimestamp();
  const cur = ts?.current?.value ?? 0;
  const tot = ts?.total?.value ?? track?.durationMS ?? 0;
  const next = queue.tracks.toArray()[0];
  const loop = LOOP_LABEL[queue.repeatMode] || 'off';

  const header = paused ? 'RECORD STOPPED  ||' : `NOW SPINNING  ${DISC[frame % DISC.length]}`;
  const lines = [
    `**[${track.title}](${track.url})**`,
    track.author,
    '',
    paused ? 'Needle lifted.' : '',
    `\`${fmtMs(cur)}\` ${bar(cur, tot)} \`${fmtMs(tot)}\``,
  ].filter((l, i) => !(l === '' && i === 3));

  const embed = base(client, paused ? colors.muted : colors.primary)
    .setAuthor({ name: header })
    .setDescription(lines.join('\n'))
    .addFields(
      { name: 'Loop', value: `\`${loop}\``, inline: true },
      { name: 'Up next', value: next ? `${next.title}`.slice(0, 60) + (queue.tracks.size > 1 ? ` (+${queue.tracks.size - 1})` : '') : 'nothing queued', inline: true },
    );
  if (track.thumbnail) embed.setThumbnail(track.thumbnail);
  if (track.requestedBy) embed.setFooter({ text: `requested by ${track.requestedBy.globalName || track.requestedBy.username} - sonder`, iconURL: client.user.displayAvatarURL() });

  const btn = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`mp:${id}`).setLabel(label).setStyle(style);
  const row1 = new ActionRowBuilder().addComponents(
    btn('pause', paused ? 'Resume' : 'Pause', paused ? ButtonStyle.Success : ButtonStyle.Secondary),
    btn('skip', 'Skip'),
    btn('loop', `Loop: ${loop}`),
    btn('shuffle', 'Shuffle'),
    btn('stop', 'Stop', ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [row1] };
}

function finalEmbed(client, text) {
  return { embeds: [response({ client, description: text, color: colors.muted })], components: [] };
}

function clear(guildId, finalText, client) {
  const st = live.get(guildId);
  if (!st) return;
  clearInterval(st.timer);
  live.delete(guildId);
  if (finalText) st.message.edit(finalEmbed(client || st.message.client, finalText)).catch(() => {});
}

// A new track began: retire the old card (if any) and post a fresh one at the bottom of the channel.
async function start(queue) {
  const guildId = queue.guild.id;
  const channel = queue.metadata?.channel;
  if (!channel?.send || !queue.currentTrack) return;
  const client = queue.guild.client;

  const old = live.get(guildId);
  if (old) { clearInterval(old.timer); old.message.delete().catch(() => {}); live.delete(guildId); }

  // Rapid skips fire several playerStart events before the first send resolves. Only the newest start may own the
  // card: any older one removes the message it just posted instead of leaving an orphan with live buttons.
  const mySeq = (startSeq.get(guildId) || 0) + 1;
  startSeq.set(guildId, mySeq);

  let message;
  try { message = await channel.send(buildCard(client, queue, 0)); } catch (err) { log.warn(`now-playing card failed: ${err.message}`); return; }
  if (startSeq.get(guildId) !== mySeq) { message.delete().catch(() => {}); return; }

  const st = { message, frame: 0, busy: false, timer: null };
  const tick = async () => {
    if (live.get(guildId) !== st) return; // replaced or cleared: never touch another card's state
    const q = useQueue(guildId);
    if (!q?.currentTrack) return clear(guildId, 'Record stopped.', client);
    if (!q.node.isPaused() && !st.busy) {
      st.busy = true;
      st.frame += 1;
      try { await st.message.edit(buildCard(client, q, st.frame)); }
      catch (err) { clear(guildId); log.warn(`now-playing edit stopped: ${err.message}`); return; }
      finally { st.busy = false; }
    }
    schedule();
  };
  // Self-pacing: every card shares one global edit budget, so the more servers are playing the slower each card
  // ticks. This keeps the bot far under Discord's 50 req/s global limit, with jitter so edits do not arrive in bursts.
  const schedule = () => {
    if (live.get(guildId) !== st) return; // this card was replaced or cleared mid-tick: do not leave an orphan timer
    const delay = Math.min(MAX_TICK_MS, Math.max(TICK_MS, (live.size / EDIT_BUDGET_PER_SEC) * 1000));
    st.timer = setTimeout(tick, delay * (0.85 + Math.random() * 0.3));
    st.timer.unref?.();
  };
  live.set(guildId, st);
  schedule();
}

function refresh(queue) {
  const st = live.get(queue.guild.id);
  if (st && queue.currentTrack) st.message.edit(buildCard(queue.guild.client, queue, st.frame)).catch(() => {});
}

async function handleButton(interaction) {
  const action = interaction.customId.slice(3);
  const queue = useQueue(interaction.guild.id);
  const deny = (text) => interaction.reply({ embeds: [response({ client: interaction.client, description: text, color: colors.error })], ephemeral: true });

  if (!queue?.currentTrack) {
    clear(interaction.guild.id, 'Record stopped.', interaction.client);
    return deny('Nothing is playing.');
  }
  const vc = interaction.member?.voice?.channel;
  if (!vc || vc.id !== interaction.guild.members.me.voice.channelId) return deny('Join my voice channel to use these buttons.');

  switch (action) {
    case 'pause': queue.node.setPaused(!queue.node.isPaused()); break;
    case 'skip': queue.node.skip(); break; // playerStart posts the next card
    case 'loop': {
      const order = [QueueRepeatMode.OFF, QueueRepeatMode.TRACK, QueueRepeatMode.QUEUE];
      queue.setRepeatMode(order[(order.indexOf(queue.repeatMode) + 1) % order.length]);
      break;
    }
    case 'shuffle': queue.tracks.shuffle(); break;
    case 'stop':
      queue.delete();
      clear(interaction.guild.id);
      return interaction.update(finalEmbed(interaction.client, 'Record stopped.'));
    default: return;
  }

  if (action === 'skip') return interaction.deferUpdate().catch(() => {});
  await interaction.update(buildCard(interaction.client, queue, live.get(interaction.guild.id)?.frame || 0)).catch(() => {});
}

module.exports = { start, clear, refresh, handleButton, buildCard, _fmtMs: fmtMs, _bar: bar };
