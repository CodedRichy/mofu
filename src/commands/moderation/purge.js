const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const { sendChannelLog } = require('../../utils/modguard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk delete messages')
    .addIntegerOption((o) =>
      o.setName('amount').setDescription('Number of messages to delete (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)
    )
    .addUserOption((o) => o.setName('user').setDescription('Only delete messages from this user'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const amount = interaction.options.getInteger('amount');
    const targetUser = interaction.options.getUser('user');
    // Prefix path only: the message that invoked the command (slash interactions have no `message`).
    const commandMessage = interaction.message || null;

    // Fetch BEFORE deferring: on the prefix path deferReply posts a placeholder message that must not be purged.
    // One extra is fetched so the command message can be excluded without coming up short.
    let fetched;
    try {
      fetched = await interaction.channel.messages.fetch({ limit: targetUser ? 100 : Math.min(100, amount + (commandMessage ? 1 : 0)) });
    } catch {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: "Couldn't read this channel's messages. Check my permissions.", color: colors.error })], ephemeral: true });
    }

    let messages = [...fetched.values()].filter((m) => !commandMessage || m.id !== commandMessage.id);
    if (targetUser) messages = messages.filter((m) => m.author.id === targetUser.id);
    messages = messages.slice(0, amount);

    await interaction.deferReply({ ephemeral: true });

    let deleted;
    try {
      deleted = await interaction.channel.bulkDelete(messages, true);
    } catch {
      return interaction.editReply({ embeds: [response({ client: interaction.client, description: "Couldn't delete those messages. Check my permissions.", color: colors.error })] }).catch(() => {});
    }

    // Tidy up the command message itself (prefix path); it is not part of the count.
    if (commandMessage?.deletable) commandMessage.delete().catch(() => {});

    const desc = targetUser
      ? `Deleted **${deleted.size}** message(s) from **${targetUser.tag}**`
      : `Deleted **${deleted.size}** message(s)`;

    // Log first: a failed reply (message gone, interaction expired) must not skip the audit trail.
    await sendChannelLog(interaction.guild, {
      action: 'purge',
      channel: interaction.channel,
      moderator: interaction.user,
      reason: `${deleted.size} messages${targetUser ? ` from ${targetUser.tag}` : ''}`,
      color: colors.info,
    });

    await interaction.editReply({ embeds: [response({ client: interaction.client, description: desc, color: colors.info })] }).catch(() => {});
  },
};
