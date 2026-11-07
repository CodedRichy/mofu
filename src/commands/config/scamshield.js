const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const duration = require('../../utils/duration');
const shield = require('../../utils/scamshield');
const qrscan = require('../../utils/qrscan');

// Scam shield settings. Default OFF per server. Prefix command (the manager registers it).
module.exports = {
  data: new SlashCommandBuilder()
    .setName('scamshield')
    .setDescription('Catch hijacked-account scam waves, login QR scams and staff lookalikes')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('on').setDescription('Turn the scam shield on'))
    .addSubcommand((s) => s.setName('off').setDescription('Turn the scam shield off'))
    .addSubcommand((s) => s.setName('status').setDescription('Show the scam shield settings'))
    .addSubcommand((s) =>
      s.setName('timeout').setDescription('How long a flagged account is timed out')
        .addStringOption((o) => o.setName('length').setDescription('Length, e.g. 30m, 1h, 1d').setRequired(true)))
    .addSubcommand((s) =>
      s.setName('trust').setDescription('Ignore members holding a role (trusted meme posters)')
        .addRoleOption((o) => o.setName('role').setDescription('Role to trust').setRequired(true)))
    .addSubcommand((s) =>
      s.setName('untrust').setDescription('Stop ignoring a role')
        .addRoleOption((o) => o.setName('role').setDescription('Role to remove').setRequired(true))),

  async execute(interaction) {
    const { guild } = interaction;
    const reply = (description, color = colors.primary) =>
      interaction.reply({ embeds: [response({ client: interaction.client, description, color })], ephemeral: true });

    const perms = interaction.member?.permissions;
    if (!perms || !(perms.has('ManageGuild') || perms.has('Administrator'))) {
      return reply('You need the Manage Server permission to change the scam shield.', colors.error);
    }

    const sub = interaction.options.getSubcommand();
    const cfg = shield.getConfig(guild.id);

    if (sub === 'on' || sub === 'off') {
      shield.setConfig(guild.id, { enabled: sub === 'on' });
      return reply(sub === 'on'
        ? 'Scam shield is **on**. Staff with Manage Messages and trusted roles are ignored. Flagged accounts are timed out, not banned.'
        : 'Scam shield is **off**.', sub === 'on' ? colors.success : colors.muted);
    }

    if (sub === 'timeout') {
      const ms = duration.parse(String(interaction.options.getString('length') || '').trim());
      if (!ms || ms < shield.MIN_TIMEOUT_MS || ms > shield.MAX_TIMEOUT_MS) {
        return reply(`Pick a length between ${duration.format(shield.MIN_TIMEOUT_MS)} and ${duration.format(shield.MAX_TIMEOUT_MS)}, for example \`30m\` or \`1h\`.`, colors.error);
      }
      shield.setConfig(guild.id, { timeoutMs: ms });
      return reply(`Flagged accounts will be timed out for **${duration.format(ms)}**.`, colors.success);
    }

    if (sub === 'trust' || sub === 'untrust') {
      const role = interaction.options.getRole('role');
      if (!role) return reply('I could not find that role.', colors.error);
      const set = new Set(cfg.trustedRoles);
      if (sub === 'trust') set.add(role.id); else set.delete(role.id);
      const next = shield.setConfig(guild.id, { trustedRoles: [...set] });
      return reply(`${sub === 'trust' ? 'Now ignoring' : 'No longer ignoring'} ${role}. Trusted roles: ${next.trustedRoles.length ? next.trustedRoles.map((id) => `<@&${id}>`).join(' ') : 'none'}.`, colors.success);
    }

    // status
    const lines = [
      `**Scam shield** ${cfg.enabled ? 'on' : 'off'}`,
      `**Burst rule** same text or file in ${shield.BURST_CHANNELS}+ channels within ${duration.format(shield.BURST_WINDOW_MS)}: copies deleted, member timed out`,
      `**Timeout** ${duration.format(cfg.timeoutMs)}`,
      `**Login QR scans** ${qrscan.available() ? 'on' : 'unavailable (jsqr package not installed); remote-auth links in text are still caught'}`,
      '**Staff lookalike alerts** modlog only, no action',
      `**Ignored** members with Manage Messages or higher${cfg.trustedRoles.length ? `, plus ${cfg.trustedRoles.map((id) => `<@&${id}>`).join(' ')}` : ''}`,
      'No AI is used. Only hashes and timestamps are kept in memory, not message text or image bytes.',
    ];
    return reply(lines.join('\n'), cfg.enabled ? colors.success : colors.muted);
  },
};
