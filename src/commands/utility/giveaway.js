const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response, footer } = require('../../utils/embed');
const { parse, format } = require('../../utils/duration');
const giveawayDb = require('../../database/giveaway');
const { setLongTimeout } = require('../../utils/longTimeout');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Manage giveaways')
    .addSubcommand((sub) =>
      sub.setName('start').setDescription('Start a giveaway')
        .addStringOption((o) => o.setName('prize').setDescription('What are you giving away?').setRequired(true).setMaxLength(256))
        .addStringOption((o) => o.setName('duration').setDescription('How long? (e.g. 1h, 1d, 1w)').setRequired(true))
        .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners (default: 1)').setMinValue(1).setMaxValue(20))
    )
    .addSubcommand((sub) =>
      sub.setName('end').setDescription('End a giveaway early')
        .addStringOption((o) => o.setName('message_id').setDescription('Message ID of the giveaway').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('reroll').setDescription('Reroll winners for a giveaway')
        .addStringOption((o) => o.setName('message_id').setDescription('Message ID of the giveaway').setRequired(true))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild, channel } = interaction;

    if (sub === 'start') {
      const prize = interaction.options.getString('prize');
      const durationStr = interaction.options.getString('duration');
      const winnerCount = interaction.options.getInteger('winners') || 1;
      const ms = parse(durationStr);

      if (!ms) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Invalid duration. Use `1h`, `1d`, `1w`.', color: colors.error })], ephemeral: true });
      }

      const endsAt = Date.now() + ms;

      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: '🎉 Giveaway' })
        .setDescription(`**${prize}**\n\nClick **Enter** to join.\n**Winners:** ${winnerCount}\n**Ends:** <t:${Math.floor(endsAt / 1000)}:R>\n**Hosted by:** ${interaction.user}`)
        .setFooter(footer(interaction.client, `${winnerCount} winner(s) | ends`))
        .setTimestamp(endsAt);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('giveaway_enter').setLabel('Enter').setStyle(ButtonStyle.Primary).setEmoji('🎉'),
      );

      // Post first, confirm after: never say "started" for a giveaway that did not get posted.
      const msg = await channel.send({ embeds: [embed], components: [row] }).catch(() => null);
      if (!msg) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: "Couldn't post the giveaway. Check that I can send messages and embeds in this channel.", color: colors.error })], ephemeral: true });
      }
      await interaction.reply({ embeds: [response({ client: interaction.client, description: 'Giveaway started.', color: colors.success })], ephemeral: true });

      giveawayDb.create(guild.id, {
        messageId: msg.id,
        channelId: channel.id,
        prize,
        winnerCount,
        endsAt,
        hostId: interaction.user.id,
      });

      setLongTimeout(() => endGiveaway(guild, msg.id, channel.id, interaction.client), ms);

    } else if (sub === 'end') {
      const messageId = interaction.options.getString('message_id');
      const gw = giveawayDb.get(guild.id, messageId);
      if (!gw || gw.ended) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Giveaway not found or already ended.', color: colors.error })], ephemeral: true });
      }

      await endGiveaway(guild, messageId, gw.channelId, interaction.client);
      await interaction.reply({ embeds: [response({ client: interaction.client, description: 'Giveaway ended.', color: colors.success })], ephemeral: true });

    } else if (sub === 'reroll') {
      const messageId = interaction.options.getString('message_id');
      const gw = giveawayDb.get(guild.id, messageId);
      if (!gw) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Giveaway not found.', color: colors.error })], ephemeral: true });
      }

      const winners = giveawayDb.pickWinners(gw, gw.winnerCount);
      const ch = guild.channels.cache.get(gw.channelId);
      if (ch && winners.length) {
        await ch.send({ embeds: [response({ client: interaction.client, description: `🎉 **Rerolled!** New winner(s): ${winners.map((w) => `<@${w}>`).join(', ')}\n**Prize:** ${gw.prize}`, color: colors.primary })] });
      }

      await interaction.reply({ embeds: [response({ client: interaction.client, description: `Rerolled ${winners.length} winner(s).`, color: colors.success })], ephemeral: true });
    }
  },
};

async function endGiveaway(guild, messageId, channelId, client) {
  const gw = giveawayDb.end(guild.id, messageId);
  if (!gw) return;

  const channel = guild.channels.cache.get(channelId);
  if (!channel) return;

  const msg = await channel.messages.fetch(messageId).catch(() => null);
  if (!msg) return;

  const winners = giveawayDb.pickWinners(gw, gw.winnerCount);

  const embed = base(client, colors.muted)
    .setAuthor({ name: '🎉 Giveaway Ended' })
    .setDescription(
      winners.length
        ? `**${gw.prize}**\n\n**Winner(s):** ${winners.map((w) => `<@${w}>`).join(', ')}`
        : `**${gw.prize}**\n\nNot enough entries.`,
    )
    .setFooter(footer(client, 'Ended'))
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('giveaway_ended').setLabel('Ended').setStyle(ButtonStyle.Secondary).setDisabled(true),
  );

  await msg.edit({ embeds: [embed], components: [row] }).catch(() => {});

  if (winners.length) {
    await channel.send({ content: `🎉 Congratulations ${winners.map((w) => `<@${w}>`).join(', ')}! You won **${gw.prize}**!`, allowedMentions: { users: winners } });
  }
}
