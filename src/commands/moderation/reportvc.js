const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response, base } = require('../../utils/embed');
const modlog = require('../../utils/modlog');
const vc = require('../../utils/voicecase');
const { joinClipped } = require('../../utils/modguard');

// Prefix usage:  ;reportvc [#channel] [@member] [note]   (alias: vcreport)
// Files a numbered case with a snapshot of who is in the voice channel and the last minutes of joins, leaves,
// moves and toggles. mofu never hears audio, so this is a list of ids and times, not a recording.

const err = (i, description) => i.reply({ embeds: [response({ client: i.client, description, color: colors.error })], ephemeral: true });

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reportvc')
    .setDescription('Report a voice channel to the moderators with a snapshot of who is in it')
    .addChannelOption((o) => o.setName('channel').setDescription('Voice channel (defaults to the one you are in)')
      .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
    .addUserOption((o) => o.setName('user').setDescription('Member you are reporting (optional)'))
    .addStringOption((o) => o.setName('note').setDescription('What is happening (optional)').setMaxLength(200)),

  async execute(interaction) {
    const { guild } = interaction;
    if (!guild) return err(interaction, 'Use this in a server.');
    const member = interaction.member;
    const channel = interaction.options.getChannel('channel') || member?.voice?.channel;
    if (!channel) return err(interaction, 'Join the voice channel first, or name it: `reportvc #channel`.');
    if (!channel.isVoiceBased?.()) return err(interaction, 'That is not a voice channel.');
    if (!channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)) return err(interaction, "You can't see that channel.");

    const now = Date.now();
    const events = vc.buffer.snapshot(guild.id, channel.id, now);
    const present = [...channel.members.values()];
    if (!present.length && !events.length) return err(interaction, 'Nobody is in that channel and nothing was recorded there recently.');

    if (!vc.reportLimiter.take(`${guild.id}:${member.id}`, now)) {
      return err(interaction, `You can file ${vc.reportLimiter.max} reports every ${Math.round(vc.reportLimiter.windowMs / 60000)} minutes. Try again later.`);
    }

    const suspect = interaction.options.getUser('user');
    const note = interaction.options.getString('note');
    const snap = vc.compactSnapshot({
      channelId: channel.id, at: now, memberIds: present.map((m) => m.id), events, note,
    });
    const caseId = modlog.openCase(guild, {
      action: 'voice_report', target: suspect || undefined, moderator: interaction.user, reason: snap.json,
    });

    const timeline = vc.renderTimeline(events, 25);
    const embed = base(interaction.client, colors.warning)
      .setAuthor({ name: `VOICE REPORT${caseId ? ` | Case #${caseId}` : ''}` })
      .setDescription([
        `**Channel** <#${channel.id}> \`${channel.id}\``,
        `**Reported by** ${interaction.user.tag} \`${interaction.user.id}\``,
        suspect ? `**Member reported** <@${suspect.id}> \`${suspect.id}\`` : null,
        note ? `**Note** ${note.replace(/@(everyone|here)/gi, '$1').slice(0, 200)}` : null,
        `**In the channel now** ${present.length}`,
      ].filter(Boolean).join('\n'))
      .addFields(
        { name: 'Members in the channel', value: joinClipped(present.map((m) => `<@${m.id}>`), 1000, ', ') || 'Nobody' },
        { name: 'Recent activity', value: joinClipped(timeline, 1000) || 'Nothing recorded recently' },
      )
      .setFooter({ text: vc.NO_AUDIO_NOTE, iconURL: interaction.client.user?.displayAvatarURL?.() || undefined });

    const store = require('../../database/store');
    const logChannel = guild.channels.cache.get(store.getConfig(guild.id, 'modlog_channel'));
    let posted = false;
    if (logChannel) {
      const msg = await logChannel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
      if (msg) {
        posted = true;
        if (caseId) { try { require('../../database/infractions').attachLogMessage(guild.id, caseId, logChannel.id, msg.id); } catch { /* ignore */ } }
      }
    }

    const text = posted
      ? `Report sent to the moderators${caseId ? ` as case #${caseId}` : ''}.`
      : `Report saved${caseId ? ` as case #${caseId}` : ''}, but this server has no modlog channel I can post in, so moderators will not see it until they look up the case.`;
    await interaction.reply({ embeds: [response({ client: interaction.client, description: text, color: posted ? colors.success : colors.warning })], ephemeral: true });
  },
};
