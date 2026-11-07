const { SlashCommandBuilder, PermissionFlagsBits, StickerFormatType } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sticker')
    .setDescription('Manage server stickers')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
    .addSubcommand((s) =>
      s.setName('steal')
        .setDescription('Steal a sticker from a message (reply to a message with a sticker)')
        .addStringOption((o) => o.setName('name').setDescription('Custom name').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('delete')
        .setDescription('Delete a server sticker')
        .addStringOption((o) => o.setName('name').setDescription('Sticker name').setRequired(true))
    )
    .addSubcommand((s) => s.setName('list').setDescription('List server stickers')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'steal') {
      const name = interaction.options.getString('name');
      const ref = interaction.message?.reference;
      const stickers = interaction.message?.stickers;

      if (!stickers?.size && !ref) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Reply to a message with a sticker, or use this command in a message with a sticker.', color: colors.error })], ephemeral: true });
      }

      let stickerUrl, stickerFormat;

      if (stickers?.size) {
        const s = stickers.first();
        stickerUrl = s.url;
        stickerFormat = s.format;
      } else if (ref) {
        try {
          const msg = await interaction.channel.messages.fetch(ref.messageId);
          if (!msg.stickers.size) {
            return interaction.reply({ embeds: [response({ client: interaction.client, description: 'That message has no stickers.', color: colors.error })], ephemeral: true });
          }
          const s = msg.stickers.first();
          stickerUrl = s.url;
          stickerFormat = s.format;
        } catch {
          return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Failed to fetch message.', color: colors.error })], ephemeral: true });
        }
      }

      if (stickerFormat === StickerFormatType.Lottie) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Lottie stickers cannot be stolen.', color: colors.error })], ephemeral: true });
      }

      try {
        await interaction.guild.stickers.create({ file: stickerUrl, name, tags: 'mofu' });
        await interaction.reply({ embeds: [response({ client: interaction.client, description: `Sticker **${name}** added.`, color: colors.success })] });
      } catch {
        await interaction.reply({ embeds: [response({ client: interaction.client, description: 'Failed to add sticker. Server may be at the sticker limit.', color: colors.error })], ephemeral: true });
      }
    }

    if (sub === 'delete') {
      const name = interaction.options.getString('name');
      const sticker = interaction.guild.stickers.cache.find((s) => s.name.toLowerCase() === name.toLowerCase());
      if (!sticker) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `Sticker **${name}** not found.`, color: colors.error })], ephemeral: true });
      }

      try {
        await sticker.delete();
        await interaction.reply({ embeds: [response({ client: interaction.client, description: `Sticker **${name}** deleted.`, color: colors.success })] });
      } catch {
        await interaction.reply({ embeds: [response({ client: interaction.client, description: 'Failed to delete sticker.', color: colors.error })], ephemeral: true });
      }
    }

    if (sub === 'list') {
      const stickers = interaction.guild.stickers.cache;
      if (!stickers.size) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'No stickers in this server.', color: colors.muted })], ephemeral: true });
      }

      const desc = stickers.map((s) => `\`:${s.name}:\``).join(', ');
      await interaction.reply({ embeds: [response({ client: interaction.client, description: `**Server Stickers** (${stickers.size})\n\n${desc}`, color: colors.primary })] });
    }
  },
};
