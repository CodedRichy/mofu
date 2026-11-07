const store = require('../database/store');
const log = require('../utils/logger');

// /threadwatch: when a watched thread gets archived (auto-archive or manual), unarchive it.
// Works only while the bot is online and allowed to (Send Messages in Threads, or Manage Threads for locked ones).
module.exports = {
  name: 'threadUpdate',
  async execute(oldThread, newThread) {
    if (!newThread?.guild || !newThread.archived || oldThread?.archived) return;
    const watched = store.getConfig(newThread.guild.id, 'threadwatch');
    if (!Array.isArray(watched) || !watched.includes(newThread.id)) return;
    if (!newThread.unarchivable) return;
    await newThread.setArchived(false, 'mofu threadwatch: keep this thread open')
      .catch((err) => log.warn(`[threadwatch] could not unarchive ${newThread.id}:`, err.message));
  },
};
