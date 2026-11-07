const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response } = require('../../utils/embed');
const { rateLimit } = require('../../utils/ratelimit');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('github')
    .setDescription('Look up a GitHub user profile')
    .addStringOption((o) => o.setName('username').setDescription('GitHub username').setRequired(true)),

  async execute(interaction) {
    const username = interaction.options.getString('username');
    if (!rateLimit(`github:${interaction.guild.id}:${interaction.user.id}`, 10, 60000)) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Rate limit reached. Try again in a minute.', color: colors.error })], ephemeral: true });
    }
    await interaction.deferReply();

    try {
      const res = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, {
        headers: { 'User-Agent': 'mofu-bot' },
      });
      if (!res.ok) throw new Error();
      const u = await res.json();

      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: u.login, iconURL: u.avatar_url, url: u.html_url })
        .setThumbnail(u.avatar_url);

      const info = [];
      if (u.name) info.push(`**Name** ${u.name}`);
      if (u.bio) info.push(`**Bio** ${u.bio}`);
      if (u.company) info.push(`**Company** ${u.company}`);
      if (u.location) info.push(`**Location** ${u.location}`);
      info.push(`**Repos** ${u.public_repos} · **Gists** ${u.public_gists}`);
      info.push(`**Followers** ${u.followers} · **Following** ${u.following}`);
      info.push(`**Created** <t:${Math.floor(new Date(u.created_at).getTime() / 1000)}:R>`);

      embed.setDescription(info.join('\n'));

      await interaction.editReply({ embeds: [embed] });
    } catch {
      await interaction.editReply({ embeds: [response({ client: interaction.client, description: `No GitHub user found for **${username}**`, color: colors.error })] });
    }
  },
};
