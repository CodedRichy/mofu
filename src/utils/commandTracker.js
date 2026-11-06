const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const LOG_PATH = path.join(__dirname, '../../logs/commands.jsonl');

fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });

function track(name, { userId, guildId, type, feedback, error }) {
  const entry = {
    command: name,
    type,
    userId,
    guildId,
    feedback,
    error: error || null,
    timestamp: new Date().toISOString(),
  };
  // Async append: this runs on every command/feedback click, so keep disk I/O
  // off the event loop. Telemetry failures must never surface to users.
  fs.appendFile(LOG_PATH, JSON.stringify(entry) + '\n', () => {});
}

async function promptFeedback(source, commandName, type) {
  const uid = `cmdtrack:${commandName}:${Date.now()}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${uid}:yes`).setLabel('Worked').setEmoji('👍').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${uid}:no`).setLabel('Broken').setEmoji('👎').setStyle(ButtonStyle.Danger),
  );

  let msg;
  try {
    if (source.replied || source.deferred) {
      msg = await source.followUp({ content: 'Did that work?', components: [row], ephemeral: true });
    } else {
      msg = await source.reply({ content: 'Did that work?', components: [row], ephemeral: true });
    }
  } catch {
    return;
  }

  const userId = source.user?.id || source.author?.id || source.message?.author?.id;
  const guildId = source.guildId || source.guild?.id || source.message?.guildId;

  try {
    const i = await msg.awaitMessageComponent({ filter: b => b.user.id === userId, time: 15_000 });
    const worked = i.customId.endsWith(':yes');
    track(commandName, { userId, guildId, type, feedback: worked ? 'worked' : 'broken' });
    await i.update({ content: worked ? '👍 Noted.' : '👎 Logged as broken.', components: [] });
  } catch {
    track(commandName, { userId, guildId, type, feedback: 'no-response' });
    try { await msg.edit({ content: '*(timed out)*', components: [] }); } catch {}
  }
}

function getStats() {
  if (!fs.existsSync(LOG_PATH)) return { total: 0, commands: {} };
  const lines = fs.readFileSync(LOG_PATH, 'utf-8').trim().split('\n').filter(Boolean);
  const stats = { total: lines.length, worked: 0, broken: 0, noResponse: 0, errored: 0, commands: {} };
  for (const line of lines) {
    const e = JSON.parse(line);
    if (e.feedback === 'worked') stats.worked++;
    else if (e.feedback === 'broken') stats.broken++;
    else if (e.feedback === 'no-response') stats.noResponse++;
    else if (e.feedback === 'errored') stats.errored++;
    if (!stats.commands[e.command]) stats.commands[e.command] = { worked: 0, broken: 0, noResponse: 0, errored: 0 };
    const cmd = stats.commands[e.command];
    if (e.feedback === 'worked') cmd.worked++;
    else if (e.feedback === 'broken') cmd.broken++;
    else if (e.feedback === 'no-response') cmd.noResponse++;
    else if (e.feedback === 'errored') cmd.errored++;
  }
  return stats;
}

module.exports = { track, promptFeedback, getStats };
