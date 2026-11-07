// Image checks: feeds messages and alarm reactions to the crowd tracker (src/handlers/imagemod.js).
// A separate listener file so the shared messageCreate / messageReactionAdd handlers stay untouched.
// Does nothing in servers that have not turned image checks on.
module.exports = [
  {
    name: 'messageCreate',
    async execute(message) {
      await require('../handlers/imagemod').onMessage(message);
    },
  },
  {
    name: 'messageReactionAdd',
    async execute(reaction, user) {
      await require('../handlers/imagemod').onReaction(reaction, user);
    },
  },
];
