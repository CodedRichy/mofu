const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const { cmdRef } = require('../../utils/invocation');
const store = require('../../database/store');

// "#ff0000", "ff0000" or "f00" -> "ff0000"; anything else -> null. (parseInt alone accepts "ff0000zz" and overflows.)
function normalizeHex(input) {
  const h = String(input || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) return h.split('').map((c) => c + c).join('').toLowerCase();
  return /^[0-9a-f]{6}$/i.test(h) ? h.toLowerCase() : null;
}

// no control characters, collapsed whitespace
function cleanName(input) {
  return String(input || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32);
}

// A booster role must not impersonate an existing role (Moderator, Admin, ...). Returns an error string or null.
function nameClash(guild, name, ownRoleId) {
  if (!name) return 'Pick a name with at least one character.';
  const lower = name.toLowerCase();
  const clash = guild.roles.cache.find((r) => r.id !== ownRoleId && r.name.toLowerCase() === lower);
  return clash ? 'A role with that name already exists. Pick a different one.' : null;
}

module.exports = {
  normalizeHex, cleanName, nameClash,
  data: new SlashCommandBuilder()
    .setName('boosterrole')
    .setDescription('Create or manage your custom booster role')
    .addSubcommand((sub) =>
      sub.setName('create').setDescription('Create your custom role')
        .addStringOption((o) => o.setName('name').setDescription('Role name').setRequired(true).setMaxLength(32))
        .addStringOption((o) => o.setName('color').setDescription('Hex color (e.g. #ff0000)').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('color').setDescription('Change your role color')
        .addStringOption((o) => o.setName('color').setDescription('Hex color').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('name').setDescription('Change your role name')
        .addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true).setMaxLength(32))
    )
    .addSubcommand((sub) => sub.setName('delete').setDescription('Delete your custom role')),

  async execute(interaction) {
    if (!interaction.member.premiumSince) {
      return interaction.reply({ embeds: [response({ client: interaction.client, description: 'You must be a server booster to use this.', color: colors.error })], ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    const { guild, user } = interaction;

    if (sub === 'create') {
      const existingId = store.getConfig(guild.id, `boosterrole_${user.id}`);
      if (existingId && guild.roles.cache.has(existingId)) {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: `You already have a custom role. Use ${cmdRef(guild.id, 'boosterrole color')} or ${cmdRef(guild.id, 'boosterrole name')} to edit.`, color: colors.error })], ephemeral: true });
      }

      const name = cleanName(interaction.options.getString('name'));
      const nameProblem = nameClash(guild, name, null);
      if (nameProblem) return interaction.reply({ embeds: [response({ client: interaction.client, description: nameProblem, color: colors.error })], ephemeral: true });
      const colorStr = normalizeHex(interaction.options.getString('color'));
      const color = colorStr ? parseInt(colorStr, 16) : NaN;
      if (isNaN(color)) return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Invalid hex color.', color: colors.error })], ephemeral: true });

      let role;
      try {
        role = await guild.roles.create({ name, color, reason: `Booster role for ${user.tag}` });
        await interaction.member.roles.add(role);
      } catch {
        return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Failed to create role. Check bot permissions.', color: colors.error })], ephemeral: true });
      }
      store.setConfig(guild.id, `boosterrole_${user.id}`, role.id);

      await interaction.reply({ embeds: [response({ client: interaction.client, description: `Created your custom role: ${role}`, color: colors.success })] });

    } else if (sub === 'color') {
      const roleId = store.getConfig(guild.id, `boosterrole_${user.id}`);
      const role = roleId && guild.roles.cache.get(roleId);
      if (!role) return interaction.reply({ embeds: [response({ client: interaction.client, description: `No custom role found. Use ${cmdRef(guild.id, 'boosterrole create')}.`, color: colors.error })], ephemeral: true });

      const colorStr = normalizeHex(interaction.options.getString('color'));
      const color = colorStr ? parseInt(colorStr, 16) : NaN;
      if (isNaN(color)) return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Invalid hex color.', color: colors.error })], ephemeral: true });

      try { await role.setColor(color); } catch { return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Failed to update color.', color: colors.error })], ephemeral: true }); }
      await interaction.reply({ embeds: [response({ client: interaction.client, description: `Role color updated to **#${colorStr}**`, color })] });

    } else if (sub === 'name') {
      const roleId = store.getConfig(guild.id, `boosterrole_${user.id}`);
      const role = roleId && guild.roles.cache.get(roleId);
      if (!role) return interaction.reply({ embeds: [response({ client: interaction.client, description: 'No custom role found.', color: colors.error })], ephemeral: true });

      const name = cleanName(interaction.options.getString('name'));
      const nameProblem = nameClash(guild, name, role.id);
      if (nameProblem) return interaction.reply({ embeds: [response({ client: interaction.client, description: nameProblem, color: colors.error })], ephemeral: true });
      try { await role.setName(name); } catch { return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Failed to update name.', color: colors.error })], ephemeral: true }); }
      await interaction.reply({ embeds: [response({ client: interaction.client, description: `Role renamed to **${name}**`, color: colors.success })] });

    } else {
      const roleId = store.getConfig(guild.id, `boosterrole_${user.id}`);
      const role = roleId && guild.roles.cache.get(roleId);
      if (!role) return interaction.reply({ embeds: [response({ client: interaction.client, description: 'No custom role to delete.', color: colors.error })], ephemeral: true });

      try { await role.delete(); } catch { return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Failed to delete role.', color: colors.error })], ephemeral: true }); }
      store.setConfig(guild.id, `boosterrole_${user.id}`, null);
      await interaction.reply({ embeds: [response({ client: interaction.client, description: 'Custom role deleted.', color: colors.muted })] });
    }
  },
};
