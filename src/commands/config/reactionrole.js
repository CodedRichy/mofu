const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response, base } = require('../../utils/embed');
const store = require('../../database/store');
const { roleProblem, clip } = require('../../utils/modguard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Create a reaction role panel')
    .addSubcommand((sub) =>
      sub.setName('create').setDescription('Create a reaction role message')
        .addStringOption((o) => o.setName('title').setDescription('Panel title').setRequired(true))
        .addRoleOption((o) => o.setName('role1').setDescription('First role').setRequired(true))
        .addStringOption((o) => o.setName('label1').setDescription('Button label for role 1').setRequired(true))
        .addRoleOption((o) => o.setName('role2').setDescription('Second role'))
        .addStringOption((o) => o.setName('label2').setDescription('Button label for role 2'))
        .addRoleOption((o) => o.setName('role3').setDescription('Third role'))
        .addStringOption((o) => o.setName('label3').setDescription('Button label for role 3'))
        .addRoleOption((o) => o.setName('role4').setDescription('Fourth role'))
        .addStringOption((o) => o.setName('label4').setDescription('Button label for role 4'))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const title = interaction.options.getString('title');
    const roles = [];

    for (let i = 1; i <= 4; i++) {
      const role = interaction.options.getRole(`role${i}`);
      const label = interaction.options.getString(`label${i}`);
      if (role && label) roles.push({ id: role.id, label: clip(label, 80), name: role.name, role });
    }

    if (!roles.length) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Provide at least one role and label.', color: colors.error })], ephemeral: true });
    }

    // Members get these roles by clicking, so the panel creator may only offer roles they could hand out themselves.
    // (Re-checked at click time against the bot; here against the creator's rank.)
    for (const r of roles) {
      const problem = roleProblem(interaction.guild, interaction.member, r.role);
      if (problem) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `**${r.role.name}**: ${problem}`, color: colors.error })], ephemeral: true });
      }
    }
    if (new Set(roles.map((r) => r.id)).size !== roles.length) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Each role can only appear once on a panel.', color: colors.error })], ephemeral: true });
    }

    const btnStyles = [ButtonStyle.Primary, ButtonStyle.Success, ButtonStyle.Secondary, ButtonStyle.Danger];
    const row = new ActionRowBuilder().addComponents(
      roles.map((r, i) =>
        new ButtonBuilder()
          .setCustomId(`rr_${r.id}`)
          .setLabel(r.label)
          .setStyle(btnStyles[i % btnStyles.length])
      ),
    );

    const desc = roles.map((r) => `**${r.label}** → <@&${r.id}>`).join('\n');
    const embed = base(interaction.client, colors.primary)
      .setAuthor({ name: title, iconURL: interaction.guild.iconURL() })
      .setDescription(desc);

    try {
      await interaction.channel.send({ embeds: [embed], components: [row] });
    } catch {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Failed to send the reaction role panel. Check my permissions in this channel.', color: colors.error })], ephemeral: true });
    }
    await interaction.reply({ embeds: [response({ client: interaction.client, description: `Reaction role panel created with ${roles.length} role(s).`, color: colors.success })], ephemeral: true });
  },
};
