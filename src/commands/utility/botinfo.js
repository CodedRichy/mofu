const { SlashCommandBuilder, version } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base } = require('../../utils/embed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('botinfo')
    .setDescription('View bot information'),

  async execute(interaction) {
    const { client } = interaction;
    const uptime = formatUptime(client.uptime);
    const memUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

    const embed = base(client, colors.primary)
      .setAuthor({ name: 'sonder', iconURL: client.user.displayAvatarURL() })
      .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true },
        { name: 'Members (summed)', value: `${client.guilds.cache.reduce((a, g) => a + g.memberCount, 0).toLocaleString()}`, inline: true },
        { name: 'Commands', value: `${client.commands.size}`, inline: true },
        { name: 'Uptime', value: uptime, inline: true },
        { name: 'Memory', value: `${memUsage} MB`, inline: true },
        { name: 'discord.js', value: `v${version}`, inline: true },
        { name: 'Node.js', value: process.version, inline: true },
        { name: 'Ping', value: `${client.ws.ping}ms`, inline: true },
      );

    await interaction.reply({ embeds: [embed] });
  },
};

function formatUptime(ms) {
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}
