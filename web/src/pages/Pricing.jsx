import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { Layout } from '../components/Layout'
import { INVITE_URL } from '../lib/invite'
import { BRAND } from '../lib/brand'
import '../styles/landing.css'
import '../styles/pricing.css'

// Honesty rules for this page: every Free item was checked against src/commands (file named beside it); the AI
// numbers come from src/utils/aiBudget.js defaults; competitor facts come from their own pages, checked 2026-11-08
// (saved text in logs/greed-text.txt and logs/jar-text.txt, Greed's live Premium page, MEE6's help article).
// No price for Premium, no buy button, no waitlist: none of those exist.
const CHECKED = '8 Nov 2026'
const GREED_PREMIUM = 'https://greed.best/premium'
const MEE6_TABLE = 'https://help.mee6.xyz/en/articles/710936-mee6-free-vs-premium-plans-comparison'

const FREE = [
  ['Moderation', 'case numbers, warns, tempbans and appeals'], // moderation/case, warn, tempban, appeal
  ['Levels', 'text and voice XP, level roles'], // leveling/leveling (voice), levelrole
  ['Logging', 'deletes, edits, joins and voice'], // config/logging
  ['Tickets', 'private channels, transcripts on close'], // config/ticket
  ['Music', 'one live player card per server'], // music/*
  ['Last.fm', 'now playing, whoknows, crowns'], // lastfm/fm
  ['Reaction roles', 'button and reaction panels'], // config/reactionrole
  ['Tags', 'saved replies anyone can use'], // utility/tag
  ['Voice reports', 'a snapshot of who is in the channel'], // moderation/reportvc
  ['Antinuke and VoiceMaster', 'limits on mass deletes, join-to-create voice'], // config/antinuke, voicemaster
  ['Scam shield', 'scam links and staff lookalikes, off by default'], // config/scamshield
  ['Chat AI', 'confirm buttons on every action, with a generous daily allowance'], // src/ai/actions.js, aiBudget
  ['85+ slash commands', 'each one also works with the prefix'], // commands.json: 86 slash
]

const LATER = [
  'A higher daily AI allowance',
  'Longer history and backup retention',
  'Image checks for the scam shield',
  'Priority support',
]

// Published prices and limits. src: [label, href|null]
const PRICES = [
  { bot: 'Greed', plan: 'Free', price: 'Free', limit: '75 AI chat assistant requests a day; 5 AI questions a day', src: ['greed.best/premium', GREED_PREMIUM] },
  { bot: 'Greed', plan: 'User Premium', price: '$5.99 a month or $59.99 a year', limit: '75 AI chat assistant requests a day; 200 AI questions a day', src: ['greed.best/premium', GREED_PREMIUM] },
  { bot: 'Greed', plan: 'Server Premium', price: '$69.99 a year', limit: '1,500 AI chat assistant requests a day', src: ['greed.best/premium', GREED_PREMIUM] },
  { bot: 'MEE6', plan: 'Premium', price: 'Paid plan', limit: 'Its own comparison marks XP and levels, welcome and goodbye messages, reaction roles and moderation as not on Free', src: ['MEE6 help: Free vs Premium', MEE6_TABLE] },
  { bot: 'Jar', plan: '-', price: 'Pricing not published on the page we checked', limit: '-', src: ['Jar homepage', null] },
  { bot: BRAND, plan: 'Free', price: 'Free', limit: 'A daily AI allowance per server (see note 1)', src: ['this page', null], us: true },
  { bot: BRAND, plan: 'Server Premium', price: 'Not for sale', limit: '-', src: ['this page', null], us: true },
]

// Feature rows. mofu cells were checked against src/commands; Greed and Jar cells are what each lists on its own
// homepage. y = has it / lists it, n = not yet (mofu) or not seen on their page (others). A string adds detail.
const ROWS = [
  ['Moderation commands', 'y', 'y', 'y'],
  ['Antinuke', 'y', 'y', 'n'],
  ['Music player', 'y', 'y', ['y', 'Spotify, SoundCloud and more']],
  ['Levels with voice XP', 'y', 'y', 'n'],
  ['Logging', 'y', 'y', 'n'],
  ['Tickets with transcripts', 'y', 'y', 'n'],
  ['VoiceMaster (temporary voice channels)', 'y', 'y', 'y'],
  ['Last.fm with whoknows and crowns', 'y', ['y', 'also collages'], 'n'],
  ['AI that asks before it changes anything', ['y', 'mute, unmute, warn, kick, and commands by sentence'], 'y', 'n'],
  ['Reminders, snipe, translate, giveaways', 'y', 'y', 'n'],
  ['Web dashboard', ['part', 'settings, moderation, levels, economy'], 'y', 'n'],
  ['Analytics charts', ['n', 'text stats only: /channelstats, /besttime'], 'y', 'n'],
  ['Image editing', 'n', 'y', 'n'],
  ['Roblox, Valorant and other game lookups', 'n', 'y', 'n'],
  ['Custom bot name and avatar per server', 'n', 'y', 'n'],
  ['Reposting TikTok and Twitter posts', 'n', 'n', 'y'],
  ['AutoPost from curated sources', 'n', 'n', 'y'],
  ['Servers, as shown on its homepage', ['txt', 'Pre-launch'], ['txt', '301,603'], ['txt', 'Over 55,500']],
]
const COLS = [BRAND, 'Greed', 'Jar']

function Cell({ v, us }) {
  const [k, note] = Array.isArray(v) ? v : [v, null]
  if (k === 'txt') return <span className="pr-txt">{note}</span>
  const label = k === 'y' ? (us ? 'Yes' : 'Listed') : k === 'part' ? 'Partly' : us ? 'Not yet' : '-'
  return (
    <span className={`pr-mark pr-mark--${k}`}>
      <i aria-hidden="true" />
      <span className="pr-mark-l">{label}</span>
      {note && <span className="pr-mark-n">{note}</span>}
    </span>
  )
}

function Ext({ href, children }) {
  return <a className="pr-ext" href={href} target="_blank" rel="noopener noreferrer">{children}<ArrowUpRight size={13} aria-hidden="true" /></a>
}

function AddToDiscord() {
  if (INVITE_URL) return <a className="ln-btn ln-btn--primary pr-add" href={INVITE_URL}>Add to Discord</a>
  return <span className="ln-btn ln-btn--primary pr-add is-off" role="link" aria-disabled="true">Add to Discord</span>
}

export function Pricing() {
  return (
    <Layout wide>
      <main className="ln pr">
        <header className="pr-top">
          <div className="ln-eyebrow">Pricing</div>
          <h1 className="pr-h1">The basics stay free. <span>Nothing is for sale yet.</span></h1>
          <p className="ln-lede pr-lede">Everything under Free works on every server today. No trial, no card, no paid tier holding a feature back.</p>
        </header>

        <section className="pr-plans" aria-label="Plans">
          <div className="pr-free">
            <div className="pr-plan-head">
              <h2 className="pr-plan-name">Free</h2>
              <p className="pr-plan-tag">Every server, today</p>
            </div>
            <ul className="pr-ledger">
              {FREE.map(([t, d]) => (
                <li key={t}>
                  <b>{t}{t === 'Chat AI' && <sup><a href="#pr-note-1" aria-label="Note 1">1</a></sup>}</b>
                  <span>{d}</span>
                </li>
              ))}
            </ul>
            <div className="ln-cta pr-cta">
              <AddToDiscord />
              <Link className="ln-textlink" to="/commands">Browse commands</Link>
            </div>
          </div>

          <div className="pr-later" aria-labelledby="pr-later-h">
            <div className="pr-plan-head">
              <h2 className="pr-plan-name pr-plan-name--muted" id="pr-later-h">Server Premium</h2>
              <p className="pr-plan-tag">Coming later</p>
            </div>
            <div className="pr-slot" role="note">
              <span className="pr-slot-k">Price</span>
              <span className="pr-slot-v">Not set</span>
            </div>
            <p className="pr-later-p">What it would add, if it ships:</p>
            <ul className="pr-later-list">{LATER.map((x) => <li key={x}>{x}</li>)}</ul>
            <p className="pr-later-p pr-later-fine">No buy button and no waitlist, because there is nothing to buy. If Premium ships, everything under Free stays free.</p>
          </div>
        </section>

        <section className="pr-notes" aria-label="How it stays free">
          <div>
            <h2 className="pr-h3">How we keep it free</h2>
            <p>Storing a server's settings costs almost nothing. AI replies are the one real cost per server, so each server gets a daily AI allowance.<sup><a href="#pr-note-1" aria-label="Note 1">1</a></sup> When a server uses it up, AI replies pause until it refills. Everything that is not AI keeps working.</p>
          </div>
          <div>
            <h2 className="pr-h3">Your data</h2>
            <p>Remove {BRAND} and everything stored for your server is deleted 30 days later. Add it back within those 30 days and it is all still there. The <Link to="/privacy">privacy policy</Link> lists exactly what is kept.</p>
          </div>
        </section>

        <section className="pr-compare" aria-labelledby="pr-cmp">
          <div className="ln-eyebrow">Compare</div>
          <h2 className="ln-h2" id="pr-cmp">What the others publish.</h2>
          <p className="pr-checked">
            Prices and limits as published on each bot's own site, checked {CHECKED}. They change; check their pages:{' '}
            <Ext href={GREED_PREMIUM}>Greed Premium</Ext>{' '}
            <Ext href={MEE6_TABLE}>MEE6 Free vs Premium</Ext>
          </p>

          <h3 className="pr-h3 pr-tablehead" id="pr-prices">Plans and AI limits</h3>
          <div className="pr-tablewrap">
            <table className="pr-table pr-table--prices" aria-labelledby="pr-prices">
              <thead><tr><th scope="col">Bot</th><th scope="col">Plan</th><th scope="col">Price</th><th scope="col">Limits and notes</th><th scope="col">Source</th></tr></thead>
              <tbody>
                {PRICES.map((r, i) => (
                  <tr key={i} className={r.us ? 'is-us' : undefined}>
                    <th scope="row" data-l="Bot">{r.bot}</th>
                    <td data-l="Plan">{r.plan}</td>
                    <td data-l="Price">{r.price}</td>
                    <td data-l="Limits">{r.limit}</td>
                    <td data-l="Source">{r.src[1] ? <Ext href={r.src[1]}>{r.src[0]}</Ext> : r.src[0]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="pr-h3 pr-tablehead" id="pr-features">Features each bot lists</h3>
          <p className="pr-checked">The {BRAND} column was checked against its own code. Greed and Jar show what each lists on its homepage; a dash means we did not see it there, not that it does not exist.</p>
          <div className="pr-tablewrap">
            <table className="pr-table pr-table--feat" aria-labelledby="pr-features">
              <thead><tr><th scope="col">Feature</th>{COLS.map((c) => <th scope="col" key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {ROWS.map(([f, ...cells]) => (
                  <tr key={f}>
                    <th scope="row">{f}</th>
                    {cells.map((v, i) => <td key={i} data-l={COLS[i]}><Cell v={v} us={i === 0} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="pr-foot">
          <p id="pr-note-1"><b>1.</b> Current limits per server: 3,000 AI calls a day, 20 a minute for chat and AI commands, and 30 a minute for AI automod checks. A shared per-minute limit across all servers also applies.</p>
          <p>{BRAND} is independent and not affiliated with Greed, Jar or MEE6. Their names belong to their owners.</p>
        </footer>
      </main>
    </Layout>
  )
}
