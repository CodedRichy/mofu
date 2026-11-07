const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const audit = require('../../database/aiActions');

const ICON = { executed: 'done', cancelled: 'cancelled', expired: 'expired', rejected: 'refused', failed: 'failed', proposed: 'waiting' };

// Who asked mofu to do what in this server, and what happened. Staff-only, shown just to the caller.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('aiactions')
    .setDescription('See what people asked mofu to do in chat, and what happened')
    .addStringOption((o) =>
      o.setName('status').setDescription('Only show one outcome')
        .addChoices(
          { name: 'Done', value: 'executed' },
          { name: 'Refused (permission or hierarchy)', value: 'rejected' },
          { name: 'Cancelled', value: 'cancelled' },
          { name: 'Expired', value: 'expired' },
          { name: 'Failed', value: 'failed' },
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const status = interaction.options.getString('status');
    const rows = audit.recent(interaction.guild.id, 10, status);
    const reply = (description, color) =>
      interaction.reply({ embeds: [response({ client: interaction.client, description, color })], ephemeral: true, allowedMentions: { parse: [] } });

    if (!rows.length) return reply(status ? 'Nothing with that outcome yet.' : 'Nobody has asked mofu to do anything in chat yet.', colors.muted);

    const lines = rows.map((r) => {
      const when = Math.floor(r.created_at / 1000);
      const dur = r.duration_ms ? ` for ${Math.round(r.duration_ms / 60000)}m` : '';
      const note = r.note ? ` (${r.note})` : '';
      return `\`#${r.id}\` **${r.kind}**${dur} <@${r.target_id}> asked by <@${r.invoker_id}> · ${ICON[r.status] || r.status}${note} · <t:${when}:R>\n   reason: ${r.reason || 'none'}`;
    });
    return reply(`**Last ${rows.length} chat actions**\n${lines.join('\n')}`, colors.primary);
  },
};
