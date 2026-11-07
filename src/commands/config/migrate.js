const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const store = require('../../database/store');
const config = require('../../config');
const { detectBots, prefixClash, suggestChannels } = require('../../utils/migrate');

const LABELS = { modlog_channel: 'Mod log', welcome_channel: 'Welcome', goodbye_channel: 'Goodbye' };

function textChannels(guild) {
  const me = guild.members.me;
  return [...guild.channels.cache.values()]
    .filter((c) => c.type === ChannelType.GuildText && c.permissionsFor(me)?.has(['ViewChannel', 'SendMessages']))
    .map((c) => ({ id: c.id, name: c.name }));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('migrate')
    .setDescription('Switching from another bot? Find clashes and reuse your existing channels')
    .addSubcommand((sub) => sub.setName('scan').setDescription('Check this server for other bots and channels Sonder can reuse (changes nothing)'))
    .addSubcommand((sub) => sub.setName('apply').setDescription('Link the matching channels for any setting that is still empty'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const { guild } = interaction;
    const sub = interaction.options.getSubcommand();
    await guild.members.fetch().catch(() => {}); // so other bots in the member list are visible

    const prefix = store.getConfig(guild.id, 'prefix') || config.discord.defaultPrefix;
    const bots = detectBots([...guild.members.cache.values()].filter((m) => m.user.bot && m.id !== interaction.client.user.id).map((m) => m.user.username));
    const suggestions = suggestChannels(textChannels(guild));
    const unset = Object.keys(suggestions).filter((k) => !store.getConfig(guild.id, k));

    if (sub === 'apply') {
      if (!unset.length) return interaction.reply({ embeds: [response({ client: interaction.client, description: 'Nothing to link. Either no matching channels were found or those settings are already set.', color: colors.muted })], ephemeral: true });
      const lines = [];
      for (const key of unset) {
        store.setConfig(guild.id, key, suggestions[key].id);
        if (key === 'welcome_channel' && !store.getConfig(guild.id, 'welcome_message')) {
          store.setConfig(guild.id, 'welcome_message', "Welcome to {server}, {user}! You're member #{membercount}");
        }
        if (key === 'goodbye_channel' && !store.getConfig(guild.id, 'goodbye_message')) {
          store.setConfig(guild.id, 'goodbye_message', "{user} left **{server}**.");
        }
        lines.push(`${LABELS[key]} -> <#${suggestions[key].id}>`);
      }
      return interaction.reply({ embeds: [response({ client: interaction.client, description: `**Linked**\n${lines.join('\n')}\n\nChange any of these later with \`/welcome\`, \`/goodbye\` or \`/logging\`.`, color: colors.success })], allowedMentions: { parse: [] } });
    }

    const out = [];
    if (bots.length) {
      out.push(`**Other bots here:** ${bots.map((b) => `${b.name} (default prefix \`${b.prefix}\`)`).join(', ')}`);
      const clash = prefixClash(prefix, bots);
      out.push(clash.length
        ? `**Prefix clash:** Sonder uses \`${prefix}\`, the same as ${clash.map((b) => b.name).join(', ')}. Both would answer. Change it with \`/prefix\`.`
        : `**Prefix:** Sonder uses \`${prefix}\`, so it will not collide with their defaults. If you changed their prefix, check it doesn't match.`);
      out.push('Both bots can stay while you move over. Turn off a feature on the old bot once Sonder\'s version works, so nothing runs twice.');
    } else {
      out.push('No other well-known bots found in this server.');
    }

    const found = Object.keys(suggestions);
    if (found.length) {
      out.push('**Channels Sonder can reuse**\n' + found.map((k) => `${LABELS[k]}: <#${suggestions[k].id}> ${store.getConfig(guild.id, k) ? '(already set)' : '(not set)'}`).join('\n'));
      if (unset.length) out.push('Run `/migrate apply` to link the ones that are not set.');
    }
    out.push('**Warnings:** if your old bot can export them to a CSV, bring them over with `/import warnings`.\n**Not transferable:** levels and economy balances (other bots give servers no export), so those start fresh. Your server\'s bans, roles and Discord AutoMod rules are unaffected.');

    return interaction.reply({ embeds: [response({ client: interaction.client, description: out.join('\n\n'), color: colors.primary })], ephemeral: true, allowedMentions: { parse: [] } });
  },
};
