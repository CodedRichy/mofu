// Helpers for commands that touch many channels at once (jail/hardmute/imute/rmute role setup).
// - ack early: defer before slow work so a slash interaction never misses Discord's 3 second window
// - small concurrency with a short pause per worker; discord.js queues per route and handles 429s, this just
//   avoids firing hundreds of requests in one burst
// - progress edits at most every few seconds, and a failures list the caller must show (never silently partial)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reply or edit, whichever is valid now. Once deferred, ephemeral can no longer change, so it is dropped.
async function send(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    const { ephemeral, ...rest } = payload; // eslint-disable-line no-unused-vars
    return interaction.editReply({ content: null, ...rest });
  }
  return interaction.reply(payload);
}

async function ensureDeferred(interaction) {
  if (interaction.deferred || interaction.replied) return;
  await interaction.deferReply();
}

// Run worker(item) over items with `concurrency` workers. Never throws; collects failures.
// onProgress(done, total) is called at most every progressMs (and not at all for fast runs).
async function runBulk(items, worker, { concurrency = 4, delayMs = 150, progressMs = 3000, onProgress = null, now = () => Date.now() } = {}) {
  const list = [...items];
  const failed = [];
  let next = 0;
  let done = 0;
  let lastProgress = now();
  async function lane() {
    while (next < list.length) {
      const item = list[next++];
      try { await worker(item); } catch (err) { failed.push({ item, error: err?.message || String(err) }); }
      done++;
      if (onProgress && now() - lastProgress >= progressMs && done < list.length) {
        lastProgress = now();
        try { await onProgress(done, list.length); } catch { /* progress is cosmetic */ }
      }
      if (delayMs && next < list.length) await sleep(delayMs);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, lane));
  return { total: list.length, ok: list.length - failed.length, failed };
}

// "Couldn't update 3 channels: #a, #b, #c" capped to maxChars (embed field/description safe).
function failureText(names, { what = 'channel', maxChars = 900 } = {}) {
  if (!names.length) return '';
  const head = `Couldn't update ${names.length} ${what}${names.length === 1 ? '' : 's'} (check my permissions there): `;
  let out = head;
  let shown = 0;
  for (const n of names) {
    const piece = (shown ? ', ' : '') + n;
    if (out.length + piece.length > maxChars - 20) break;
    out += piece;
    shown++;
  }
  if (shown < names.length) out += ` and ${names.length - shown} more`;
  return out;
}

// Channels that can carry overwrites (threads cannot) and do not yet have one for this role.
// Re-running a command after a partial failure therefore retries only the channels that were missed.
function channelsMissingOverwrite(guild, role, filter = () => true) {
  return [...guild.channels.cache.values()].filter((ch) => ch.permissionOverwrites
    && !ch.isThread?.()
    && filter(ch)
    && !ch.permissionOverwrites.cache.has(role.id));
}

// Apply `perms` for `role` on every channel still missing it. Defers first if there is real work, reports
// progress through the deferred reply, and returns { total, failedNames }.
async function applyRoleOverwrites(interaction, role, perms, { filter, label = role.name, reason } = {}) {
  const pending = channelsMissingOverwrite(interaction.guild, role, filter);
  if (!pending.length) return { total: 0, failedNames: [] };
  await ensureDeferred(interaction);
  const result = await runBulk(pending, (ch) => ch.permissionOverwrites.edit(role, perms, reason ? { reason } : undefined), {
    onProgress: (done, total) => interaction.editReply({ content: `Setting up the **${label}** role: ${done}/${total} channels...`, embeds: [] }),
  });
  return { total: result.total, failedNames: result.failed.map((f) => `#${String(f.item.name).slice(0, 40)}`) };
}

module.exports = { send, ensureDeferred, runBulk, failureText, channelsMissingOverwrite, applyRoleOverwrites };
