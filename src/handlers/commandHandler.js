const fs = require('fs');
const path = require('path');
const { Collection, REST, Routes } = require('discord.js');
const config = require('../config');
const log = require('../utils/logger');

const PREFIX_ONLY = new Set([
  // moderation — slash keeps: ban, unban, kick, mute, unmute, warn, purge, lock, modlog
  'banlist', 'drag', 'hardmute', 'hide', 'history', 'imute', 'jail',
  'modstats', 'mutelist', 'nickname', 'note', 'rmute', 'role',
  'selfpurge', 'slowmode', 'softban',
  // music — slash keeps: play, skip, stop, queue, nowplaying
  'loop', 'pause', 'shuffle', 'volume',
  // utility — slash keeps: help, ping, avatar, userinfo, server
  'afk', 'banner', 'besttime', 'boostimpact', 'botinfo', 'bots', 'calculate',
  'catchup', 'channelstats', 'define', 'emoji', 'firstmessage', 'ghostcheck',
  'github', 'giveaway', 'inrole', 'invites', 'joinposition', 'membercount',
  'milestone', 'newusers', 'poll', 'quote', 'remind', 'roleaudit', 'roleinfo',
  'snipe', 'spotlight', 'staleperms', 'sticker', 'threadwatch', 'timezone',
  'toprole', 'translate', 'uptime', 'voice',
  // economy — slash keeps: bank, daily, work, shop
  'beg', 'blackjack', 'coinflip', 'crime', 'fish', 'heist', 'hunt',
  'inventory', 'leaderboard', 'rob', 'slots', 'transfer',
  // leveling — slash keeps: rank, leveling
  'setlevel', 'xpleaderboard',
  // ai — all slash
  // fun — slash keeps: trivia
  '8ball', 'bite', 'blacktea', 'bonk', 'cat', 'confess', 'dog', 'hug',
  'kiss', 'meme', 'mock', 'pat', 'rps', 'ship', 'slap', 'truthordare',
  'uwuify', 'wyr',
  // config — slash keeps: welcome, goodbye, autorole, prefix, logging, reactionrole, ticket, setup, quicksetup, settings, rolesetup
  'aimod', 'antilink', 'antinuke', 'antiraid', 'antispam', 'auditlog',
  'autoresponder', 'backup', 'birthday', 'boosterrole', 'bumpreminder',
  'confession', 'configaudit', 'counter', 'customcommand', 'nightwatch',
  'starboard', 'stickymessage', 'voicemaster', 'wordfilter',
  // lastfm
  'fm',
]);

const ALIASES = {
  // moderation
  b: 'ban', k: 'kick', m: 'mute', um: 'unmute', w: 'warn',
  to: 'mute', timeout: 'mute', unto: 'unmute', untimeout: 'unmute', unm: 'unmute',
  ub: 'unban', sb: 'softban', sban: 'softban',
  hm: 'hardmute', im: 'imute', rm: 'rmute',
  j: 'jail', nick: 'nickname', nn: 'nickname',
  clear: 'purge', clr: 'purge', del: 'purge', prune: 'purge', c: 'purge',
  l: 'lock', sp: 'selfpurge', sm: 'slowmode',
  bl: 'banlist', ml: 'mutelist', ms: 'modstats', hist: 'history',
  mlog: 'modlog', dm: 'drag', n: 'note',
  wl: 'warn',

  // music
  p: 'play', pl: 'play', s: 'skip', np: 'nowplaying', q: 'queue', vol: 'volume',
  pa: 'pause', resume: 'pause', sh: 'shuffle', lp: 'loop',
  st: 'stop', dc: 'stop', leave: 'stop', disconnect: 'stop',

  // economy
  lb: 'leaderboard', bal: 'bank', dep: 'deposit', wd: 'withdraw',
  pay: 'transfer', give: 'transfer', send: 'transfer',
  wallet: 'bank', store: 'shop', steal: 'rob',
  bj: 'blackjack', cf: 'coinflip', inv: 'inventory', d: 'daily',

  // leveling
  lvl: 'rank', xp: 'rank', xlb: 'xpleaderboard', sl: 'setlevel',

  // utility
  h: 'help', av: 'avatar', pfp: 'avatar', pic: 'avatar',
  ui: 'userinfo', whois: 'userinfo', info: 'userinfo',
  si: 'server', serverinfo: 'server', sinfo: 'server',
  members: 'membercount', mc: 'membercount',
  ri: 'roleinfo', bi: 'botinfo', sn: 'snipe',
  ga: 'giveaway', rem: 'remind', tz: 'timezone',
  calc: 'calculate', def: 'define', gh: 'github', tr: 'translate',
  e: 'emoji', emote: 'emoji',

  // fun
  t: 'trivia', tod: 'truthordare', tord: 'truthordare',
  uwu: 'uwuify', '8b': '8ball',

  // ai
  r: 'roast', sum: 'summarize',
};

function loadCommands(client) {
  client.commands = new Collection();
  client.aliases = new Collection();

  const commandsPath = path.join(__dirname, '..', 'commands');
  const categories = fs.readdirSync(commandsPath).filter((f) =>
    fs.statSync(path.join(commandsPath, f)).isDirectory()
  );

  for (const category of categories) {
    const categoryPath = path.join(commandsPath, category);
    const files = fs.readdirSync(categoryPath).filter((f) => f.endsWith('.js'));

    for (const file of files) {
      const command = require(path.join(categoryPath, file));
      if (command.data && command.execute) {
        command.category = category;
        client.commands.set(command.data.name, command);
        log.debug(`Loaded command: ${command.data.name}`);
      } else {
        log.warn(`Skipping ${file} — missing data or execute`);
      }
    }
  }

  for (const [alias, target] of Object.entries(ALIASES)) {
    const cmd = client.commands.get(target);
    if (cmd) client.aliases.set(alias, cmd);
  }

  log.info(`Loaded ${client.commands.size} commands (${client.commands.size - PREFIX_ONLY.size} slash, ${PREFIX_ONLY.size} prefix-only) + ${client.aliases.size} aliases`);
}

async function registerCommands(client) {
  const rest = new REST().setToken(config.discord.token);

  const slashCommands = client.commands
    .filter((cmd) => !PREFIX_ONLY.has(cmd.data.name))
    .map((cmd) => cmd.data.toJSON());

  // Clear stale global commands from previous registration
  await rest.put(Routes.applicationCommands(config.discord.clientId), { body: [] });

  // Issue all guild PUTs at once; @discordjs/rest queues them per bucket and
  // handles 429s, so this is never slower than awaiting one by one. One guild
  // failing (e.g. missing applications.commands scope) must not
  // abort the rest or reject the ready handler.
  await Promise.all(client.guilds.cache.map(async (guild) => {
    try {
      const data = await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, guild.id),
        { body: slashCommands }
      );
      log.info(`Registered ${data.length} slash commands in ${guild.name}`);
    } catch (err) {
      log.warn(`Failed to register slash commands in ${guild.name} (${guild.id}):`, err.message);
    }
  }));
}

module.exports = { loadCommands, registerCommands };
