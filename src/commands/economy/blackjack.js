const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base } = require('../../utils/embed');
const { response } = require('../../utils/embed');
const store = require('../../database/store');

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function createDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ suit: s, rank: r });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(rank) {
  if (['J', 'Q', 'K'].includes(rank)) return 10;
  if (rank === 'A') return 11;
  return parseInt(rank);
}

function handValue(hand) {
  let total = hand.reduce((s, c) => s + cardValue(c.rank), 0);
  let aces = hand.filter((c) => c.rank === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function displayHand(hand) {
  return hand.map((c) => `\`${c.rank}${c.suit}\``).join(' ');
}

function buildEmbed(client, user, guildId, playerHand, dealerHand, amount, status, hideDealer) {
  const pVal = handValue(playerHand);
  const dVal = hideDealer ? cardValue(dealerHand[0].rank) : handValue(dealerHand);
  const dealerDisplay = hideDealer
    ? `${displayHand([dealerHand[0]])} \`??\``
    : displayHand(dealerHand);

  let color = colors.primary;
  if (status === 'win' || status === 'blackjack') color = colors.success;
  else if (status === 'lose' || status === 'bust') color = colors.error;
  else if (status === 'push') color = colors.warning;

  const embed = base(client, color)
    .setAuthor({ name: `Blackjack — ⌬ ${amount.toLocaleString()}`, iconURL: user.displayAvatarURL() })
    .setDescription(
      `**Dealer** ${dealerDisplay} (${hideDealer ? '?' : dVal})\n` +
      `**You** ${displayHand(playerHand)} (${pVal})`
    );

  if (status && status !== 'playing') {
    const messages = {
      blackjack: `Blackjack! You won **⌬ ${Math.floor(amount * 1.5).toLocaleString()}**`,
      win: `You won **⌬ ${amount.toLocaleString()}**`,
      lose: `You lost **⌬ ${amount.toLocaleString()}**`,
      bust: `Bust! You lost **⌬ ${amount.toLocaleString()}**`,
      push: `Push — your bet was returned`,
    };
    const newBal = store.getBalance(guildId, user.id);
    embed.addFields({ name: 'Result', value: `${messages[status]}\n**Wallet** \`⌬ ${newBal.wallet.toLocaleString()}\`` });
  }

  return embed;
}

const activeGames = new Map();
const BLACKJACK_COOLDOWN = 30000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('Play a hand of blackjack')
    .addIntegerOption((o) => o.setName('amount').setDescription('Amount to bet').setRequired(true).setMinValue(10)),

  async execute(interaction) {
    const { guild, user } = interaction;

    const cd = store.getCooldown(guild.id, user.id, 'blackjack');
    if (cd) {
      const remaining = Math.ceil((cd - Date.now()) / 1000);
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `You need to wait **${remaining}s** before playing again.`, color: colors.error })], ephemeral: true });
    }

    const amount = interaction.options.getInteger('amount');
    const bal = store.getBalance(guild.id, user.id);

    if (activeGames.has(user.id)) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'You already have an active game.', color: colors.error })], ephemeral: true });
    }

    if (amount > bal.wallet) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `You only have **⌬ ${bal.wallet.toLocaleString()}** in your wallet.`, color: colors.error })], ephemeral: true });
    }

    store.setCooldown(guild.id, user.id, 'blackjack', Date.now() + BLACKJACK_COOLDOWN);

    store.addWallet(guild.id, user.id, -amount);

    const deck = createDeck();
    const playerHand = [deck.pop(), deck.pop()];
    const dealerHand = [deck.pop(), deck.pop()];

    if (handValue(playerHand) === 21) {
      const dealerBj = handValue(dealerHand) === 21;
      store.addWallet(guild.id, user.id, dealerBj ? amount : Math.floor(amount * 2.5));
      const embed = buildEmbed(interaction.client, user, guild.id, playerHand, dealerHand, amount, dealerBj ? 'push' : 'blackjack', false);
      return interaction.reply({ embeds: [embed] });
    }

    const gameId = `bj_${user.id}_${Date.now()}`;
    activeGames.set(user.id, { deck, playerHand, dealerHand, amount, guildId: guild.id, acted: false });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${gameId}_hit`).setLabel('Hit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${gameId}_stand`).setLabel('Stand').setStyle(ButtonStyle.Secondary),
    );

    const embed = buildEmbed(interaction.client, user, guild.id, playerHand, dealerHand, amount, 'playing', true);
    let msg;
    try {
      msg = await interaction.reply({ embeds: [embed], components: [buttons], fetchReply: true });
    } catch (err) {
      // The player never saw the hand: give the bet back and free the slot
      if (activeGames.delete(user.id)) store.addWallet(guild.id, user.id, amount);
      throw err;
    }

    const collector = msg.createMessageComponentCollector({ time: 60000 });

    collector.on('collect', async (btn) => {
      if (btn.user.id !== user.id) {
        return btn.reply({ content: "This isn't your game.", ephemeral: true });
      }

      const game = activeGames.get(user.id);
      if (!game) return btn.update({ components: [] });

      game.acted = true;

      if (btn.customId.endsWith('_hit')) {
        if (game.deck.length === 0) {
          // Deck depleted — force stand with current hand
          btn.customId = `${gameId}_stand`;
        } else {
          game.playerHand.push(game.deck.pop());
          const pVal = handValue(game.playerHand);

          if (pVal > 21) {
            activeGames.delete(user.id);
            collector.stop();
            const embed = buildEmbed(interaction.client, user, guild.id, game.playerHand, game.dealerHand, game.amount, 'bust', false);
            return btn.update({ embeds: [embed], components: [] });
          }

          if (pVal === 21) {
            btn.customId = `${gameId}_stand`;
          } else {
            const embed = buildEmbed(interaction.client, user, guild.id, game.playerHand, game.dealerHand, game.amount, 'playing', true);
            return btn.update({ embeds: [embed], components: [buttons] });
          }
        }
      }

      if (btn.customId.endsWith('_stand')) {
        while (handValue(game.dealerHand) < 17 && game.deck.length > 0) {
          game.dealerHand.push(game.deck.pop());
        }

        const pVal = handValue(game.playerHand);
        const dVal = handValue(game.dealerHand);

        let status;
        if (dVal > 21 || pVal > dVal) {
          status = 'win';
          store.addWallet(guild.id, user.id, amount * 2);
        } else if (pVal === dVal) {
          status = 'push';
          store.addWallet(guild.id, user.id, amount);
        } else {
          status = 'lose';
        }

        activeGames.delete(user.id);
        collector.stop();
        const embed = buildEmbed(interaction.client, user, guild.id, game.playerHand, game.dealerHand, game.amount, status, false);
        return btn.update({ embeds: [embed], components: [] });
      }
    });

    collector.on('end', (_, reason) => {
      const game = activeGames.get(user.id);
      if (game) {
        // Refund only if the player never acted; walking away mid-hand forfeits the bet
        activeGames.delete(user.id);
        if (!game.acted) store.addWallet(guild.id, user.id, amount);
        const text = game.acted
          ? `Blackjack timed out mid-hand — you forfeit your **⌬ ${amount.toLocaleString()}** bet.`
          : `Blackjack timed out — your **⌬ ${amount.toLocaleString()}** bet has been refunded.`;
        interaction.editReply({
          embeds: [response({ client: interaction.client, description: text, color: colors.warning })],
          components: [],
        }).catch(() => {});
      }
    });
  },
};
