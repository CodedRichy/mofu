const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const store = require('../../database/store');
const gambling = require('../../utils/gambling');

const COINFLIP_COOLDOWN = 15000;
const LUCKY_COIN_MAX_BET = 500;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Flip a coin — double or nothing')
    .addIntegerOption((o) => o.setName('amount').setDescription('Amount to bet').setRequired(true).setMinValue(10))
    .addStringOption((o) =>
      o.setName('side').setDescription('Pick a side').setRequired(true).addChoices(
        { name: 'Heads', value: 'heads' },
        { name: 'Tails', value: 'tails' },
      )
    ),

  async execute(interaction) {
    if (await gambling.blocked(interaction)) return;
    const { guild, user } = interaction;

    const cd = store.getCooldown(guild.id, user.id, 'coinflip');
    if (cd) {
      const remaining = Math.ceil((cd - Date.now()) / 1000);
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `You need to wait **${remaining}s** before flipping again.`, color: colors.error })], ephemeral: true });
    }

    const amount = interaction.options.getInteger('amount');
    const pick = interaction.options.getString('side');
    const bal = store.getBalance(guild.id, user.id);

    if (amount > bal.wallet) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `You only have **⌬ ${bal.wallet.toLocaleString()}** in your wallet.`, color: colors.error })], ephemeral: true });
    }

    const coinSkipped = amount > LUCKY_COIN_MAX_BET && (store.getConfig(guild.id, `inv_${user.id}`) || {}).lucky_coin > 0;

    store.setCooldown(guild.id, user.id, 'coinflip', Date.now() + COINFLIP_COOLDOWN);

    // Deduct bet upfront to prevent race condition with concurrent flips
    store.addWallet(guild.id, user.id, -amount);

    const inv = store.getConfig(guild.id, `inv_${user.id}`) || {};
    let hasLuck = false;
    if (inv.lucky_coin && inv.lucky_coin > 0 && amount <= LUCKY_COIN_MAX_BET) {
      inv.lucky_coin -= 1;
      if (inv.lucky_coin === 0) delete inv.lucky_coin;
      store.setConfig(guild.id, `inv_${user.id}`, inv);
      hasLuck = true;
    }

    const result = hasLuck ? pick : (Math.random() < 0.5 ? 'heads' : 'tails');
    const won = result === pick;

    if (won) {
      store.addWallet(guild.id, user.id, amount * 2); // return bet + winnings
    }
    // on loss: already deducted, nothing to do

    const newBal = store.getBalance(guild.id, user.id);
    const emoji = result === 'heads' ? '👑' : '🪙';

    const note = coinSkipped ? `\n-# Your Lucky Coin only works on bets of ⌬ ${LUCKY_COIN_MAX_BET} or less, so it was not used.` : '';
    const desc = won
      ? `${emoji} It landed on **${result}**! You won **⌬ ${amount.toLocaleString()}**\n**Wallet** \`⌬ ${newBal.wallet.toLocaleString()}\``
      : `${emoji} It landed on **${result}**. You lost **⌬ ${amount.toLocaleString()}**\n**Wallet** \`⌬ ${newBal.wallet.toLocaleString()}\``;

    await interaction.reply({
      embeds: [response({ client: interaction.client, description: desc + note, color: won ? colors.success : colors.error })],
    });
  },
};
