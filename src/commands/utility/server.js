const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { colors } = require('../../utils/constants');
const { fetchAllMembers } = require('../../utils/members');
const { base } = require('../../utils/embed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('server')
    .setDescription('Server info, icon, and banner')
    .addSubcommand((sub) =>
      sub.setName('info').setDescription('View information about this server')
    )
    .addSubcommand((sub) =>
      sub.setName('icon').setDescription('View the server icon')
    )
    .addSubcommand((sub) =>
      sub.setName('banner').setDescription('View the server banner')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'info') {
      const { guild } = interaction;
      await fetchAllMembers(guild).catch(() => {});

      const text = guild.channels.cache.filter((c) => c.type === ChannelType.GuildText).size;
      const voice = guild.channels.cache.filter((c) => c.type === ChannelType.GuildVoice).size;
      const categories = guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory).size;
      const humans = guild.members.cache.filter((m) => !m.user.bot).size;
      const bots = guild.members.cache.filter((m) => m.user.bot).size;
      const online = guild.members.cache.filter((m) => m.presence?.status !== 'offline').size;

      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: guild.name, iconURL: guild.iconURL({ size: 256 }) })
        .setThumbnail(guild.iconURL({ size: 512 }));

      if (guild.description) embed.setDescription(guild.description);

      embed.addFields(
        { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
        { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Boost Level', value: `Level ${guild.premiumTier} (${guild.premiumSubscriptionCount} boosts)`, inline: true },
        { name: 'Members', value: `${guild.memberCount} total\n${humans} humans · ${bots} bots`, inline: true },
        { name: 'Channels', value: `${text} text · ${voice} voice\n${categories} categories`, inline: true },
        { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
        { name: 'Emojis', value: `${guild.emojis.cache.size}`, inline: true },
        { name: 'Stickers', value: `${guild.stickers.cache.size}`, inline: true },
        { name: 'Verification', value: ['None', 'Low', 'Medium', 'High', 'Very High'][guild.verificationLevel] || 'Unknown', inline: true },
      );

      const banner = guild.bannerURL({ size: 1024 });
      if (banner) embed.setImage(banner);

      await interaction.reply({ embeds: [embed] });
    }

    else if (sub === 'icon') {
      const icon = interaction.guild.iconURL({ size: 4096 });
      if (!icon) {
        return interaction.reply({ embeds: [base(interaction.client, colors.muted).setDescription('This server has no icon.')] });
      }

      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: interaction.guild.name })
        .setImage(icon);

      await interaction.reply({ embeds: [embed] });
    }

    else if (sub === 'banner') {
      const banner = interaction.guild.bannerURL({ size: 4096 });
      if (!banner) {
        return interaction.reply({ embeds: [base(interaction.client, colors.muted).setDescription('This server has no banner.')] });
      }

      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: interaction.guild.name })
        .setImage(banner);

      await interaction.reply({ embeds: [embed] });
    }
  },
};
