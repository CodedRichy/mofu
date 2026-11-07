# Launch checklist

Ordered. Status is what the repo shows; anything about the live Discord portal, hosting or accounts is TODO for the owner.

## Before inviting anyone

1. [ ] Deploy on the VPS following `DEPLOY.md`, including daily backups. (TODO owner)
2. [ ] `REGISTER_GLOBAL=1` set in `.env`. Code supports it (`src/handlers/commandHandler.js`); the flag itself is not done until the production `.env` has it. Global command updates can take up to an hour.
3. [ ] `SESSION_SECRET` set (done in code: the bot refuses to start the dashboard in production without it; value is TODO).
4. [ ] `DASHBOARD_CALLBACK_URL` set to the production URL and the same redirect added in the Developer Portal. Not done: `.env.example` still has the localhost value.
5. [ ] Privacy and Terms pages deployed at public URLs. Pages are done (`web/src/pages/Privacy.jsx`, `Terms.jsx`); hosting is TODO. Put both URLs in the application settings.
6. [ ] Support server created and its invite linked from the website, Privacy page and application description. Not done (no link in the repo).
7. [ ] Status page: `web/src/pages/Status.jsx` and live status posts (`src/utils/statusPost.js`, needs `STATUS_CHANNEL_ID`) exist. Done in code; deployment TODO.
8. [ ] One invite link everywhere, with no Administrator: `/invite` (new) builds it from `src/commands/utility/invite.js`. Not done: `/invites link` (`src/commands/utility/invites.js`) still requests Administrator, and `web/src/lib/invite.js` uses its own bit set. Make both match `/invite`.
9. [ ] Fix presence-based fields (`roast`, `bots`, `server`) that show everyone offline because the Presence intent is not requested. Not done. See `docs/verification.md`.
10. [ ] App Directory page assets: icon, banner, short and long description, tags, privacy and terms URLs. TODO owner (no asset files in the repo for this).

## Growth and verification

11. [ ] Grow with real servers only. No alt accounts, no friend seeding, no server-count tricks; Discord reviews for this and it fails verification.
12. [ ] At 76 servers (past the 75 mark), apply for the Message Content and Server Members intents with the text in `docs/verification.md`. Bot verification itself is required before 100 servers, so submit it at the same time. Record a short demo of AI chat and a slash-only flow.
13. [ ] While waiting for approval, confirm mention chat and all slash commands work with the intent off (`src/utils/mentionTrigger.js`; integration still needs to be added to `messageCreate.js`).
14. [ ] top.gg listing: not done, and no top.gg code exists in the repo. Write the listing from facts the code backs, and use the same invite link. A vote reward is optional; if you add one, make it a small perk (extra daily coins, for example). Do not gate core features behind votes. Posting server counts to top.gg needs an API token and a small poster; not built.
15. [ ] Post-launch: watch error logs and the status channel for the first week; keep the 30-day removal purge (`src/database/retention.js`) running as documented.
