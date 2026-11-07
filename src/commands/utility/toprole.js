const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response, footer } = require('../../utils/embed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('toprole')
    .setDescription('See most active members with a specific role')
    .addRoleOption((o) => o.setName('role').setDescription('Role to check').setRequired(true))
    .addChannelOption((o) => o.setName('channel').setDescription('Check activity in a specific channel').addChannelTypes(ChannelType.GuildText)),

  async execute(interaction) {
    const role = interaction.options.getRole('role');
    const channel = interaction.options.getChannel('channel');
    await interaction.deferReply();

    const roleMembers = role.members;
    if (!roleMembers.size) {
      return interaction.editReply({ embeds: [response({ client: interaction.client, description: `No members have ${role}.`, color: colors.muted })] });
    }

    const channels = channel ? [channel] : interaction.guild.channels.cache.filter((c) => c.isTextBased() && !c.isThread()).first(5);
    const counts = new Map();

    const channelList = Array.isArray(channels) ? channels : [channels];
    for (const ch of channelList) {
      try {
        const msgs = await ch.messages.fetch({ limit: 100 });
        for (const msg of msgs.values()) {
          if (roleMembers.has(msg.author.id)) {
            counts.set(msg.author.id, (counts.get(msg.author.id) || 0) + 1);
          }
        }
      } catch {
        // Can't access channel
      }
    }

    const sorted = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);

    const inactive = roleMembers.filter((m) => !counts.has(m.id)).size;

    const desc = sorted.length
      ? sorted.map(([id, count], i) => `\`${String(i + 1).padStart(2)}.\` <@${id}> — ${count} messages`).join('\n')
      : '*No recent messages from this role*';

    const embed = base(interaction.client, role.color || colors.primary)
      .setAuthor({ name: `Top ${role.name} Members` })
      .setDescription(`${roleMembers.size} members · ${inactive} inactive in sample\n\n${desc}`)
      .setFooter(footer(interaction.client, `Based on recent messages in ${channelList.length} channel${channelList.length > 1 ? 's' : ''}`));

    await interaction.editReply({ embeds: [embed] });
  },
};
