const store = require('../database/store');
const antiraid = require('../database/antiraid');
const { response } = require('../utils/embed');
const { colors } = require('../utils/constants');
const log = require('../utils/logger');
const { generateCard } = require('../utils/welcomeCard');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    const { guild } = member;

    const raid = antiraid.check(guild.id, member);
    if (raid.triggered) {
      const action = antiraid.getAction(guild.id);
      // Track the result so the modlog only says Banned/Kicked when Discord accepted it.
      let ok = true;
      if (action === 'ban') {
        await guild.members.ban(member.id, { reason: `[mofu antiraid] ${raid.reason} (${raid.count} joins)` }).catch(() => { ok = false; });
      } else {
        await member.kick(`[mofu antiraid] ${raid.reason} (${raid.count} joins)`).catch(() => { ok = false; });
      }
      const outcome = ok
        ? (action === 'ban' ? 'Banned' : 'Kicked')
        : `${action === 'ban' ? 'Ban' : 'Kick'} failed (check my permissions and role position)`;

      const modlogChannel = store.getConfig(guild.id, 'modlog_channel');
      if (modlogChannel) {
        const ch = guild.channels.cache.get(modlogChannel);
        if (ch) {
          ch.send({
            embeds: [response({
              client: guild.client,
              description: `**Antiraid triggered**\n**User** ${member.user.tag} \`${member.id}\`\n**Reason** ${raid.reason === 'join_flood' ? 'Join flood detected' : 'New account flood detected'}\n**Action** ${outcome}\n**Count** ${raid.count} joins in ${antiraid.WINDOW / 1000}s`,
              color: colors.warning,
            })],
          }).catch(() => {});
        }
      }

      log.warn(`[antiraid] ${raid.reason} in ${guild.name} — ${member.user.tag} ${ok ? `${action}ed` : `${action} failed`}`);
      return;
    }

    // Autoroles
    const autoroles = store.getConfig(guild.id, 'autoroles') || [];
    for (const roleId of autoroles) {
      const role = guild.roles.cache.get(roleId);
      if (role) {
        await member.roles.add(role).catch((err) => log.warn(`Autorole failed for ${roleId}:`, err.message));
      }
    }

    // Welcome message
    const channelId = store.getConfig(guild.id, 'welcome_channel');
    const message = store.getConfig(guild.id, 'welcome_message');
    if (!channelId || !message) return;

    const channel = guild.channels.cache.get(channelId);
    if (!channel) return;

    const formatted = message
      .replace(/{user}/gi, member.toString())
      .replace(/{user\.tag}/gi, member.user.tag)
      .replace(/{server}/gi, guild.name)
      .replace(/{membercount}/gi, guild.memberCount.toString());

    const embed = response({ client: member.client, description: formatted, color: colors.primary })
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }));

    const useCard = store.getConfig(guild.id, 'welcome_card');
    if (useCard) {
      const card = await generateCard(member, 'welcome').catch(() => null);
      await channel.send({ embeds: [embed], files: card ? [card] : [] }).catch(() => {});
    } else {
      await channel.send({ embeds: [embed] }).catch(() => {});
    }
  },
};
