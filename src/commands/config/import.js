const crypto = require('crypto');
const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response, base } = require('../../utils/embed');
const store = require('../../database/store');
const log = require('../../utils/logger');
const { parseWarningsCsv, MAX_ROWS } = require('../../utils/csvImport');
const levelImport = require('../../utils/levelImport');

const MAX_BYTES = 256 * 1024;
const MAX_LEVEL_BYTES = 1024 * 1024; // 20k rows of "id,xp" is about 600 KB
const CONFIRM_MS = 5 * 60 * 1000;
const PREVIEW_ROWS = 10;
// only fetch from Discord's own CDN: the URL comes from an attachment, never from free text
const CDN_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

const importing = new Set(); // guild ids with a level import prompt open or writing

// Download an attachment from Discord's CDN. Returns { text } or { error } and never throws.
async function downloadAttachment(file, maxBytes) {
  if (!file) return { error: 'Attach a file.' };
  if (file.size > maxBytes) return { error: `That file is too big (max ${maxBytes / 1024} KB).` };
  let host;
  try { host = new URL(file.url).hostname; } catch { return { error: "Couldn't read that attachment." }; }
  if (!CDN_HOSTS.has(host)) return { error: "Couldn't read that attachment." };
  let text;
  try {
    const res = await fetch(file.url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { error: "Couldn't download the file. Try uploading it again." };
    text = await res.text();
  } catch {
    return { error: "Couldn't download the file. Try uploading it again." };
  }
  if (text.length > maxBytes * 2) return { error: 'That file is too big.' };
  return { text };
}

const fmt = (n) => Number(n).toLocaleString('en-US');

function previewText({ plan, parsed, overwrite, xpStore, expiresAt }) {
  const lines = ['**Level import preview.** Nothing has been written yet.', ''];
  lines.push(`File: ${fmt(parsed.records.length)} valid row${parsed.records.length === 1 ? '' : 's'} (${parsed.mode === 'xp' ? 'total XP' : 'levels'})${parsed.errors.length ? `, ${parsed.errors.length}${parsed.errors.length >= 10 ? '+' : ''} skipped` : ''}`);
  lines.push(`Will update: **${fmt(plan.changes.length)}** member${plan.changes.length === 1 ? '' : 's'}${plan.lower ? ` (${fmt(plan.lower)} of them go down)` : ''}`);
  if (plan.unchanged) lines.push(`Already at ${overwrite ? 'that' : 'or above that'} XP here: ${fmt(plan.unchanged)} (left as is)`);
  if (plan.notInServer) lines.push(`No longer in this server: ${fmt(plan.notInServer)} (skipped)`);
  if (plan.bots) lines.push(`Bots: ${fmt(plan.bots)} (skipped)`);
  if (plan.duplicates) lines.push(`Repeated user ids in the file: ${fmt(plan.duplicates)} (highest value kept)`);
  lines.push(`Total XP in the update: ${fmt(plan.totalXp)}`);

  if (plan.changes.length) {
    lines.push('', `**First ${Math.min(PREVIEW_ROWS, plan.changes.length)}**`);
    plan.changes.slice(0, PREVIEW_ROWS).forEach((c, i) => {
      const a = xpStore.levelFromTotal(c.from).level;
      const b = xpStore.levelFromTotal(c.to).level;
      lines.push(`${i + 1}. <@${c.userId}> level ${a} -> ${b} (${fmt(c.from)} -> ${fmt(c.to)} XP)`);
    });
  }

  const l20 = xpStore.totalXpForLevel(20);
  lines.push('', `**How levels are worked out.** mofu stores total XP and computes the level from it (each level needs \`5 * level^2 + 50 * level + 100\` XP). MEE6 is reported to use the same formula, so MEE6 level 20 (${fmt(l20)} total XP) becomes mofu level ${xpStore.levelFromTotal(l20).level}. Other bots use other curves, so their levels can differ here.`);
  if (parsed.mode === 'level') lines.push('This file has levels, not XP: each member gets the XP for the start of that level, so progress inside a level is not carried over.');
  lines.push(overwrite
    ? 'Mode **overwrite**: members get exactly the file\'s value, even if that is lower than what they have now.'
    : 'Mode **keep higher**: nobody\'s XP goes down. Running the same file again changes nothing.');
  lines.push('Level reward roles are not given during the import. Run `/levelrole sync` afterwards.');
  if (parsed.truncated) lines.push(`Only the first ${fmt(levelImport.MAX_ROWS)} rows were read. Split the file to import the rest.`);
  if (parsed.errors.length) lines.push('', `Skipped lines:\n${parsed.errors.slice(0, 5).map((e) => `- ${e}`).join('\n')}`);
  lines.push('', `This prompt expires <t:${Math.floor(expiresAt / 1000)}:R>.`);
  return lines.join('\n').slice(0, 4000);
}

// Audit line in the modlog channel. Not a moderation case, so no case number. Never throws.
async function postAudit(guild, invoker, text) {
  try {
    const channelId = store.getConfig(guild.id, 'modlog_channel');
    const channel = channelId && guild.channels.cache.get(channelId);
    if (!channel) return;
    const embed = base(guild.client, colors.info)
      .setAuthor({ name: 'LEVELS IMPORTED' })
      .setDescription(`**By** ${invoker.tag} \`${invoker.id}\`\n${text}`);
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
  } catch { /* the import already succeeded */ }
}

async function importWarnings(interaction, reply) {
  const { guild } = interaction;
  const dl = await downloadAttachment(interaction.options.getAttachment('file'), MAX_BYTES);
  if (dl.error) return reply(dl.error, colors.error);

  const { rows, errors, truncated } = parseWarningsCsv(dl.text);
  if (!rows.length) return reply(`Nothing to import.\n${errors.join('\n') || ''}`.trim(), colors.error);

  // skip members who are not in the server? No: a banned or departed member's history still matters, so import all.
  const importerId = interaction.user.id;
  let added = 0;
  store.db.transaction(() => {
    for (const r of rows) {
      store.addWarning(guild.id, r.userId, {
        reason: `${r.reason} (imported)`,
        moderator: r.moderatorId || importerId,
        timestamp: r.timestamp,
      });
      added++;
    }
  })();

  log.info(`Imported ${added} warnings into guild ${guild.id} by ${importerId}`);
  const notes = [];
  if (errors.length) notes.push(`Skipped lines:\n${errors.map((e) => `- ${e}`).join('\n')}`);
  if (truncated) notes.push(`Stopped at ${MAX_ROWS} rows. Split the file to import the rest.`);
  return reply(`Imported **${added}** warning${added === 1 ? '' : 's'}. They show up in \`/warn list\` marked "(imported)".${notes.length ? `\n\n${notes.join('\n\n')}` : ''}`, colors.success);
}

// One open level import per server. The lock is held from the start; the button collector takes it over.
async function importLevels(interaction, reply) {
  const gid = interaction.guild.id;
  if (importing.has(gid)) return reply('A level import is already open in this server. Finish or cancel it first.', colors.error);
  importing.add(gid);
  let handedOff = false;
  try {
    return await levelsFlow(interaction, reply, () => { handedOff = true; });
  } finally {
    if (!handedOff) importing.delete(gid);
  }
}

async function levelsFlow(interaction, reply, handOff) {
  const { guild, client } = interaction;
  const xpStore = require('../../database/xp');
  const overwrite = interaction.options.getString('mode') === 'overwrite';

  const dl = await downloadAttachment(interaction.options.getAttachment('file'), MAX_LEVEL_BYTES);
  if (dl.error) return reply(dl.error, colors.error);

  const parsed = levelImport.parseLevelsFile(dl.text);
  if (!parsed.records.length) {
    return reply(`Nothing to import.\n${parsed.errors.map((e) => `- ${e}`).join('\n')}\n\nThe file needs a header line with a user id column and either \`xp\` (total XP) or \`level\`, for example:\n\`\`\`\nuser_id,xp\n123456789012345678,4200\n\`\`\``, colors.error);
  }

  let members;
  try {
    members = await require('../../utils/members').fetchAllMembers(guild);
  } catch {
    return reply("Couldn't load this server's member list, so I can't tell who is still here. Nothing was written. Try again in a minute.", colors.error);
  }

  const plan = levelImport.planImport(parsed.records, {
    isMember: (id) => members.has(id),
    isBot: (id) => !!members.get(id)?.user?.bot,
    currentTotal: (id) => xpStore.getStats(guild.id, id).totalXp,
    totalXpForLevel: xpStore.totalXpForLevel,
    maxXp: xpStore.MAX_XP,
    overwrite,
  });

  const expiresAt = Date.now() + CONFIRM_MS;
  const text = previewText({ plan, parsed, overwrite, xpStore, expiresAt });
  if (!plan.changes.length) {
    return reply(`${text.replace(/\n\nThis prompt expires.*$/s, '')}\n\nNothing to change, so there is nothing to confirm.`, colors.muted);
  }

  const nonce = crypto.randomBytes(6).toString('hex');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`importlevels:yes:${nonce}`).setLabel(`Import ${plan.changes.length}`).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`importlevels:no:${nonce}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  const msg = await interaction.editReply({
    embeds: [response({ client, description: text, color: colors.warning })],
    components: [row],
    allowedMentions: { parse: [] },
  });
  if (!msg?.createMessageComponentCollector) return undefined;

  let done = false;
  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (i) => i.user.id === interaction.user.id && i.customId.endsWith(`:${nonce}`),
    time: CONFIRM_MS,
    max: 1,
  });
  handOff();
  const finish = (i, description, color) =>
    i.update({ embeds: [response({ client, description, color })], components: [], allowedMentions: { parse: [] } }).catch(() => {});

  collector.on('collect', async (i) => {
    done = true;
    try {
      if (i.customId.startsWith('importlevels:no:')) return await finish(i, 'Cancelled. Nothing was written.', colors.muted);
      // Permissions can change in five minutes: check again at the press.
      if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return await finish(i, 'You no longer have **Manage Server**. Nothing was written.', colors.error);
      }
      let result;
      try {
        result = xpStore.importTotals(guild.id, plan.changes.map((c) => ({ userId: c.userId, totalXp: c.incoming })), { overwrite });
      } catch (err) {
        log.error('level import failed', err);
        return await finish(i, 'Something went wrong. Nothing was written (the import is all or nothing). Try again later.', colors.error);
      }
      log.info(`Level import in guild ${guild.id}: ${result.written} written, ${result.unchanged} unchanged, ${result.lowered} lowered`);
      const summary = `${result.written} member${result.written === 1 ? '' : 's'} updated, ${result.unchanged} unchanged${result.lowered ? `, ${result.lowered} lowered` : ''} (mode: ${overwrite ? 'overwrite' : 'keep higher'}).`;
      await finish(i, `Done. ${summary}\n\nLevel reward roles were not given. Run \`/levelrole sync\` to give them now.`, colors.success);
      await postAudit(guild, interaction.user, `From an uploaded file: ${summary}`);
    } finally {
      importing.delete(guild.id);
    }
  });

  collector.on('end', () => {
    if (done) return;
    importing.delete(guild.id);
    interaction.editReply({ embeds: [response({ client, description: 'Expired. Nothing was written.', color: colors.muted })], components: [] }).catch(() => {});
  });
  return msg;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('import')
    .setDescription('Bring data over from another bot')
    .addSubcommand((sub) =>
      sub.setName('warnings').setDescription('Import warnings from a CSV file (user_id, reason, moderator, date)')
        .addAttachmentOption((o) => o.setName('file').setDescription(`CSV, up to ${MAX_ROWS} rows. Header like: user_id,reason,moderator,date`).setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('levels').setDescription('Import XP or levels from a CSV or JSON file (preview first, then confirm)')
        .addAttachmentOption((o) => o.setName('file').setDescription('Header user_id,xp (total XP) or user_id,level. Up to 20000 rows.').setRequired(true))
        .addStringOption((o) => o.setName('mode').setDescription('keep higher (default): nobody goes down. overwrite: use the file exactly')
          .addChoices({ name: 'keep higher', value: 'keep' }, { name: 'overwrite', value: 'overwrite' }))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  downloadAttachment,
  previewText,
  _importing: importing,

  async execute(interaction) {
    const reply = (description, color) =>
      interaction.editReply({ embeds: [response({ client: interaction.client, description, color })], components: [], allowedMentions: { parse: [] } });
    await interaction.deferReply({ ephemeral: true });
    if (!interaction.guild) return reply('Run this in a server.', colors.error);

    // re-check in code: Discord's per-command override must not be the only gate on bulk writes
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return reply('You need **Manage Server** to import data.', colors.error);

    const sub = interaction.options.getSubcommand?.() || 'warnings';
    if (sub === 'levels') return importLevels(interaction, reply);
    return importWarnings(interaction, reply);
  },
};
