const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const store = require('../../database/store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Set your AFK status')
    .addStringOption((o) => o.setName('reason').setDescription('AFK reason').setMaxLength(200)),

  async execute(interaction) {
    const reason = interaction.options.getString('reason') || 'AFK';
    store.setConfig(interaction.guild.id, `afk_${interaction.user.id}`, { reason, since: Date.now() });

    await interaction.reply({
      embeds: [response({ client: interaction.client, description: `${interaction.user} is now AFK: **${reason}**`, color: colors.muted })],
    });
  },
};
