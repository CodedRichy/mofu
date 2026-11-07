const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const { cmdRef } = require('../../utils/invocation');
const store = require('../../database/store');

const backup = require('../../utils/backup');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Backup or restore server configuration')
    .addSubcommand((sub) => sub.setName('export').setDescription('Export current config as a JSON file'))
    .addSubcommand((sub) =>
      sub
        .setName('import')
        .setDescription('Import config from a JSON file attachment')
        .addAttachmentOption((o) => o.setName('file').setDescription('JSON backup file').setRequired(true)),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;

    if (sub === 'export') {
      const data = backup.buildExport(guild, { store });
      const keyCount = Object.keys(data.config).length;
      const file = new AttachmentBuilder(Buffer.from(JSON.stringify(data, null, 2)), {
        name: `mofu-backup-${guild.id}.json`,
      });

      return interaction.reply({
        embeds: [
          response({
            client: interaction.client,
            description: `Config exported: **${keyCount}** settings, **${data.panels.length}** role panels and **${data.tags.length}** tags saved to the file. Import restores settings and tags; role panels are saved for reference and have to be rebuilt by hand. Mod cases, levels and economy are not in this file.`,
            color: colors.success,
          }),
        ],
        files: [file],
      });
    }

    if (sub === 'import') {
      const attachment = interaction.options.getAttachment('file');

      if (!attachment.name.endsWith('.json')) {
        return interaction.reply({
          embeds: [response({ client: interaction.client, description: `Upload a \`.json\` file exported from ${cmdRef(interaction.guild.id, 'backup export')}.`, color: colors.error })],
          ephemeral: true,
        });
      }

      if (attachment.size > 100_000) {
        return interaction.reply({
          embeds: [response({ client: interaction.client, description: `Backup file too large (max 100KB). Re-export with ${cmdRef(interaction.guild.id, 'backup export')}.`, color: colors.error })],
          ephemeral: true,
        });
      }

      let data;
      try {
        const res = await fetch(attachment.url);
        data = await res.json();
      } catch {
        return interaction.reply({
          embeds: [response({ client: interaction.client, description: "Couldn't read file — make sure it's a valid JSON backup from mofu.", color: colors.error })],
          ephemeral: true,
        });
      }

      if (!backup.validateExport(data).ok) {
        return interaction.reply({
          embeds: [response({ client: interaction.client, description: `This doesn't look like a mofu backup. Use ${cmdRef(interaction.guild.id, 'backup export')} to create one.`, color: colors.error })],
          ephemeral: true,
        });
      }

      const { applied: appliedCount, skippedKeys, tagsAdded, tagsSkipped, panelsInFile } = backup.applyImport(guild.id, data, { store });

      let desc = `Config restored. **${appliedCount}** settings imported.`;
      if (tagsAdded || tagsSkipped) desc += ` **${tagsAdded}** tags added${tagsSkipped ? `, ${tagsSkipped} skipped (already exist or invalid)` : ''}.`;
      if (panelsInFile) desc += `\n\nThe file lists **${panelsInFile}** role panels. They are not restored automatically; recreate them with the panel commands.`;
      if (skippedKeys.length) {
        desc += `\n\n⚠️ **${skippedKeys.length}** unknown keys skipped: ${skippedKeys.map((k) => `\`${k}\``).join(', ')}`;
      }

      return interaction.reply({
        embeds: [
          response({
            client: interaction.client,
            description: desc,
            color: colors.success,
          }),
        ],
      });
    }
  },
};
