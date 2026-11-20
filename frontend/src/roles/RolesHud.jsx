/**
 * RolesHud — the screen overlay at a Raja Mantri Chor Sipahi table: round and
 * prompt, the scores, your chit, the Mantri's aim / FIRE controls with the
 * 30 s bar, table chat, Leave, and the final standings with your coins.
 * The 3D table (three/roles/RolesWorld) is underneath; both read rolesState.
 */
import { useState } from 'react'
import { useAppStore } from '../store/appStore'
import { SecondsLeft } from '../lobby/ui'
import { ROLE, holderOf, seatName } from './info'
import '../styles/roles.css'

const GUESS_MS = 30_000 // the Mantri's time to fire (server: roles.TIMES["guess"])

function Prompt({ st }) {
  const me = st.seats.find((s) => s.id === st.me)
  const mine = me?.role
  const raja = holderOf(st, 'raja')
  const mantri = holderOf(st, 'mantri')
  const name = (id) => seatName(st, id)
  let big
  let sub = null
  if (st.phase === 'pick') {
    const waiting = st.seats.filter((s) => !s.picked && s.id !== st.me).map((s) => s.name)
    big = me?.picked ? 'Waiting for the others to pick…' : 'Pick a chit'
    sub = me?.picked ? `Still picking: ${waiting.join(', ')}` : 'Click one of the four rolled chits on the table'
  } else if (st.phase === 'raja') {
    big = raja === st.me ? `${ROLE.raja.icon} You are the Raja!` : `${ROLE.raja.icon} ${name(raja)} is the Raja`
    sub = '“Mera Mantri kaun hai?”'
  } else if (st.phase === 'mantri') {
    big = mantri === st.me ? `${ROLE.mantri.icon} You are the Mantri!` : `${ROLE.mantri.icon} ${name(mantri)} is the Mantri`
    sub = 'The Mantri must find the Chor'
  } else if (st.phase === 'guess') {
    big = {
      mantri: 'Find the Chor!',
      chor: 'You are the Chor. Keep a straight face 🤫',
      sipahi: 'You are the Sipahi. You’re safe, but the Mantri doesn’t know that',
      raja: `${name(mantri)} is hunting the Chor…`,
    }[mine]
    sub = st.aim
      ? `${mantri === st.me ? 'You are' : `${name(mantri)} is`} aiming at ${name(st.aim)}`
      : mantri === st.me
      ? 'Click a suspect to aim, then fire'
      : 'Watch the blaster…'
  } else if (st.phase === 'result' && st.last) {
    const { correct, accused, chor } = st.last
    big = correct ? `${name(st.last.mantri)} caught the Chor! 🎯` : `${name(st.last.mantri)} shot the Sipahi!`
    sub = correct
      ? `${name(accused)} ${accused === st.me ? 'were' : 'was'} the Chor. +800 to the Mantri`
      : `The Chor, ${name(chor)}, escapes with the Mantri’s 800`
  }
  if (!big) return null
  return (
    <div className="rm-prompt" role="status" aria-live="polite">
      <b>{big}</b>
      {sub && <span>{sub}</span>}
    </div>
  )
}

function Scores({ st }) {
  const result = st.phase === 'result' && st.last?.round === st.round
  return (
    <ol className="rm-panel rm-board" aria-label="Scores">
      {st.seats.map((s) => {
        const r = s.role && ROLE[s.role]
        return (
          <li key={s.id} className={s.id === st.me ? 'me' : ''}>
            <span className="ic" aria-hidden="true">{r ? r.icon : '·'}</span>
            <span className="nm">
              {s.id === st.me ? 'You' : s.name}
              {s.bot && <i>BOT</i>}
            </span>
            {result && <em>+{st.last.points[s.id]}</em>}
            <b>{s.score.toLocaleString()}</b>
          </li>
        )
      })}
    </ol>
  )
}

function MyChit({ role }) {
  const r = ROLE[role]
  const hint = {
    raja: 'You announce first and keep your 1000.',
    mantri: 'Find the Chor among the two hidden players.',
    chor: 'Stay hidden. If the Mantri misses, the 800 is yours.',
    sipahi: 'You keep 500 either way. Make the Mantri doubt.',
  }[role]
  return (
    <div className="rm-chit" style={{ '--rc': r.color }}>
      <small>Your chit</small>
      <b lang="hi">{r.hi}</b>
      <span>
        {r.icon} {r.en} · {r.points} points
      </span>
      <p>{hint}</p>
    </div>
  )
}

function MantriControls({ st }) {
  const { rolesAim, rolesGuess } = useAppStore.getState()
  return (
    <div className="rm-act">
      <div className="rm-time" aria-hidden="true">
        <i key={st.deadline} style={{ width: `${(100 * Math.max(0, st.deadline - Date.now())) / GUESS_MS}%`, animationDuration: `${Math.max(0, st.deadline - Date.now())}ms` }} />
      </div>
      <div className="rm-aims" role="group" aria-label="Aim at">
        {st.suspects.map((id) => (
          <button key={id} className={st.aim === id ? 'on' : ''} aria-pressed={st.aim === id} onClick={() => rolesAim(id)}>
            🎯 {seatName(st, id)}
          </button>
        ))}
      </div>
      <button className="rm-fire" disabled={!st.aim} onClick={() => rolesGuess(st.aim)}>
        FIRE
        <small>
          <SecondsLeft until={st.deadline} />s
        </small>
      </button>
    </div>
  )
}

function Chat() {
  const [text, setText] = useState('')
  const myBubble = useAppStore((s) => s.bubbles?.[s.rolesState?.me])
  const sendChat = useAppStore((s) => s.sendChat)
  return (
    <form
      className="rm-panel rm-chat"
      onSubmit={(e) => {
        e.preventDefault()
        sendChat(text)
        setText('')
      }}
    >
      {myBubble && <p className="mine">{myBubble.text}</p>}
      <input value={text} onChange={(e) => setText(e.target.value)} maxLength={120} placeholder="Say something to the table" aria-label="Say something to the table" />
      <button className="rm-btn">Send</button>
    </form>
  )
}

function Final({ st }) {
  const rolesLeave = useAppStore((s) => s.rolesLeave)
  const reward = st.reward
  const byId = Object.fromEntries(st.seats.map((s) => [s.id, s]))
  return (
    <div className="rm-end" role="dialog" aria-modal="true" aria-label="Final standings">
      <div className="rm-panel rm-endcard">
        <h2>Final standings</h2>
        <ol>
          {st.standings.map((r) => (
            <li key={r.id} className={`p${r.place} ${r.id === st.me ? 'me' : ''}`}>
              <span className="pl">{r.place}</span>
              <span className="nm">
                {r.id === st.me ? 'You' : byId[r.id].name}
                {byId[r.id].bot && <i>BOT</i>}
              </span>
              <b>{r.score.toLocaleString()}</b>
            </li>
          ))}
        </ol>
        {reward && (
          <p className="rm-reward">
            +{reward.coins} coins
            {reward.unlocked?.length > 0 && ` · ${reward.unlocked.length} new item${reward.unlocked.length > 1 ? 's' : ''} unlocked`}
          </p>
        )}
        <button className="rm-btn go" onClick={rolesLeave} autoFocus>
          Back to lobby
        </button>
      </div>
    </div>
  )
}

export default function RolesHud() {
  const st = useAppStore((s) => s.rolesState)
  return st ? <Hud st={st} /> : null // nothing for the moment after you leave
}

function Hud({ st }) {
  const error = useAppStore((s) => s.error)
  const rolesLeave = useAppStore((s) => s.rolesLeave)
  const [leaving, setLeaving] = useState(false)
  const mine = st.seats.find((s) => s.id === st.me)?.role
  const iAmMantri = holderOf(st, 'mantri') === st.me

  return (
    <div className="rm">
      <div className="rm-top">
        <div className="rm-panel rm-round">
          <b>
            Round {st.round}
            <small>/{st.rounds}</small>
          </b>
          <span>Raja Mantri Chor Sipahi</span>
        </div>
        {st.phase !== 'finished' && (
          <div className="rm-leave">
            {leaving ? (
              <>
                <span>Leave? Your seat plays itself and you get no coins.</span>
                <button className="rm-btn danger" onClick={rolesLeave}>
                  Leave
                </button>
                <button className="rm-btn" onClick={() => setLeaving(false)}>
                  Stay
                </button>
              </>
            ) : (
              <button className="rm-btn" onClick={() => setLeaving(true)}>
                Leave
              </button>
            )}
          </div>
        )}
      </div>
      <Prompt st={st} />
      <Scores st={st} />
      {mine && <MyChit role={mine} />}
      {iAmMantri && st.phase === 'guess' && <MantriControls st={st} />}
      <Chat />
      {error && <div className="rm-toast" role="alert">{error}</div>}
      {st.phase === 'finished' && st.standings && <Final st={st} />}
    </div>
  )
}
