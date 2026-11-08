const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const bdStore = require('../../database/birthday');
const { createConfigChannel, CHANNEL_DEFAULTS } = require('../../utils/channelCreate');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Birthday system')
    .addSubcommand((s) =>
      s.setName('set')
        .setDescription('Set your birthday')
        .addIntegerOption((o) => o.setName('month').setDescription('Month (1-12)').setRequired(true).setMinValue(1).setMaxValue(12))
        .addIntegerOption((o) => o.setName('day').setDescription('Day (1-31)').setRequired(true).setMinValue(1).setMaxValue(31))
    )
    .addSubcommand((s) => s.setName('remove').setDescription('Remove your birthday'))
    .addSubcommand((s) =>
      s.setName('channel')
        .setDescription('Set birthday announcement channel')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel for announcements').setRequired(true).addChannelTypes(ChannelType.GuildText))
    )
    .addSubcommand((s) => s.setName('list').setDescription('View upcoming birthdays'))
    .addSubcommand((s) =>
      s.setName('view')
        .setDescription("View someone's birthday")
        .addUserOption((o) => o.setName('user').setDescription('User to check').setRequired(true))
    )
    .addSubcommand((s) => s.setName('create').setDescription('Create a #birthday-announcements channel and set it up')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild, user } = interaction;

    if (sub === 'set') {
      const month = interaction.options.getInteger('month');
      const day = interaction.options.getInteger('day');
      const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (day > daysInMonth[month - 1]) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `${MONTHS[month - 1]} only has ${daysInMonth[month - 1]} days.`, color: colors.error })], ephemeral: true });
      }

      bdStore.setBirthday(guild.id, user.id, month, day);
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `Birthday set to **${MONTHS[month - 1]} ${day}**`, color: colors.success })] });
    }

    if (sub === 'remove') {
      bdStore.removeBirthday(guild.id, user.id);
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Birthday removed.', color: colors.muted })] });
    }

    if (sub === 'channel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'You need **Manage Server** permission.', color: colors.error })], ephemeral: true });
      }
      const ch = interaction.options.getChannel('channel');
      const existing = bdStore.getChannel(guild.id);
      if (existing === ch.id) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `Birthday channel is already set to ${ch}`, color: colors.warning })], ephemeral: true });
      }
      bdStore.setChannel(guild.id, ch.id);
      const msg = existing ? `Birthday channel updated to ${ch} (was <#${existing}>)` : `Birthdays will be announced in ${ch}, once a day shortly after midnight UTC.`;
      return interaction.reply({ embeds: [response({ client: interaction.client, description: msg, color: colors.success })] });
    }

    if (sub === 'list') {
      const all = bdStore.listAll(guild.id);
      if (!all.length) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'No birthdays registered.', color: colors.muted })], ephemeral: true });
      }

      const now = new Date();
      const sorted = all
        .map((b) => {
          let next = new Date(now.getFullYear(), b.month - 1, b.day);
          if (next < now) next.setFullYear(next.getFullYear() + 1);
          return { ...b, next };
        })
        .sort((a, b) => a.next - b.next)
        .slice(0, 15);

      const desc = sorted.map((b) => `<@${b.userId}> — **${MONTHS[b.month - 1]} ${b.day}**`).join('\n');
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `**Upcoming Birthdays**\n\n${desc}`, color: colors.primary })] });
    }

    if (sub === 'view') {
      const target = interaction.options.getUser('user');
      const bd = bdStore.getBirthday(guild.id, target.id);
      if (!bd) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `${target} hasn't set a birthday.`, color: colors.muted })], ephemeral: true });
      }
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `${target}'s birthday is **${MONTHS[bd.month - 1]} ${bd.day}**`, color: colors.primary })] });
    }

    if (sub === 'create') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'You need **Manage Server** permission.', color: colors.error })], ephemeral: true });
      }
      const defaults = CHANNEL_DEFAULTS.birthday_channel;
      const ch = await createConfigChannel(guild, { ...defaults, client: interaction.client });
      if (!ch) return interaction.reply({ embeds: [response({ client: interaction.client, description: "Couldn't create channel. Make sure I have **Manage Channels** permission.", color: colors.error })], ephemeral: true });
      bdStore.setChannel(guild.id, ch.id);
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `Created ${ch} and set as birthday announcement channel.`, color: colors.success })] });
    }
  },
};
