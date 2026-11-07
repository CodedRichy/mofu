const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');

const STAFF_FLAGS = ['Administrator', 'ManageGuild', 'ManageMessages', 'ModerateMembers', 'BanMembers', 'KickMembers'];

// Read-only: does this account really hold a staff role here? Helps spot lookalike accounts.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('isstaff')
    .setDescription('Check whether an account really holds a staff role in this server')
    .addUserOption((o) => o.setName('user').setDescription('Account to check').setRequired(true)),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    if (!user) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Mention the account or paste its ID.', color: colors.error })], ephemeral: true });
    }
    const member = interaction.guild.members.cache.get(user.id) || await interaction.guild.members.fetch(user.id).catch(() => null);
    let text;
    if (!member) {
      text = `\`${user.id}\` is not in this server, so they hold no staff role here.`;
    } else {
      const staff = STAFF_FLAGS.some((f) => member.permissions.has(f));
      const roles = member.roles.cache.filter((r) => r.id !== interaction.guild.id && STAFF_FLAGS.some((f) => r.permissions.has(f)));
      text = staff
        ? `${member} (\`${member.id}\`) **does** hold staff permissions here${roles.size ? ` through ${roles.map((r) => r.toString()).slice(0, 8).join(' ')}` : ''}.`
        : `${member} (\`${member.id}\`) does **not** hold a staff role here. If they claim to be staff, they are not.`;
    }
    return interaction.reply({ embeds: [response({ client: interaction.client, description: text, color: colors.info })], ephemeral: true, allowedMentions: { parse: [] } });
  },
};
