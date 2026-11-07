# mofu operations

Run book for the single-process bot. Keep this short and true; update it when behavior changes.

## Health check

`GET /healthz` (dashboard port, default 3001, bound to 127.0.0.1 in Docker). No auth, no secrets, no guild names.
Returns 200 only when Discord is ready and the database answers, otherwise 503.

Fields: `ok`, `discord.ready`, `discord.wsPingMs`, `db.ok`, `uptimeSeconds`, `providers.groq` / `providers.gemini`
(true when a key is configured, never the key), `commands` (loaded command count), `lastBackupAt` (ISO time of the
newest snapshot, or null), `sharding` (`sharded` true only when running under a ShardingManager).

## Backups

Two different things:

1. `/backup export` (admin): a JSON file with server settings, punishment presets, voiceguard / scamshield / gambling
   settings, tags and role panel definitions. `version` is 2; version 1 files still import. It holds no message text,
   tokens or secrets. Import restores settings and tags (existing tags are kept). Role panels are listed in the file
   but must be rebuilt by hand, because their messages live in Discord. Cases, levels, economy and other member data
   are NOT in this file; they are only in the database snapshots below.
2. Daily SQLite snapshot of the whole database: `data/backups/sonder-YYYYMMDD-HHMM.db` (UTC), newest 7 kept.
   Disable with `BACKUPS=0`.

### Second copy on another drive

The snapshot folder is on the same disk as the database, so a dead disk takes both. Set `BACKUP_COPY_DIR` to a path on
another drive or a mounted share and each snapshot is also copied there (written as `.tmp`, then renamed), newest 7
kept. A failure is logged as a warning and never blocks the bot. If the target was away, the newest missing snapshot
is copied on the next hourly check. In Docker, mount that path as a volume first or the copy lands inside the container.

## Restore data/sonder.db

The filename stays `data/sonder.db`.

1. Stop the bot (`docker compose stop`, or stop the node process). Do not copy over a running database.
2. Keep the broken files: move `data/sonder.db`, `data/sonder.db-wal` and `data/sonder.db-shm` into a dated folder.
   A stale `-wal` next to a restored file corrupts it, so the old `-wal` / `-shm` must not stay in place.
3. Copy the chosen snapshot (from `data/backups` or `BACKUP_COPY_DIR`) to `data/sonder.db`.
4. Start the bot and check `/healthz` (`db.ok` true) and a command that reads data.
5. Anything written after the snapshot time is gone (up to one day). Deleted-user data can reappear from an old
   snapshot: re-run any `/forgetme` requests made since, and keep this in mind before restoring.

Docker volume: `docker compose run --rm --no-deps -v "$PWD/restore:/restore" sonder sh -c "cp /restore/sonder-XXXX.db /app/data/sonder.db"`
with the service stopped, after moving the old files away.

## Environment variables

| Variable | Needed | Meaning |
|---|---|---|
| DISCORD_TOKEN, DISCORD_CLIENT_ID | yes | Bot login and application id |
| REGISTER_GLOBAL | production | `1` registers slash commands globally; otherwise guild-scoped for development |
| SESSION_SECRET | production | Signs dashboard sessions; the app refuses to start without it when `NODE_ENV=production`. Generate with `openssl rand -hex 32` |
| DASHBOARD_CALLBACK_URL | production | OAuth callback, must match the Discord developer portal. Defaults to localhost |
| GROQ_API_KEY | for AI | Groq provider |
| GEMINI_API_KEY | optional | Gemini fallback provider; healthz shows whether it is set |
| AI_CHAT_PROVIDER | optional | `groq` (default), `gemini` or `auto`: who answers chat |
| AI_MOD_PROVIDER | optional | Same choices, for classifiers and utility calls |
| BACKUP_COPY_DIR | optional | Second location for daily snapshots (see above) |
| BACKUPS | optional | `0` turns the daily snapshot off |
| TRUST_PROXY | behind a proxy | Lets rate limits see the real client IP |

## Docker notes

- `docker compose up -d --build`. Volumes: `sonder-data` (database and snapshots) and `sonder-logs`. Never run
  `docker compose down -v`; it deletes the data volume.
- The dashboard port is bound to 127.0.0.1:3001. Put Caddy or nginx with TLS in front; do not publish it directly.
- Point the container healthcheck or an external monitor at `/healthz`.
- Updating: `git pull`, `docker compose up -d --build`. The database migrates itself on start. Snapshot first
  if the release touches tables.
- Use the same `BACKUP_COPY_DIR` volume mount across rebuilds.

## Sharding readiness

Today the bot is one process (`src/index.js`). `src/shard.js` exists and uses a discord.js `ShardingManager`, but the
bot is not verified under it. Discord requires sharding at 2,500 servers; plan before that, not at it.

### In-memory state that breaks under sharding

Each shard process would hold its own copy, so anything keyed across guilds or shared across users misbehaves:

- Pending proposal maps and per-guild/per-user proposal rate windows (`src/ai/actions.js`). A confirm button pressed
  on a different shard than the one that proposed it finds nothing. Buttons route to the shard that owns the guild, so
  this is mostly safe per guild, but restarts still lose them.
- Command router cooldown (`src/ai/router.js`), chat cooldown and spam tracker (`src/events/messageCreate.js`).
- Ring buffers and windows: anti-raid join log, anti-nuke action log, voice-flap windows, scam shield burst windows
  and the planned crowd-signal windows. Per guild, so shard-safe as long as a guild always lives on one shard; lost on
  restart.
- Starboard message map, rolepanel busy locks and reset timers, ticket locks, active blackjack games and heist lobbies.
- Music: live players and cards are bound to the shard process that holds the voice connection.
- Config cache in `src/database/store.js`: each process caches settings. A write on one shard (for example from the
  dashboard API) does not invalidate another shard's cache.
- Anything that reads `client.guilds.cache.size` or `client.commands.size` (public stats, healthz) sees only its own
  shard.
- Timers: giveaway timers, reminders, tempban sweep and the retention sweep run in every shard process unless guarded.
  They must not double-fire; the DB claim (`end()` returning null the second time) protects giveaways, check the rest.
- The dashboard server binds one port; a second shard process would collide.

### What breaks at what scale

| Scale | Symptom | Action |
|---|---|---|
| under about 1,000 servers | none expected on one process | stay single-process |
| 1,000 to 2,000 | slower startup, higher memory, cache churn | measure memory and gateway ping; plan migration |
| 2,500 | Discord refuses a single shard connection | must be sharded |
| many writers | SQLite file shared by processes: writer lock contention | move hot tables to Postgres (already wired, unused) |

Numbers are planning guesses except 2,500, which is Discord's limit. Measure before acting.

### Migration plan

1. Run `src/shard.js` in staging with `totalShards: 2` on a test bot and fix what breaks (list above).
2. Run the dashboard API and `/healthz` in the ShardingManager parent, not in shards; answer stats with
   `client.shard.fetchClientValues` / `broadcastEval` aggregates.
3. Make cross-shard state shared: move pending actions to the database (`src/database/aiActions.js` already stores
   proposals), config cache invalidation through shard messaging or a short TTL, and rate limits to the database or Redis.
4. Guard timers so exactly one process runs sweeps (shard 0 only, or DB claims).
5. Switch SQLite to Postgres if write contention shows up. SQLite WAL with several processes works for light writes only.
6. Roll out: `totalShards: 'auto'`, restart during a quiet hour, watch `/healthz` on the parent.

## Incident checklist

1. Check `/healthz`. 503 with `discord.ready` false: gateway or token problem. `db.ok` false: disk full, locked or
   corrupt file.
2. Read recent logs (`docker compose logs --tail 200`). Look for the first error, not the last.
3. Bot online but commands fail: check `commands` count in healthz and that `REGISTER_GLOBAL=1` is set.
4. AI silent: check `providers` in healthz. Both false means keys are missing; an outage upstream is expected to fall
   back to the other provider when one is configured.
5. Disk or database trouble: stop the bot, copy `data/` somewhere safe, then follow the restore steps above.
6. Suspected bad release: roll back the image, restore the last snapshot only if the data itself is damaged.
7. Suspected token leak: reset the token in the Discord developer portal first, then update `.env` and restart.
8. After recovery, check `lastBackupAt` is recent and write down what happened and what changed.
