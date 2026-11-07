const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response, footer } = require('../../utils/embed');
const store = require('../../database/store');
const infractions = require('../../database/infractions');
const { joinClipped } = require('../../utils/modguard');
const timeline = require('../../utils/timeline');

const SHOW = 12;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription("A member's timeline: cases, warnings and notes, newest first")
    .addUserOption((o) => o.setName('user').setDescription('User to look up').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const guildId = interaction.guild.id;
    const warnings = store.getWarnings(guildId, user.id);
    const notes = store.getNotes(guildId, user.id);
    const cases = infractions.casesFor(guildId, user.id, 50);
    const entries = timeline.mergeTimeline({ cases, warnings, notes });

    if (!entries.length) {
      return interaction.reply({
        embeds: [response({ client: interaction.client, description: `**${user.tag}** has no cases, warnings or notes in this server.`, color: colors.muted })],
        ephemeral: true,
      });
    }

    const lines = entries.slice(0, SHOW).map((e) => timeline.formatEntry(e, { reasonMax: 100 }));
    const embed = base(interaction.client, colors.primary)
      .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .setDescription(`**${warnings.length}** warnings · **${notes.length}** notes · **${cases.length}** cases\n\n${joinClipped(lines, 3600)}`)
      .setFooter(footer(interaction.client, entries.length > SHOW ? `newest ${SHOW} of ${entries.length}` : `${entries.length} entries`));

    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
