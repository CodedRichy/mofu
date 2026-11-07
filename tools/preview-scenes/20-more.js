module.exports = (scene, { client, user }) => {
  const { base, errorCard, permissionDenied, refId } = require('../../src/utils/embed');
  const { colors } = require('../../src/utils/constants');
  const { bar, fmt } = require('../../src/utils/visuals');
  const { PermissionFlagsBits } = require('discord.js');

  scene('Error card', 'REAL builder: errorCard in src/utils/embed.js', () => ({
    embeds: [errorCard({ client, title: 'Could not join voice', fix: 'Join a voice channel first, then run the command again.', ref: refId() })],
  }));
  scene('Permission denied (known perms)', 'REAL builder: permissionDenied in src/utils/embed.js (stub command)', () => ({
    embeds: [permissionDenied(client, { data: { name: 'ban', default_member_permissions: String(PermissionFlagsBits.BanMembers | PermissionFlagsBits.KickMembers) } })],
  }));
  scene('Permission denied (generic)', 'REAL builder: permissionDenied, no permission bits', () => ({ embeds: [permissionDenied(client, { data: { name: 'x' } })] }));

  scene('Rank', 'MOCK mirrored from src/commands/leveling/rank.js (builder not exported; uses real base/bar/fmt)', () => {
    const u = user('member'); const pct = 0.62;
    return { embeds: [base(client, colors.primary)
      .setAuthor({ name: u.tag, iconURL: u.displayAvatarURL() }).setThumbnail(u.displayAvatarURL({ size: 256 }))
      .setDescription(`**Rank** #3 of ${fmt(1204)}\n**Level** 14\n**XP** ${fmt(1860)} / ${fmt(3000)}\n\n${bar(pct, 12)} **${Math.floor(pct * 100)}%**\n${fmt(1140)} XP to level 15`)] };
  });

  const frame = (a, b, c) => '```\n+-----------+\n| ' + a + ' ' + b + ' ' + c + ' |\n+-----------+\n```';
  const slots = (color, a, b, c, text) => ({ embeds: [base(client, color).setAuthor({ name: 'Slots', iconURL: user('member').displayAvatarURL() }).setDescription(`${frame(a, b, c)}\n${text}`)] });
  const SPIN = '\u{1F300}';
  scene('Slots: spinning', 'MOCK mirrored from src/commands/economy/slots.js (stage() is inline)', () => slots(colors.primary, SPIN, SPIN, SPIN, 'Bet **⌬ 500** - spinning...'));
  scene('Slots: win', 'MOCK mirrored from slots.js', () => slots(colors.success, '\u{1F48E}', '\u{1F48E}', '\u{1F48E}', 'You won **⌬ 2,500** (5x)\n**Wallet** `⌬ 9,100`'));
  scene('Slots: jackpot', 'MOCK mirrored from slots.js', () => slots(colors.success, '7️⃣', '7️⃣', '7️⃣', '**JACKPOT!** Triple sevens.\nYou won **⌬ 5,000** (10x)\n**Wallet** `⌬ 11,600`'));
  scene('Slots: loss', 'MOCK mirrored from slots.js', () => slots(colors.error, '\u{1F352}', '\u{1F34B}', '\u{1F347}', 'You lost **⌬ 500**\n**Wallet** `⌬ 6,600`'));

  scene('AI action proposal', 'MOCK mirrored from src/ai/actions.js proposalCard (not exported)', () => ({
    embeds: [base(client, colors.warning).setAuthor({ name: 'AI ACTION PROPOSAL', iconURL: user('x').displayAvatarURL() }).addFields(
      { name: 'Command', value: '```\n/mute @spammer 10m\n```' },
      { name: 'Reason', value: 'spamming links in #general' },
      { name: 'Target', value: '<@1> - Member', inline: true },
      { name: 'Who can confirm', value: 'Only <@2> (needs Moderate Members)', inline: true },
      { name: 'Expires', value: '<t:1:R>', inline: true })],
    components: [{ type: 1, components: [{ type: 2, style: 4, label: 'Mute' }, { type: 2, style: 2, label: 'Cancel' }] }],
  }));
  scene('AI result card', 'MOCK mirrored from src/ai/actions.js resultCard (not exported)', () => ({
    embeds: [base(client, colors.success).setAuthor({ name: 'Muted' }).setDescription('**Action** mute\n**Target** <@1>\n**Duration** 10 minutes').setFooter({ text: 'via Sonder AI', iconURL: client.user.displayAvatarURL() })],
  }));
};
