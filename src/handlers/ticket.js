// Ticket claim flow. Wired from interactionCreate: customId 'ticket_claim' -> handleClaim(interaction).
const { PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const store = require('../database/store');
const { response } = require('../utils/embed');
const { colors } = require('../utils/constants');

const claimKey = (channelId) => `ticket_claim_${channelId}`;

// Pure decision. Staff = holds the support role (or, when no role is set, Manage Channels).
// Returns { ok: true } or { ok: false, reason: 'not_staff' | 'already_yours' | 'claimed', by? }.
function decideClaim({ supportRoleId, memberRoleIds = [], canManageChannels = false, claimedBy = null, userId }) {
  const staff = supportRoleId ? memberRoleIds.includes(supportRoleId) : canManageChannels;
  if (!staff) return { ok: false, reason: 'not_staff' };
  if (claimedBy) return { ok: false, reason: claimedBy === userId ? 'already_yours' : 'claimed', by: claimedBy };
  return { ok: true };
}

function denyText(d) {
  if (d.reason === 'not_staff') return 'Only the ticket support team can claim tickets.';
  if (d.reason === 'already_yours') return 'You already claimed this ticket.';
  return `This ticket was already claimed by <@${d.by}>.`;
}

// Close stays; Claim becomes a disabled "Claimed" button.
function claimedRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
    new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claimed').setStyle(ButtonStyle.Secondary).setDisabled(true),
  );
}

function claimedEmbed(original, userId) {
  const e = original ? EmbedBuilder.from(original) : new EmbedBuilder().setColor(colors.primary);
  const fields = (e.data.fields || []).filter((f) => f.name !== 'Claimed by');
  e.setFields(...fields, { name: 'Claimed by', value: `<@${userId}>`, inline: true });
  return e;
}

async function handleClaim(interaction) {
  const { guild, user, channel } = interaction;
  if (!guild || !channel?.name?.startsWith('ticket-')) return;

  const decision = decideClaim({
    supportRoleId: store.getConfig(guild.id, 'ticket_support_role'),
    memberRoleIds: [...(interaction.member?.roles?.cache?.keys?.() || [])],
    canManageChannels: !!interaction.member?.permissions?.has(PermissionFlagsBits.ManageChannels),
    claimedBy: store.getConfig(guild.id, claimKey(channel.id)),
    userId: user.id,
  });
  if (!decision.ok) {
    return interaction.reply({ embeds: [response({ client: interaction.client, description: denyText(decision), color: colors.error })], ephemeral: true });
  }

  // No await between the check above and this write, so two simultaneous clicks cannot both claim.
  store.setConfig(guild.id, claimKey(channel.id), user.id);

  try {
    await interaction.update({
      embeds: [claimedEmbed(interaction.message?.embeds?.[0], user.id)],
      components: [claimedRow()],
      allowedMentions: { parse: [] },
    });
  } catch { /* the message edit failed; the claim is still recorded */ }
  await channel.send({
    embeds: [response({ client: interaction.client, description: `${user} claimed this ticket and will help you from here.`, color: colors.success })],
    allowedMentions: { parse: [] },
  }).catch(() => {});
}

module.exports = { decideClaim, denyText, handleClaim, claimKey };
