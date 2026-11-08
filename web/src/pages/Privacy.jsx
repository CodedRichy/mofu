import { Layout } from '../components/Layout'
import { BRAND } from '../lib/brand'

// Every line here must be true of the code in src/. Sources: src/commands/utility/privacy.js,
// src/database/privacy.js, src/database/retention.js, src/utils/backup.js, docs/verification.md.
const h2 = { fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-2)', marginBottom: 'var(--space-2)' }
const list = { marginTop: 'var(--space-2)', paddingLeft: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }
const strong = { color: 'var(--fg-2)' }

function Item({ label, children }) {
  return <li><strong style={strong}>{label}</strong> — {children}</li>
}

export function Privacy() {
  return (
    <Layout>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: 'var(--space-16) var(--space-6)' }}>
        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)',
          fontWeight: 'var(--weight-bold)', color: 'var(--fg-1)',
          letterSpacing: 'var(--tracking-tight)', marginBottom: 'var(--space-8)',
        }}>
          privacy policy
        </h1>

        <div style={{ fontSize: 'var(--text-base)', color: 'var(--fg-3)', lineHeight: 1.8, display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          <p style={{ color: 'var(--fg-4)', fontSize: 'var(--text-sm)' }}>Last updated: November 2026</p>

          <section>
            <h2 style={h2}>what we collect</h2>
            <p>{BRAND} stores the minimum data needed to function, keyed by Discord server and user IDs:</p>
            <ul style={list}>
              <Item label="Server config">settings you configure (welcome messages, modlog channel, prefix, automod rules and so on)</Item>
              <Item label="Moderation cases">for each moderation action (warning, mute, kick, ban and so on): the member's and moderator's user IDs and usernames, the action, the reason text the moderator typed, the duration and timestamps</Item>
              <Item label="Appeals">the case it is about, the appellant's user ID and username, the reason text they typed, its status, who resolved it and when</Item>
              <Item label="Chat action log">when someone asks {BRAND} to mute, warn or kick in chat, we record who asked, who it was about, the reason, the outcome, and the first 300 characters of the request. Server admins can read it with /aiactions. The request text is cleared after 30 days</Item>
              <Item label="Economy & XP">balances, inventory, cooldowns and experience points per user per server. Economy uses virtual coins only</Item>
              <Item label="Last.fm">if you link an account with /fm set, your Last.fm username, and for server rankings the artist, your user ID and play count for crowns you hold. /fm privacy hide takes you out of the rankings and removes your crowns in that server</Item>
              <Item label="Health post">off by default. If a server turns on the weekly health post, we keep counters only: joins, leaves and messages per channel per day, plus new members' IDs and join times (14 days) and the message and author IDs of unanswered questions in help channels (7 days). No message text</Item>
              <Item label="Server insights">for the dashboard Insights tab, always on: one number per server per day for messages (bots left out), joins and leaves, and one number per command per day. No user IDs, channel IDs or message text. Kept for 90 days</Item>
              <Item label="Alerts">for YouTube and RSS alerts a server sets up: the feed URL, label, target channel, who added it, and hashes of entries already posted</Item>
            </ul>
          </section>

          <section>
            <h2 style={h2}>what we don't collect</h2>
            <ul style={list}>
              <li>We do not keep a log of your messages. Text is stored only when someone saves it on purpose (a quote, tag, reason, appeal or /memory note), or in the snipe buffer and chat action log described here</li>
              <li>{BRAND} never hears or records voice audio. Music only plays audio out</li>
              <li>We do not track users across servers</li>
              <li>We do not sell or share data with advertisers</li>
              <li>We do not log DMs</li>
            </ul>
          </section>

          <section>
            <h2 style={h2}>AI features</h2>
            <p>Some features send text to a third-party AI provider: Groq, and Google's Gemini when it is configured as the main or backup provider.</p>
            <ul style={list}>
              <Item label="AI commands">(ask, vibe, sentiment, summarize, roast, persona, plan) send the text they act on</Item>
              <Item label={`Talking to ${BRAND}`}>when a message contains the word "{BRAND}" (or its old name, "sonder", while the rename settles) or mentions the bot, that message plus the last few messages in the channel (up to 10, from the previous 20 minutes) and the server and channel name are sent so it can reply in context. It cannot see anything else</Item>
              <Item label="Server notes">admins can save short facts with /memory. They are stored with the server's settings and sent along with chat replies so {BRAND} knows them</Item>
              <Item label="AI moderation">is off by default. If a server admin turns it on, messages from members without Manage Messages are sent to be checked</Item>
            </ul>
            <p style={{ marginTop: 'var(--space-2)' }}>{BRAND} does not store this text after the response, apart from the chat action log above. Each provider processes it under its own terms and privacy policy. Bot actions requested in chat (like a mute) are never decided by the AI: they are parsed by code, checked against the requester's real permissions, and need a button confirmation.</p>
          </section>

          <section>
            <h2 style={h2}>image checks</h2>
            <p>Image checks are off by default. When a server turns them on, an image is checked only when the chat reacts to it with alarm (or it comes from an account under 7 days old, if the server also chose that, or an admin is running /imagemod test). That one image is checked for login QR codes on our host and processed by Google's Gemini, which requires a paid-tier API key. The image is not stored: we keep only daily counters and a short fingerprint in memory.</p>
          </section>

          <section>
            <h2 style={h2}>scam shield</h2>
            <p>Scam shield is off by default. When on, it looks for scam waves (the same message posted across several channels within seconds), login-stealing QR links and staff lookalikes, keeping short-lived hashes, IDs and timestamps in memory. It never stores message text or images.</p>
          </section>

          <section>
            <h2 style={h2}>voice reports</h2>
            <p>{BRAND} keeps a short in-memory timeline of voice events (join, leave, move, server mute or deafen, stream or camera on and off) for the last 15 minutes, which is lost on restart. When someone files /reportvc, the user IDs and times from that timeline, who was in the channel, and the reporter's optional note are saved in the case.</p>
          </section>

          <section>
            <h2 style={h2}>deleted and edited messages</h2>
            <p>Snipe is off unless a server turns it on. Then, to power the snipe commands, {BRAND} keeps the last 10 deleted messages, edited messages, removed reactions and purges per channel (text, author, and attachment link) for 2 hours. Server admins can clear a channel's buffer, and it is deleted with the rest of the server's data.</p>
          </section>

          <section>
            <h2 style={h2}>backups</h2>
            <p>The whole database is snapshotted once a day and the newest 7 snapshots are kept, so deleted data can stay in a backup for about 7 more days. Admins can download their server's settings, tags and role panel definitions with /backup export; that file holds no message text and, once downloaded, is in the admin's hands.</p>
          </section>

          <section>
            <h2 style={h2}>data retention and removal</h2>
            <p>Server data is retained as long as {BRAND} is in your server. When {BRAND} is removed, all of that server's data (settings, moderation records, economy, XP, reminders, snipe buffer, everything keyed to the server) is kept for 30 days in case of accidental removal, then permanently deleted automatically. Re-adding {BRAND} within the 30 days restores it and cancels the deletion.</p>
            <p style={{ marginTop: 'var(--space-2)' }}>Any member can run /forgetme to delete their own XP, economy, inventory, cooldowns, reminders, birthday, invite record, AFK, timezone and Last.fm settings, quotes of them and snipe entries, in one server or every server. Moderation records (warnings, notes, cases, appeals, chat action logs) are kept, because they belong to the server's safety record. /privacy shows this summary in Discord.</p>
          </section>

          <section>
            <h2 style={h2}>dashboard authentication</h2>
            <p>The web dashboard uses Discord OAuth2 for authentication. We receive your Discord user ID, username, and server list. We never see your Discord password, and the sign-in token is kept in your browser, not on our servers.</p>
          </section>

          <section>
            <h2 style={h2}>changes</h2>
            <p>We may update this policy. Material changes will be announced in the support server.</p>
          </section>

          <p style={{ color: 'var(--fg-4)', fontSize: 'var(--text-sm)', borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-6)' }}>
            Questions about your data? Reach out through our Discord support server.
          </p>
        </div>
      </div>
    </Layout>
  )
}
