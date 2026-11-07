const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response } = require('../../utils/embed');
const store = require('../../database/store');

const ITEMS = [
  { id: 'fishing_rod', name: 'Fishing Rod', price: 500, emoji: '🎣', description: 'Go fishing for extra income' },
  { id: 'laptop', name: 'Laptop', price: 2000, emoji: '💻', description: 'Permanently earn 50% more from working' },
  { id: 'shield', name: 'Rob Shield', price: 3000, emoji: '🛡️', description: 'Blocks one robbery attempt (consumed)' },
  { id: 'lucky_coin', name: 'Lucky Coin', price: 1500, emoji: '🍀', description: 'Win your next coinflip or slots (consumed)' },
  { id: 'bank_note', name: 'Bank Note', price: 5000, emoji: '💵', description: 'Permanently increase bank capacity by ⌬10,000' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Browse or buy items')
    .addSubcommand((s) => s.setName('view').setDescription('Browse available items'))
    .addSubcommand((s) =>
      s.setName('buy')
        .setDescription('Buy an item')
        .addStringOption((o) =>
          o.setName('item').setDescription('Item name from the shop to purchase').setRequired(true)
            .addChoices(...ITEMS.map((i) => ({ name: i.name, value: i.id })))
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'view') {
      const desc = ITEMS.map((i) => `${i.emoji} **${i.name}** — ⌬ ${i.price.toLocaleString()}\n> ${i.description}`).join('\n\n');

      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: '🛒 Shop' })
        .setDescription(desc)
        .setFooter({ text: 'Use /shop buy <item> to purchase' });

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'buy') {
      const itemId = interaction.options.getString('item');
      const item = ITEMS.find((i) => i.id === itemId);

      if (!item) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Item not found.', color: colors.error })], ephemeral: true });
      }

      const bal = store.getBalance(interaction.guild.id, interaction.user.id);

      if (item.id === 'fishing_rod' || item.id === 'laptop') {
        const owned = store.getConfig(interaction.guild.id, `inv_${interaction.user.id}`) || {};
        if (owned[itemId] > 0) {
          return interaction.reply({ embeds: [response({ client: interaction.client, description: `You already own a ${item.emoji} **${item.name}**. It is permanent, so a second one would be wasted.`, color: colors.error })], ephemeral: true });
        }
      }

      if (bal.wallet < item.price) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `You need **⌬ ${item.price.toLocaleString()}** but only have **⌬ ${bal.wallet.toLocaleString()}**`, color: colors.error })], ephemeral: true });
      }

      store.addWallet(interaction.guild.id, interaction.user.id, -item.price);

      const inv = store.getConfig(interaction.guild.id, `inv_${interaction.user.id}`) || {};
      inv[itemId] = (inv[itemId] || 0) + 1;
      store.setConfig(interaction.guild.id, `inv_${interaction.user.id}`, inv);

      const newBal = store.getBalance(interaction.guild.id, interaction.user.id);
      return interaction.reply({
        embeds: [response({
          client: interaction.client,
          description: `Bought ${item.emoji} **${item.name}** for **⌬ ${item.price.toLocaleString()}**\n**Wallet** \`⌬ ${newBal.wallet.toLocaleString()}\``,
          color: colors.success,
        })],
      });
    }
  },
};
