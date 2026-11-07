const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Collection, REST, Routes, InteractionContextType } = require('discord.js');
const config = require('../config');
const log = require('../utils/logger');

const PREFIX_ONLY = new Set([
  // Everything NOT listed here is also registered as a slash command (Discord caps an app at 100, enforced by
  // test/slashcap.test.js; keep roughly 10 slots free). The most-used commands are slash so they keep working
  // if MESSAGE_CONTENT is ever denied at privileged-intent review.
  // moderation — slash: ban, unban, kick, mute, unmute, tempban, warn, case, purge, lock, modlog, role, slowmode, nickname, history
  'banlist', 'drag', 'hardmute', 'hide', 'imute', 'jail',
  'modstats', 'mutelist', 'note', 'rmute',
  'selfpurge', 'softban',
  // music — all slash
  // utility — slash: help, ping, avatar, userinfo, server, privacy, forgetme, afk, giveaway, membercount, poll, remind,
  // roleinfo, snipe, translate
  'banner', 'besttime', 'boostimpact', 'botinfo', 'bots', 'calculate',
  'catchup', 'channelstats', 'define', 'emoji', 'firstmessage', 'ghostcheck',
  'github', 'inrole', 'invites', 'joinposition',
  'milestone', 'newusers', 'quote', 'roleaudit',
  'spotlight', 'staleperms', 'sticker', 'threadwatch', 'timezone',
  'toprole', 'uptime', 'voice',
  // economy — slash: bank, daily, work, shop, leaderboard, transfer, inventory, coinflip, blackjack
  'beg', 'crime', 'fish', 'heist', 'hunt',
  'rob', 'slots',
  // leveling — slash: rank, leveling, levelrole, levelup, xpignore, xpmultiplier, xpleaderboard
  'setlevel',
  // ai — all slash
  // fun — slash: trivia, 8ball, rps
  'bite', 'blacktea', 'bonk', 'cat', 'confess', 'dog', 'hug',
  'kiss', 'meme', 'mock', 'pat', 'ship', 'slap', 'truthordare',
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
  pa: 'pause', sh: 'shuffle', lp: 'loop',
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
  tags: 'tag',

  // config
  rolepanel: 'reactionrole', rr: 'reactionrole',

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
    // Commands are written against interaction.guild: keep them out of DMs / group chats (the server-side
    // equivalent of the interactionCreate guard). Commands that set their own contexts keep them.
    .map((cmd) => {
      const json = cmd.data.toJSON();
      if (!json.contexts) json.contexts = [InteractionContextType.Guild];
      return json;
    });

  // Production: REGISTER_GLOBAL=1 registers once globally (works in every server, powers the profile's
  // featured commands) and wipes the per-guild copies so nothing shows twice. Global updates can take up
  // to an hour to propagate, so dev keeps the default guild-scoped mode below (instant).
  if (process.env.REGISTER_GLOBAL === '1') {
    // Skip the whole dance when the command payload is unchanged since the last successful run: every
    // restart would otherwise spend one global PUT plus one clearing PUT per guild (rate limit fuel).
    const hashFile = path.join(__dirname, '..', '..', 'data', 'commands.hash');
    const hash = 'global:' + crypto.createHash('sha256').update(JSON.stringify(slashCommands)).digest('hex');
    let previous = '';
    try { previous = fs.readFileSync(hashFile, 'utf-8').trim(); } catch { /* first run */ }
    if (previous === hash) {
      log.info('Global slash commands unchanged, skipping registration');
      return;
    }
    const data = await rest.put(Routes.applicationCommands(config.discord.clientId), { body: slashCommands });
    log.info(`Registered ${data.length} global slash commands`);
    let clearFailed = false;
    await Promise.all(client.guilds.cache.map((guild) =>
      rest.put(Routes.applicationGuildCommands(config.discord.clientId, guild.id), { body: [] })
        .catch((err) => { clearFailed = true; log.warn(`Could not clear guild commands in ${guild.name}:`, err.message); })));
    if (!clearFailed) {
      try {
        fs.mkdirSync(path.dirname(hashFile), { recursive: true });
        fs.writeFileSync(hashFile, hash, 'utf-8');
      } catch (err) { log.warn('Could not save commands.hash:', err.message); }
    }
    return;
  }

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

module.exports = { loadCommands, registerCommands, PREFIX_ONLY };
