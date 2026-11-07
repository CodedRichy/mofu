const store = require('../database/store');
const vm = require('../database/voicemaster');
const { response } = require('../utils/embed');
const { colors } = require('../utils/constants');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const voicecase = require('../utils/voicecase');
const voiceguard = require('../utils/voiceguard');
const log = require('../utils/logger');

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    const guild = newState.guild;

    // Voice case file: ids and timestamps only (mofu never hears audio). Must never break the handlers below.
    try {
      if (!newState.member?.user?.bot) voicecase.recordStates(guild.id, newState.id, oldState, newState);
      const finding = voiceguard.observe(oldState, newState);
      if (finding) voiceguard.propose(finding).catch((err) => log.warn(`voiceguard propose failed: ${err.message}`));
    } catch (err) {
      log.warn(`voice case record failed: ${err.message}`);
    }

    // VoiceMaster: join-to-create
    if (newState.channelId) {
      const joinId = vm.getJoinChannelId(guild.id);
      if (joinId && newState.channelId === joinId) {
        const categoryId = vm.getCategoryId(guild.id);
        const member = newState.member;

        try {
          const channel = await guild.channels.create({
            name: `${member.displayName}'s channel`,
            type: ChannelType.GuildVoice,
            parent: categoryId || null,
            permissionOverwrites: [
              {
                id: member.id,
                allow: [
                  PermissionFlagsBits.ManageChannels,
                  PermissionFlagsBits.MuteMembers,
                  PermissionFlagsBits.DeafenMembers,
                  PermissionFlagsBits.MoveMembers,
                ],
              },
            ],
          });

          await member.voice.setChannel(channel).catch(() => {});
          vm.registerChannel(channel.id, member.id);
        } catch {
          // Missing permissions to create channel
        }
      }
    }

    // VoiceMaster: auto-delete empty channels
    if (oldState.channelId && oldState.channelId !== newState.channelId) {
      if (vm.isVoiceMasterChannel(oldState.channelId)) {
        const oldChannel = guild.channels.cache.get(oldState.channelId);
        if (oldChannel && oldChannel.members.size === 0) {
          vm.unregisterChannel(oldState.channelId);
          await oldChannel.delete().catch(() => {});
        }
      }
    }

    // Transfer ownership if owner leaves but channel not empty
    if (oldState.channelId && oldState.channelId !== newState.channelId) {
      if (vm.isVoiceMasterChannel(oldState.channelId)) {
        const owner = vm.getOwner(oldState.channelId);
        if (owner === oldState.member.id) {
          const oldChannel = guild.channels.cache.get(oldState.channelId);
          if (oldChannel && oldChannel.members.size > 0) {
            const newOwner = oldChannel.members.first();
            vm.setOwner(oldState.channelId, newOwner.id);
          }
        }
      }
    }

    // Voice logging
    const logCh = store.getConfig(guild.id, 'log_channel');
    if (!logCh || store.getConfig(guild.id, 'log_voice') === false) return;

    const ch = guild.channels.cache.get(logCh);
    if (!ch) return;

    const member = newState.member;
    let desc;

    if (!oldState.channelId && newState.channelId) {
      desc = `**${member.user.tag}** joined voice channel ${newState.channel}`;
    } else if (oldState.channelId && !newState.channelId) {
      desc = `**${member.user.tag}** left voice channel ${oldState.channel}`;
    } else if (oldState.channelId !== newState.channelId) {
      desc = `**${member.user.tag}** moved from ${oldState.channel} to ${newState.channel}`;
    } else {
      return;
    }

    const embed = response({ client: guild.client, description: desc, color: colors.info })
      .setTimestamp();
    ch.send({ embeds: [embed] }).catch(() => {});
  },
};
