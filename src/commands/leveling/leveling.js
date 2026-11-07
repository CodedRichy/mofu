const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const store = require('../../database/store');
const lv = require('../../utils/xp');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leveling')
    .setDescription('Configure the XP leveling system')
    .addSubcommand((sub) =>
      sub.setName('toggle').setDescription('Turn XP gain on or off for this server')
        .addStringOption((o) => o.setName('state').setDescription('Enable or disable the leveling system').setRequired(true).addChoices(
          { name: 'On', value: 'on' },
          { name: 'Off', value: 'off' },
        ))
    )
    .addSubcommand((sub) =>
      sub.setName('channel').setDescription('Set where level-up announcements go')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel for announcements (empty = same channel as message)').addChannelTypes(ChannelType.GuildText))
    )
    .addSubcommand((sub) =>
      sub.setName('voice').setDescription('Earn XP for time in voice channels (with at least one other person)')
        .addStringOption((o) => o.setName('state').setDescription('Enable or disable voice XP').setRequired(true).addChoices(
          { name: 'On', value: 'on' },
          { name: 'Off', value: 'off' },
        ))
        .addIntegerOption((o) => o.setName('rate').setDescription(`XP per minute (default ${lv.LIMITS.VOICE_RATE_DEFAULT})`).setMinValue(1).setMaxValue(lv.LIMITS.VOICE_RATE_MAX))
    )
    .addSubcommand((sub) => sub.setName('settings').setDescription('View current leveling settings'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;

    if (sub === 'toggle') {
      const state = interaction.options.getString('state') === 'on';
      store.setConfig(guild.id, 'leveling', state);

      await interaction.reply({
        embeds: [response({ client: interaction.client, description: `Leveling **${state ? 'enabled' : 'disabled'}**`, color: state ? colors.success : colors.muted })],
      });
    } else if (sub === 'channel') {
      const channel = interaction.options.getChannel('channel');
      if (channel) {
        store.setConfig(guild.id, 'levelup_channel', channel.id);
        await interaction.reply({
          embeds: [response({ client: interaction.client, description: `Level-up messages will be sent to ${channel}`, color: colors.success })],
        });
      } else {
        store.setConfig(guild.id, 'levelup_channel', null);
        await interaction.reply({
          embeds: [response({ client: interaction.client, description: 'Level-up messages will be sent in the same channel', color: colors.info })],
        });
      }
    } else if (sub === 'voice') {
      const on = interaction.options.getString('state') === 'on';
      const rate = interaction.options.getInteger('rate');
      if (rate !== null && (!Number.isSafeInteger(rate) || rate < 1 || rate > lv.LIMITS.VOICE_RATE_MAX)) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `Rate must be from 1 to ${lv.LIMITS.VOICE_RATE_MAX} XP per minute.`, color: colors.error })], ephemeral: true });
      }
      store.setConfig(guild.id, lv.KEYS.voiceEnabled, on ? true : null);
      if (rate !== null) store.setConfig(guild.id, lv.KEYS.voiceRate, rate);
      const effective = lv.voiceRate(store.getConfig(guild.id, lv.KEYS.voiceRate));
      await interaction.reply({
        embeds: [response({
          client: interaction.client,
          description: on
            ? `Voice XP **on**: **${effective} XP** per minute for members in voice with at least one other person (not deafened, not muted by staff, not in the AFK channel). Multipliers and no-XP lists apply.`
            : 'Voice XP **off**.',
          color: on ? colors.success : colors.muted,
        })],
      });
    } else {
      const enabled = store.getConfig(guild.id, 'leveling') ?? true;
      const chId = store.getConfig(guild.id, 'levelup_channel');
      const cfg = lv.readConfig(guild.id, store);
      const voiceOn = store.getConfig(guild.id, lv.KEYS.voiceEnabled) === true;
      const announce = (store.getConfig(guild.id, lv.KEYS.announce) ?? true) !== false;
      const custom = store.getConfig(guild.id, lv.KEYS.message);
      const g = lv.validMult(cfg.global, 0, lv.LIMITS.TOTAL_MULT_MAX);
      const lines = [
        `**Leveling** ${enabled ? 'Enabled' : 'Disabled'}`,
        `**Level-up channel** ${chId ? `<#${chId}>` : 'Same channel'}`,
        `**Announcements** ${announce ? 'On' : 'Off'}${custom ? ' (custom message)' : ''}`,
        `**Level rewards** ${cfg.rewards.length}/${lv.LIMITS.REWARDS_MAX} (${cfg.mode})`,
        `**Multipliers** server ${g === null ? 1 : g}x, ${Object.keys(cfg.roleMults).length} role, ${Object.keys(cfg.channelMults).length} channel`,
        `**No-XP** ${cfg.ignoreChannels.length} channel${cfg.ignoreChannels.length === 1 ? '' : 's'}, ${cfg.ignoreRoles.length} role${cfg.ignoreRoles.length === 1 ? '' : 's'}`,
        `**Voice XP** ${voiceOn ? `On (${lv.voiceRate(store.getConfig(guild.id, lv.KEYS.voiceRate))}/min)` : 'Off'}`,
      ];

      await interaction.reply({
        embeds: [response({
          client: interaction.client,
          description: lines.join('\n'),
          color: colors.info,
        })],
      });
    }
  },
};
