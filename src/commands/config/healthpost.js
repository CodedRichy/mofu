const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const stats = require('../../database/healthstats');
const run = require('../../utils/healthpostRun');
const H = require('../../utils/healthpost');

const MAX_HELP = 10;
const MAX_EXCLUDED = 50;
const TEXT = ChannelType.GuildText;

// Weekly community health post. Default OFF per server. Prefix command (the manager registers it).
module.exports = {
  data: new SlashCommandBuilder()
    .setName('healthpost')
    .setDescription('Weekly community health post from counts only (for servers without Server Insights)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('on').setDescription('Turn the weekly post on'))
    .addSubcommand((s) => s.setName('off').setDescription('Turn the weekly post off'))
    .addSubcommand((s) =>
      s.setName('channel').setDescription('Channel the weekly post goes to')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel for the post').setRequired(true).addChannelTypes(TEXT)))
    .addSubcommand((s) =>
      s.setName('helpadd').setDescription('Track unanswered questions in a help channel')
        .addChannelOption((o) => o.setName('channel').setDescription('Help channel').setRequired(true).addChannelTypes(TEXT)))
    .addSubcommand((s) =>
      s.setName('helpremove').setDescription('Stop tracking questions in a help channel')
        .addChannelOption((o) => o.setName('channel').setDescription('Help channel').setRequired(true).addChannelTypes(TEXT)))
    .addSubcommand((s) =>
      s.setName('excludeadd').setDescription('Leave a channel out of the quiet channel list')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel to leave out').setRequired(true).addChannelTypes(TEXT)))
    .addSubcommand((s) =>
      s.setName('excluderemove').setDescription('Put a channel back in the quiet channel list')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel to include again').setRequired(true).addChannelTypes(TEXT)))
    .addSubcommand((s) => s.setName('status').setDescription('Show the settings'))
    .addSubcommand((s) => s.setName('preview').setDescription('Post the report for the last week in this channel now')),

  async execute(interaction) {
    const { guild } = interaction;
    const reply = (description, color = colors.primary) =>
      interaction.reply({ embeds: [response({ client: interaction.client, description, color })], ephemeral: true });

    const perms = interaction.member?.permissions;
    if (!perms || !(perms.has('ManageGuild') || perms.has('Administrator'))) {
      return reply('You need the Manage Server permission to change the health post.', colors.error);
    }

    const sub = interaction.options.getSubcommand();
    const cfg = stats.getConfig(guild.id);

    if (sub === 'on') {
      if (!cfg.channelId) return reply('Pick a channel first with the channel option, then turn it on.', colors.error);
      // `since` marks when counting began, so the first post says so if it covers less than a full week.
      stats.setConfig(guild.id, { enabled: true, since: cfg.enabled ? cfg.since : Date.now(), lastPostAt: cfg.enabled ? cfg.lastPostAt : null });
      return reply(`Weekly health post is **on**, going to <#${cfg.channelId}>. Counting starts now and the first post comes after ${H.WINDOW_DAYS} days.`, colors.success);
    }
    if (sub === 'off') {
      stats.setConfig(guild.id, { enabled: false });
      return reply('Weekly health post is **off**. Counting is off. Counts already stored are removed by the retention schedule.', colors.muted);
    }

    if (sub === 'channel') {
      const ch = interaction.options.getChannel('channel');
      if (!ch) return reply('I could not find that channel.', colors.error);
      stats.setConfig(guild.id, { channelId: ch.id });
      return reply(`The weekly post will go to <#${ch.id}>.`, colors.success);
    }

    if (sub === 'helpadd' || sub === 'helpremove' || sub === 'excludeadd' || sub === 'excluderemove') {
      const ch = interaction.options.getChannel('channel');
      if (!ch) return reply('I could not find that channel.', colors.error);
      const isHelp = sub.startsWith('help');
      const key = isHelp ? 'helpChannels' : 'excluded';
      const cap = isHelp ? MAX_HELP : MAX_EXCLUDED;
      const set = new Set(cfg[key]);
      if (sub.endsWith('add')) {
        if (!set.has(ch.id) && set.size >= cap) return reply(`That list is full (${cap} channels). Remove one first.`, colors.error);
        set.add(ch.id);
      } else set.delete(ch.id);
      const next = stats.setConfig(guild.id, { [key]: [...set] });
      const list = next[key].length ? next[key].map((id) => `<#${id}>`).join(' ') : 'none';
      return reply(`${isHelp ? 'Help channels' : 'Left out of the quiet list'}: ${list}`, colors.success);
    }

    if (sub === 'preview') {
      // Counts so far, rendered the same way as the weekly post, in the channel the command was used in.
      const embed = run.embedForGuild(interaction.client, guild);
      return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    }

    // status
    const fmt = (ids) => (ids.length ? ids.map((id) => `<#${id}>`).join(' ') : 'none');
    const lines = [
      `**Weekly health post** ${cfg.enabled ? 'on' : 'off'}`,
      `**Post channel** ${cfg.channelId ? `<#${cfg.channelId}>` : 'not set'}`,
      `**Help channels** ${fmt(cfg.helpChannels)}`,
      `**Left out of the quiet list** ${fmt(cfg.excluded)}`,
      'Counts only: joins, leaves, messages per channel per day, and for help channels a message id, a time and whether someone replied. No message text, no DMs, no automatic actions.',
      'A question is a message ending with a question mark in a help channel. It counts as answered when someone else uses Discord reply on it.',
    ];
    return reply(lines.join('\n'), cfg.enabled ? colors.success : colors.muted);
  },
};
