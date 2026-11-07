# Discord verification and intents

Facts below come from the code in this repo (checked against `src/`). Anything the repo cannot show is marked TODO for the owner.

When this applies: Discord requires bot verification before a bot passes 100 servers, and privileged intents (Message Content, Server Members, Presence) need approval once the bot is in 75 or more servers. Below 75 servers the toggles in the Developer Portal can be switched on freely. Re-check these thresholds on Discord's support pages before applying. TODO: owner confirms current numbers.

## Intents the bot requests (src/index.js)

| Intent | Privileged | Requested |
|---|---|---|
| Guilds | no | yes |
| GuildMessages | no | yes |
| GuildVoiceStates | no | yes |
| GuildMessageReactions | no | yes |
| GuildModeration | no | yes |
| GuildMembers (Server Members) | yes | yes |
| MessageContent | yes | yes |
| GuildPresences | yes | no, not requested and not needed |

Do not apply for Presence. The code does not request it. Note: `src/commands/ai/roast.js`, `src/commands/utility/bots.js` and `src/commands/utility/server.js` read `member.presence`, which is always empty without the intent, so they report everyone as offline. TODO: remove or reword those fields before launch so nothing claims online counts the bot cannot see.

## Message Content intent

### Paste-ready justification

> mofu is an AI-native community bot. Its main feature is conversation: members talk to it by name or by mentioning it ("@mofu what time is it in Tokyo", "mofu mute that spammer"), and it replies in plain text or proposes an action that a moderator confirms with a button. Reading the text of a message is how it knows it was addressed and what it was asked. Replies use only the last few messages of that channel as context, and only when someone addresses the bot.
>
> Slash commands are the main path for everything else and do not need this intent: moderation, economy, leveling, music and configuration all work as slash commands. Message Content is needed for (1) the name trigger and mention chat described above, (2) the optional text prefix (for example `;ban`), which mirrors the slash commands, (3) automod features a server turns on itself: word filter, link filter, spam detection and the optional AI moderation check, and (4) server-configured autoresponders, custom commands and counting channels.
>
> We do not store message text in a log. The only message text kept is for features a moderator explicitly enables (see data handling below). Without the intent the bot stays usable: all slash commands work, and a message that @mentions the bot still reaches it, so mention chat keeps working.

### What needs it, and what degrades without it

| Feature | Where | Without the intent |
|---|---|---|
| Name trigger chat ("mofu ..." anywhere in a message) | `src/events/messageCreate.js` | stops; @mention at message start and replying to the bot still work (Discord delivers the text of messages that mention the bot) |
| Natural-language commands and AI mute/unmute/warn/kick proposals | `src/ai/router.js`, `src/ai/actions.js` | work when the message starts with an @mention; name-only phrasing stops |
| Prefix commands (`;ban`) | `messageCreate.js` | stop; the slash version of each command works |
| Automod: word filter, antilink, antispam, AI moderation check | `src/utils/automod.js`, `messageCreate.js` | stop |
| Autoresponders, custom commands, tags, counting, sticky messages | `messageCreate.js` | autoresponders, tags, counting stop; sticky depends on message events, not text (TODO verify) |
| Nightwatch alerts (shows a snippet of a new account's message) | `messageCreate.js` | the snippet is empty or the alert is skipped (TODO verify on a test bot) |
| Snipe (opt-in per server) and message delete/edit audit log text | `src/database/snipe.js`, `src/events/auditLog.js` | log shows no text for most messages |
| XP from chatting | `messageCreate.js` | does not depend on text (TODO verify the code path) |

Everything marked TODO verify needs a test run on a bot with the intent switched off. Use a scratch application, not the production bot.

## Server Members intent

Needed for: member join and leave events (welcome and goodbye cards, autorole, antiraid, nightwatch new-account check, join position, invite attribution), member update events (role-change audit log), and member list reads (`inrole`, `ghostcheck`, `staleperms`, `newusers`, member counts by role).

Justification text:

> mofu welcomes new members, assigns the server's chosen autorole, detects join raids and logs role changes. These all react to members joining, leaving or being updated, which Discord only sends with the Server Members intent. We store member and server ids and counts, not profile data.

Without it: slash commands that act on a user the invoker selects still work (Discord supplies that member with the interaction). Welcome and goodbye, autorole, antiraid, join logging and role-change logs stop, and member-list commands return partial data.

## Presence intent

Not used and not requested. Do not apply.

## Data handling summary

This must match the Privacy page (`web/src/pages/Privacy.jsx`), `/privacy` and `/forgetme`. Source of truth in code: `src/commands/utility/privacy.js`, `src/database/privacy.js`, `src/database/retention.js`.

- No message log. mofu does not keep a record of what members say.
- AI chat: when someone addresses the bot, the last few messages of that channel (up to 10, only those from the previous 20 minutes) plus the speaker's name and basic server facts are sent to the AI provider to produce a reply. Nothing from that is saved for chat replies.
- AI actions (propose a mute, kick and so on): the sentence that led to the proposal is stored with the action record and cleared after the retention period below. A moderator's real permissions are re-checked at proposal and at button press.
- Snipe is off unless a server turns it on; it keeps deleted or edited message snapshots for a short fixed window (see `MAX_AGE_MS` in `src/database/snipe.js`).
- Per-server data: XP, economy, moderation cases, settings and similar, keyed by server and member id.
- Deletion: when the bot is removed from a server, all of that server's data is deleted after 30 days (`RETENTION_DAYS` in `src/database/retention.js`). Members can run `/forgetme` to delete their own data, and `/privacy` explains what is stored.
- Backups: deleted data can remain in daily database backups until they rotate out (see `/privacy`).
- No sale of data. TODO: owner confirms this statement and lists the AI providers by name in the Privacy page (the code uses Groq, with Gemini wired as an optional second provider).
- Voice: the music feature streams audio out; it does not record voice. TODO: owner confirms no voice capture exists (nothing in `src/` records audio).

## Developer Policy checklist

- [ ] Verification submitted in the Developer Portal with real owner identity (TODO owner).
- [ ] Privacy Policy and Terms of Service URLs set in the application settings (pages exist in `web/src/pages/`; deployed URLs TODO).
- [ ] Message Content and Server Members justifications above pasted, with a short screen recording of AI chat and of a slash-only server (TODO owner).
- [ ] Invite requests no Administrator (`/invite` computes the set; `/invites link` and the website link must match, see launch-checklist.md).
- [ ] No selling or sharing of user data; no use of Discord data to train a model (TODO owner confirms provider terms).
- [ ] AI/automated moderation actions are proposals behind a confirm button, audit-tagged (true in `src/ai/actions.js`).
- [ ] Bot does not read DMs or user tokens, no self-botting, no mass DMs.
- [ ] Support contact reachable (support server link TODO).
- [ ] Data deletion on request works (`/forgetme`, 30-day removal purge: true in code, covered by `test/privacy.test.js` and `test/retention.test.js`).
- [ ] Team members on the application are real accounts of the owner (no alt or friend seeding to reach server counts).
