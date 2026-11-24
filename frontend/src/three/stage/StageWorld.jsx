/**
 * StageWorld — Ring Clash in 3D: the ring and arena (Stage3D), a fighter per
 * player (Actor3D), the lights, and the cameras. While you fight you see
 * through your own eyes (your Actor3D moves the camera); knocked out, sitting
 * a round out, or once it's over, a TV-style ring camera frames every fighter
 * still standing — following their midpoint, pulling back as they spread out.
 * A big hit on you shakes the view. The HUD (stage/StageHud) reads the same state.
 */
import { Suspense, useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { stageFrames, useAppStore } from '../../store/appStore'
import { firstPerson, INTERP_DELAY_MS, MY_DELAY_MS, RING_HALF, sampleFighters } from '../../stage/info'
import Stage3D from './Stage3D'
import Actor3D from './Actor3D'

const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

function Camera() {
  const camera = useThree((s) => s.camera)
  const aspect = useThree((s) => s.size.width / s.size.height)
  const aim = useRef({ x: 0, z: 0, dist: 10, shake: 0, seen: 0, ready: false, eyes: null })
  useLayoutEffect(() => () => {
    camera.near = 0.1 // leave the lens as the other worlds expect it
    camera.updateProjectionMatrix()
  }, [camera])
  useFrame((_, dt) => {
    const st = useAppStore.getState().stageState
    const a = aim.current
    const mine = st && sampleFighters(stageFrames, performance.now() - MY_DELAY_MS).get(st.fighters[st.you]?.id)
    const eyes = !!st && firstPerson(st.phase, mine)
    if (eyes !== a.eyes) {
      a.eyes = eyes
      camera.fov = eyes ? 75 : 40
      camera.near = eyes ? 0.05 : 0.1 // your fists come close to your eyes
      camera.updateProjectionMatrix()
      a.ready = false // the ring camera cuts straight to its spot when it takes over
    }
    if (eyes) return // your fighter's eyes are the camera (Actor3D)
    const fighters = [...sampleFighters(stageFrames, performance.now() - INTERP_DELAY_MS).values()]
    const up = fighters.filter((f) => f.in_round && f.state !== 'ko')
    const show = up.length ? up : fighters.filter((f) => f.in_round)
    if (!show.length) return
    const xs = show.map((f) => f.x)
    const zs = show.map((f) => f.z)
    const mid = { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 }
    const spread = Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...zs) - Math.min(...zs)) * 0.6)
    const narrow = Math.max(1, 16 / 9 / aspect) // tall screens: pull back so everyone still fits
    const dist = Math.min(18, Math.max(7, 5.5 + spread * 1.2)) * Math.min(1.5, narrow)
    const k = a.ready ? 1 - Math.pow(0.04, Math.min(dt, 0.1)) : 1
    a.ready = true
    a.x += (mid.x * 0.85 - a.x) * k
    a.z += (mid.z * 0.85 - a.z) * k
    a.dist += (dist - a.dist) * k
    // a big hit on you shakes the view (not with reduced motion)
    const me = st?.fighters?.[st.you]?.id
    for (const e of st?.events || []) {
      if (e.seq <= a.seen) continue
      a.seen = e.seq
      if (!reduce && e.to === me && e.kind !== 'block') a.shake = Math.max(a.shake, e.kind === 'ko' ? 0.12 : e.dmg >= 12 ? 0.07 : 0.03)
    }
    a.shake *= Math.pow(0.02, Math.min(dt, 0.1))
    const t = performance.now() / 1000
    // high, like a TV ring camera: looking down over the near ropes rather than through them
    camera.position.set(a.x + a.shake * Math.sin(t * 83), 3.0 + a.dist * 0.32 + a.shake * Math.sin(t * 67 + 1), a.z + a.dist)
    camera.lookAt(a.x, 0.6, a.z)
  })
  return null
}

export default function StageWorld() {
  // re-render only when the roster changes; positions are read every frame from the snapshots
  const roster = useAppStore((s) => JSON.stringify(s.stageState?.fighters.map((f) => [f.id, f.character, f.name]) || []))
  const myId = useAppStore((s) => s.stageState?.fighters[s.stageState.you]?.id)
  return (
    <>
      <color attach="background" args={['#04050c']} />
      <fog attach="fog" args={['#04050c', 28, 72]} />
      <hemisphereLight args={['#aab4ff', '#140f20', 0.7]} />
      <spotLight position={[0, 12, 2]} angle={Math.atan((RING_HALF + 1.5) / 12)} penumbra={0.5} intensity={260} distance={32} color="#fff4e0" castShadow
        shadow-mapSize={[1024, 1024]} shadow-bias={-0.0005} />
      <directionalLight position={[-4, 5, 7]} intensity={0.9} color="#cfe0ff" />
      <pointLight position={[0, 3, -7]} intensity={18} distance={16} color="#7a5cff" />
      <Camera />
      <Stage3D />
      <Suspense fallback={null}>
        {JSON.parse(roster).map(([id, character, name]) => (
          <Actor3D key={id} id={id} character={character} name={name} me={id === myId} />
        ))}
      </Suspense>
    </>
  )
}
