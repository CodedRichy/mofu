# Competitors and switch triggers - 2026-11

Researched 2026-11-08. Builds on greed-bot-reference.md and jar-bot-reference.md (not repeated). Many bot pricing pages are JS-only or returned 403; prices marked UNVERIFIED come only from peakbot.pro, a competing bot's SEO blog.

## Switch triggers (ranked)

1. **Paywalled basics, MEE6 above all.** MEE6's own comparison (dated 2026-06-16) marks "XP and Levels", "Welcome & Goodbye messages", "Reaction Role", "Custom commands" and "Moderation" as NOT on Free (https://help.mee6.xyz/en/articles/710936-mee6-free-vs-premium-plans-comparison). Trustpilot, 2026-11-04: "a lot of features used to be free but are now behind a paywall" (https://www.trustpilot.com/review/mee6.xyz).
2. **Losing XP history.** Every leveling rival leads with import: Lurkr "Import & Never Lose Progress" (https://lurkr.gg), Koya "direct importer for MEE6 and Amari" (https://koya.gg/en/features/leveling-bot).
3. **Role-reward caps.** Koya: 10 free, 50 Premium, unlimited Pro (koya URL above).
4. **AI the owner did not ask for.** Trustpilot 2026-08-31: "I don't use any AI features ... I wish they didn't exist" (trustpilot URL above). Our AI must be opt-in and confirm-gated.
5. Speed, broken dashboards, dead features: covered in the greed notes.

## Paywall gaps we can undercut

| Bot | Servers | Paid | Gated |
|---|---|---|---|
| MEE6 | 21.5M (https://discordbotlist.com/bots/mee6) | ~$11.95/mo per server UNVERIFIED (https://peakbot.pro/blog/why-is-mee6-so-expensive-2026) | leveling, welcome, reaction roles, custom cmds (official) |
| Carl-bot | 15.4M (https://discordbotlist.com/bots/carl-bot) | ~$7.99/mo UNVERIFIED | more command blocks (1 free, 3 premium, https://tagscript-docs.readthedocs.io/en/latest/BlockReference/commands.html) |
| Dyno | 9.64M (https://discordbotlist.com/bots/dyno) | $4.99/$11.99/$14.99 UNVERIFIED (https://peakbot.pro/blog/peakbot-vs-dyno) | UNVERIFIED |
| Arcane | 3.14M (https://discordbotlist.com/bots/arcane) | $4.99-$7 UNVERIFIED | voice XP is premium (official: https://docs-arcane-bot.pages.dev/plugins/leveling/setup/xp-options) |
| Sapphire | 1.88M (https://discordbotlist.com/bots/sapphire) | free; donations unlock no features (https://www.patreon.com/sapphbot/about) | none |
| Wick | 1.05M (https://discordbotlist.com/bots/wick) | Patreon, price UNVERIFIED | backups/restore, panic modes, join-raid; basic antinuke free |
| Lurkr (growing) | 70k (https://lurkr.gg) | premium raises limits only | none |

Mimu: no server count, pricing or site found (UNVERIFIED). Per-bot praise and complaint lists could not be pulled from top.gg (403); UNVERIFIED.

**Undercut:** leveling, voice XP, unlimited role rewards, welcome cards, reaction roles and custom commands free, forever. Sapphire already gives all of this away, so "free" alone is no moat. Speed, import and AI must carry the pitch.

## Features we are missing (ranked by impact)

The repo already has reaction roles, level roles, voice XP, welcome cards, tickets, custom commands, backups, logging, `/migrate scan` and a CSV warnings import.

1. **MEE6 XP + role-reward import.** Not built. Highest-leverage switching tool.
2. **Public leaderboard page.** Ours is behind dashboard login (src/dashboard/server.js:458); MEE6 and Koya publish one.
3. **Status page with live uptime numbers.** Lurkr shows "99.9%" uptime (lurkr URL above).
4. **Rank-card customization** (Koya charges for it).
5. **Scripting depth** comparable to Carl tags (UNVERIFIED how much owners rely on it).

## Migration/import reality

- MEE6 has no official API or export. Wrappers call an undocumented route that "is subject to change at any point of time" and only works after the owner enables "Make my server's leaderboard public", otherwise 401 (https://github.com/rjt-rockx/mee6-levels-api). 100 users per page (https://github.com/hyperevo/mee6-py-api).
- Lurkr imports MEE6 levels and role rewards with `/importxp`: Admin only, once per hour (https://lurkr.gg/docs/guides/importing-levels-from-other-bots).
- Arcane cannot be imported: it requires "special authorization on your behalf" (lurkr URL above). Amari's API is taken down; Polaris is retired (JSON file only).
- MEE6 ToS text could not be retrieved (UNVERIFIED). Lowest-risk design: the owner runs the command, the owner has made the leaderboard public, we read once, never on a schedule, back off on errors, and the command can be switched off remotely. Also accept a CSV upload so a dead route does not block switching.

## Platform risks

- **Changed 2026-06-10:** privileged intent review now triggers at more than 10,000 unique users who can see the app, not at a server count. The app keeps running and joining servers during review, but loses access if it does not apply within 90 days. Requests are denied when the use case "can be accomplished through interactions" (https://docs.discord.com/developers/gateway/getting-started-with-privileged-intent-review).
- **Prefix commands are the weak justification.** Discord points to slash commands as the replacement (same URL). Justify MESSAGE_CONTENT with automod, XP and the "sonder" trigger. Without the intent we still receive messages that mention the bot and DMs (https://docs.discord.com/developers/events/gateway#privileged-intents). A mention-based trigger survives a denial.
- **The 100-server verification cap** is reported by third parties (https://wisechecker.com/?p=5508). There is no official 2026 page; UNVERIFIED.

## Website copy angles

- Proof that works: stats bar with servers, members, uptime and messages, plus "Trusted by" server logos (Lurkr). Koya shows no proof at all, just a FAQ.
- "Bring your levels. Keep your ranks." Lead with import.
- "Leveling, welcome and reaction roles are free. Not a trial." State it plainly and link MEE6's own table.
- "AI that asks first." The confirm button answers the anti-AI complaint.
- Do not publish a server count or uptime figure until we have real numbers.

## Top 5 things to build next

1. MEE6 levels + role-reward importer (owner-triggered, public leaderboard, rate-limited), plus a CSV fallback.
2. Mention-first AI trigger and an intent-review justification doc, ready before 10k users.
3. Public, linkable server leaderboard page.
4. Public status page with measured uptime and command latency.
5. Landing page: free-forever table versus MEE6, import-first hero, real stats bar.
