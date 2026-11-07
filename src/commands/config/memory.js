const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const store = require('../../database/store');

// Per-server notes Sonder can use when people talk to it ("the mod team meets on fridays", "the owner's
// birthday is in May"). Written only by admins; capped so the prompt stays small. Stored under config key `ai_notes`.
const MAX_NOTES = 20;
const MAX_LEN = 200;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('memory')
    .setDescription('Teach Sonder facts about this server')
    .addSubcommand((sub) =>
      sub.setName('add').setDescription('Add a fact Sonder should know about this server')
        .addStringOption((o) => o.setName('fact').setDescription('e.g. "movie night is every friday at 8pm est"').setRequired(true).setMaxLength(MAX_LEN))
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Show what Sonder knows about this server'))
    .addSubcommand((sub) =>
      sub.setName('remove').setDescription('Forget one fact')
        .addIntegerOption((o) => o.setName('number').setDescription('Number from /memory list').setRequired(true).setMinValue(1).setMaxValue(MAX_NOTES))
    )
    .addSubcommand((sub) => sub.setName('clear').setDescription('Forget everything about this server'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;
    const notes = store.getConfig(guild.id, 'ai_notes') || [];
    const reply = (description, color, ephemeral = false) =>
      interaction.reply({ embeds: [response({ client: interaction.client, description, color })], ephemeral, allowedMentions: { parse: [] } });

    if (sub === 'add') {
      const fact = interaction.options.getString('fact').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
      if (!fact) return reply('Nothing to save.', colors.error, true);
      if (notes.length >= MAX_NOTES) return reply(`That's the limit (${MAX_NOTES}). Remove one with \`/memory remove\` first.`, colors.error, true);
      if (notes.some((n) => n.toLowerCase() === fact.toLowerCase())) return reply('Already saved.', colors.muted, true);
      notes.push(fact);
      store.setConfig(guild.id, 'ai_notes', notes);
      return reply(`Saved (${notes.length}/${MAX_NOTES}): ${fact}`, colors.success);
    }

    if (sub === 'list') {
      if (!notes.length) return reply('Nothing saved yet. Add a fact with `/memory add`.', colors.muted, true);
      return reply(`**What Sonder knows here**\n${notes.map((n, i) => `\`${i + 1}\` ${n}`).join('\n')}`, colors.primary, true);
    }

    if (sub === 'remove') {
      const n = interaction.options.getInteger('number');
      if (n > notes.length) return reply(`There is no note ${n}.`, colors.error, true);
      const [gone] = notes.splice(n - 1, 1);
      store.setConfig(guild.id, 'ai_notes', notes.length ? notes : null);
      return reply(`Forgot: ${gone}`, colors.success);
    }

    store.setConfig(guild.id, 'ai_notes', null);
    return reply('Cleared. Sonder knows nothing special about this server now.', colors.success);
  },
};
