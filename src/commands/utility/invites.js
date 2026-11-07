const { SlashCommandBuilder, PermissionFlagsBits, OAuth2Scopes } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response } = require('../../utils/embed');
const inviteStore = require('../../database/invites');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Invite links, counts, and leaderboard')
    .addSubcommand((sub) =>
      sub.setName('link').setDescription('Get the bot invite link'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('check')
        .setDescription('View invite count for a user')
        .addUserOption((o) => o.setName('user').setDescription('User to check (defaults to you)')),
    )
    .addSubcommand((sub) =>
      sub.setName('leaderboard').setDescription('View top inviters'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('reset')
        .setDescription('Reset invite counts (requires Manage Server)')
        .addUserOption((o) => o.setName('user').setDescription('Reset for a specific user (omit to reset all)')),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── /invites link ──────────────────────────────────────────────
    if (sub === 'link') {
      const link = interaction.client.generateInvite({
        scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
        permissions: [PermissionFlagsBits.Administrator],
      });

      return interaction.reply({
        embeds: [response({
          client: interaction.client,
          description: `**[Invite mofu to your server](${link})**`,
          color: colors.primary,
        })],
      });
    }

    // ── /invites check [user] ──────────────────────────────────────
    if (sub === 'check') {
      const target = interaction.options.getUser('user') || interaction.user;

      try {
        const invites = await interaction.guild.invites.fetch();
        const userInvites = invites.filter((i) => i.inviter?.id === target.id);
        const total = userInvites.reduce((sum, i) => sum + (i.uses || 0), 0);

        return interaction.reply({
          embeds: [response({
            client: interaction.client,
            description: `${target} has **${total}** invite${total !== 1 ? 's' : ''}`,
            color: colors.primary,
          })],
        });
      } catch {
        return interaction.reply({
          embeds: [response({ client: interaction.client, description: 'Failed to fetch invites.', color: colors.error })],
          ephemeral: true,
        });
      }
    }

    // ── /invites leaderboard ───────────────────────────────────────
    if (sub === 'leaderboard') {
      await interaction.deferReply();

      try {
        const invites = await interaction.guild.invites.fetch();
        const counts = new Map();

        for (const inv of invites.values()) {
          if (!inv.inviter || !inv.uses) continue;
          const current = counts.get(inv.inviter.id) || 0;
          counts.set(inv.inviter.id, current + inv.uses);
        }

        const sorted = [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);

        if (!sorted.length) {
          return interaction.editReply({
            embeds: [response({ client: interaction.client, description: 'No invite data available.', color: colors.muted })],
          });
        }

        const desc = sorted
          .map(([id, count], i) => `\`${i + 1}.\` <@${id}> — **${count}** invite${count !== 1 ? 's' : ''}`)
          .join('\n');

        const embed = base(interaction.client, colors.primary)
          .setAuthor({ name: `Invite Leaderboard — ${interaction.guild.name}` })
          .setDescription(desc);

        return interaction.editReply({ embeds: [embed] });
      } catch {
        return interaction.editReply({
          embeds: [response({ client: interaction.client, description: 'Failed to fetch invites.', color: colors.error })],
        });
      }
    }

    // ── /invites reset [user] ──────────────────────────────────────
    if (sub === 'reset') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
          embeds: [response({ client: interaction.client, description: 'You need **Manage Server** to reset invites.', color: colors.error })],
          ephemeral: true,
        });
      }

      const target = interaction.options.getUser('user');

      if (target) {
        inviteStore.resetUser(interaction.guild.id, target.id);
        return interaction.reply({
          embeds: [response({ client: interaction.client, description: `Reset invites for ${target}`, color: colors.success })],
        });
      }

      inviteStore.resetGuild(interaction.guild.id);
      return interaction.reply({
        embeds: [response({ client: interaction.client, description: 'All invite counts reset.', color: colors.success })],
      });
    }
  },
};
