const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('selfpurge')
    .setDescription('Delete your own recent messages')
    .addIntegerOption((o) => o.setName('count').setDescription('Number of messages to delete').setRequired(true).setMinValue(1).setMaxValue(100)),

  async execute(interaction) {
    const count = interaction.options.getInteger('count');
    await interaction.deferReply({ ephemeral: true });

    const messages = await interaction.channel.messages.fetch({ limit: 100 });
    const own = messages.filter((m) => m.author.id === interaction.user.id).first(count);

    const results = await Promise.all(own.map((msg) => msg.delete().then(() => true, () => false)));
    const deleted = results.filter(Boolean).length;
    const failed = results.length - deleted;
    const extra = [
      failed ? `${failed} could not be deleted` : '',
      own.length < count ? `only ${own.length} of yours were in the last 100 messages here` : '',
    ].filter(Boolean).join('; ');

    await interaction.editReply({ embeds: [response({ client: interaction.client, description: `Deleted **${deleted}** of your messages.${extra ? ` (${extra})` : ''}`, color: deleted ? colors.success : colors.muted })] });
  },
};
