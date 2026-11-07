const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response, base } = require('../../utils/embed');
const alerts = require('../../utils/alerts');
const db = require('../../database/alerts');
const duration = require('../../utils/duration');

// Free social alerts. Default OFF: a server has no subscriptions until someone adds one. Prefix command (the manager
// registers it): ;alerts add youtube <channel link|@handle|id> #channel
module.exports = {
  data: new SlashCommandBuilder()
    .setName('alerts')
    .setDescription('Post new YouTube uploads and RSS feed items to a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName('add').setDescription('Subscribe a channel to a YouTube channel or an RSS/Atom feed')
        .addStringOption((o) => o.setName('type').setDescription('Where the feed comes from').setRequired(true)
          .addChoices({ name: 'youtube', value: 'youtube' }, { name: 'rss', value: 'rss' }))
        .addStringOption((o) => o.setName('url').setDescription('YouTube channel link, @handle or id; or the feed link').setRequired(true))
        .addChannelOption((o) => o.setName('channel').setDescription('Where to post new items').setRequired(true)))
    .addSubcommand((s) =>
      s.setName('remove').setDescription('Remove a subscription')
        .addIntegerOption((o) => o.setName('id').setDescription('Number from the list').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('Show this server\'s subscriptions'))
    .addSubcommand((s) =>
      s.setName('test').setDescription('Post the newest item of a subscription once, to check the setup')
        .addIntegerOption((o) => o.setName('id').setDescription('Number from the list').setRequired(true))),

  async execute(interaction) {
    const { guild, client } = interaction;
    const reply = (description, color = colors.primary) => {
      const payload = { embeds: [response({ client, description, color })], ephemeral: true };
      return interaction.deferred || interaction.replied ? interaction.editReply(payload) : interaction.reply(payload);
    };

    const perms = interaction.member?.permissions;
    if (!perms || !(perms.has('ManageGuild') || perms.has('Administrator'))) {
      return reply('You need the Manage Server permission to manage alerts.', colors.error);
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const rows = db.list(guild.id);
      if (!rows.length) return reply(`No alerts yet. Add one with \`add youtube <channel> #channel\` or \`add rss <feed link> #channel\`. Each server can have ${alerts.MAX_SUBS_PER_GUILD}.`, colors.muted);
      const lines = rows.map((r) => `**#${r.id}** ${r.kind} to <#${r.channelId}>: ${r.label || r.feedUrl}${r.enabled ? '' : ' (turned off after repeated failures)'}${r.fails && r.enabled ? ` (${r.fails} failed checks in a row)` : ''}`);
      return reply(`${lines.join('\n')}\n\n${rows.length}/${alerts.MAX_SUBS_PER_GUILD} used. Feeds are checked about every ${duration.format(alerts.SWEEP_MS)}.`);
    }

    if (sub === 'remove') {
      const ok = db.remove(guild.id, interaction.options.getInteger('id'));
      return reply(ok ? 'Removed.' : 'No alert with that number. Check `list`.', ok ? colors.success : colors.error);
    }

    if (sub === 'test') {
      const row = db.get(guild.id, interaction.options.getInteger('id'));
      if (!row) return reply('No alert with that number. Check `list`.', colors.error);
      await interaction.deferReply({ ephemeral: true });
      try {
        const { text } = await alerts.fetchText(row.feedUrl);
        const feed = alerts.parseFeed(text);
        const ch = guild.channels.cache.get(row.channelId);
        if (!ch?.send) return reply('The target channel is gone. Remove this alert and add it again.', colors.error);
        const newest = [...feed.entries].sort((a, b) => (b.published ?? 0) - (a.published ?? 0))[0];
        if (!newest) return reply('The feed works but has no items yet.', colors.warning);
        await ch.send({ content: 'Test post (not a new item):', embeds: [alerts.buildEmbed(client, row, newest)], allowedMentions: { parse: [] } });
        return reply(`Posted the newest item to <#${row.channelId}>.`, colors.success);
      } catch (err) {
        return reply(`Could not check that feed: ${String(err.message || err).slice(0, 150)}`, colors.error);
      }
    }

    // add
    const type = interaction.options.getString('type');
    const input = String(interaction.options.getString('url') || '').trim();
    const channel = interaction.options.getChannel('channel');
    if (!channel?.send || channel.isVoiceBased?.()) return reply('Pick a text channel to post in.', colors.error);
    const me = guild.members.me;
    if (me && !channel.permissionsFor(me)?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
      return reply(`I need View Channel, Send Messages and Embed Links in ${channel}.`, colors.error);
    }
    if (db.count(guild.id) >= alerts.MAX_SUBS_PER_GUILD) {
      return reply(`This server already has ${alerts.MAX_SUBS_PER_GUILD} alerts. Remove one first.`, colors.error);
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      let feedUrl;
      if (type === 'youtube') feedUrl = alerts.youtubeFeedUrl(await alerts.resolveYoutube(input));
      else {
        const c = alerts.checkUrl(input);
        if (!c.ok) return reply(c.reason, colors.error);
        feedUrl = c.url;
      }
      const { text } = await alerts.fetchText(feedUrl);
      const feed = alerts.parseFeed(text);
      // Everything already in the feed counts as seen: only items published after this moment are ever posted.
      const res = db.add(guild.id, {
        kind: type, feedUrl, label: feed.title, channelId: channel.id, addedBy: interaction.user?.id,
        seen: alerts.mergeSeen(feed.entries, []),
      }, alerts.MAX_SUBS_PER_GUILD);
      if (!res.ok) {
        return reply(res.reason === 'limit' ? `This server already has ${alerts.MAX_SUBS_PER_GUILD} alerts. Remove one first.` : 'That feed already posts to that channel.', colors.error);
      }
      const e = base(client, colors.success).setTitle(`Alert #${res.id} added`)
        .setDescription(`${feed.title || feedUrl}\nNew items will post in ${channel}. Older items are skipped. Feeds are checked about every ${duration.format(alerts.SWEEP_MS)}. Use \`test ${res.id}\` to see how a post looks.`);
      return interaction.editReply({ embeds: [e] });
    } catch (err) {
      return reply(`Could not add that feed: ${String(err.message || err).slice(0, 150)}`, colors.error);
    }
  },
};
