import { useState } from 'react'
import { ShieldCheck, MessageSquareText, Music2, Trophy, Swords, Timer, Plus } from 'lucide-react'
import { Embed, MemberIcon, clock } from './Discord'
import { BRAND } from '../../lib/brand'

// Capability rows that open to show the real reply. Each embed copies its builder:
// /history (src/commands/moderation/history.js), refusal (actions.js say -> response error),
// /loop (src/commands/music/loop.js), /rank (src/commands/leveling/rank.js + utils/visuals bar),
// antinuke (src/events/channelDelete.js). Numbers inside are sample values.

const rankBar = (p, w = 12) => '▰'.repeat(Math.round(p * w)) + '▱'.repeat(w - Math.round(p * w))

const ROWS = [
  {
    icon: ShieldCheck, t: 'Moderation you can read',
    d: 'Mute, warn, kick, ban, jail, purge and notes. Every action posts to your mod log with the moderator and the reason.',
    cmd: '/history user:@member',
    ex: () => (
      <Embed color="primary" author="member" authorIcon={<MemberIcon name="member" />} thumb={<MemberIcon name="member" size={80} />} at={clock()}
        fields={[{ name: '⚠️ Warnings', value: <>
          <code className="dc-code">#14</code> spamming links (via {BRAND} AI)<br />{'▸'} <span className="dc-mention">@Moderator</span> {'•'} 2 days ago<br />
          <code className="dc-code">#9</code> caps spam (imported)<br />{'▸'} <span className="dc-mention">@Moderator</span> {'•'} 3 months ago
        </> }]}>
        <b>2</b> warnings {'·'} <b>0</b> notes
      </Embed>
    ),
  },
  {
    icon: MessageSquareText, t: 'Chat that does things, safely',
    d: 'Mute, unmute, warn and kick from plain words. Code, not the model, decides what runs, and it checks your permissions twice.',
    cmd: `${BRAND} kick @admin`,
    ex: () => <Embed color="error" at={clock()}>you can't kick someone with a higher or equal role.</Embed>,
  },
  {
    icon: Music2, t: 'A record player in chat',
    d: `Play from a search or a link. Queue, loop, shuffle, volume and lyrics, from slash, prefix or "${BRAND} play".`,
    cmd: `${BRAND} loop track`,
    ex: () => <Embed color="success" at={clock()}>Loop mode set to <b>track</b></Embed>,
  },
  {
    icon: Trophy, t: 'Leveling, with voice XP',
    d: 'XP for chat and for time in voice, rank, a server leaderboard and level-up announcements. Plus an economy: daily, bank, shop, games.',
    cmd: '/rank',
    ex: () => (
      <Embed color="primary" author="member" authorIcon={<MemberIcon name="member" />} thumb={<MemberIcon name="member" size={80} />} at={clock()}>
        <b>Rank</b> #3 of 41<br /><b>Level</b> 12<br /><b>XP</b> 1,240 / 1,500<br /><br />
        <span className="dc-bar">{rankBar(0.82)}</span> <b>82%</b><br />260 XP to level 13
      </Embed>
    ),
  },
  {
    icon: Swords, t: 'Protection',
    d: 'Antinuke that reads the audit log to find who did it, plus anti-raid, anti-spam, link and word filters.',
    cmd: 'antinuke alert',
    ex: () => (
      <Embed color="error" at={clock()}>
        <b>Antinuke triggered</b><br /><b>User</b> compromised-admin <code className="dc-code">300119875533220864</code><br /><b>Action</b> Mass channel delete {'—'} user banned, channel restored
      </Embed>
    ),
  },
  {
    icon: Timer, t: 'Your data, on a timer',
    d: `Remove ${BRAND} and your server's rows are deleted 30 days later. Add it back inside the window and nothing is lost.`,
    cmd: null,
    ex: () => (
      <ol className="cp-tl">
        <li><b>Day 0</b> {BRAND} is removed from the server</li>
        <li><b>Day 1-29</b> Add it back and everything is still there</li>
        <li><b>Day 30</b> Every row stored for that server is deleted</li>
      </ol>
    ),
  },
]

export function Capabilities() {
  const [open, setOpen] = useState(0)
  return (
    <ul className="cp">
      {ROWS.map(({ icon: Icon, t, d, cmd, ex }, i) => {
        const on = open === i
        return (
          <li key={t} className={`cp-row ${on ? 'is-open' : ''}`}>
            <h3 className="cp-h3">
              <button type="button" className="cp-head" aria-expanded={on} aria-controls={`cp-${i}`} id={`cp-b-${i}`} onClick={() => setOpen(on ? -1 : i)}>
                <span className="cp-ico" aria-hidden="true"><Icon size={18} strokeWidth={1.75} /></span>
                <span className="cp-t">{t}</span>
                <span className="cp-plus" aria-hidden="true"><Plus size={18} /></span>
              </button>
            </h3>
            <p className="cp-d">{d}</p>
            <div className="cp-more" id={`cp-${i}`} role="region" aria-labelledby={`cp-b-${i}`} hidden={!on}>
              {cmd && <div className="cp-cmd">{cmd}</div>}
              {on && ex()}
              {i === 3 && <p className="cp-note">Sample numbers.</p>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
