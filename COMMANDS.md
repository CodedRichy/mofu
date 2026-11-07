# Command Registration

Discord limit: 100 slash commands per app. mofu registers 84 as slash and keeps 85 prefix-only (169 total).
Every command works via prefix (`;command`). Controlled by the `PREFIX_ONLY` set in `src/handlers/commandHandler.js`;
`test/slashcap.test.js` checks the cap and validates every slash builder against Discord's limits. Keep about
10 slots free. The most-used commands are slash so they keep working if MESSAGE_CONTENT is denied at review.

## Slash Commands (84) — visible in `/` menu, also work with the prefix

### ai (6)
ask, persona, roast, sentiment, summarize, vibe

### config (18)
aiactions, airoles, automod, autorole, goodbye, import, logging, memory, migrate, prefix, quicksetup, reactionrole, rolesetup, settings, setup, ticket, warnconfig, welcome

### economy (9)
bank, blackjack, coinflip, daily, inventory, leaderboard, shop, transfer, work

### fun (3)
8ball, rps, trivia

### leveling (7)
leveling, levelrole, levelup, rank, xpignore, xpleaderboard, xpmultiplier

### moderation (15)
ban, case, history, kick, lock, modlog, mute, nickname, purge, role, slowmode, tempban, unban, unmute, warn

### music (11)
loop, lyrics, nowplaying, pause, play, queue, resume, shuffle, skip, stop, volume

### utility (15)
afk, avatar, forgetme, giveaway, help, membercount, ping, poll, privacy, remind, roleinfo, server, snipe, translate, userinfo

## Prefix-Only (85) — `;command` only

### config (20)
aimod, antilink, antinuke, antiraid, antispam, auditlog, autoresponder, backup, birthday, boosterrole, bumpreminder, confession, configaudit, counter, customcommand, nightwatch, starboard, stickymessage, voicemaster, wordfilter

### economy (7)
beg, crime, fish, heist, hunt, rob, slots

### fun (16)
bite, blacktea, bonk, cat, confess, dog, hug, kiss, meme, mock, pat, ship, slap, truthordare, uwuify, wyr

### lastfm (1)
fm

### leveling (1)
setlevel

### moderation (12)
banlist, drag, hardmute, hide, imute, jail, modstats, mutelist, note, rmute, selfpurge, softban

### utility (28)
banner, besttime, boostimpact, botinfo, bots, calculate, catchup, channelstats, define, emoji, firstmessage, ghostcheck, github, inrole, invites, joinposition, milestone, newusers, quote, roleaudit, spotlight, staleperms, sticker, threadwatch, timezone, toprole, uptime, voice

## Consolidated Commands (25 slots saved)

| New Command | Subcommands | Replaced |
|-------------|-------------|----------|
| `/snipe` | message, edit, reaction, purge, clear | snipe, editsnipe, reactionsnipe, purgesnipe, clearsnipe |
| `/invites` | link, check, leaderboard, reset | invite, invites, inviteleaderboard, resetinvites |
| `/emoji` | list, stats, enlarge, steal | emoji, emojistats, enlarge, steal |
| `/server` | info, icon, banner | serverinfo, servericon, serverbanner |
| `/warn` | add, list, clear | warn, warns, clearwarns |
| `/nickname` | set, clearall, force, unforce | nickname, clearnicknames, forcenickname |
| `/bank` | balance, deposit, withdraw | balance, deposit, withdraw |
| `/lock` | on, off | lock, unlock |
| `/hide` | on, off | hide, reveal |
| `/jail` | add, remove | jail, unjail |
| `/hardmute` | add, remove | hardmute, unhardmute |
| `/imute` | add, remove | imute, iunmute |
| `/rmute` | add, remove | rmute, runmute |
| `/remind` | set, list, cancel | remind, reminders |
| `/note` | add, view, remove | — |
| `/rolesetup` | interactive multi-select | — |
| `/autorole` | set, remove, **create** | — |

## Channel & Role Auto-Creation

Commands with `create` subcommand — auto-creates the needed channel/role if missing:

| Command | Creates | Config key |
|---------|---------|------------|
| `/welcome create` | #welcome (public) | welcome_channel |
| `/goodbye create` | #goodbye (public) | goodbye_channel |
| `/logging create` | #mofu-logs (private; an existing #sonder-logs is reused) | log_channel |
| `/modlog create` | #modlog (private) | modlog_channel |
| `;auditlog create` | #audit-log (private) | audit_log_channel |
| `;starboard create` | #starboard (public) | starboard_channel |
| `;counter create` | #counting (public) | counter_channel |
| `;confession create` | #confessions (public) | confession_channel |
| `;bumpreminder create` | #bump (public) | bump_channel |
| `/ticket create` | #ticket-logs (private) | ticket_logs |
| `/autorole create` | @Member role | autorole |
| `/rolesetup` | @Jailed, @Moderator, @Member | jail_role |
