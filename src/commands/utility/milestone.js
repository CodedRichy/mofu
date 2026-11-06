const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { fetchAllMembers } = require('../../utils/members');
const { base, response } = require('../../utils/embed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('milestone')
    .setDescription('View your server milestones')
    .addUserOption((o) => o.setName('user').setDescription('User to check')),

  async execute(interaction) {
    const target = interaction.options.getMember('user') || interaction.member;
    await interaction.deferReply();

    const milestones = [];
    const now = Date.now();

    // Join duration milestones
    if (target.joinedTimestamp) {
      const daysInServer = Math.floor((now - target.joinedTimestamp) / 86400000);

      if (daysInServer >= 365) milestones.push(`🏆 **${Math.floor(daysInServer / 365)} year${Math.floor(daysInServer / 365) > 1 ? 's' : ''}** in server`);
      else if (daysInServer >= 180) milestones.push('🥇 **6+ months** in server');
      else if (daysInServer >= 90) milestones.push('🥈 **3+ months** in server');
      else if (daysInServer >= 30) milestones.push('🥉 **1+ month** in server');
      else if (daysInServer >= 7) milestones.push('🌱 **1+ week** in server');
      else milestones.push('✨ **New member** — just joined!');
    }

    // Role count
    const roleCount = target.roles.cache.size - 1;
    if (roleCount >= 10) milestones.push(`🎭 **Role collector** — ${roleCount} roles`);
    else if (roleCount >= 5) milestones.push(`🎭 **${roleCount} roles** earned`);

    // Booster
    if (target.premiumSince) {
      const boostDays = Math.floor((now - target.premiumSinceTimestamp) / 86400000);
      milestones.push(`💎 **Server booster** for ${boostDays} days`);
    }

    // Join position
    const members = await fetchAllMembers(interaction.guild);
    const sorted = [...members.values()].filter((m) => m.joinedTimestamp).sort((a, b) => a.joinedTimestamp - b.joinedTimestamp);
    const position = sorted.findIndex((m) => m.id === target.id) + 1;
    if (position <= 10) milestones.push(`👑 **OG member** — #${position} to join`);
    else if (position <= 50) milestones.push(`⭐ **Early member** — #${position} to join`);

    // Account age
    const accountAge = Math.floor((now - target.user.createdTimestamp) / 86400000);
    if (accountAge >= 365 * 5) milestones.push(`🗿 **Discord veteran** — ${Math.floor(accountAge / 365)}yr old account`);
    else if (accountAge >= 365 * 2) milestones.push(`📅 **${Math.floor(accountAge / 365)}yr** Discord account`);

    // Permissions
    if (target.permissions.has(PermissionFlagsBits.Administrator)) milestones.push('🛡️ **Server administrator**');
    else if (target.permissions.has(PermissionFlagsBits.ManageMessages)) milestones.push('🔨 **Moderator**');

    const desc = milestones.length ? milestones.join('\n') : 'No milestones yet — keep participating!';

    const embed = base(interaction.client, colors.primary)
      .setAuthor({ name: `${target.displayName}'s Milestones`, iconURL: target.user.displayAvatarURL() })
      .setDescription(desc)
      .setThumbnail(target.user.displayAvatarURL({ size: 256 }));

    await interaction.editReply({ embeds: [embed] });
  },
};
