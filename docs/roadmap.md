# mofu roadmap (single source of truth)

Rule: one wave at a time. A wave is "done" only when tests pass, the owner has tried it in real Discord, and
the checklist below is ticked. Nothing new enters a wave once it starts; new ideas go to the Parking lot.

Source of every item: the 8 research reports (2026-11-08). Evidence labels in brackets.

## Launch cut line (what makes mofu worth switching to AND safe to launch)

### Wave 1 (running): foundations
- [ ] Case timeline, punishment presets, appeals  [verified need: shared mod history, no native appeals]
- [ ] Voice Case File, /vc mod commands, voice-flap and voice-raid alerts  [verified: no evidence in voice]
- [ ] Scam shield (burst across channels, QR login, staff lookalikes)  [plausible, 1 data source]
- [ ] Bug fixes: double logging, /logging reply, ticket Claim  [found by code audit]
- [ ] Gambling commands opt-in (App Directory risk)  [verified policy, enforcement single-source]
- [ ] /fm whoknows + crowns  [verified: fmbot leads with it]
- [ ] Gemini fallback provider + model comparison harness
- [ ] Verification docs, /invite (no Administrator), mention-first chat

### Wave 2: image moderation (needs Wave 1 Gemini + scam hook)
- [ ] Check whether Discord has a native explicit-image filter for servers (decides scope)
- [ ] Crowd-signal trigger: detect a burst of shock/mod-call replies and shock reactions after an image post
      (owner idea). Cheap, no vision call needed to fire; the vision classifier then runs ONLY on the suspect image.
      Adaptive per-channel baselines, mod Delete/Dismiss feedback tunes thresholds. Counters only, no stored text.
- [ ] Scope rule: build on Discord's own explicit-media filter, do not duplicate it (scam images, QR, server rules)
- [ ] Image/sticker/GIF classifier, opt-in, alert + Delete/Timeout buttons, fingerprints only
- [ ] Privacy policy line + paid Gemini tier before enabling

### Wave 3: growth and money
- [ ] Weekly health post for servers under 500 members  [verified gap: Insights needs 500 members]
- [ ] AI server-setup plan flow (confirm card)  [competitor parity]
- [ ] Free social alerts (YouTube RSS, Twitch)  [verified: rivals paywall]
- [ ] Pricing: free basics; Server Premium ~$4.99/mo (~Rs 199) after real cost numbers
- [ ] top.gg listing + vote rewards (weekend double)

## Before ANY public launch
- [ ] Owner tests Wave 1 in real Discord (list in the manager report)
- [ ] REGISTER_GLOBAL=1, SESSION_SECRET, DASHBOARD_CALLBACK_URL set
- [ ] Domain chosen; no sonder.gg anywhere
- [ ] Do not seed alt/friend servers (verification denial risk)
- [ ] Ask 5 real server owners: which bots would you drop, what do you still do by hand

## Parking lot (not now)
- Hinglish automod word list, study/pomodoro mode, /audit bots, catch-up digest (Discord may ship it),
  audio recording or transcription (off the table: E2E voice, consent, policy)

## Working method
- Manager agent plans and integrates, employee agents own disjoint files (see workflow wf_3a78e2b3-993).
- Commit and push after each wave, restart the bot after tests pass.
