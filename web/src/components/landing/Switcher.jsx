import { useRef, useState } from 'react'
import { ArrowUpRight, Check } from 'lucide-react'
import { INVITE_PERMISSIONS } from '../../lib/invite'
import { Embed, BotIcon, clock } from './Discord'
import { BRAND } from '../../lib/brand'

// "Switching" as a stepper: each step shows what you actually see at that point.
// Step outputs are the real reply text of /migrate scan and /import warnings (src/commands/config), for a server
// that has Greed (one of the bots src/utils/migrate.js recognises), a #mod-logs and a #welcome channel. Both replies are ephemeral response() embeds.

const BITS = {
  1: 'Kick Members', 2: 'Ban Members', 4: 'Manage Channels', 5: 'Manage Server', 6: 'Add Reactions', 7: 'View Audit Log',
  10: 'View Channels', 11: 'Send Messages', 13: 'Manage Messages', 14: 'Embed Links', 15: 'Attach Files', 16: 'Read Message History',
  18: 'Use External Emoji', 20: 'Connect', 21: 'Speak', 22: 'Mute Members', 24: 'Move Members', 27: 'Manage Nicknames',
  28: 'Manage Roles', 30: 'Manage Expressions', 38: 'Send Messages in Threads', 40: 'Timeout Members',
}
// read the list off the invite link itself, so this panel can never drift from what the invite asks for
const PERMS = (() => {
  const p = BigInt(INVITE_PERMISSIONS)
  return Object.entries(BITS).filter(([b]) => (p >> BigInt(b)) & 1n).map(([, n]) => n)
})()

const STEPS = [
  { t: `Add ${BRAND}`, d: 'Next to your current bot. One invite, no Administrator permission.' },
  { t: 'Run /migrate scan', d: 'Finds the bot you are replacing, checks prefixes, and spots channels it can reuse. Changes nothing.' },
  { t: 'Import your warnings', d: 'Export warnings from your old bot as CSV and bring them over with /import warnings.' },
  { t: 'Talk to it', d: 'Ask in plain words. It shows exactly what it will do and waits for your button press.' },
]

function Reply({ cmd, color = 'primary', children }) {
  return (
    <div className="sw-reply">
      <div className="sw-cmdline"><span className="cd-ravatar" aria-hidden="true">M</span><b>Moderator</b><span>used</span><span className="dc-cmd">/{cmd}</span></div>
      <div className="sw-bot"><BotIcon size={32} /><div><div className="cd-who">{BRAND} <span className="cd-app">APP</span><span className="cd-time">Today at {clock()}</span></div>
        <Embed color={color} at={clock()}>{children}</Embed></div></div>
      <div className="sw-only">Only you can see this {'·'} Dismiss message</div>
    </div>
  )
}

function Panel({ i, onTry }) {
  if (i === 0) {
    return (
      <div className="sw-invite">
        <div className="sw-invite-head"><img src="/logo.jpg" alt="" /><div><b>{BRAND}</b><span>wants to join your server and will be able to:</span></div></div>
        <ul>{PERMS.map((p) => <li key={p}><Check size={14} aria-hidden="true" />{p}</li>)}</ul>
      </div>
    )
  }
  if (i === 1) {
    return (
      <Reply cmd="migrate scan">
        <b>Other bots here:</b> Greed (default prefix <code className="dc-code">,</code>)<br /><br />
        <b>Prefix:</b> {BRAND} uses <code className="dc-code">;</code>, so it will not collide with their defaults. If you changed their prefix, check it doesn't match.<br /><br />
        Both bots can stay while you move over. Turn off a feature on the old bot once {BRAND}'s version works, so nothing runs twice.<br /><br />
        <b>Channels {BRAND} can reuse</b><br />Mod log: <span className="dc-mention">#mod-logs</span> (not set)<br />Welcome: <span className="dc-mention">#welcome</span> (not set)<br /><br />
        Run <code className="dc-code">/migrate apply</code> to link the ones that are not set.<br /><br />
        <b>Warnings:</b> if your old bot can export them to a CSV, bring them over with <code className="dc-code">/import warnings</code>.<br />
        <b>Not transferable:</b> levels and economy balances (other bots give servers no export), so those start fresh. Your server's bans, roles and Discord AutoMod rules are unaffected.
      </Reply>
    )
  }
  if (i === 2) {
    return (
      <>
        <pre className="sw-csv" aria-label="Example CSV file, warnings.csv">{'user_id,reason,moderator,date\n448812093355773952,spamming invites,221034718840209408,2025-03-02\n993011873320611840,slurs in #general,221034718840209408,2025-04-11\nmember2,caps spam,,2025-05-30'}</pre>
        <Reply cmd="import warnings" color="success">
          Imported <b>2</b> warnings. They show up in <code className="dc-code">/warn list</code> marked "(imported)".<br /><br />
          Skipped lines:<br />- line 4: "member2" is not a user id.
        </Reply>
      </>
    )
  }
  return (
    <div className="sw-try">
      <p>The first thing most servers try:</p>
      <code className="dc-code">{BRAND} mute @member 10m for spamming links</code>
      <button type="button" className="ln-btn ln-btn--ghost sw-trybtn" onClick={onTry}>Try it in the demo <ArrowUpRight size={17} aria-hidden="true" /></button>
    </div>
  )
}

export function Switcher({ onTry }) {
  const [i, setI] = useState(1)
  const tabs = useRef([])
  const key = (e) => {
    const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]
    const n = d ? (i + d + STEPS.length) % STEPS.length : e.key === 'Home' ? 0 : e.key === 'End' ? STEPS.length - 1 : null
    if (n === null) return
    e.preventDefault(); setI(n); tabs.current[n]?.focus()
  }
  return (
    <div className="sw">
      <div className="sw-steps" role="tablist" aria-label="Switching steps" aria-orientation="vertical" onKeyDown={key}>
        {STEPS.map((s, n) => (
          <button key={s.t} ref={(el) => { tabs.current[n] = el }} type="button" role="tab" id={`sw-tab-${n}`} aria-selected={i === n} aria-controls="sw-panel" tabIndex={i === n ? 0 : -1}
            className={`sw-step ${i === n ? 'is-on' : ''} ${n < i ? 'is-past' : ''}`} onClick={() => setI(n)}>
            <span className="sw-n">{String(n + 1).padStart(2, '0')}</span>
            <span className="sw-txt"><b>{s.t}</b><span>{s.d}</span></span>
          </button>
        ))}
      </div>
      <div className="sw-panel" id="sw-panel" role="tabpanel" aria-labelledby={`sw-tab-${i}`} key={i}>
        <Panel i={i} onTry={onTry} />
      </div>
    </div>
  )
}
