const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const { colors } = require('./constants');

function brand(client) {
  return {
    text: 'sonder',
    iconURL: client?.user?.displayAvatarURL?.() || undefined,
  };
}

function base(client, color) {
  return new EmbedBuilder()
    .setColor(color || colors.primary)
    .setFooter(brand(client))
    .setTimestamp();
}

function modAction({ client, action, color, target, moderator, reason, duration, extra }) {
  const embed = base(client, color)
    .setAuthor({
      name: action.toUpperCase(),
      iconURL: target.displayAvatarURL?.(),
    })
    .setThumbnail(target.displayAvatarURL?.({ size: 256 }) || null);

  const lines = [
    `**Member** ${target.tag || target.user?.tag} \`${target.id}\``,
    `**Moderator** ${moderator.tag} \`${moderator.id}\``,
    `**Reason** ${reason || 'No reason provided'}`,
  ];

  if (duration) lines.push(`**Duration** ${duration}`);
  if (extra) lines.push(`**Details** ${extra}`);

  embed.setDescription(lines.join('\n'));
  return embed;
}

function dmNotice({ guild, action, reason, color, duration }) {
  const lines = [`You have been **${action}** in **${guild.name}**`];
  if (duration) lines.push(`**Duration** ${duration}`);
  lines.push(`**Reason** ${reason || 'No reason provided'}`);

  return new EmbedBuilder()
    .setColor(color)
    .setDescription(lines.join('\n'))
    .setFooter(brand(guild.client))
    .setTimestamp();
}

function response({ client, description, color }) {
  return base(client, color || colors.primary).setDescription(description);
}

function errorCard({ client, title, fix, ref }) {
  const embed = base(client, colors.error).setDescription(`**${title}**
${fix}`);
  if (ref) embed.setFooter({ ...brand(client), text: `ref ${ref} - sonder` });
  return embed;
}

function refId() {
  return Math.random().toString(36).slice(2, 8);
}

// "You need Ban Members for /ban. Ask an admin for a role that has it."
function permissionDenied(client, command) {
  let names = [];
  try {
    const bits = command?.data?.default_member_permissions;
    if (bits) {
      names = new PermissionsBitField(BigInt(bits)).toArray()
        .map((n) => n.replace(/([a-z])([A-Z])/g, '$1 $2'));
    }
  } catch { /* fall through to the generic wording */ }
  const name = command?.data?.name;
  const fix = names.length
    ? `You need ${names.join(' and ')}${name ? ` for /${name}` : ''}. Ask an admin for a role with it.`
    : 'You do not have permission to use this command. Ask an admin for access.';
  return errorCard({ client, title: 'Missing permission', fix });
}

module.exports = { base, modAction, dmNotice, response, brand, errorCard, refId, permissionDenied };
