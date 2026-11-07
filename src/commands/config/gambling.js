const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const store = require('../../database/store');
const gambling = require('../../utils/gambling');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gambling')
    .setDescription('Turn games with currency bets on or off')
    .addSubcommand((sub) => sub.setName('enable').setDescription('Allow blackjack, slots, coinflip, heist and rob'))
    .addSubcommand((sub) => sub.setName('disable').setDescription('Turn those games off'))
    .addSubcommand((sub) => sub.setName('status').setDescription('Show whether those games are on'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const { guild } = interaction;
    const sub = interaction.options.getSubcommand();
    const reply = (description, color, ephemeral = false) =>
      interaction.reply({ embeds: [response({ client: interaction.client, description, color })], ephemeral });

    if (sub === 'status') {
      const on = gambling.isEnabled(guild.id);
      return reply(`Games with currency bets (blackjack, slots, coinflip, heist, rob) are **${on ? 'on' : 'off'}** in this server.\n${gambling.HONEST_NOTE}`, on ? colors.success : colors.muted);
    }

    const perms = interaction.memberPermissions;
    if (!perms?.has(PermissionFlagsBits.ManageGuild) && !perms?.has(PermissionFlagsBits.Administrator)) {
      return reply('You need the **Manage Server** permission to change this.', colors.error, true);
    }

    const enable = sub === 'enable';
    if (gambling.isEnabled(guild.id) === enable) {
      return reply(`Games with currency bets are already ${enable ? 'on' : 'off'}.`, colors.warning, true);
    }
    store.setConfig(guild.id, gambling.CONFIG_KEY, enable);
    return reply(
      enable
        ? `Games with currency bets are now on: blackjack, slots, coinflip, heist and rob.\n${gambling.HONEST_NOTE}`
        : 'Games with currency bets are now off. Daily, work, bank, shop and transfer still work.',
      enable ? colors.success : colors.muted,
    );
  },
};
