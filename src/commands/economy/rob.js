const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const store = require('../../database/store');
const gambling = require('../../utils/gambling');

const ROB_COOLDOWN = 3600000;
const SUCCESS_RATE = 0.4;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rob')
    .setDescription('Attempt to rob another member')
    .addUserOption((o) => o.setName('user').setDescription('Member to rob').setRequired(true)),

  async execute(interaction) {
    if (await gambling.blocked(interaction)) return;
    const { guild, user } = interaction;
    const target = interaction.options.getUser('user');

    if (target.id === user.id) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: "You can't rob yourself.", color: colors.error })], ephemeral: true });
    }

    if (target.bot) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: "You can't rob a bot.", color: colors.error })], ephemeral: true });
    }

    const cd = store.getCooldown(guild.id, user.id, 'rob');
    if (cd) {
      const mins = Math.ceil((cd - Date.now()) / 60000);
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `You need to wait **${mins}m** before robbing again.`, color: colors.muted })], ephemeral: true });
    }

    const targetBal = store.getBalance(guild.id, target.id);
    if (targetBal.wallet < 100) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `**${target.tag}** doesn't have enough to rob.`, color: colors.muted })], ephemeral: true });
    }

    store.setCooldown(guild.id, user.id, 'rob', Date.now() + ROB_COOLDOWN);

    const targetInv = store.getConfig(guild.id, `inv_${target.id}`) || {};
    if (targetInv.shield && targetInv.shield > 0) {
      targetInv.shield -= 1;
      if (targetInv.shield === 0) delete targetInv.shield;
      store.setConfig(guild.id, `inv_${target.id}`, targetInv);
      return interaction.reply({
        embeds: [response({ client: interaction.client, description: `**${target.tag}** had a 🛡️ **Rob Shield** — your attempt was blocked!`, color: colors.error })],
      });
    }

    if (Math.random() < SUCCESS_RATE) {
      const victimBal = store.getBalance(guild.id, target.id);
      const stolen = Math.floor(Math.random() * Math.min(victimBal.wallet, 500)) + 50;
      const actualStolen = Math.min(stolen, victimBal.wallet);
      if (actualStolen <= 0) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `**${target.tag}** doesn't have enough coins to rob.`, color: colors.error })], ephemeral: true });
      }
      store.addWallet(guild.id, target.id, -actualStolen);
      store.addWallet(guild.id, user.id, actualStolen);

      await interaction.reply({
        embeds: [response({
          client: interaction.client,
          description: `You robbed **⌬ ${actualStolen.toLocaleString()}** from **${target.tag}**`,
          color: colors.success,
        })],
      });
    } else {
      const fine = Math.floor(Math.random() * 200) + 50;
      const bal = store.getBalance(guild.id, user.id);
      const actual = Math.min(fine, bal.wallet);
      store.addWallet(guild.id, user.id, -actual);

      await interaction.reply({
        embeds: [response({
          client: interaction.client,
          description: `You got caught trying to rob **${target.tag}** and paid a **⌬ ${actual.toLocaleString()}** fine`,
          color: colors.error,
        })],
      });
    }
  },
};
