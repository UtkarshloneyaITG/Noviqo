/**
 * StageHud — the screen overlay for Ring Clash.
 *
 *   header     1v1: two health bars facing each other (you on the left) with
 *              the round clock between them; 3 to 5: a row of fighter cards.
 *              Each shows the portrait, name, health (a lighter trail lags
 *              behind a hit, showing what it took) and round wins.
 *   call-outs  "Round 2" with a 3-2-1 countdown, "Fight!", "K.O.", "Time!".
 *   in the fight  a crosshair that flashes when your punch lands (grey when
 *              it's blocked); the screen edges flash red when you're hit and
 *              pulse while you're low.
 *   also       Leave, a note while you're down or sitting a tie-break out,
 *              the controls (StagePad), the result card with places and coins.
 * The 3D ring (three/stage/StageWorld) reads the same state.
 */
import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { Coin } from '../lobby/ui'
import { portraitUrl } from '../three/world/characters'
import StagePad from './StagePad'
import { firstPerson } from './info'
import '../styles/stage.css'

const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th']

// what the HUD shows, as one string: it re-renders when this changes, not on every snapshot
const signature = (s) => {
  const st = s.stageState
  if (!st) return ''
  return [st.phase, st.round, st.tiebreak, st.you, Math.ceil(st.ms_left / 1000), st.events.at(-1)?.seq,
    ...st.fighters.map((f) => `${f.hp}/${f.wins}/${f.state === 'ko'}/${f.left}/${f.in_round}`)].join('|')
}

function Pips({ wins }) {
  return (
    <span className="sg-pips" aria-label={`${wins} round${wins === 1 ? '' : 's'} won`}>
      {Array.from({ length: Math.max(2, wins) }, (_, k) => <i key={k} className={k < wins ? 'on' : ''} />)}
    </span>
  )
}

function Health({ f }) {
  return (
    <div className="sg-hp" role="meter" aria-label={`${f.name} health`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={f.hp}>
      <i className="trail" style={{ width: `${f.hp}%` }} />
      <i className={`fill ${f.hp <= 25 ? 'low' : ''}`} style={{ width: `${f.hp}%` }} />
    </div>
  )
}

function Who({ f, you }) {
  return (
    <div className="sg-who">
      <img src={portraitUrl(f.character)} alt="" />
      <b>{f.name}</b>
      {you && <small>You</small>}
      <span className="sg-num">{f.left ? 'Left' : f.state === 'ko' ? 'K.O.' : f.hp}</span>
    </div>
  )
}

function Clock({ st }) {
  const secs = Math.ceil(st.ms_left / 1000)
  return (
    <div className="sg-clock">
      <b className={st.phase === 'fight' && secs <= 10 ? 'low' : ''}>{st.phase === 'fight' ? secs : st.phase === 'ko' ? 'K.O.' : '—'}</b>
      <small>{st.tiebreak ? 'Tie-break' : `Round ${st.round}`}</small>
    </div>
  )
}

/** 1v1: you on the left, them on the right, bars draining toward the outside edges. */
function Duel({ st }) {
  const me = st.fighters[st.you] || st.fighters[0]
  const them = st.fighters.find((f) => f !== me)
  return (
    <div className="sg-duel">
      {[me, them].map((f, i) => (
        <div key={f.id} className={`sg-side ${i ? 'right' : ''} ${f === st.fighters[st.you] ? 'me' : ''} ${f.state === 'ko' || f.left ? 'down' : ''}`}>
          <div className="sg-row">
            <Who f={f} you={f === st.fighters[st.you]} />
            <Pips wins={f.wins} />
          </div>
          <Health f={f} />
        </div>
      ))}
      <Clock st={st} />
    </div>
  )
}

/** 3 to 5 fighters: a card each, yours first. */
function Cards({ st }) {
  const mine = st.fighters[st.you]
  const order = mine ? [mine, ...st.fighters.filter((f) => f !== mine)] : st.fighters
  return (
    <div className="sg-cardrow">
      <Clock st={st} />
      <div className="sg-cards">
        {order.map((f) => (
          <div key={f.id} className={`sg-card ${f === mine ? 'me' : ''} ${f.state === 'ko' || f.left || !f.in_round ? 'down' : ''}`}>
            <div className="sg-row">
              <Who f={f} you={f === mine} />
              <Pips wins={f.wins} />
            </div>
            <Health f={f} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** The big word in the middle: what just happened, and the count into each round. */
function Callout({ st }) {
  const [fightAt, setFightAt] = useState(0)
  const was = useRef(st.phase)
  useEffect(() => {
    if (st.phase === 'fight' && was.current !== 'fight') setFightAt(Date.now())
    was.current = st.phase
  }, [st.phase])
  const [, tick] = useState(0)
  useEffect(() => {
    if (!fightAt) return
    const id = setTimeout(() => tick((n) => n + 1), 950)
    return () => clearTimeout(id)
  }, [fightAt])
  let text = null
  let sub = null
  if (st.phase === 'ready') {
    text = st.tiebreak ? 'Tie-break' : `Round ${st.round}`
    sub = Math.max(1, Math.ceil(st.ms_left / 1000))
  } else if (st.phase === 'fight' && Date.now() - fightAt < 900) text = 'Fight!'
  else if (st.phase === 'ko') text = st.fighters.some((f) => f.in_round && f.state === 'ko') ? 'K.O.' : 'Time!'
  if (!text) return null
  return (
    <div className="sg-callout" aria-live="polite">
      <b key={text + st.round}>{text}</b>
      {sub != null && <span key={sub}>{sub}</span>}
    </div>
  )
}

/** Briefly add a class when an event with a new seq turns up. */
function useFlash(ev, ms) {
  const [on, setOn] = useState(null)
  const seen = useRef(ev?.seq)
  useEffect(() => {
    if (!ev || ev.seq === seen.current) return
    seen.current = ev.seq
    setOn(ev.kind)
    const id = setTimeout(() => setOn(null), ms)
    return () => clearTimeout(id)
  }, [ev, ms])
  return on
}

function Crosshair({ mine }) {
  const flash = useFlash(mine, 220)
  return <i className={`sg-cross ${flash === 'block' ? 'blocked' : flash ? 'hit' : ''}`} aria-hidden="true" />
}

function Hurt({ taken, low }) {
  const flash = useFlash(taken, 380)
  return <div className={`sg-hurt ${flash && flash !== 'block' ? 'on' : ''} ${low ? 'low' : ''}`} aria-hidden="true" />
}

function Final({ st }) {
  const rewards = useAppStore((s) => s.lastRewards)
  const stageLeave = useAppStore((s) => s.stageLeave)
  const me = st.fighters[st.you]
  const mine = st.standings.find((r) => r.id === me?.id)
  return (
    <div className="sg-final" role="dialog" aria-label="Results">
      <div className="sg-panel">
        <h2>{mine ? ORDINAL[mine.place] : 'Results'}</h2>
        <ol>
          {st.standings.map((r) => {
            const f = st.fighters.find((x) => x.id === r.id)
            return (
              <li key={r.id} className={r.id === me?.id ? 'me' : ''}>
                <b>{ORDINAL[r.place]}</b>
                {f && <img src={portraitUrl(f.character)} alt="" />}
                <span>{f?.name}</span>
                <small>{f?.left ? 'Left' : `${r.wins} round${r.wins === 1 ? '' : 's'}`}</small>
              </li>
            )
          })}
        </ol>
        {rewards && (
          <p className="sg-coins">
            <Coin size={20} /> +{rewards.coins} coins
          </p>
        )}
        <button className="sg-btn go" onClick={stageLeave} autoFocus>
          Back to the lobby
        </button>
      </div>
    </div>
  )
}

export default function StageHud() {
  useAppStore(signature)
  const st = useAppStore.getState().stageState
  const stageLeave = useAppStore((s) => s.stageLeave)
  const [asking, setAsking] = useState(false)
  if (!st) return null
  const me = st.fighters[st.you]
  const eyes = firstPerson(st.phase, me) && me.state !== 'ko'
  const mineLanded = st.events.filter((e) => e.by === me?.id && e.kind !== 'ko').at(-1)
  const taken = st.events.filter((e) => e.to === me?.id).at(-1)
  const note = st.phase === 'over' ? null
    : me && !me.in_round ? 'Watching the tie-break'
    : me?.state === 'ko' && st.phase === 'fight' ? 'Knocked out, watching'
    : null

  return (
    <div className="sg">
      <Hurt taken={taken} low={eyes && me.hp <= 25} />
      {st.fighters.length === 2 ? <Duel st={st} /> : <Cards st={st} />}
      <div className="sg-leave">
        {asking ? (
          <div className="sg-ask sg-panel">
            <span>Leave? It counts as a loss.</span>
            <button className="sg-btn danger" onClick={stageLeave}>Leave</button>
            <button className="sg-btn" onClick={() => setAsking(false)}>Stay</button>
          </div>
        ) : (
          <button className="sg-btn" onClick={() => (st.phase === 'over' ? stageLeave() : setAsking(true))}>Leave</button>
        )}
      </div>
      <Callout st={st} />
      {eyes && <Crosshair mine={mineLanded} />}
      {note && <div className="sg-note sg-panel">{note}</div>}
      {st.phase !== 'over' && <StagePad />}
      {st.phase === 'over' && st.standings && <Final st={st} />}
    </div>
  )
}
