const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response } = require('../../utils/embed');
const infractions = require('../../database/infractions');
const { clip, reasonError, modLabel } = require('../../utils/modguard');

const MAX_CASE = 1e9;

function caseEmbed(client, c) {
  const created = Math.floor(c.created_at / 1000);
  const lines = [
    `**Action** ${clip(c.action, 40)}${c.status === 'void' ? ' *(void: the action did not go through)*' : ''}`,
    `**Member** ${c.target_tag ? clip(c.target_tag, 100) : 'unknown'}${c.target_id ? ` \`${c.target_id}\`` : ''}`,
    `**Moderator** ${c.moderator_tag ? clip(c.moderator_tag, 100) : modLabel(c.moderator_id)}${c.moderator_id ? ` \`${c.moderator_id}\`` : ''}`,
    `**Reason** ${clip(c.reason || 'No reason provided', 1024)}`,
  ];
  if (c.duration) lines.push(`**Duration** ${clip(c.duration, 40)}`);
  lines.push(`**When** <t:${created}:f> (<t:${created}:R>)`);
  if (c.updated_at && c.updated_by) lines.push(`**Edited** <t:${Math.floor(c.updated_at / 1000)}:R> by <@${c.updated_by}>`);
  if (c.log_channel_id && c.log_message_id) lines.push(`**Log** https://discord.com/channels/${c.guild_id}/${c.log_channel_id}/${c.log_message_id}`);
  return base(client, c.status === 'void' ? colors.muted : colors.primary)
    .setAuthor({ name: `Case #${c.case_id}` })
    .setDescription(lines.join('\n'));
}

// Rewrite the "**Reason** ..." line of the modlog post this case produced, if it still exists.
async function editLogPost(guild, c) {
  if (!c.log_channel_id || !c.log_message_id) return false;
  try {
    const ch = guild.channels.cache.get(c.log_channel_id);
    const msg = ch?.messages ? await ch.messages.fetch(c.log_message_id).catch(() => null) : null;
    const old = msg?.embeds?.[0];
    if (!old || msg.author?.id !== guild.client.user.id) return false;
    const desc = String(old.description || '');
    if (!/\*\*Reason\*\* /.test(desc)) return false;
    const next = desc.replace(/\*\*Reason\*\* [^\n]*/, () => `**Reason** ${clip(c.reason, 1024)}`);
    await msg.edit({ embeds: [EmbedBuilder.from(old).setDescription(next.slice(0, 4096))] });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('View or edit a moderation case')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((s) => s.setName('view').setDescription('Show a case')
      .addIntegerOption((o) => o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1).setMaxValue(MAX_CASE)))
    .addSubcommand((s) => s.setName('reason').setDescription('Change the reason on a case')
      .addIntegerOption((o) => o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1).setMaxValue(MAX_CASE))
      .addStringOption((o) => o.setName('text').setDescription('New reason (max 512)').setRequired(true).setMaxLength(512))),

  async execute(interaction) {
    let sub = interaction.options.getSubcommand();
    let number = interaction.options.getInteger('number');
    // prefix shorthand: ";case 12" means ";case view 12"
    if (/^\d{1,10}$/.test(String(sub || '')) && number === null) { number = Number(sub); sub = 'view'; }
    if (sub !== 'view' && sub !== 'reason') return; // the prefix dispatcher prints usage

    const fail = (description) => interaction.reply({ embeds: [response({ client: interaction.client, description, color: colors.error })], ephemeral: true });
    if (!Number.isInteger(number) || number < 1 || number > MAX_CASE) return fail('Give a case number, e.g. `/case view 12`.');

    const c = infractions.getCase(interaction.guild.id, number);
    if (!c) return fail(`Case #${number} does not exist in this server.`);

    if (sub === 'view') return interaction.reply({ embeds: [caseEmbed(interaction.client, c)] });

    const text = String(interaction.options.getString('text') || '').trim();
    if (!text) return fail('Give the new reason.');
    const err = reasonError(text);
    if (err) return fail(err);
    // The moderator who made the case can fix their own reason; anyone else needs Manage Server.
    const isAuthor = c.moderator_id === interaction.user.id;
    if (!isAuthor && !interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
      return fail('Only the moderator who made this case, or someone with Manage Server, can change its reason.');
    }
    const updated = infractions.setReason(interaction.guild.id, number, text, interaction.user.id);
    if (!updated) return fail(`Case #${number} does not exist in this server.`);
    const edited = await editLogPost(interaction.guild, updated);
    const embed = caseEmbed(interaction.client, updated);
    return interaction.reply({ content: edited ? 'Reason updated (modlog post edited too).' : 'Reason updated.', embeds: [embed], allowedMentions: { parse: [] } });
  },

  _test: { caseEmbed },
};
