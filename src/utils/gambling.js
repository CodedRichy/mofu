// Gate for games with currency bets. Off by default; an admin enables it per server with /gambling enable.
// Needed for Discord App Directory eligibility. Coins are virtual only: no real money exists in the bot.
const store = require('../database/store');
const { response } = require('./embed');
const { colors } = require('./constants');

const CONFIG_KEY = 'gambling_enabled';
const OFF_MESSAGE = 'Games with currency bets are off in this server. An admin can turn them on with /gambling enable';
const HONEST_NOTE = 'Virtual coins only. No real money is involved.';

function isEnabled(guildId) {
  return !!guildId && store.getConfig(guildId, CONFIG_KEY) === true;
}

// Returns true (and replies privately) when the game must not run.
// Use: if (await gambling.blocked(interaction)) return;
async function blocked(interaction) {
  if (isEnabled(interaction.guild?.id)) return false;
  await interaction.reply({
    embeds: [response({ client: interaction.client, description: OFF_MESSAGE, color: colors.muted })],
    ephemeral: true,
  });
  return true;
}

module.exports = { CONFIG_KEY, OFF_MESSAGE, HONEST_NOTE, isEnabled, blocked };
