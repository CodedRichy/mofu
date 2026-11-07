# mofu

mofu is a multipurpose Discord bot in Node.js with moderation, economy, leveling, music and AI commands, plus a web dashboard.

## What it does

- Every command works as a slash command and as a prefix command (`;ban`).
- Moderation, economy (daily, work, shop, blackjack, slots), leveling with rank cards, fun commands and trivia, and music playback through discord-player.
- Chat: say "mofu" (the old name "sonder" still works for now) to talk to it or ask for a mute, unmute, warn or kick.
- AI commands (`ask`, `persona`, `roast`, `sentiment`, `summarize`, `vibe`) call Groq's `llama-3.3-70b-versatile`. An OpenAI key is listed as an optional alternative in `.env.example`.
- A React and Vite dashboard in `web/`, with an Express API that uses Discord OAuth.

## Status

Pre-launch, version 0.1.0. There is no test suite. Guild and economy state goes through SQLite (`better-sqlite3`); PostgreSQL and Redis are optional. Commands are still registered per guild, not globally.

## Stack

Node.js 20+, discord.js 14, discord-player, better-sqlite3, optional PostgreSQL and Redis, Express 5 with Passport, React 18 and Vite.

## Run it

```bash
npm install
cp .env.example .env     # set DISCORD_TOKEN and DISCORD_CLIENT_ID at minimum
npm start                # node src/index.js

cd web && npm install && npm run dev    # dashboard
```

A `Dockerfile` is included.

## Permissions

mofu never asks for Administrator. The invite (run `;invite` or `/invite`) requests the minimum set, with the reason for each permission listed in the reply; the list lives in `src/commands/utility/invite.js` and a test fails if Administrator is ever added.

Intents: Server Members and Message Content are privileged. Slash commands and @mention chat work without Message Content; prefix commands and name triggers need it. Details and the verification text are in `docs/verification.md`.

## License

All rights reserved.
