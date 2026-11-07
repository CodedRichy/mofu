import { Layout } from '../components/Layout'

const h2 = { fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-2)', marginBottom: 'var(--space-2)' }
const list = { marginTop: 'var(--space-2)', paddingLeft: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }
const strong = { color: 'var(--fg-2)' }
const code = { fontFamily: 'var(--font-mono, monospace)', color: 'var(--fg-2)' }

export function Switch() {
  return (
    <Layout>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: 'var(--space-16) var(--space-6)' }}>
        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)',
          fontWeight: 'var(--weight-bold)', color: 'var(--fg-1)',
          letterSpacing: 'var(--tracking-tight)', marginBottom: 'var(--space-3)',
        }}>
          switching to sonder
        </h1>
        <p style={{ color: 'var(--fg-3)', marginBottom: 'var(--space-8)' }}>
          You do not have to pick a day and flip everything. Run Sonder next to your current bot, move one feature at a time, and remove the old one when you are happy.
        </p>

        <div style={{ fontSize: 'var(--text-base)', color: 'var(--fg-3)', lineHeight: 1.8, display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          <section>
            <h2 style={h2}>the five minute version</h2>
            <ol style={list}>
              <li>Add Sonder to your server.</li>
              <li>Run <span style={code}>/migrate scan</span>. It lists the other bots it can see, warns you if a prefix would clash, and finds the log and welcome channels you already have.</li>
              <li>Run <span style={code}>/migrate apply</span> to link those channels. It only fills settings that are still empty and never overwrites one.</li>
              <li>Turn a feature on in Sonder, check it works, then turn the same feature off on the old bot so nothing runs twice.</li>
              <li>When the old bot has nothing left to do, kick it.</li>
            </ol>
          </section>

          <section>
            <h2 style={h2}>what moves over</h2>
            <ul style={list}>
              <li><strong style={strong}>Bans, roles, channels, AutoMod rules</strong> live in Discord, so they are untouched.</li>
              <li><strong style={strong}>Log, welcome and goodbye channels</strong> are detected by name and linked with one command.</li>
              <li><strong style={strong}>Warnings</strong> come across with <span style={code}>/import warnings</span> if your old bot can export them to a CSV (user id, reason, and optionally moderator and date). Dates are kept and the entries are marked "(imported)".</li>
              <li><strong style={strong}>Setup templates</strong> (<span style={code}>/quicksetup</span>) switch on moderation, leveling and starboard in one step.</li>
            </ul>
          </section>

          <section>
            <h2 style={h2}>what does not</h2>
            <p>Levels and economy balances start fresh: other bots give servers no export, so there is nothing for us to import. If your old bot can export a file of them, tell us in the support server and we will look at supporting it.</p>
          </section>

          <section>
            <h2 style={h2}>what is different</h2>
            <ul style={list}>
              <li><strong style={strong}>Talk to it.</strong> Anyone you allow can say "sonder mute kai 10m spam" in chat. Sonder checks that person's real permissions and role order, shows a confirm button only they can press, and tags the action in the audit log. The AI never decides what runs.</li>
              <li><strong style={strong}>It knows your server.</strong> <span style={code}>/memory</span> lets admins teach it short facts about the community. It reads only the last few messages in the channel, never a log of everything.</li>
              <li><strong style={strong}>Slash and prefix.</strong> Every command works both ways, and the prefix is yours to change.</li>
              <li><strong style={strong}>Your data goes away.</strong> Remove Sonder and everything stored for your server is deleted after 30 days. Read the <a href="/privacy" style={{ color: 'var(--fg-2)' }}>privacy policy</a> for exactly what is kept.</li>
            </ul>
          </section>

          <section>
            <h2 style={h2}>if something goes wrong</h2>
            <p>Both bots can stay in your server as long as you like. Sonder never removes another bot or changes its settings. Ask in the support server and we will help you move the rest.</p>
          </section>
        </div>
      </div>
    </Layout>
  )
}
