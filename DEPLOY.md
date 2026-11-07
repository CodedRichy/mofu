# Deploying mofu

One small VPS runs everything: the bot, its SQLite database and the dashboard API. A 2 vCPU / 2 GB machine
(Hetzner CX22 or similar, about 4-5 EUR a month) is plenty until you are well into thousands of servers.

> The Docker image has not been built on the development machine (no Docker there). Treat the first build on the
> VPS as the test, and read the build output before trusting it.

## 1. Server

Ubuntu 24.04, a non-root user with sudo, SSH keys only.

```bash
sudo apt update && sudo apt install -y ca-certificates curl git ufw
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # log out and back in
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
```

Port 3001 is bound to `127.0.0.1` by the compose file on purpose. Never open it to the internet directly.

## 2. Configure

```bash
git clone <your repo url> sonder && cd sonder
cp .env.example .env && nano .env
```

| Variable | Needed | Notes |
|---|---|---|
| `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` | yes | Developer Portal. Never commit them. |
| `GROQ_API_KEY` | for AI | Chat and moderation. Without it the AI features stay silent. |
| `REGISTER_GLOBAL=1` | production | Registers slash commands in every server. Updates can take up to an hour to appear. |
| `DISCORD_CLIENT_SECRET`, `DASHBOARD_URL`, `DASHBOARD_CALLBACK_URL` | for the dashboard | Must match the OAuth redirect in the Developer Portal. |
| `LASTFM_API_KEY` | optional | `;fm` commands. |

## 3. Run

```bash
docker compose up -d --build
docker compose ps                  # STATUS should reach "healthy" within about a minute
docker compose logs -f sonder      # expect: Logged in as ..., Registered N global slash commands
curl -s http://127.0.0.1:3001/healthz   # {"ok":true}
```

If the build fails on `better-sqlite3`, the image already installs `python3 make g++`; send me the log.

## 4. HTTPS for the dashboard (only if you use it)

```bash
sudo apt install -y caddy
printf 'api.example.com {\n  reverse_proxy 127.0.0.1:3001\n}\n' | sudo tee /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Point an `A` record for `api.example.com` at the VPS first. Set `DASHBOARD_URL` to wherever the web app is hosted.
The web app itself (`cd web && npm ci && npm run build`) is static: put `web/dist` on Cloudflare Pages.

## 5. Backups (do this before inviting anyone)

The whole database is one file in the `sonder-data` volume. Take a consistent copy daily:

```bash
mkdir -p ~/backups
docker compose exec -T sonder node -e "
  const D=require('better-sqlite3');
  new D('data/sonder.db').backup('data/backup.db').then(()=>console.log('ok'))"
docker compose cp sonder:/app/data/backup.db ~/backups/sonder-$(date +%F).db
find ~/backups -name 'sonder-*.db' -mtime +14 -delete
```

Put those lines in a script and run it from `crontab -e` (`0 4 * * *`). Copy `~/backups` off the machine as well.
Test a restore once: stop the bot, copy a backup over `data/sonder.db` in the volume, start it.

## 6. Updating

```bash
git pull && docker compose up -d --build
```

Pending confirmation cards (chat mute/kick) are held in memory, so they expire on restart. That is intentional and safe.

## 7. Before the public launch

- Discord asks for bot verification at 75 servers. Prepare: the privacy policy and terms URLs
  (`/privacy`, `/terms` on the site), a description of why each privileged intent is needed
  (Message Content: prefix commands, "mofu" (or old "sonder") chat, AutoMod; Server Members: welcome, autorole, moderation),
  and a support server link.
- Past about 2,500 servers Discord requires sharding. `shard.js` is already there: change the compose command to
  `node shard.js`.
- Set `SESSION_SECRET` to a long random value (`openssl rand -hex 32`).
- Run `/migrate scan` in your own server and read what a new admin would see.
- Watch the first day: `docker compose logs -f sonder | grep -i "warn\|error"`.
- Full ordered list: `docs/launch-checklist.md`. Intents and verification text: `docs/verification.md`. Invite only with the `;invite` link (no Administrator).
