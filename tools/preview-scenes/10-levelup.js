module.exports = (scene, { client, user }) => {
  const { levelUpEmbed } = require('../../src/utils/visuals');
  scene('Level up', 'src/utils/visuals.js', () => ({ embeds: [levelUpEmbed({ client, user: user('member'), oldLevel: 13, newLevel: 14, xpPct: 0.12 })] }));
  scene('Level up (milestone)', 'levels 10/25/50/100', () => ({ embeds: [levelUpEmbed({ client, user: user('member'), oldLevel: 24, newLevel: 25, xpPct: 0.4 })] }));
};
