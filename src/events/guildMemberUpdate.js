// Nickname or avatar change: re-run the staff lookalike check (alert only; see utils/scamshield.js).
module.exports = {
  name: 'guildMemberUpdate',
  async execute(oldMember, newMember) {
    if (oldMember.nickname === newMember.nickname && oldMember.avatar === newMember.avatar) return;
    await require('../utils/scamshield').checkImpersonation(newMember);
  },
};
