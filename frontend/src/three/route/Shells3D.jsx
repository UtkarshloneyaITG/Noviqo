/**
 * Shells3D — the four cowrie shells. While a seat is due to throw, the shells
 * sit in that player's hand (acts.hands[seat].anchor; their hand shakes them).
 * The `throw` event flings them from the hand: they tumble across the table
 * and settle in the near-right corner on the faces the server rolled (mouth
 * up = counts). A 4 (Chowka) or 8 (Baara) flares a warm glow. Between throws
 * they rest where they landed.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FELT_TOP } from './Board3D'
import { glowTexture } from '../world/sky'
import { acts, THROW_S } from './acts'

const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const FLY_S = THROW_S - 0.2
const SPOTS = [[0, 0], [0.32, -0.18], [-0.05, 0.33], [0.3, 0.25]] // where they settle
const TRAY = new THREE.Vector3(3.1, FELT_TOP, 2.75) // the table's near-right corner, clear of the board and every tray
const SIZE = 1.45
const DOME_H = 0.15 * SIZE
const IN_HAND = [[0, 0, 0], [0.07, 0.02, 0.05], [-0.06, 0.03, 0.04], [0.02, 0.05, -0.06]] // clustered in a palm

// A cowrie: a glossy dome (back) over a flat belly with a toothed slit (mouth).
const DOME = new THREE.SphereGeometry(0.2, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2)
DOME.scale(1, 0.75, 0.66)
const BELLY = new THREE.CircleGeometry(0.2, 24)
BELLY.scale(1, 0.66, 1)
const SLIT = new THREE.BoxGeometry(0.3, 0.02, 0.03)
const IVORY = new THREE.MeshStandardMaterial({ color: '#f3e6cc', roughness: 0.25, metalness: 0.05 })
const BACK = new THREE.MeshStandardMaterial({ color: '#d9b98a', roughness: 0.3 })
const MOUTH = new THREE.MeshStandardMaterial({ color: '#4a3220', roughness: 0.6 })

function Shell({ shellRef }) {
  return (
    <group ref={shellRef} scale={SIZE}>
      <mesh geometry={DOME} material={BACK} castShadow />
      <mesh geometry={BELLY} material={IVORY} rotation-x={Math.PI / 2} />
      <mesh geometry={SLIT} material={MOUTH} position-y={-0.012} />
    </group>
  )
}

const hand = new THREE.Vector3()

export default function Shells3D({ st }) {
  const refs = useRef([])
  const glow = useRef()
  const fly = useRef(null) // { t, faces, special, from: [Vector3], spins }
  const seen = useRef(null)
  const ends = useMemo(() => SPOTS.map(([x, z]) => new THREE.Vector3(TRAY.x + x, TRAY.y, TRAY.z + z)), [])
  const holder = st.phase === 'throw' && st.seats[st.turn] ? st.seats[st.turn].id : null

  // Who holds the shells now (their hand shakes them while they decide).
  useEffect(() => {
    for (const k of Object.keys(acts.toss)) if (acts.toss[k].phase === 'hold' && k !== holder) delete acts.toss[k]
    if (holder) acts.toss[holder] = { phase: 'hold', since: performance.now() / 1000 }
  }, [holder])
  useEffect(() => () => Object.keys(acts.toss).forEach((k) => delete acts.toss[k]), [])

  useEffect(() => {
    const fresh = seen.current == null ? [] : st.events.filter((e) => e.seq > seen.current && e.kind === 'throw')
    seen.current = st.events.length ? st.events[st.events.length - 1].seq : 0
    const last = fresh[fresh.length - 1] || (fly.current ? null : st.events.filter((e) => e.kind === 'throw').pop())
    if (!last) return
    acts.toss[last.seat] = { phase: 'fling', since: performance.now() / 1000 }
    fly.current = {
      t: fresh.length && !reduce ? 0 : 1,
      faces: last.faces,
      special: last.extra,
      from: refs.current.map((g) => (g ? g.position.clone() : TRAY.clone())),
      fromScale: refs.current[0] ? refs.current[0].scale.x / SIZE : 1,
      spins: last.faces.map(() => [3 + Math.random() * 4, 2 + Math.random() * 4, Math.random() * Math.PI * 2]),
    }
  }, [st])

  useFrame(({ clock }, dt) => {
    const k = fly.current
    // In someone's hand: the shells ride their palm (and so shake with it).
    if (holder && (!k || k.t >= 1)) {
      const h = acts.hands[holder]
      const anchor = h?.anchor(hand)
      if (anchor) {
        const k = h.scale ?? 1 // your first-person hand is small and close: smaller shells
        refs.current.forEach((g, i) => {
          if (!g) return
          const [x, y, z] = IN_HAND[i]
          g.scale.setScalar(SIZE * k)
          g.position.set(anchor.x + x * k, anchor.y + y * k, anchor.z + z * k)
          g.rotation.set(clock.elapsedTime * 2 + i, i, 0)
        })
        if (glow.current) glow.current.material.opacity = 0
        return
      }
    }
    if (!k) return
    k.t = Math.min(1, k.t + Math.min(dt, 0.05) / FLY_S)
    const e = 1 - (1 - k.t) ** 3
    refs.current.forEach((g, i) => {
      if (!g) return
      const end = ends[i]
      const lift = k.faces[i] === 1 ? DOME_H : 0 // a mouth-up shell rests on its dome
      g.scale.setScalar(SIZE * (k.fromScale + (1 - k.fromScale) * e))
      g.position.lerpVectors(k.from[i], end, e)
      g.position.y += lift * e + Math.abs(Math.sin(e * Math.PI * 1.5)) * (1 - e) * 1.2
      const [sx, sz, yaw] = k.spins[i]
      const up = k.faces[i] === 1 ? Math.PI : 0 // mouth up: belly (and slit) facing the sky
      g.rotation.set(up + (1 - e) * sx * Math.PI, yaw, (1 - e) * sz)
    })
    if (glow.current) glow.current.material.opacity = k.special ? 0.9 * Math.sin(Math.PI * Math.min(1, Math.max(0, (k.t - 0.6) / 0.4))) : 0
  })

  return (
    <group>
      {[0, 1, 2, 3].map((i) => (
        <Shell key={i} shellRef={(g) => (refs.current[i] = g)} />
      ))}
      {/* a 4 or 8 flares: an additive glow, not a light (a light would cost every lit material) */}
      <sprite ref={glow} position={[TRAY.x + 0.3, TRAY.y + 0.35, TRAY.z]} scale={[3, 3, 1]}>
        <spriteMaterial map={glowTexture()} color="#ffc66b" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
    </group>
  )
}
