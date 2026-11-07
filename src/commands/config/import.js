const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const store = require('../../database/store');
const log = require('../../utils/logger');
const { parseWarningsCsv, MAX_ROWS } = require('../../utils/csvImport');

const MAX_BYTES = 256 * 1024;
// only fetch from Discord's own CDN: the URL comes from an attachment, never from free text
const CDN_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('import')
    .setDescription('Bring data over from another bot')
    .addSubcommand((sub) =>
      sub.setName('warnings').setDescription('Import warnings from a CSV file (user_id, reason, moderator, date)')
        .addAttachmentOption((o) => o.setName('file').setDescription(`CSV, up to ${MAX_ROWS} rows. Header like: user_id,reason,moderator,date`).setRequired(true))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const { guild } = interaction;
    const reply = (description, color, ephemeral = true) =>
      interaction.editReply({ embeds: [response({ client: interaction.client, description, color })], allowedMentions: { parse: [] } });
    await interaction.deferReply({ ephemeral: true });

    // re-check in code: Discord's per-command override must not be the only gate on bulk writes
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return reply('You need **Manage Server** to import data.', colors.error);

    const file = interaction.options.getAttachment('file');
    if (!file) return reply('Attach a CSV file.', colors.error);
    if (file.size > MAX_BYTES) return reply(`That file is too big (max ${MAX_BYTES / 1024} KB).`, colors.error);

    let host;
    try { host = new URL(file.url).hostname; } catch { return reply("Couldn't read that attachment.", colors.error); }
    if (!CDN_HOSTS.has(host)) return reply("Couldn't read that attachment.", colors.error);

    let text;
    try {
      const res = await fetch(file.url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return reply("Couldn't download the file. Try uploading it again.", colors.error);
      text = await res.text();
    } catch {
      return reply("Couldn't download the file. Try uploading it again.", colors.error);
    }
    if (text.length > MAX_BYTES * 2) return reply('That file is too big.', colors.error);

    const { rows, errors, truncated } = parseWarningsCsv(text);
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
  },
};
