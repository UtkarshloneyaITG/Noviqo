/**
 * RouteHud — the screen overlay at an Ang Mang Chok Chang table: a one-line
 * prompt at the bottom (whose turn, what to do, your clock), the hold-to-throw
 * button with its shake meter (Space too; Enter throws at once), a big banner
 * for each throw (CHOWKA / BAARA, extra throws), the last throw's shells,
 * your legal moves as compact buttons (the 3D pawns are clickable too), your
 * own card in the corner (the others' cards float over their seats), notices
 * for captures and finishes, How to play, Leave, and the final places with
 * your coins. The 3D table (three/route/RouteWorld) reads the same state.
 */
import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { SecondsLeft } from '../lobby/ui'
import { COLOUR_HEX, RULE_NAMES, THROW_NAMES } from './info'
import { acts } from '../three/route/acts'
import SeatCard from './SeatCard'
import '../styles/route.css'

const ORDINAL = ['', '1st', '2nd', '3rd', '4th']

function Dot({ colour }) {
  return <i className="rt-dot" style={{ background: COLOUR_HEX[colour] }} aria-hidden="true" />
}

/** One cowrie shell: mouth up (counts) or curved back up. */
function Shell({ up }) {
  return (
    <svg className={`rt-shell ${up ? 'up' : ''}`} viewBox="0 0 24 16" aria-hidden="true">
      <ellipse cx="12" cy="8" rx="10.5" ry="7" />
      {up ? <path d="M4 8.5 Q12 5.5 20 8.5" /> : <path d="M6 5 Q12 2.5 18 5" opacity=".35" />}
    </svg>
  )
}

function LastThrow({ last, owed, mine, by }) {
  if (!last) return null
  const name = THROW_NAMES[last.value]
  return (
    <div className="rt-panel rt-throw" aria-live="polite">
      <div className="rt-shells">
        {last.faces.map((f, i) => (
          <Shell key={i} up={f === 1} />
        ))}
      </div>
      <b>
        {last.value}
        {name && <small>{name}</small>}
      </b>
      {by && <span className="rt-owed">{by}</span>}
      {mine && owed > 1 && <span className="rt-extra">{owed} throws to go</span>}
    </div>
  )
}

function moveLabel(m) {
  if (m.enters) return 'enter'
  if (m.finishes) return 'to the centre'
  return `to ${m.to + 1}${m.to > 15 ? ' (inner)' : ''}`
}

/** A big banner for each new throw: the value, Chowka / Baara, and whether it earns another. */
function ThrowBanner({ st }) {
  const seen = useRef(null)
  const [shown, setShown] = useState(null)
  useEffect(() => {
    const fresh = seen.current == null ? [] : st.events.filter((e) => e.seq > seen.current && e.kind === 'throw')
    seen.current = st.events.length ? st.events[st.events.length - 1].seq : 0
    const t = fresh[fresh.length - 1]
    if (!t) return
    setShown({ ...t, key: t.seq })
    const id = setTimeout(() => setShown(null), 1400)
    return () => clearTimeout(id)
  }, [st])
  if (!shown) return null
  const who = st.seats.find((s) => s.id === shown.seat)
  const name = THROW_NAMES[shown.value]
  return (
    <div key={shown.key} className={`rt-banner ${shown.extra ? 'special' : ''}`} style={{ '--seat': COLOUR_HEX[who?.colour] }} aria-hidden="true">
      <b>{shown.value}</b>
      {name && <span className="nm">{name}!</span>}
      {shown.extra && <span className="ex">Extra throw</span>}
      <small>{who?.index === st.you ? 'You' : who?.name}</small>
    </div>
  )
}

function Prompt({ st, me }) {
  const seat = st.seats[st.turn]
  const mine = st.you === st.turn
  let text
  if (st.phase === 'over') text = 'Game over'
  else if (mine && st.phase === 'throw') text = 'Your throw — hold to shake, let go to throw'
  else if (mine && st.phase === 'move') text = st.moves.length ? 'Move a pawn — tap a glowing one' : 'No pawn can move'
  else if (mine) text = 'Your turn'
  else text = `${seat.name} is ${st.phase === 'move' ? 'choosing a pawn' : 'throwing'}…`
  const gate = me && st.rules === 'traditional' && !me.captured && st.phase !== 'over'
  return (
    <div className="rt-panel rt-prompt" style={{ '--seat': COLOUR_HEX[seat.colour] }} aria-live="polite">
      <i className="rt-dot" style={{ background: COLOUR_HEX[seat.colour] }} aria-hidden="true" />
      <b>{text}</b>
      {mine && st.deadline && st.phase !== 'over' && (
        <span className="rt-clock">
          <SecondsLeft until={st.deadline} />s
        </span>
      )}
      {gate && <span className="rt-gate" title="Traditional rules">Capture once to open your inner path</span>}
    </div>
  )
}

/** Short notices for what just happened (captures, finishes, places, throws nobody could use). */
let noteId = 0
function useNotices(st) {
  const seen = useRef(null)
  const timers = useRef([])
  const [notes, setNotes] = useState([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  useEffect(() => {
    const fresh = st.events.filter((e) => seen.current != null && e.seq > seen.current)
    seen.current = st.events.length ? st.events[st.events.length - 1].seq : 0
    const name = (sid) => st.seats.find((s) => s.id === sid)?.name || '?'
    const lines = fresh.flatMap((e) =>
      e.kind === 'captured' ? [`${name(e.by)} captured ${name(e.seat)}'s pawn!`]
        : e.kind === 'finished' ? [`${name(e.seat)} brought a pawn home`]
          : e.kind === 'placed' ? [`${name(e.seat)} finishes ${ORDINAL[e.place]}!`]
            : e.kind === 'stuck' ? [`${name(e.seat)} threw ${e.value}: no pawn can move`]
              : [],
    )
    if (!lines.length) return
    const items = lines.map((text) => ({ id: ++noteId, text }))
    setNotes((n) => [...n, ...items].slice(-3))
    for (const it of items) timers.current.push(setTimeout(() => setNotes((n) => n.filter((x) => x.id !== it.id)), 3200))
  }, [st])
  return notes
}

function HowTo({ onClose }) {
  return (
    <div className="rt-panel rt-howto" role="dialog" aria-label="How to play">
      <h2>How to play</h2>
      <ul>
        <li>Throw four cowrie shells: the number of mouths up is your move. None up counts 8 (Baara); all four up is 4 (Chowka).</li>
        <li>A 4 or 8, and every capture, earns another throw.</li>
        <li>Pawns enter on your home square with a 4 or 8, run once round the outer ring, then the inner ring, then reach the centre with an exact throw.</li>
        <li>Land on opponents to send them home. Nobody can be captured on the crossed squares (the four homes and the centre).</li>
        <li>Traditional rules: you must capture once before your pawns may turn inward; until then they keep circling. Basic rules skip that.</li>
        <li>First to bring all four pawns to the centre wins; the others play on for the places.</li>
      </ul>
      <button className="rt-btn go" onClick={onClose} autoFocus>
        Got it
      </button>
    </div>
  )
}

function Final({ st }) {
  const rewards = useAppStore((s) => s.lastRewards)
  const routeLeave = useAppStore((s) => s.routeLeave)
  return (
    <div className="rt-final" role="dialog" aria-label="Results">
      <div className="rt-panel">
        <h2>Results</h2>
        <ol>
          {st.standings.map((r) => {
            const s = st.seats.find((x) => x.id === r.id)
            return (
              <li key={r.id} className={s.index === st.you ? 'me' : ''}>
                <b>{ORDINAL[r.place]}</b>
                <Dot colour={s.colour} />
                <span>{s.name}</span>
                <small>{r.finished}/4 home</small>
              </li>
            )
          })}
        </ol>
        {rewards && <p className="rt-coins">+{rewards.coins} coins</p>}
        <button className="rt-btn go" onClick={routeLeave} autoFocus>
          Back to the lobby
        </button>
      </div>
    </div>
  )
}

export default function RouteHud() {
  const st = useAppStore((s) => s.routeState)
  const error = useAppStore((s) => s.error)
  const { routeThrow, routeMove, routeLeave } = useAppStore.getState()
  const [leaving, setLeaving] = useState(false)
  const [help, setHelp] = useState(false)
  const [holding, setHolding] = useState(false)
  const notes = useNotices(st)
  const me = st.seats[st.you]
  const mine = st.you === st.turn
  const canThrow = mine && st.phase === 'throw'

  // Hold to shake the shells in your fist, let go to throw (Space too; Enter throws at once).
  const hold = (on) => {
    if (on && canThrow) (acts.localHold = true), setHolding(true)
    else if (!on && acts.localHold) {
      acts.localHold = false
      setHolding(false)
      routeThrow()
    }
  }
  useEffect(() => {
    if (!canThrow) {
      acts.localHold = false
      setHolding(false)
      return
    }
    const typing = (e) => e.target.closest?.('input, textarea')
    const down = (e) => {
      if (typing(e) || e.repeat) return
      if (e.key === ' ') (e.preventDefault(), (acts.localHold = true), setHolding(true))
      else if (e.key === 'Enter') (e.preventDefault(), routeThrow())
    }
    const up = (e) => {
      if (e.key === ' ' && acts.localHold) (e.preventDefault(), (acts.localHold = false), setHolding(false), routeThrow())
    }
    addEventListener('keydown', down)
    addEventListener('keyup', up)
    return () => (removeEventListener('keydown', down), removeEventListener('keyup', up), (acts.localHold = false))
  }, [canThrow, routeThrow])

  return (
    <div className="rt">
      <div className="rt-top">
        <div className="rt-panel rt-title">
          <b>Ang Mang Chok Chang</b>
          <span>{RULE_NAMES[st.rules]} rules</span>
        </div>
        <div className="rt-actions">
          <button className="rt-btn" onClick={() => setHelp(true)}>
            How to play
          </button>
          {st.phase !== 'over' &&
            (leaving ? (
              <>
                <span>{me?.place ? 'Leave? You keep your place and coins.' : 'Leave? Your seat plays itself and you get no coins.'}</span>
                <button className="rt-btn danger" onClick={routeLeave}>
                  Leave
                </button>
                <button className="rt-btn" onClick={() => setLeaving(false)}>
                  Stay
                </button>
              </>
            ) : (
              <button className="rt-btn" onClick={() => setLeaving(true)}>
                Leave
              </button>
            ))}
        </div>
      </div>
      {me && (
        <div className="rt-mycard">
          <SeatCard seat={me} acting={mine && st.phase !== 'over'} you />
        </div>
      )}
      <ThrowBanner st={st} />
      <div className="rt-bottom">
        <Prompt st={st} me={me} />
        <LastThrow last={st.last} owed={st.owed} mine={mine} by={st.last && st.last.seat !== me?.id ? st.seats.find((s) => s.id === st.last.seat)?.name : null} />
        {canThrow && (
          <button
            className={`rt-btn go rt-throwbtn ${holding ? 'holding' : ''}`}
            onPointerDown={(e) => (e.currentTarget.setPointerCapture?.(e.pointerId), hold(true))}
            onPointerUp={() => hold(false)}
            onPointerCancel={() => ((acts.localHold = false), setHolding(false))}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), routeThrow())}
            aria-label="Throw the shells: hold to shake, release to throw"
          >
            <span>{holding ? 'Shaking… let go!' : 'Throw'}</span>
            <i className="meter" aria-hidden="true" />
          </button>
        )}
        {mine && st.phase === 'move' && st.moves.length > 0 && (
          <div className="rt-moves" role="group" aria-label="Your moves">
            {st.moves.map((m) => (
              <button key={m.pawn} className={`rt-btn ${m.captures.length ? 'hit' : ''}`} onClick={() => routeMove(m.pawn)}>
                <Dot colour={me.colour} /> {m.pawn + 1} · {moveLabel(m)}
                {m.captures.length > 0 && <em>capture</em>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="rt-notes" aria-live="polite">
        {notes.map((n) => (
          <div key={n.id} className="rt-panel rt-note">
            {n.text}
          </div>
        ))}
      </div>
      {error && <div className="rt-toast" role="alert">{error}</div>}
      {help && <HowTo onClose={() => setHelp(false)} />}
      {st.phase === 'over' && st.standings && <Final st={st} />}
    </div>
  )
}

