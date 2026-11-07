const { SlashCommandBuilder, PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');

// The permissions mofu asks for when it is added, each with the feature that needs it. This is the minimum the
// code uses: no Administrator, and nothing for features a server can opt into later (see NOT_REQUESTED).
// Add a line here only when a feature really needs it.
const PERMISSIONS = Object.freeze([
  ['ViewChannel', 'see the channels it works in'],
  ['SendMessages', 'reply to commands and chat'],
  ['SendMessagesInThreads', 'reply inside threads'],
  ['EmbedLinks', 'post embed cards'],
  ['AttachFiles', 'attach rank, welcome and backup files'],
  ['ReadMessageHistory', 'read the last few messages for chat replies and purge'],
  ['AddReactions', 'reaction roles and starboard'],
  ['ManageMessages', 'purge, sticky messages and automod deletes'],
  ['ModerateMembers', 'timeouts (mute)'],
  ['KickMembers', 'kick'],
  ['BanMembers', 'ban, tempban, softban and unban'],
  ['ManageRoles', 'autorole, role panels, jail and mute roles'],
  ['ManageChannels', 'lock, tickets, jail and VoiceMaster channels'],
  ['ManageNicknames', 'the nickname command'],
  ['ViewAuditLog', 'the audit log feed and who-did-it lookups'],
  ['Connect', 'join voice for music and voice XP'],
  ['Speak', 'play music'],
  ['MoveMembers', 'VoiceMaster and drag'],
  ['MuteMembers', 'VoiceMaster channel controls'],
  ['DeafenMembers', 'VoiceMaster channel controls'],
]);

// Left out on purpose. The matching feature reports what it is missing instead of failing silently.
const NOT_REQUESTED = Object.freeze([
  ['Administrator', 'mofu does not need it'],
  ['ManageGuild', 'invite tracking; add it only if you want that'],
  ['ManageGuildExpressions', 'copying emoji and stickers; add it only if you use those commands'],
  ['ManageThreads', 'thread watch; add it only if you use it'],
]);

const SCOPES = Object.freeze(['bot', 'applications.commands']);

function permissionBits() {
  return new PermissionsBitField(PERMISSIONS.map(([name]) => PermissionFlagsBits[name]));
}

function buildInviteUrl(clientId) {
  const id = String(clientId ?? '').replace(/\D/g, '');
  if (!id) return null;
  const params = new URLSearchParams({
    client_id: id,
    scope: SCOPES.join(' '),
    permissions: permissionBits().bitfield.toString(),
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function describe() {
  const asked = PERMISSIONS.map(([name, why]) => `**${name}**: ${why}`).join('\n');
  const skipped = NOT_REQUESTED.map(([name, why]) => `**${name}**: ${why}`).join('\n');
  return { asked, skipped };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Get the link to add mofu to a server, with the permissions it asks for and why'),

  PERMISSIONS,
  NOT_REQUESTED,
  SCOPES,
  permissionBits,
  buildInviteUrl,
  describe,

  async execute(interaction) {
    const url = buildInviteUrl(interaction.client.user?.id || interaction.client.application?.id);
    if (!url) {
      return interaction.reply({
        embeds: [response({ client: interaction.client, description: 'I could not build the invite link right now.', color: colors.error })],
        ephemeral: true,
      });
    }
    const { asked, skipped } = describe();
    const text = [
      `**[Add mofu to a server](${url})**`,
      'These are the permissions it asks for and what each is used for. You can change any of them in your server settings; a feature that lacks one reports it when it cannot run.',
      asked,
      `**Not requested**\n${skipped}`,
    ].join('\n\n');
    await interaction.reply({
      embeds: [response({ client: interaction.client, description: text, color: colors.primary })],
    });
  },
};
