/**
 * RolesWorld — the Raja Mantri Chor Sipahi table: the same rooftop, table and
 * first-person seat as the card table, the other three players seated round
 * it (Seated3D), the four rolled chits (Chits3D), and the Mantri's toy
 * blaster — in a remote Mantri's hand, or in your own view when you're the
 * Mantri (click a suspect to aim; the HUD's FIRE button shoots). When the
 * Mantri fires, the shot (Shot3D) flies to whoever they named.
 */
import { Suspense, useEffect, useRef, useState } from 'react'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useAppStore } from '../../store/appStore'
import Room3D from '../Room3D'
import Table3D from '../Table3D'
import LookControls from '../LookControls'
import { HORIZON_FOG } from '../world/sky'
import { FIGURE_H, FIGURE_SCALE as S, FLOOR_Y, SEAT_RADIUS, TABLE_TOP_Y, opponentSeats, orderedOpponents, playerHue } from '../layout'
import Seated3D, { muzzles } from './Seated3D'
import Chits3D from './Chits3D'
import { Blaster, MUZZLE, Shot3D } from './Blaster3D'
import { ROLE, holderOf } from '../../roles/info'
import '../../styles/roles.css'

const EYE = [0, 4.6, 10] // your seat's camera (as at the card table)
const ME_SEAT = { x: 0, z: SEAT_RADIUS }
const ME_HEAD = new THREE.Vector3(0, 4.1, 9.2) // where a dart aimed at you lands: right at the camera
const HEAD_Y = FLOOR_Y + FIGURE_H * 0.7
const TAG_Y = FLOOR_Y + FIGURE_H * 0.86
const LOWERED = new THREE.Vector3(0, TABLE_TOP_Y, 0) // blaster held ready, pointing at the table

/** Your blaster in first person, bottom right, pointing at the aim. */
function HeldBlaster({ aimAt, playerId }) {
  const ref = useRef()
  const { camera } = useThree()
  const off = useRef(new THREE.Vector3())
  useFrame(() => {
    const g = ref.current
    g.position.copy(camera.position).add(off.current.set(1.1, -1.05, -2.6).applyQuaternion(camera.quaternion))
    g.lookAt(aimAt)
    g.updateWorldMatrix(true, false)
    muzzles[playerId] = g.localToWorld(MUZZLE.clone())
  })
  return <Blaster ref={ref} scale={S * 0.55} />
}

/** Name plate over a seated player: name, score, role once you may see it, and round events. */
function Tag({ st, p }) {
  const bubble = useAppStore((s) => s.bubbles?.[p.id])
  const r = p.role && ROLE[p.role]
  const result = st.phase === 'result' && st.last?.round === st.round
  const accused = result && st.last.accused === p.id
  const gain = result ? st.last.points[p.id] : null
  const status = p.left ? 'Left the table' : !p.connected ? 'Offline' : st.phase === 'pick' ? (p.picked ? 'Has a chit' : 'Picking…') : null
  return (
    <Html position={[0, TAG_Y, 0]} center distanceFactor={11} zIndexRange={[5, 0]}>
      <div className={`rm-tag ${p.connected ? '' : 'rm-tag--off'}`}>
        {bubble && <div key={bubble.key} className="rm-bubble">{bubble.text}</div>}
        {accused && <div className={`rm-stamp ${st.last.correct ? 'ok' : 'miss'}`}>{st.last.correct ? 'CAUGHT!' : 'MISSED!'}</div>}
        {r && (
          <div className="rm-badge" style={{ '--rc': r.color }}>
            {r.icon} {r.en}
          </div>
        )}
        <div className="rm-plate">
          <b>{p.name}</b>
          {p.bot && <i>BOT</i>}
          <span>{p.score.toLocaleString()}</span>
        </div>
        {status && <small>{status}</small>}
        {gain != null && <em className={gain ? 'up' : ''}>+{gain}</em>}
      </div>
    </Html>
  )
}

// The canvas is its own React root: when you leave, this re-renders once with no
// table before Experience swaps it out, so render nothing then.
export default function RolesWorld() {
  const st = useAppStore((s) => s.rolesState)
  return st ? <Table st={st} /> : null
}

function Table({ st }) {
  const { rolesPick, rolesAim } = useAppStore.getState()
  const [shot, setShot] = useState(null)
  const [hit, setHit] = useState(null)
  const prev = useRef(st)

  const others = orderedOpponents(st.seats, st.me)
  const spots = opponentSeats(others.length)
  const seatSpot = (id) => (id === st.me ? ME_SEAT : spots[others.findIndex((s) => s.id === id)] || ME_SEAT)
  const headOf = (id) => (id === st.me ? ME_HEAD : new THREE.Vector3(seatSpot(id).x, HEAD_Y, seatSpot(id).z))

  const mantri = holderOf(st, 'mantri')
  const armed = (st.phase === 'guess' || st.phase === 'result') && !!mantri
  const aimAt = st.aim ? headOf(st.aim) : LOWERED
  const spotOf = (id) => {
    const role = st.seats.find((s) => s.id === id)?.role
    if (st.phase === 'raja' && role === 'raja') return ROLE.raja.color
    if ((st.phase === 'mantri' || st.phase === 'guess') && role === 'mantri') return ROLE.mantri.color
    if (st.phase === 'result' && role === 'chor') return ROLE.chor.color
    return null
  }

  // The Mantri fired (guess → result): play the shot from their muzzle to whoever they named.
  useEffect(() => {
    const p = prev.current
    prev.current = st
    if (p?.phase === 'guess' && st.phase === 'result' && st.last?.round === st.round) {
      const { mantri: from, accused } = st.last
      setShot({ key: st.round, from: (muzzles[from] || headOf(from)).clone(), to: headOf(accused) })
      setHit({ id: accused, at: performance.now() + 300 })
    }
  }, [st]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <color attach="background" args={['#080a24']} />
      <fog attach="fog" args={[HORIZON_FOG, 22, 52]} />
      <Room3D />
      <Table3D />
      {others.map((p) => (
        <Seated3D
          key={p.id}
          seat={seatSpot(p.id)}
          player={p}
          hue={playerHue(st.seats.findIndex((s) => s.id === p.id))}
          spot={spotOf(p.id)}
          armed={armed && p.id === mantri}
          aimAt={aimAt}
          hitAt={hit?.id === p.id ? hit.at : null}
          aimable={mantri === st.me && st.phase === 'guess' && st.suspects.includes(p.id)}
          onAim={() => rolesAim(p.id)}
        >
          <Tag st={st} p={p} />
        </Seated3D>
      ))}
      <Suspense fallback={null}>
        <Chits3D st={st} seatSpot={seatSpot} onPick={rolesPick} />
      </Suspense>
      <Suspense fallback={null}>{armed && mantri === st.me && <HeldBlaster aimAt={aimAt} playerId={st.me} />}</Suspense>
      {shot && <Shot3D key={shot.key} from={shot.from} to={shot.to} scale={S / 2} onDone={() => setShot(null)} />}
      <LookControls position={EYE} lookAt={[0, 1.1, 1]} />
    </>
  )
}
