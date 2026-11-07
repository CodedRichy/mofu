import { Layout } from '../components/Layout'
import { BRAND } from '../lib/brand'

export function Terms() {
  return (
    <Layout>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: 'var(--space-16) var(--space-6)' }}>
        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)',
          fontWeight: 'var(--weight-bold)', color: 'var(--fg-1)',
          letterSpacing: 'var(--tracking-tight)', marginBottom: 'var(--space-8)',
        }}>
          terms of service
        </h1>

        <div style={{ fontSize: 'var(--text-base)', color: 'var(--fg-3)', lineHeight: 1.8, display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          <p style={{ color: 'var(--fg-4)', fontSize: 'var(--text-sm)' }}>Last updated: November 2026</p>

          <section>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-2)', marginBottom: 'var(--space-2)' }}>1. acceptance</h2>
            <p>By adding {BRAND} to your Discord server or using its commands, you agree to these terms. If you don't agree, remove the bot.</p>
          </section>

          <section>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-2)', marginBottom: 'var(--space-2)' }}>2. the service</h2>
            <p>{BRAND} is a Discord bot that provides moderation, economy, leveling, music, and AI-powered community features. The service is provided as-is. We may modify or discontinue features at any time.</p>
          </section>

          <section>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-2)', marginBottom: 'var(--space-2)' }}>3. your responsibilities</h2>
            <p>You are responsible for how {BRAND} is configured in your server. Do not use the bot to harass, spam, or violate Discord's Terms of Service. We may restrict access to servers that misuse the bot.</p>
          </section>

          <section>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-2)', marginBottom: 'var(--space-2)' }}>4. data</h2>
            <p>{BRAND} stores server configuration, moderation logs, economy balances, and XP data. We do not sell your data. See our Privacy Policy for details on what we collect and how long we keep it.</p>
          </section>

          <section>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-2)', marginBottom: 'var(--space-2)' }}>5. AI features</h2>
            <p>AI-powered commands send message content to third-party language model providers for processing. These messages are not stored by {BRAND} beyond the immediate response. By using AI commands, you consent to this processing.</p>
          </section>

          <section>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-2)', marginBottom: 'var(--space-2)' }}>6. limitation of liability</h2>
            <p>{BRAND} is provided without warranty. We are not liable for any damages arising from bot downtime, data loss, or misconfiguration. Virtual currency and items have no real-world value.</p>
          </section>

          <section>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-2)', marginBottom: 'var(--space-2)' }}>7. changes</h2>
            <p>We may update these terms. Continued use after changes constitutes acceptance.</p>
          </section>

          <p style={{ color: 'var(--fg-4)', fontSize: 'var(--text-sm)', borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-6)' }}>
            Questions? Reach out through our Discord support server.
          </p>
        </div>
      </div>
    </Layout>
  )
}
