const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const { clip } = require('../../utils/modguard');
const store = require('../../database/store');
const lv = require('../../utils/xp');

const reply = (i, description, color, ephemeral = false) =>
  i.reply({ embeds: [response({ client: i.client, description, color })], ephemeral, allowedMentions: { parse: [] } });
const fail = (i, description) => reply(i, description, colors.error, true);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('levelup')
    .setDescription('Configure level-up announcements')
    .addSubcommand((sub) => sub.setName('channel').setDescription('Where level-ups are announced')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel (leave empty = the channel the member was talking in)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((sub) => sub.setName('message').setDescription('Custom level-up text: {user} {level} {server}, or "reset"')
      .addStringOption((o) => o.setName('text').setDescription('e.g. GG {user}, you reached level {level}!  ("reset" = default card)').setRequired(true).setMaxLength(lv.LIMITS.MESSAGE_MAX)))
    .addSubcommand((sub) => sub.setName('toggle').setDescription('Turn level-up announcements on or off (XP and rewards keep working)')
      .addStringOption((o) => o.setName('state').setDescription('On or off').setRequired(true).addChoices(
        { name: 'On', value: 'on' },
        { name: 'Off', value: 'off' },
      )))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;

    if (sub === 'channel') {
      const channel = interaction.options.getChannel('channel');
      if (!channel) {
        store.setConfig(guild.id, lv.KEYS.channel, null);
        return reply(interaction, 'Level-ups will be announced in the channel the member was talking in. Voice level-ups are not announced without a channel.', colors.info);
      }
      if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) return fail(interaction, 'Pick a text or announcement channel.');
      const me = guild.members.me;
      const perms = me ? channel.permissionsFor(me) : null;
      if (perms && !perms.has(['ViewChannel', 'SendMessages'])) return fail(interaction, `I can't send messages in <#${channel.id}>. Give me View Channel and Send Messages there first.`);
      store.setConfig(guild.id, lv.KEYS.channel, channel.id);
      return reply(interaction, `Level-ups will be announced in <#${channel.id}>.`, colors.success);
    }

    if (sub === 'message') {
      const raw = interaction.options.getString('text');
      if (typeof raw === 'string' && /^(reset|default|clear|none)$/i.test(raw.trim())) {
        store.setConfig(guild.id, lv.KEYS.message, null);
        return reply(interaction, 'Level-ups use the default card again.', colors.success);
      }
      const t = lv.cleanTemplate(raw);
      if (t.error) return fail(interaction, t.error);
      store.setConfig(guild.id, lv.KEYS.message, t.value);
      const preview = lv.renderLevelUpMessage(t.value, { userId: interaction.user.id, level: 5, serverName: guild.name });
      return reply(interaction, `Level-up message saved. Preview:\n\n${clip(preview, 3500)}`, colors.success);
    }

    // toggle
    const on = interaction.options.getString('state') === 'on';
    store.setConfig(guild.id, lv.KEYS.announce, on ? null : false);
    return reply(interaction, on ? 'Level-up announcements **on**.' : 'Level-up announcements **off**. Members still earn XP and level rewards.', on ? colors.success : colors.muted);
  },
};
