/**
 * Pawns3D — the 16 lacquered pawns. Home pawns wait in a tray in front of
 * their seat's side of the board; pawns on the board stand on their square
 * (several on one square share it, offset); finished pawns gather on the
 * centre. A move plays as hand work: a moment for the mover's hand to reach
 * the pawn, then the pawn is carried square by square (tapping down on
 * each), then set down. While that happens it is published in
 * acts.carry[seat] so the mover's hand (yours or a seated player's) follows
 * it. A captured pawn is knocked home after the mover lands. On your move,
 * the pawns you may move glow and can be clicked.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CELL, HALF, FELT_TOP, cellToWorld } from './Board3D'
import { COLOUR_HEX, pathFor, rotate } from '../../route/info'
import { acts, CAPTURE_S, HOP_S, REACH_S, RELEASE_S } from './acts'

const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const CARRY_H = reduce ? 0 : 0.4 // how high a carried pawn lifts between taps

// Shared shape: a bead on a flared cone, built once.
const PROFILE = [[0, 0], [0.2, 0], [0.21, 0.04], [0.15, 0.08], [0.09, 0.3], [0.07, 0.36], [0.11, 0.4], [0.12, 0.46], [0.08, 0.55], [0, 0.58]]
const GEO = new THREE.LatheGeometry(PROFILE.map(([x, y]) => new THREE.Vector2(x, y)), 28)
const MATS = {}
const lacquer = (colour) =>
  (MATS[colour] ??= new THREE.MeshStandardMaterial({ color: COLOUR_HEX[colour], roughness: 0.28, metalness: 0.15, emissive: COLOUR_HEX[colour], emissiveIntensity: 0 }))

/** Where seat `s`'s home pawn `i` waits: a tray just outside its side of the board. */
export function trayPos(seatIndex, i, turns, out = new THREE.Vector3()) {
  const [r, c] = rotate(pathFor(seatIndex)[0], turns) // its home square, as you see the board
  const dir = new THREE.Vector2(c - 2, r - 2).normalize()
  const side = new THREE.Vector2(-dir.y, dir.x)
  const along = (i - 1.5) * 0.42
  return out.set(dir.x * (HALF + 0.75) + side.x * along, FELT_TOP, dir.y * (HALF + 0.75) + side.y * along)
}

const STACK = [[0, 0], [0.22, 0.22], [-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0, 0.3], [0, -0.3], [0.3, 0]]

/** Where every pawn should rest now, per the state (stacked pawns spread out on their square). */
function restPositions(st, turns) {
  const out = {}
  const crowd = {}
  st.seats.forEach((s) => {
    st.pawns[s.id].forEach((p, i) => {
      const key = `${s.id}:${i}`
      if (p.state === 'home') out[key] = trayPos(s.index, i, turns)
      else {
        const cell = pathFor(s.index)[p.state === 'finished' ? 24 : p.index]
        const k = cell.join(',')
        const n = (crowd[k] = (crowd[k] ?? -1) + 1)
        const v = cellToWorld(cell, turns)
        const [dx, dz] = STACK[n % STACK.length]
        out[key] = v.set(v.x + dx * CELL, v.y, v.z + dz * CELL)
      }
    })
  })
  return out
}

function Pawn({ pawn, colour, rig, start, movable, onPick }) {
  const mat = useMemo(() => lacquer(colour).clone(), [colour])
  useEffect(() => () => mat.dispose(), [mat])
  const ref = useRef()
  // Placed once, on mount; from then on the animation owns the position.
  useLayoutEffect(() => {
    rig.group = ref.current
    if (start) ref.current.position.copy(start)
    return () => {
      if (rig.group === ref.current) rig.group = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useFrame(({ clock }) => {
    mat.emissiveIntensity = movable ? 0.35 + 0.3 * Math.sin(clock.elapsedTime * 6) : 0
  })
  return (
    <group ref={ref}>
      <mesh geometry={GEO} material={mat} castShadow scale={1.25}
        onClick={movable ? (e) => (e.stopPropagation(), (document.body.style.cursor = ''), onPick(pawn)) : undefined}
        onPointerOver={movable ? () => (document.body.style.cursor = 'pointer') : undefined}
        onPointerOut={movable ? () => (document.body.style.cursor = '') : undefined} />
      {movable && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
          <ringGeometry args={[0.3, 0.38, 32]} />
          <meshBasicMaterial color={COLOUR_HEX[colour]} transparent opacity={0.8} toneMapped={false} />
        </mesh>
      )}
    </group>
  )
}

export default function Pawns3D({ st, turns, onPick }) {
  const rigs = useRef({}) // key → { group, queue: [{to, dur, arc, act, seat}], from, t }
  const seen = useRef(null)
  const rest = useMemo(() => restPositions(st, turns), [st, turns])
  const movable = new Set(st.you === st.turn && st.phase === 'move' ? st.moves.map((m) => m.pawn) : [])
  const mine = st.seats[st.you]?.id

  // New events become hand work; the very first state (or a gap after a reconnect) just places everything.
  useEffect(() => {
    const fresh = seen.current == null ? [] : st.events.filter((e) => e.seq > seen.current)
    const gap = fresh.length > 0 && fresh[0].seq > (seen.current ?? 0) + 1
    seen.current = st.events.length ? st.events[st.events.length - 1].seq : 0
    if (reduce || gap) return
    let landing = 0 // how long the last mover takes to set down: its victims fly home after that
    for (const e of fresh) {
      const rig = rigs.current[`${e.seat}:${e.pawn}`]
      const s = st.seats.find((x) => x.id === e.seat)
      if (!rig || !s) continue
      if (e.kind === 'moved' || e.kind === 'entered') {
        rig.queue.push({ to: null, dur: REACH_S, arc: 0, act: 'reach', seat: e.seat })
        for (const idx of e.path) rig.queue.push({ to: cellToWorld(pathFor(s.index)[idx], turns), dur: HOP_S, arc: CARRY_H, act: 'carry', seat: e.seat })
        rig.queue.push({ to: null, dur: RELEASE_S, arc: 0, act: 'release', seat: e.seat })
        landing = REACH_S + e.path.length * HOP_S
      } else if (e.kind === 'captured') {
        if (landing) rig.queue.push({ to: null, dur: landing, arc: 0 }) // hold still until struck
        rig.queue.push({ to: trayPos(s.index, e.pawn, turns), dur: CAPTURE_S, arc: 2.2 })
      }
    }
  }, [st, turns])

  useFrame((_, dt) => {
    for (const [key, rig] of Object.entries(rigs.current)) {
      const g = rig.group
      if (!g) continue
      if (!rig.queue.length) {
        const target = rest[key]
        if (target) g.position.lerp(target, Math.min(1, dt * 10)) // settle onto the exact resting spot
        continue
      }
      const step = rig.queue[0]
      if (rig.t === 0) rig.from = g.position.clone()
      rig.t += Math.min(dt, 0.05) / step.dur
      const k = Math.min(1, rig.t)
      g.position.lerpVectors(rig.from, step.to || rig.from, k)
      g.position.y += Math.sin(Math.PI * k) * step.arc
      if (step.act) {
        const c = (acts.carry[step.seat] ??= { phase: step.act, at: new THREE.Vector3() })
        c.phase = step.act
        c.at.copy(g.position)
      }
      if (k >= 1) {
        rig.queue.shift()
        rig.t = 0
        if (step.act === 'release') delete acts.carry[step.seat]
      }
    }
  })

  // Leaving the table: nobody is carrying anything any more.
  useEffect(() => () => Object.keys(acts.carry).forEach((k) => delete acts.carry[k]), [])

  return (
    <group>
      {st.seats.map((s) =>
        st.pawns[s.id].map((p, i) => {
          const key = `${s.id}:${i}`
          const rig = (rigs.current[key] ??= { group: null, queue: [], from: null, t: 0 })
          return <Pawn key={key} pawn={i} colour={s.colour} rig={rig} start={rest[key]} movable={s.id === mine && movable.has(i)} onPick={onPick} />
        }),
      )}
    </group>
  )
}
