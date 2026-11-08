import { BRAND } from '../../lib/brand'
import { Embed, DButton, BotIcon, MemberIcon, clock } from './Discord'

// A scripted Discord conversation, CSS only. Every step fades in on its own delay (see .hs-step in landing.css);
// with prefers-reduced-motion the animations are off and the final state is simply there.
// What it shows is what the bot does:
//  - "what time is it in <place>" is answered from the clock in code (src/utils/tzIntent.js answerTimeQuestion),
//    same Intl format and sentence, so the time below is the visitor's real "now" in Dubai.
//  - a mute request gets a proposal card (src/ai/actions.js proposalCard): command, reason, target, who can
//    confirm and the permission it needs, expiry (120 s), buttons "Mute" (danger) and "Cancel".
//  - pressing it posts the mod-action embed (src/utils/embed.js modAction) and writes to the mod log.
const dubaiAnswer = () => {
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dubai', weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true })
    return `It is ${f.format(new Date())} in Dubai (Asia/Dubai).`
  } catch { return 'It is 6:41 PM in Dubai (Asia/Dubai).' }
}

function Who({ name, bot, at }) {
  return (
    <div className="cd-who">
      {name}{bot && <> <span className="cd-app">APP</span></>}<span className="cd-time">Today at {at}</span>
    </div>
  )
}

function Row({ n, bot, name, at, children, typing }) {
  return (
    <div className={`hs-step hs-s${n} ${typing ? 'hs-typing' : ''}`}>
      <div className="hs-msg">
        <div className="cd-avatar">{bot ? <img src="/logo.jpg" alt="" /> : <MemberIcon name={name} size={36} />}</div>
        <div className="cd-main"><Who name={name} bot={bot} at={at} />{children}</div>
      </div>
    </div>
  )
}

export function HeroScene() {
  const at = clock()
  return (
    <figure className="hs" aria-label={`A short example conversation with ${BRAND}`}>
      <img className="hs-peek" src="/logo.jpg" alt="" width="84" height="84" />
      <div className="hs-bar"><span className="hs-hash">#</span>general<span className="hs-dots" aria-hidden="true"><i /><i /><i /></span></div>
      <div className="hs-log" role="log">
        <Row n={1} name="dana" at={at}><p className="hs-text">{BRAND} what time is it in dubai</p></Row>
        <div className="hs-step hs-t1" aria-hidden="true"><span className="hs-wait"><BotIcon size={20} /><b>{BRAND}</b> is typing<i /><i /><i /></span></div>
        <Row n={2} bot name={BRAND} at={at}><p className="hs-text">{dubaiAnswer()}</p></Row>

        <Row n={3} name="Moderator" at={at}><p className="hs-text">{BRAND} mute <span className="dc-mention">@jinx</span> 10m spam</p></Row>
        <div className="hs-step hs-t2" aria-hidden="true"><span className="hs-wait"><BotIcon size={20} /><b>{BRAND}</b> is typing<i /><i /><i /></span></div>
        <Row n={4} bot name={BRAND} at={at}>
          <div className="hs-card">
            <Embed color="warning" author="AI ACTION PROPOSAL" footer={null}
              fields={[
                { name: 'Command', value: <pre className="dc-pre">/mute @jinx 10m spam</pre> },
                { name: 'Target', value: '@jinx - Member', inline: true },
                { name: 'Who can confirm', value: 'Only @Moderator (needs Moderate Members)', inline: true },
                { name: 'Expires', value: 'in 2 minutes', inline: true },
              ]} />
            <div className="hs-btns">
              <span className="hs-press"><DButton kind="danger" tabIndex={-1}>Mute</DButton></span>
              <DButton kind="secondary" tabIndex={-1}>Cancel</DButton>
            </div>
          </div>
        </Row>
        <Row n={5} bot name={BRAND} at={at}>
          <Embed color="warning" author="MUTE" at={at}>
            <b>Member</b> jinx<br /><b>Moderator</b> Moderator<br /><b>Reason</b> spam (via {BRAND} AI, confirmed by Moderator)<br /><b>Duration</b> 10m
          </Embed>
        </Row>
      </div>
      <figcaption className="hs-cap">Nothing that can hurt runs until the person who asked presses the button. Permissions are checked when the card is posted and again on the press.</figcaption>
    </figure>
  )
}
