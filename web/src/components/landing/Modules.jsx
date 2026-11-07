import { useState } from 'react'
import { Volume2, Hash, Paperclip } from 'lucide-react'
import { Embed, DButton, MemberIcon, BotIcon, clock } from './Discord'
import { ArtTile, DEMO_QUEUE } from './MusicPlayer'
import { BRAND } from '../../lib/brand'

// One mock per module, each copying what the bot really sends. Sources (all under src/):
//  tickets      commands/config/ticket.js:49-62, events/interactionCreate.js:147-263
//  logging      commands/config/logging.js:81-86, events/messageDelete.js, messageUpdate.js, voiceStateUpdate.js:80-91
//  leaderboard  commands/leveling/xpleaderboard.js:17-35
//  voicemaster  commands/config/voicemaster.js:25-93, events/voiceStateUpdate.js:19-68, commands/utility/voice.js
//  last.fm      commands/lastfm/fm.js:78-112
//  antinuke     commands/config/antinuke.js:25-118, database/antinuke.js:5-6, events/channelDelete.js:36-41
// Member names are generic; numbers are sample values.

const Bot = ({ children, at = clock(), content }) => (
  <div className="cd-msg">
    <div className="cd-avatar"><img src="/logo.jpg" alt="" /></div>
    <div className="cd-main">
      <div className="cd-who">{BRAND} <span className="cd-app">APP</span><span className="cd-time">Today at {at}</span></div>
      {content && <div className="cd-said">{content}</div>}
      {children}
    </div>
  </div>
)
const Used = ({ cmd, who = 'Moderator' }) => (
  <div className="sw-cmdline"><span className="cd-ravatar" aria-hidden="true">{who[0]}</span><b>{who}</b><span>used</span><span className="dc-cmd">/{cmd}</span></div>
)
const Only = () => <div className="sw-only">Only you can see this {'·'} Dismiss message</div>
const Chan = ({ name, children, icon }) => (
  <div className="ln-chan">
    <div className="ln-chanbar">{icon || <span>#</span>}{name}</div>
    {children}
  </div>
)

/* ---------------- tickets ---------------- */
export function TicketsMock() {
  // panel -> opened -> (claimed) -> closed
  const [s, setS] = useState({ open: false, claimed: false, closed: false })
  const reset = () => setS({ open: false, claimed: false, closed: false })
  return (
    <div className="ln-mockstack" aria-live="polite">
      <Chan name="support">
        <Bot>
          <div className="dc-card">
            <Embed author="Support Tickets" authorIcon={<MemberIcon name="Server" />}>
              Need help? Click the button below to open a ticket.<br />It opens a private channel that support staff can see.
            </Embed>
            <div className="dc-row">
              <DButton kind="primary" onClick={() => setS({ open: true, claimed: false, closed: false })} disabled={s.open && !s.closed}>{'🎫'} Open Ticket</DButton>
            </div>
          </div>
        </Bot>
        {s.open && <div className="cd-sys">Ticket created: <span className="dc-mention">#ticket-member</span> <span className="ln-eph">(only you can see this)</span></div>}
      </Chan>
      {s.open && (
        <Chan name="ticket-member">
          <Bot content={<span className="dc-mention">@Support</span>}>
            <div className="dc-card">
              <Embed author="Ticket Opened" authorIcon={<MemberIcon name="member" />}>
                Welcome <span className="dc-mention">@member</span>. Support staff can see this channel.<br />Describe your issue here.
              </Embed>
              {!s.closed && (
                <div className="dc-row">
                  <DButton kind="danger" onClick={() => setS((x) => ({ ...x, closed: true }))}>{'🔒'} Close Ticket</DButton>
                  <DButton kind="success" onClick={() => setS((x) => ({ ...x, claimed: true }))}>{'✋'} Claim</DButton>
                </div>
              )}
            </div>
          </Bot>
          {s.claimed && <Bot><Embed color="success">Ticket claimed by <span className="dc-mention">@Moderator</span></Embed></Bot>}
          {s.closed && <Bot><Embed color="muted">Ticket closed by <span className="dc-mention">@Moderator</span>. Deleting in 5 seconds...</Embed></Bot>}
        </Chan>
      )}
      {s.closed && (
        <Chan name="ticket-logs">
          <Bot>
            <Embed author={'Ticket Closed — ticket-member'}><b>Closed by</b> moderator<br /><b>Messages</b> 3</Embed>
            <div className="ln-file"><Paperclip size={15} aria-hidden="true" />ticket-member-transcript.txt</div>
          </Bot>
          <button type="button" className="ln-restart" onClick={reset}>Start over</button>
        </Chan>
      )}
    </div>
  )
}

/* ---------------- logging ---------------- */
export function LoggingMock() {
  return (
    <div className="ln-mockstack">
      <Chan name="mofu-logs">
        <Bot>
          <Embed color="error" footer={`ID: 1170433212880011264 - ${BRAND}`}>
            <b>Message deleted in</b> <span className="dc-mention">#general</span><br /><b>Author</b> member<br /><br />free nitro at this link
          </Embed>
        </Bot>
        <Bot>
          <Embed color="warning" footer={`ID: 1170433398410870784 - ${BRAND}`}>
            <b>Message edited in</b> <span className="dc-mention">#general</span> <span className="dc-link">Jump</span><br /><b>Author</b> member2<br /><br />
            <b>Before</b><br />see you at 8<br /><br /><b>After</b><br />see you at 9
          </Embed>
        </Bot>
        <Bot><Embed color="info"><b>member</b> joined voice channel <span className="dc-mention">#lounge</span></Embed></Bot>
      </Chan>
    </div>
  )
}
export function LoggingSettings() {
  return (
    <div className="ln-audit">
      <Used cmd="logging settings" />
      <div className="sw-bot"><BotIcon size={32} /><div>
        <div className="cd-who">{BRAND} <span className="cd-app">APP</span><span className="cd-time">Today at {clock()}</span></div>
        <Embed color="info">
          <b>Channel</b> <span className="dc-mention">#mofu-logs</span><br /><br />
          {'🟢'} message delete<br />{'🟢'} message edit<br />{'🟢'} voice<br /><br />
          Member join/leave, role and nickname events are not logged by this command yet.
        </Embed>
      </div></div>
    </div>
  )
}

/* ---------------- leaderboard ---------------- */
const LB = [['member', 24, 61240], ['member2', 22, 52310], ['user', 19, 40875], ['moderator', 15, 24420], ['member3', 12, 15990], ['member4', 9, 8730], ['member5', 7, 5210]]
export function LeaderboardMock() {
  const n = (x) => x.toLocaleString('en-US')
  const medal = ['🥇', '🥈', '🥉']
  return (
    <Chan name="general">
      <Used cmd="xpleaderboard" who="member" />
      <Bot>
        <Embed author={'Your Server — XP Leaderboard'} authorIcon={<MemberIcon name="Server" />}>
          {LB.slice(0, 3).map(([u, lv, xp], i) => (
            <div key={u} className="ln-lb-top">{medal[i]} <b><span className="dc-mention">@{u}</span></b><div className="ln-quote">Level <b>{lv}</b> {'·'} {n(xp)} XP</div></div>
          ))}
          <br />
          {LB.slice(3).map(([u, lv, xp], i) => (
            <div key={u}><code className="dc-code">{String(i + 4).padStart(2, ' ')}.</code> <span className="dc-mention">@{u}</span> {'·'} Lv {lv} {'·'} {n(xp)} XP</div>
          ))}
          <br />
          <div><code className="dc-code">14.</code> <b>You</b> {'·'} Lv 5 {'·'} {n(2860)} XP</div>
        </Embed>
      </Bot>
    </Chan>
  )
}

/* ---------------- voicemaster ---------------- */
export function VoiceMock() {
  const [inside, setInside] = useState(false)
  return (
    <div className="ln-mockstack">
      <div className="ln-audit">
        <Used cmd="voicemaster setup" />
        <div className="sw-bot"><BotIcon size={32} /><div>
          <div className="cd-who">{BRAND} <span className="cd-app">APP</span><span className="cd-time">Today at {clock()}</span></div>
          <Embed color="success">VoiceMaster enabled. Join <span className="dc-mention">{'🔊'} {'➕'} Create Channel</span> to create a channel.</Embed>
        </div></div>
      </div>
      <div className="ln-vc" aria-live="polite">
        <div className="ln-vc-cat">VOICE</div>
        <button type="button" className="ln-vc-ch" onClick={() => setInside(true)} disabled={inside} aria-label={inside ? 'Create Channel (you were moved to your own channel)' : 'Join Create Channel'}>
          <Volume2 size={16} aria-hidden="true" />{'➕'} Create Channel{!inside && <span className="ln-vc-hint">click to join</span>}
        </button>
        {inside && (
          <div className="ln-vc-new">
            <div className="ln-vc-ch is-on"><Volume2 size={16} aria-hidden="true" />member's channel</div>
            <div className="ln-vc-user"><MemberIcon name="member" size={22} />member <span className="ln-vc-own">owner</span></div>
            <button type="button" className="ln-restart" onClick={() => setInside(false)}>Leave (the empty channel is deleted)</button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------------- last.fm ---------------- */
export function LastfmMock() {
  const t = DEMO_QUEUE[2]
  return (
    <Chan name="music-talk">
      <div className="cd-msg cd-msg--me">
        <div className="cd-avatar cd-avatar--me" aria-hidden="true">M</div>
        <div className="cd-main"><div className="cd-who">member<span className="cd-time">Today at {clock()}</span></div><div className="cd-said">;fm</div></div>
      </div>
      <Bot>
        <Embed author={'member — Now Playing'} authorIcon={<MemberIcon name="member" />} thumb={<ArtTile />}>
          <b><span className="dc-link">{t.title}</span></b><br />by <b>{t.author}</b><br />on <i>Night Bus Tapes</i>
        </Embed>
      </Bot>
    </Chan>
  )
}

/* ---------------- antinuke ---------------- */
const AN = [['ban', 'Ban', 3], ['kick', 'Kick', 3], ['channel_delete', 'Channel Delete', 3], ['channel_create', 'Channel Create', 5], ['role_delete', 'Role Delete', 3], ['role_create', 'Role Create', 5]]
export function AntinukeMock() {
  const [lim, setLim] = useState(() => Object.fromEntries(AN.map(([k, , d]) => [k, d])))
  const [pick, setPick] = useState('channel_delete')
  const [said, setSaid] = useState(null)
  const label = (k) => k.replace('_', ' ')
  const set = (v) => { const n = Math.min(10, Math.max(2, v)); setLim((x) => ({ ...x, [pick]: n })); setSaid({ k: pick, n }) }
  return (
    <div className="ln-mockstack">
      <div className="ln-an-ctl" role="group" aria-label="Try /antinuke threshold">
        <span className="dc-cmd">/antinuke threshold</span>
        <label className="ln-an-f">action
          <select value={pick} onChange={(e) => setPick(e.target.value)}>{AN.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <span className="ln-an-f">limit
          <span className="ln-an-step">
            <button type="button" onClick={() => set(lim[pick] - 1)} aria-label="Lower limit" disabled={lim[pick] <= 2}>-</button>
            <output aria-live="polite">{lim[pick]}</output>
            <button type="button" onClick={() => set(lim[pick] + 1)} aria-label="Raise limit" disabled={lim[pick] >= 10}>+</button>
          </span>
        </span>
      </div>
      {said && (
        <div className="ln-audit">
          <Used cmd="antinuke threshold" who="Owner" />
          <div className="sw-bot"><BotIcon size={32} /><div>
            <div className="cd-who">{BRAND} <span className="cd-app">APP</span><span className="cd-time">Today at {clock()}</span></div>
            <Embed color="success">Threshold for <b>{label(said.k)}</b> set to <b>{said.n}</b> actions in 10s.</Embed>
          </div></div>
        </div>
      )}
      <div className="ln-audit">
        <Used cmd="antinuke settings" who="Owner" />
        <div className="sw-bot"><BotIcon size={32} /><div>
          <div className="cd-who">{BRAND} <span className="cd-app">APP</span><span className="cd-time">Today at {clock()}</span></div>
          <Embed color="success">
            <b>Status</b> {'🟢'} Enabled<br /><br /><b>Thresholds</b> (per 10s)<br />
            {AN.map(([k]) => <span key={k}><b>{label(k)}</b> {'—'} {lim[k]}<br /></span>)}
            <br /><b>Whitelisted</b> None
          </Embed>
        </div></div>
      </div>
    </div>
  )
}
export function AntinukeAlert() {
  return (
    <Chan name="mod-logs">
      <Bot>
        <Embed color="error">
          <b>Antinuke triggered</b><br /><b>User</b> compromised-admin <code className="dc-code">300119875533220864</code><br /><b>Trigger</b> Mass channel delete<br />
          <b>Ban</b> done<br /><b>Roles stripped</b> done<br /><b>Channel recreated (empty, no permission overwrites)</b> done
        </Embed>
      </Bot>
    </Chan>
  )
}

export { Hash }
