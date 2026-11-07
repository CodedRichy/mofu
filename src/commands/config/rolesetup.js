const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response } = require('../../utils/embed');
const { createRole, lockdownRoleInChannels, ROLE_PRESETS } = require('../../utils/roleCreate');

const PRESET_OPTIONS = [
  { label: 'Jailed', value: 'jailed', emoji: '\u{1F512}', description: 'Restricted role for jailed members. Denies access to all channels.' },
  { label: 'Moderator', value: 'moderator', emoji: '\u{1F6E1}️', description: 'Staff role with kick, ban, manage messages, timeout permissions.' },
  { label: 'Member', value: 'member', emoji: '\u{1F464}', description: 'Basic member role. Great for autorole or verification gates.' },
  { label: 'All Essential', value: 'all', emoji: '\u{1F4CB}', description: 'Create all three roles at once.' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rolesetup')
    .setDescription('Create essential roles for the server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    await interaction.deferReply();

    const menu = new StringSelectMenuBuilder()
      .setCustomId('rolesetup_select')
      .setPlaceholder('Select roles to create')
      .setMinValues(1)
      .setMaxValues(PRESET_OPTIONS.length)
      .addOptions(PRESET_OPTIONS);

    const row = new ActionRowBuilder().addComponents(menu);

    const embed = base(interaction.client, colors.primary)
      .setAuthor({ name: 'Role Setup', iconURL: interaction.client.user.displayAvatarURL() })
      .setDescription(
        'Select the roles you want to create for your server.\n\n' +
        PRESET_OPTIONS.map((o) => `${o.emoji} **${o.label}** — ${o.description}`).join('\n')
      );

    const msg = await interaction.editReply({ embeds: [embed], components: [row] });

    const collector = msg.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id,
      time: 60_000,
      max: 1,
    });

    collector.on('collect', async (i) => {
      await i.deferUpdate();

      let selected = i.values;
      if (selected.includes('all')) {
        selected = ['jailed', 'moderator', 'member'];
      } else {
        selected = [...new Set(selected.filter((v) => v !== 'all'))];
      }

      const results = [];

      for (const preset of selected) {
        const config = ROLE_PRESETS[preset];
        if (!config) continue;

        const existing = interaction.guild.roles.cache.find((r) => r.name === config.name);
        const role = await createRole(interaction.guild, preset);

        if (!role) {
          results.push({ preset, status: 'failed', name: config.name });
          continue;
        }

        if (existing) {
          results.push({ preset, status: 'existed', role });
        } else {
          results.push({ preset, status: 'created', role });
        }

        if (preset === 'jailed') {
          const count = await lockdownRoleInChannels(interaction.guild, role, {
            deny: ['ViewChannel', 'SendMessages', 'AddReactions', 'Connect'],
          });
          // /jail finds this role by name ('Jailed'); no config key is needed.
          results[results.length - 1].channelCount = count;
        }
      }

      const memberResult = results.find((r) => r.preset === 'member');
      const modResult = results.find((r) => r.preset === 'moderator');

      if (modResult && modResult.role && memberResult && memberResult.role) {
        try {
          await modResult.role.setPosition(interaction.guild.roles.cache.size - 3);
        } catch {}
      }

      const lines = results.map((r) => {
        if (r.status === 'failed') {
          return `✗ Failed to create @${r.name} — missing permissions`;
        }
        if (r.status === 'existed') {
          const extra = r.preset === 'jailed' && r.channelCount != null ? ` (applied to ${r.channelCount} channels)` : '';
          return `✓ ${r.role} already existed — reusing${extra}`;
        }
        const extra = r.preset === 'jailed' && r.channelCount != null ? ` (applied to ${r.channelCount} channels)` : '';
        return `✓ Created ${r.role}${extra}`;
      });

      const resultEmbed = base(interaction.client, colors.success)
        .setAuthor({ name: 'Role Setup Complete', iconURL: interaction.client.user.displayAvatarURL() })
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Tip: use /autorole add for the Member role', iconURL: interaction.client.user.displayAvatarURL() });

      await interaction.editReply({ embeds: [resultEmbed], components: [] });
    });

    collector.on('end', async (collected) => {
      if (collected.size > 0) return;
      const timeoutEmbed = response({ client: interaction.client, description: 'Role setup timed out. Run the command again.', color: colors.muted });
      await interaction.editReply({ embeds: [timeoutEmbed], components: [] }).catch(() => {});
    });
  },
};
