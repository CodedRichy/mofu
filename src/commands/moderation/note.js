const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response } = require('../../utils/embed');
const store = require('../../database/store');
const { clip, joinClipped, modLabel } = require('../../utils/modguard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('note')
    .setDescription('Manage staff notes on a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((s) =>
      s.setName('add')
        .setDescription('Add a note to a user')
        .addUserOption((o) => o.setName('user').setDescription('User to add a note to').setRequired(true))
        .addStringOption((o) => o.setName('content').setDescription('Note content').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('view')
        .setDescription('View notes for a user')
        .addUserOption((o) => o.setName('user').setDescription('User to view notes for').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('remove')
        .setDescription('Remove a note by ID')
        .addIntegerOption((o) => o.setName('id').setDescription('Note ID to remove').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const user = interaction.options.getUser('user');
      const content = interaction.options.getString('content');

      if (content.length > 1000) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Note content is too long (max 1000 characters).', color: colors.error })], ephemeral: true });
      }

      const id = store.addNote(interaction.guild.id, user.id, interaction.user.tag, content);

      await interaction.reply({ embeds: [response({ client: interaction.client, description: `📝 Note added to **${user.tag}** (note #${id})`, color: colors.success })] });
    } else if (sub === 'view') {
      const user = interaction.options.getUser('user');
      const notes = store.getNotes(interaction.guild.id, user.id);

      if (!notes.length) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `No notes for **${user.tag}**`, color: colors.muted })], ephemeral: true });
      }

      const total = notes.length;
      // getNotes is newest-first, so the first ten are the newest ten
      const recent = notes.slice(0, 10);

      const list = joinClipped(recent.map((n) => {
        const ts = Math.floor(new Date(n.timestamp).getTime() / 1000);
        return `\`#${n.id}\` ${clip(n.content, 300)}\n▸ ${modLabel(n.moderator)} • <t:${ts}:R>`;
      }), 4000, '\n\n');

      const embed = base(interaction.client)
        .setAuthor({ name: `Notes — ${user.tag}`, iconURL: user.displayAvatarURL() })
        .setDescription(list)
        .setFooter({ text: total > 10 ? `showing 10 of ${total} notes` : `${total} notes` });

      await interaction.reply({ embeds: [embed] });
    } else if (sub === 'remove') {
      const noteId = interaction.options.getInteger('id');
      const removed = store.removeNote(interaction.guild.id, noteId);

      if (!removed) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Note not found.', color: colors.error })], ephemeral: true });
      }

      await interaction.reply({ embeds: [response({ client: interaction.client, description: `Removed note **#${noteId}**`, color: colors.success })] });
    }
  },
};
