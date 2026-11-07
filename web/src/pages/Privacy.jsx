import { Layout } from '../components/Layout'

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
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-2)', marginBottom: 'var(--space-2)' }}>what we collect</h2>
            <p>Sonder stores the minimum data needed to function:</p>
            <ul style={{ marginTop: 'var(--space-2)', paddingLeft: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <li><strong style={{ color: 'var(--fg-2)' }}>Server config</strong> — settings you configure (welcome messages, modlog channels, prefix, automod rules)</li>
              <li><strong style={{ color: 'var(--fg-2)' }}>Moderation data</strong> — warnings, notes, and modlog entries for your server</li>
              <li><strong style={{ color: 'var(--fg-2)' }}>Chat action log</strong> — when someone asks Sonder to mute, warn or kick in chat, we record who asked, who it was about, the reason, the outcome, and the first 300 characters of the request. Server admins can read it with /aiactions. It is deleted with the rest of the server's data</li>
              <li><strong style={{ color: 'var(--fg-2)' }}>Economy & XP</strong> — balances, inventory, and experience points per user per server</li>
              <li><strong style={{ color: 'var(--fg-2)' }}>User IDs</strong> — Discord user and server IDs to associate data with the correct accounts</li>
            </ul>
          </section>

          <section>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-2)', marginBottom: 'var(--space-2)' }}>what we don't collect</h2>
            <ul style={{ paddingLeft: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <li>We do not keep a log of your messages. The only message text we store is the short-lived snipe buffer described below</li>
              <li>We do not track users across servers</li>
              <li>We do not sell or share data with advertisers</li>
              <li>We do not log DMs</li>
            </ul>
          </section>

          <section>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-2)', marginBottom: 'var(--space-2)' }}>AI features</h2>
            <p>Some features send message text to a third-party AI provider (Groq) for processing:</p>
            <ul style={{ marginTop: 'var(--space-2)', paddingLeft: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <li><strong style={{ color: 'var(--fg-2)' }}>AI commands</strong> (ask, vibe, sentiment, summarize, roast, persona) send the text they act on</li>
              <li><strong style={{ color: 'var(--fg-2)' }}>Talking to Sonder</strong> — when a message contains the word "sonder" or mentions the bot, that message plus the last few messages in the channel are sent so it can reply in context. It cannot see anything else</li>
              <li><strong style={{ color: 'var(--fg-2)' }}>AI moderation</strong> is off by default. If a server admin turns it on, messages from members without Manage Messages are sent to be checked</li>
            </ul>
            <p style={{ marginTop: 'var(--space-2)' }}>Sonder does not store this text after the response. Groq processes it under its own terms and privacy policy. Bot actions requested in chat (like a mute) are never decided by the AI: they are parsed by code, checked against the requester's real permissions, and need a button confirmation.</p>
          </section>

          <section>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-2)', marginBottom: 'var(--space-2)' }}>deleted and edited messages</h2>
            <p>To power the snipe commands, Sonder keeps the last 10 deleted and last 10 edited messages per channel (text, author, and attachment link) until newer ones replace them. Server admins can clear a channel's buffer, and it is deleted with the rest of the server's data.</p>
          </section>

          <section>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-2)', marginBottom: 'var(--space-2)' }}>data retention</h2>
            <p>Server data is retained as long as Sonder is in your server. When Sonder is removed, all of that server's data (settings, moderation records, economy, XP, reminders, snipe buffer, everything keyed to the server) is kept for 30 days in case of accidental removal, then permanently deleted automatically. Re-adding Sonder within the 30 days restores it and cancels the deletion.</p>
          </section>

          <section>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-2)', marginBottom: 'var(--space-2)' }}>your rights</h2>
            <p>You can request deletion of all data associated with your server by removing Sonder and contacting us. Server owners can view stored data through the dashboard.</p>
          </section>

          <section>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-2)', marginBottom: 'var(--space-2)' }}>dashboard authentication</h2>
            <p>The web dashboard uses Discord OAuth2 for authentication. We receive your Discord user ID, username, and server list. We do not store your Discord password or OAuth tokens beyond the active session.</p>
          </section>

          <section>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-2)', marginBottom: 'var(--space-2)' }}>changes</h2>
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
