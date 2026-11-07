const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const { chat } = require('../../utils/ai');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roast')
    .setDescription('Get a lighthearted AI roast')
    .addUserOption((o) => o.setName('user').setDescription('User to roast').setRequired(false)),

  cooldown: 15,

  async execute(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    await interaction.deferReply();

    const member = interaction.guild?.members.cache.get(target.id);
    const displayName = member?.displayName || target.displayName;
    const status = member?.presence?.status || 'offline';

    const roast = await chat([
      {
        role: 'system',
        content: 'You are a witty roast comedian in a Discord server. Generate a short, lighthearted roast (2-3 sentences max). Be funny and creative but NEVER be actually mean, offensive, or target real insecurities. Keep it PG-13. No slurs, no body shaming, no personal attacks. Think playful teasing, not bullying.',
      },
      {
        role: 'user',
        content: `Roast the Discord user named ${displayName} (username: ${target.username}). Their account was created ${target.createdAt.toLocaleDateString()}. They are ${status} in the server.`,
      },
    ], { maxTokens: 150, temperature: 0.9, guildId: interaction.guildId });

    if (!roast) {
      return interaction.editReply({
        embeds: [response({ client: interaction.client, description: 'AI unavailable right now.', color: colors.error })],
      });
    }

    await interaction.editReply({
      embeds: [response({ client: interaction.client, description: `🔥 **Roasting ${displayName}**\n\n${roast}`, color: colors.primary })],
    });
  },
};
