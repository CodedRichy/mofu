const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const { cmdRef } = require('../../utils/invocation');
const store = require('../../database/store');

const MAX_COMMANDS = 50;
const MAX_RESPONSE_LENGTH = 1500;

function formatVars(text, member, guild) {
  return text
    .replace(/{user}/gi, member.toString())
    .replace(/{user\.tag}/gi, member.user?.tag || member.tag || 'Unknown')
    .replace(/{server}/gi, guild.name)
    .replace(/{membercount}/gi, guild.memberCount.toString());
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('customcommand')
    .setDescription('Manage custom commands')
    .addSubcommand((sub) =>
      sub.setName('add').setDescription('Create a custom command')
        .addStringOption((o) => o.setName('name').setDescription('Command trigger name').setRequired(true).setMaxLength(32))
        .addStringOption((o) => o.setName('response').setDescription('Response text — supports {user}, {server}, {membercount}').setRequired(true).setMaxLength(MAX_RESPONSE_LENGTH))
        .addBooleanOption((o) => o.setName('embed').setDescription('Send as styled embed (default: true)'))
    )
    .addSubcommand((sub) =>
      sub.setName('edit').setDescription('Edit a custom command response')
        .addStringOption((o) => o.setName('name').setDescription('Command name').setRequired(true).setMaxLength(32))
        .addStringOption((o) => o.setName('response').setDescription('New response text').setRequired(true).setMaxLength(MAX_RESPONSE_LENGTH))
        .addBooleanOption((o) => o.setName('embed').setDescription('Send as styled embed'))
    )
    .addSubcommand((sub) =>
      sub.setName('remove').setDescription('Delete a custom command')
        .addStringOption((o) => o.setName('name').setDescription('Command name').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('View all custom commands'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;

    if (sub === 'add') {
      const name = interaction.options.getString('name').toLowerCase().replace(/\s+/g, '-');
      const text = interaction.options.getString('response');
      const useEmbed = interaction.options.getBoolean('embed') ?? true;

      if (store.getCustomCommand(guild.id, name)) {
        return interaction.reply({
          embeds: [response({ client: interaction.client, description: `Command \`${name}\` already exists. Use ${cmdRef(guild.id, 'customcommand edit')} to modify.`, color: colors.error })],
          ephemeral: true,
        });
      }

      const existing = store.listCustomCommands(guild.id);
      if (existing.length >= MAX_COMMANDS) {
        return interaction.reply({
          embeds: [response({ client: interaction.client, description: `Max ${MAX_COMMANDS} custom commands reached. Remove some first.`, color: colors.error })],
          ephemeral: true,
        });
      }

      const builtinCmd = interaction.client.commands.get(name);
      if (builtinCmd) {
        return interaction.reply({
          embeds: [response({ client: interaction.client, description: `\`${name}\` conflicts with a built-in command. Choose a different name.`, color: colors.error })],
          ephemeral: true,
        });
      }

      store.addCustomCommand(guild.id, name, {
        response: text,
        embed: useEmbed,
        createdBy: interaction.user.id,
        createdAt: new Date().toISOString(),
      });

      await interaction.reply({
        embeds: [response({
          client: interaction.client,
          description: `Custom command \`${name}\` created.\n\n**Preview:**\n${formatVars(text, interaction.member, guild)}`,
          color: colors.success,
        })],
      });

    } else if (sub === 'edit') {
      const name = interaction.options.getString('name').trim().toLowerCase().replace(/\s+/g, '-');
      const text = interaction.options.getString('response');
      const useEmbed = interaction.options.getBoolean('embed');

      const existing = store.getCustomCommand(guild.id, name);
      if (!existing) {
        return interaction.reply({
          embeds: [response({ client: interaction.client, description: `Command \`${name}\` not found.`, color: colors.error })],
          ephemeral: true,
        });
      }

      existing.response = text;
      if (useEmbed !== null) existing.embed = useEmbed;
      store.addCustomCommand(guild.id, name, existing);

      await interaction.reply({
        embeds: [response({
          client: interaction.client,
          description: `Command \`${name}\` updated.\n\n**Preview:**\n${formatVars(text, interaction.member, guild)}`,
          color: colors.success,
        })],
      });

    } else if (sub === 'remove') {
      const name = interaction.options.getString('name').toLowerCase();
      if (!store.removeCustomCommand(guild.id, name)) {
        return interaction.reply({
          embeds: [response({ client: interaction.client, description: `Command \`${name}\` not found.`, color: colors.error })],
          ephemeral: true,
        });
      }
      await interaction.reply({ embeds: [response({ client: interaction.client, description: `Command \`${name}\` deleted.`, color: colors.success })] });

    } else {
      const commands = store.listCustomCommands(guild.id);
      if (!commands.length) {
        return interaction.reply({
          embeds: [response({ client: interaction.client, description: `No custom commands configured.\nUse ${cmdRef(guild.id, 'customcommand add')} to create one.`, color: colors.muted })],
        });
      }

      const list = commands
        .map(([name, data]) => `\`${name}\` — ${data.response.length > 50 ? data.response.slice(0, 50) + '…' : data.response}`)
        .join('\n');

      await interaction.reply({
        embeds: [response({
          client: interaction.client,
          description: `**Custom Commands** (${commands.length}/${MAX_COMMANDS})\n\n${list}`,
          color: colors.info,
        })],
      });
    }
  },
};
