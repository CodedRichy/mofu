const { SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../utils/constants');
const { response } = require('../../utils/embed');
const infractions = require('../../database/infractions');
const appeals = require('../../database/appeals');
const handler = require('../../handlers/appeal');
const modlog = require('../../utils/modlog');

const MAX_CASE = 1e9;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('appeal')
    .setDescription('Appeal a mute you received; staff review it')
    .addIntegerOption((o) => o.setName('case').setDescription('Your case number (shown in the DM you got)').setRequired(true).setMinValue(1).setMaxValue(MAX_CASE))
    // free-text reason must stay LAST: the prefix parser gives every earlier string option a single word
    .addStringOption((o) => o.setName('reason').setDescription('Why the punishment should be lifted').setRequired(true).setMinLength(10).setMaxLength(500)),

  async execute(interaction) {
    const fail = (description) => interaction.reply({ embeds: [response({ client: interaction.client, description, color: colors.error })], ephemeral: true });
    const { guild, user } = interaction;
    const number = interaction.options.getInteger('case');
    const reason = String(interaction.options.getString('reason') || '').trim();

    if (!Number.isInteger(number) || number < 1 || number > MAX_CASE) return fail('Give your case number, e.g. `appeal 12 I was not spamming`.');
    if (reason.length < 10) return fail('Explain in a sentence or two (at least 10 characters) why the punishment should be lifted.');

    const c = infractions.getCase(guild.id, number);
    const problem = handler.eligibilityProblem(c, user.id);
    if (problem) return fail(problem);

    // Is the punishment still in effect? An already-lifted one has nothing to appeal.
    if (c.action === 'mute') {
      const member = interaction.member || guild.members.cache.get(user.id);
      if (!member?.isCommunicationDisabled?.()) return fail('That mute is no longer active.');
      if (!handler.isLatestMuteCase(infractions.casesFor(guild.id, user.id, 50), number)) {
        return fail('Appeal your most recent mute instead; that is the one in effect now.');
      }
    }

    const blocked = appeals.blockReason(guild.id, number);
    if (blocked) return fail(blocked);

    const id = appeals.openAppeal({ guildId: guild.id, caseId: number, userId: user.id, userTag: user.tag, reason });
    if (!id) return fail('There is already an open appeal for this case. Staff will answer it.');

    const posted = await handler.postAppeal(guild, appeals.getAppeal(guild.id, id), c);
    if (!posted.ok) {
      appeals.discard(guild.id, id); // do not leave an open appeal staff can never see
      return fail(posted.error);
    }

    // Timeline entry for the member's record (the reason text lives in the appeals table, not here).
    modlog.openCase(guild, { action: 'appeal', target: user, moderator: user, reason: `Appeal #${id} filed against case #${number}` });

    return interaction.reply({
      embeds: [response({ client: interaction.client, description: `Your appeal #${id} for case #${number} was sent to the moderators. A different moderator than the one who issued the case has to approve it.`, color: colors.success })],
      ephemeral: true,
    });
  },
};
