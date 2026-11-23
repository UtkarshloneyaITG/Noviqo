/**
 * Shells3D — the four cowrie shells. Each new `throw` event tosses them in
 * from above the board's right edge; they tumble and settle on the faces the
 * server rolled (mouth up = counts). A 4 (Chowka) or 8 (Baara) flashes a warm
 * light over them. Between throws they rest where they landed.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FELT_TOP } from './Board3D'
import { glowTexture } from '../world/sky'

const TOSS_S = 0.7 // server: route.THROW_S
const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const SPOTS = [[0, 0], [0.32, -0.18], [-0.05, 0.33], [0.3, 0.25]] // where they settle
const TRAY = new THREE.Vector3(3.1, FELT_TOP, 2.75) // the table's near-right corner, clear of the board and every tray
const DOME_H = 0.15 * 1.45

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
    <group ref={shellRef} scale={1.45}>
      <mesh geometry={DOME} material={BACK} castShadow />
      <mesh geometry={BELLY} material={IVORY} rotation-x={Math.PI / 2} />
      <mesh geometry={SLIT} material={MOUTH} position-y={-0.012} />
    </group>
  )
}

export default function Shells3D({ st }) {
  const refs = useRef([])
  const light = useRef()
  const toss = useRef(null) // { t, faces, spins, special }
  const seen = useRef(null)
  const ends = useMemo(() => SPOTS.map(([x, z]) => new THREE.Vector3(TRAY.x + x, TRAY.y, TRAY.z + z)), [])

  useEffect(() => {
    const fresh = seen.current == null ? [] : st.events.filter((e) => e.seq > seen.current && e.kind === 'throw')
    seen.current = st.events.length ? st.events[st.events.length - 1].seq : 0
    const last = fresh[fresh.length - 1] || (toss.current ? null : st.events.filter((e) => e.kind === 'throw').pop())
    if (!last) return
    toss.current = {
      t: fresh.length && !reduce ? 0 : 1,
      faces: last.faces,
      special: last.extra,
      spins: last.faces.map(() => [4 + Math.random() * 6, 3 + Math.random() * 5, Math.random() * Math.PI * 2]),
    }
  }, [st])

  useFrame((_, dt) => {
    const k = toss.current
    if (!k) return
    k.t = Math.min(1, k.t + Math.min(dt, 0.05) / TOSS_S)
    const e = 1 - (1 - k.t) ** 3
    refs.current.forEach((g, i) => {
      if (!g) return
      const end = ends[i]
      const lift = k.faces[i] === 1 ? DOME_H : 0 // a mouth-up shell rests on its dome
      g.position.set(end.x - (1 - e) * 0.9, end.y + lift + Math.abs(Math.sin(e * Math.PI * 1.5)) * (1 - e) * 1.6, end.z - (1 - e) * 0.6)
      const [sx, sz, yaw] = k.spins[i]
      const up = k.faces[i] === 1 ? Math.PI : 0 // mouth up: belly (and slit) facing the sky
      g.rotation.set(up + (1 - e) * sx * Math.PI, yaw, (1 - e) * sz)
    })
    if (light.current) light.current.material.opacity = k.special ? 0.9 * Math.sin(Math.PI * Math.min(1, Math.max(0, (k.t - 0.6) / 0.4))) : 0
  })

  return (
    <group>
      {[0, 1, 2, 3].map((i) => (
        <Shell key={i} shellRef={(g) => (refs.current[i] = g)} />
      ))}
      {/* a 4 or 8 flares: an additive glow, not a light (a light would cost every lit material) */}
      <sprite ref={light} position={[TRAY.x + 0.3, TRAY.y + 0.35, TRAY.z]} scale={[3, 3, 1]}>
        <spriteMaterial map={glowTexture()} color="#ffc66b" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
    </group>
  )
}
