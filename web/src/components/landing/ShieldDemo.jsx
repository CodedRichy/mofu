import { useState } from 'react'
import { BRAND } from '../../lib/brand'
import { Embed, BotIcon, clock } from './Discord'

// Mini-demo: the settings command, answered with the bot's own wording. Both strings are copied from
// src/commands/config/scamshield.js (sub 'on' / 'off'). Real default is off, so the demo starts there.
const REPLY = {
  on: ['success', <>Scam shield is <b>on</b>. Staff with Manage Messages and trusted roles are ignored. Flagged accounts are timed out, not banned.</>],
  off: ['muted', <>Scam shield is <b>off</b>.</>],
}

export function ShieldDemo() {
  const [state, setState] = useState('off')
  const [color, body] = REPLY[state]
  return (
    <div className="sd">
      <div className="sd-row">
        <span className="sd-lab" id="sd-lab">Run in your server</span>
        <div className="sd-seg" role="group" aria-labelledby="sd-lab">
          {['on', 'off'].map((s) => (
            <button key={s} type="button" className="sd-opt" aria-pressed={state === s} onClick={() => setState(s)}>
              <code>/scamshield {s}</code>
            </button>
          ))}
        </div>
      </div>
      <div className="sw-bot sd-bot">
        <BotIcon size={32} />
        <div aria-live="polite">
          <div className="cd-who">{BRAND} <span className="cd-app">APP</span><span className="cd-time">Today at {clock()}</span></div>
          <Embed color={color} at={clock()}>{body}</Embed>
          <div className="sw-only">Only you can see this {'·'} Dismiss message</div>
        </div>
      </div>
      <p className="sd-note">It is off until a server admin turns it on. It looks for hijacked-account scam waves, login QR scams and staff lookalikes.</p>
    </div>
  )
}
