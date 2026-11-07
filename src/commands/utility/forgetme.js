const crypto = require('crypto');
const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const log = require('../../utils/logger');
const privacy = require('../../database/privacy');

const CONFIRM_MS = 5 * 60 * 1000;
const { KEEP: BACKUP_COPIES } = require('../../utils/backup');
const BACKUP_NOTE = `Deleted data can stay in the daily database backups until they rotate out (the newest ${BACKUP_COPIES} are kept, so about ${BACKUP_COPIES} more days). Giveaway entries, booster role and voice channel ownership are not part of this delete.`;

function describeScope(scope, guild) {
  return scope === 'everywhere' ? 'in **every server** mofu shares with you' : `in **${guild.name.slice(0, 100)}**`;
}

// Who may delete what: anyone for themself (this server or everywhere); a Manage Server admin for another
// member, this server only. Returns an error string or null. Exported for tests.
function authorize({ invokerId, targetId, scope, canManageGuild }) {
  if (targetId === invokerId) return null;
  if (!canManageGuild) return 'You can only delete your own data. Server admins (Manage Server) can delete a member\'s data for this server.';
  if (scope === 'everywhere') return 'Admins can only delete a member\'s data for this server. `everywhere` is for your own data.';
  return null;
}

// Result lines, capped well under the 4096 embed description limit.
function summarize(result) {
  const parts = Object.entries(result.byLabel).map(([label, n]) => `${label}: ${n}`);
  let text = parts.length ? parts.join('\n') : 'Nothing was stored.';
  if (result.unlinked) text += `\ninvite credit links removed: ${result.unlinked}`;
  return text.slice(0, 1500);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('forgetme')
    .setDescription('Delete your personal data from mofu (asks to confirm)')
    .addStringOption((o) => o.setName('scope').setDescription('This server (default) or every server')
      .addChoices({ name: 'this server', value: 'server' }, { name: 'everywhere', value: 'everywhere' }))
    .addUserOption((o) => o.setName('user').setDescription('Admins only: delete this member\'s data for this server')),

  authorize,
  summarize,

  async execute(interaction) {
    const { guild, client } = interaction;
    const fail = (msg) => interaction.reply({ embeds: [response({ client, description: msg, color: colors.error })], ephemeral: true });
    if (!guild) return fail('Run this in a server.');

    const scope = interaction.options.getString('scope') === 'everywhere' ? 'everywhere' : 'server';
    const target = interaction.options.getUser('user') || interaction.user;
    const canManage = () => !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
    const denied = authorize({ invokerId: interaction.user.id, targetId: target.id, scope, canManageGuild: canManage() });
    if (denied) return fail(denied);

    const self = target.id === interaction.user.id;
    const nonce = crypto.randomBytes(6).toString('hex');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`forgetme:yes:${nonce}`).setLabel('Delete it').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`forgetme:no:${nonce}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );
    const who = self ? 'your' : `${target.username.slice(0, 32)}'s`;
    const prompt = [
      `This deletes ${who} XP, economy balance, inventory and cooldowns, reminders, birthday, invite count and join record, AFK/timezone/Last.fm settings, quotes of ${self ? 'you' : 'them'} and /snipe snapshots ${describeScope(scope, guild)}.`,
      privacy.KEPT_NOTE,
      BACKUP_NOTE,
      `It cannot be undone. This prompt expires <t:${Math.floor((Date.now() + CONFIRM_MS) / 1000)}:R>.`,
    ].join('\n\n');

    const msg = await interaction.reply({
      embeds: [response({ client, description: prompt, color: colors.warning })],
      components: [row],
      ephemeral: true,
      fetchReply: true,
    });

    let done = false;
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === interaction.user.id && i.customId.endsWith(`:${nonce}`),
      time: CONFIRM_MS,
      max: 1,
    });

    collector.on('collect', async (i) => {
      done = true;
      if (i.customId.startsWith('forgetme:no:')) {
        return i.update({ embeds: [response({ client, description: 'Cancelled. Nothing was deleted.', color: colors.muted })], components: [] }).catch(() => {});
      }
      // Permissions can change in five minutes: check again at the press.
      if (!self && !i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return i.update({ embeds: [response({ client, description: 'You no longer have Manage Server. Nothing was deleted.', color: colors.error })], components: [] }).catch(() => {});
      }
      try {
        const store = require('../../database/store');
        const result = privacy.forgetUser(store.db, target.id, { guildId: scope === 'server' ? guild.id : null });
        for (const g of result.guilds) store.clearConfigCache(g);
        log.info(`forgetme: ${self ? 'self' : 'admin'} delete of ${result.total} rows (scope ${scope})`);
        await i.update({
          embeds: [response({ client, description: `Done. Deleted ${result.total} item${result.total === 1 ? '' : 's'} ${describeScope(scope, guild)}.\n\n${summarize(result)}\n\nModeration records were kept. ${BACKUP_NOTE}`, color: colors.success })],
          components: [],
        }).catch(() => {});
        if (!self) {
          require('../../utils/modlog').send(guild, {
            action: 'Data deleted', target, moderator: interaction.user,
            reason: `Personal data deleted via /forgetme (${result.total} items, moderation records kept)`, caseId: null,
          }).catch(() => {});
        }
      } catch (err) {
        log.error('forgetme failed', err);
        await i.update({ embeds: [response({ client, description: 'Something went wrong. Nothing was deleted (the change is all or nothing). Try again later.', color: colors.error })], components: [] }).catch(() => {});
      }
    });

    collector.on('end', () => {
      if (done) return;
      const expired = { embeds: [response({ client, description: 'Expired. Nothing was deleted.', color: colors.muted })], components: [] };
      // slash: edit the ephemeral reply; prefix: edit the message we sent
      (interaction.editReply ? interaction.editReply(expired) : msg.edit(expired)).catch(() => {});
    });
  },
};
