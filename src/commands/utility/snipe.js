const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { base, response } = require('../../utils/embed');
const snipeStore = require('../../database/snipe');
const store = require('../../database/store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('snipe')
    .setDescription('View sniped messages, edits, reactions, and purges')
    .addSubcommand((sub) =>
      sub.setName('message')
        .setDescription('View the last deleted message in this channel')
        .addIntegerOption((o) => o.setName('index').setDescription('Which deletion to view (1 = most recent)').setMinValue(1).setMaxValue(10))
    )
    .addSubcommand((sub) =>
      sub.setName('edit')
        .setDescription('View the last edited message in this channel')
        .addIntegerOption((o) => o.setName('index').setDescription('Which edit to view (1 = most recent)').setMinValue(1).setMaxValue(10))
    )
    .addSubcommand((sub) =>
      sub.setName('reaction')
        .setDescription('View the last removed reaction in this channel')
        .addIntegerOption((o) => o.setName('index').setDescription('Which reaction to view (1 = most recent)').setMinValue(1).setMaxValue(10))
    )
    .addSubcommand((sub) =>
      sub.setName('purge')
        .setDescription('View recently purged messages')
    )
    .addSubcommand((sub) =>
      sub.setName('setup')
        .setDescription('Turn sniping on or off for this server (off by default)')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Store deleted/edited messages for 2 hours?').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('clear')
        .setDescription('Clear all snipe data for this channel')
        .addStringOption((o) =>
          o.setName('type').setDescription('Which type to clear').setRequired(true)
            .addChoices(
              { name: 'Deleted', value: 'deleted' },
              { name: 'Edited', value: 'edited' },
              { name: 'Reactions', value: 'reactions' },
              { name: 'Purged', value: 'purged' },
              { name: 'All', value: 'all' },
            )
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // Discord applies default_member_permissions, but server admins can override it: enforce here too.
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'You need **Manage Messages** to use snipe.', color: colors.error })], ephemeral: true });
    }

    if (sub === 'setup') {
      const enabled = interaction.options.getBoolean('enabled');
      store.setConfig(interaction.guild.id, 'snipe_enabled', !!enabled);
      if (!enabled) for (const c of ['clearDeleted', 'clearEdited', 'clearReactions', 'clearPurged']) snipeStore[c](interaction.channel.id);
      return interaction.reply({ embeds: [response({ client: interaction.client, description: enabled ? 'Snipe is **on**. Deleted and edited messages are kept for 2 hours, visible to Manage Messages only.' : 'Snipe is **off**. Nothing is stored.', color: enabled ? colors.success : colors.muted })], ephemeral: true });
    }
    if (sub !== 'clear' && !snipeStore.isEnabled(interaction.guild.id)) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Snipe is off in this server. Turn it on with `/snipe setup`.', color: colors.muted })], ephemeral: true });
    }

    if (sub === 'message') {
      const channel = interaction.channel;
      if (!channel.permissionsFor(interaction.member).has('ViewChannel')) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'You don\'t have access to that channel', color: colors.error })], ephemeral: true });
      }

      const index = (interaction.options.getInteger('index') || 1) - 1;
      const data = snipeStore.getDeleted(channel.id, index);

      if (!data) {
        return interaction.reply({ content: 'Nothing to snipe.', ephemeral: true });
      }

      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: data.author.tag, iconURL: data.author.avatar })
        .setDescription((data.content || '*No text content*').slice(0, 4096))
        .setFooter({ text: `Deleted • ${timeAgo(data.timestamp)}` });

      if (data.attachments.length) {
        embed.addFields({ name: 'Attachments', value: data.attachments.map((u, i) => `[File ${i + 1}](${u})`).join(' ').slice(0, 1024) });
        embed.setImage(data.attachments[0]);
      }

      await interaction.reply({ embeds: [embed] });

    } else if (sub === 'edit') {
      const channel = interaction.channel;
      if (!channel.permissionsFor(interaction.member).has('ViewChannel')) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'You don\'t have access to that channel', color: colors.error })], ephemeral: true });
      }

      const index = (interaction.options.getInteger('index') || 1) - 1;
      const data = snipeStore.getEdited(channel.id, index);

      if (!data) {
        return interaction.reply({ content: 'Nothing to editsnipe.', ephemeral: true });
      }

      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: data.author.tag, iconURL: data.author.avatar })
        .addFields(
          { name: 'Before', value: (data.oldContent || '*empty*').slice(0, 1024) },
          { name: 'After', value: (data.newContent || '*empty*').slice(0, 1024) },
        )
        .setFooter({ text: `Edited • ${timeAgo(data.timestamp)}` });

      await interaction.reply({ embeds: [embed] });

    } else if (sub === 'reaction') {
      const channel = interaction.channel;
      if (!channel.permissionsFor(interaction.member).has('ViewChannel')) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'You don\'t have access to that channel', color: colors.error })], ephemeral: true });
      }

      const index = (interaction.options.getInteger('index') || 1) - 1;
      const data = snipeStore.getReaction(channel.id, index);

      if (!data) {
        return interaction.reply({ content: 'Nothing to reactionsnipe.', ephemeral: true });
      }

      const ago = timeAgo(data.timestamp);

      await interaction.reply({
        embeds: [response({
          client: interaction.client,
          description: `${data.user.tag} removed ${data.emoji}${data.messageContent ? `\n**On:** ${data.messageContent}` : ''}\n\n*${ago}*`,
          color: colors.primary,
        })],
      });

    } else if (sub === 'purge') {
      const channel = interaction.channel;
      if (!channel.permissionsFor(interaction.member).has('ViewChannel')) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'You don\'t have access to that channel', color: colors.error })], ephemeral: true });
      }

      const purged = snipeStore.getPurged(channel.id);

      if (!purged) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'No purged messages to show.', color: colors.muted })], ephemeral: true });
      }

      const msgs = purged.messages || [];
      const desc = msgs.length
        ? msgs.map((m, i) => `\`${i + 1}.\` **${m.author}** — ${m.content || '*no text*'}`).join('\n')
        : '*Message content unavailable*';
      const descSafe = desc.slice(0, 4096);

      const embed = base(interaction.client, colors.primary)
        .setAuthor({ name: 'Purged Messages' })
        .setDescription(descSafe)
        .setFooter({ text: `${purged.count} messages purged by ${purged.executor.tag} · ${new Date(purged.timestamp).toLocaleString()}` });

      await interaction.reply({ embeds: [embed] });

    } else if (sub === 'clear') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'You need **Manage Messages** to clear snipe data.', color: colors.error })], ephemeral: true });
      }

      const type = interaction.options.getString('type');
      const chId = interaction.channel.id;

      if (type === 'all' || type === 'deleted') snipeStore.clearDeleted(chId);
      if (type === 'all' || type === 'edited') snipeStore.clearEdited(chId);
      if (type === 'all' || type === 'reactions') snipeStore.clearReactions(chId);
      if (type === 'all' || type === 'purged') snipeStore.clearPurged(chId);

      await interaction.reply({
        embeds: [response({ client: interaction.client, description: `Cleared **${type}** snipe data for this channel.`, color: colors.success })],
        ephemeral: true,
      });
    }
  },
};

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
