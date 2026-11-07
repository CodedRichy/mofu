# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

mofu (formerly Sonder) is an AI-native Discord bot (discord.js v14, Node.js). Combines multipurpose bot features (moderation, economy, leveling, music) with AI-powered community intelligence. Pre-launch. No domain owned yet (sonder.gg is NOT ours); do not link to it.

**Brand:** the name is always lowercase `mofu`, even at the start of a sentence. Use `BRAND` from `src/utils/constants.js` in user-facing text; chat triggers come from `TRIGGER_WORDS` (`mofu` and the old `sonder`, kept during the transition). `test/brand.test.js` fails on the old name in `src/` unless it is an internal name (db file, cookie/storage keys, env vars, backup files) or the line has `// brand-ok: <why>`. Internal names (repo, `data/sonder.db`, package and docker service names, config keys) intentionally stay `sonder`.

## Commands

```bash
npm start          # Start bot (node src/index.js)
npm run dev        # Start with --watch (auto-restart on file changes)
```

`npm test` runs the node:test suite. No linter configured. No build step — plain JS, no transpilation.

## Architecture

**Entry:** `src/index.js` — loads events from `src/events/`, loads commands via `src/handlers/commandHandler.js`, connects DB (non-fatal if unavailable), logs into Discord.

**Dual command system:** Every command works as both slash (`/ban`) and prefix (`;ban`). Commands are written against the slash interaction API. `src/utils/prefixContext.js` wraps prefix messages to mirror the interaction API, so commands have a single `execute()` function for both.

**Command registration:** Currently guild-scoped (instant updates for dev). Switch to `Routes.applicationCommands` (global) before production — see `src/handlers/commandHandler.js:38-43`.

**Command structure:** `src/commands/<category>/<name>.js` — each exports `{ data: SlashCommandBuilder, execute: async fn }`. The handler auto-discovers categories by scanning subdirectories.

**Embed system:** All embeds go through `src/utils/embed.js` — `base()`, `modAction()`, `dmNotice()`, `response()`. Colors in `src/utils/constants.js`. Brand color is indigo `0x6366f1`. Every embed gets a branded footer + timestamp.

**Data layer:** `src/database/store.js` is SQLite (better-sqlite3, `data/sonder.db`) with a write-through config cache (`getConfig`/`setConfig`; call `clearConfigCache` after raw SQL deletes). `src/database/retention.js` purges a guild's rows 30 days after the bot leaves (any table with a `guild_id` column is covered automatically). PostgreSQL and Redis are wired but optional and unused.

**AI:** `src/utils/ai.js` (Groq: gpt-oss-20b for moderation, qwen3.8-27b for chat). Saying "mofu" (or the old name "sonder") in chat is handled in `messageCreate.js`; actions (mute, unmute, warn, kick) are parsed by code in `src/ai/actions.js`, permission-checked at proposal and button press. Per-server notes via `/memory` (config key `ai_notes`).

**Tests:** `npm test` (node:test, `test/*.test.js`). **Deploy:** `docker compose up -d --build`; set `REGISTER_GLOBAL=1` for global slash commands.

**Modlog:** `src/utils/modlog.js` — reads `modlog_channel` from store, posts formatted embeds for every mod action. Silent no-op if no channel configured.

**Prefix:** Default `;`, per-guild configurable via store. Config key: `prefix`.

## Key Patterns

- Mod commands follow: validate permissions → validate hierarchy → DM target → execute action → reply with embed → post modlog
- Error responses use `response()` with `colors.error` and `ephemeral: true`
- Duration parsing via `src/utils/duration.js` — accepts `30m`, `1h`, `1d`, `1w`
- New commands: create file in `src/commands/<category>/`, export `{ data, execute }` — auto-loaded on restart

## Competitive Context

Reference docs in `research/` — greed (80k servers, slow/broken, no AI) and jar (42k servers, aesthetic embeds, no leveling). mofu must beat both on speed (<200ms target), reliability, embed quality, and AI features.

## Environment

Requires `.env` with `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`. Database/Redis URLs optional for dev. See `.env.example`.
