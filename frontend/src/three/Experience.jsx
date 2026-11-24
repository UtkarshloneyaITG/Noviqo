/**
 * Experience — the persistent 3D world.
 *
 * One <Canvas> for the whole app: the lobby (LobbyWorld) when not in a game,
 * the table (TableWorld) while a game is playing or finished. Each world owns
 * its background, lights and camera; post-processing lives here.
 * Screen-space HUD/modals are layered on top in App.jsx.
 */
import { memo, Suspense, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import { EffectComposer, Bloom, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { useAppStore } from '../store/appStore'
import TableWorld from './TableWorld'
import LobbyWorld from './lobby/LobbyWorld'
import RolesWorld from './roles/RolesWorld'
import RouteWorld from './route/RouteWorld'
import StageWorld from './stage/StageWorld'
import { useDisplay, QUALITY } from '../store/display'
import { capTick } from '../store/frameCap'

/** Frame-rate cap: with frameloop="demand", ask for a frame every 1000/fps ms. */
function FrameCap({ fps }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    const step = 1000 / fps
    let next = 0
    let raf
    const loop = (t) => {
      raf = requestAnimationFrame(loop)
      const r = capTick(next, t, step)
      next = r.next
      if (r.render) invalidate()
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [fps, invalidate])
  return null
}

/** Shadows are compiled into materials: rebuild them when the setting flips. */
function ShadowSwitch({ on }) {
  const scene = useThree((s) => s.scene)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) return void (first.current = false)
    scene.traverse((o) => {
      for (const m of [o.material].flat()) if (m) m.needsUpdate = true
    })
  }, [on, scene])
  return null
}

/** Frames per second into the #nq-fps badge (App.jsx), twice a second, without re-rendering React. */
function FpsProbe() {
  const n = useRef(0)
  const t0 = useRef(performance.now())
  useFrame(() => {
    n.current++
    const now = performance.now()
    if (now - t0.current < 500) return
    const el = document.getElementById('nq-fps')
    if (el) el.textContent = `${Math.round((n.current * 1000) / (now - t0.current))} FPS`
    n.current = 0
    t0.current = now
  })
  return null
}

function Experience() {
  const inGame = useAppStore((s) => s.gameState?.status === 'playing' || s.gameState?.status === 'finished')
  const inRoles = useAppStore((s) => !!s.rolesState) // at a Raja Mantri Chor Sipahi table
  const inRoute = useAppStore((s) => !!s.routeState) // at an Ang Mang Chok Chang table
  const inStage = useAppStore((s) => !!s.stageState) // in the Ring Clash ring
  const [dpr, setDpr] = useState(1.5)
  const [fx, setFx] = useState(true)
  const declines = useRef(0)
  const quality = useDisplay((s) => s.quality)
  const cap = useDisplay((s) => s.fps)
  const showFps = useDisplay((s) => s.showFps)
  const fixed = QUALITY[quality] // undefined on auto: the adaptive values below apply
  const shadows = fixed ? fixed.shadows : true

  // A world switch compiles shaders and loads models: the frame rate dips for a moment.
  // That's not a slow device, so dips right after a switch don't lower the quality
  // (each step down resizes the canvas or drops bloom — a visible flash, mid game start).
  const world = inStage ? 'stage' : inRoute ? 'route' : inRoles ? 'roles' : inGame ? 'table' : 'lobby'
  const switchedAt = useRef(0)
  useEffect(() => {
    switchedAt.current = performance.now()
  }, [world])

  // ponytail: one-way degrade (resolution first, then post-processing); a reload restores full quality.
  const decline = () => {
    if (performance.now() - switchedAt.current < 4000) return
    declines.current += 1
    if (declines.current === 1) setDpr(1)
    else setFx(false)
  }

  return (
    <Canvas
      shadows={shadows}
      dpr={[1, fixed ? fixed.dpr : dpr]}
      frameloop={cap ? 'demand' : 'always'}
      // Phones fire a burst of resizes while full screen or the browser bars animate;
      // resizing the drawing buffer clears it, so wait for the size to settle (one resize, no flicker).
      resize={{ debounce: { scroll: 50, resize: 150 } }}
      camera={{ position: [0, 4.6, 10], fov: 46 }}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
    >
      {!fixed && <PerformanceMonitor onDecline={decline} flipflops={3} onFallback={() => (setDpr(1), setFx(false))} />}
      {cap > 0 && <FrameCap fps={cap} />}
      <ShadowSwitch on={shadows} />
      {showFps && <FpsProbe />}

      <Suspense fallback={null}>
        {inStage ? <StageWorld /> : inRoute ? <RouteWorld /> : inRoles ? <RolesWorld /> : inGame ? <TableWorld /> : <LobbyWorld />}
      </Suspense>

      {/* The composer renders the scene un-tonemapped, so bloom only picks up
          what is truly bright (HDR rims, beams) and never the characters;
          ACES is merged into the same pass afterwards. */}
      {(fixed ? fixed.fx : fx) && (
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur intensity={0.8} luminanceThreshold={0.88} luminanceSmoothing={0.2} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      )}
    </Canvas>
  )
}

// No props: never re-render because App did.
export default memo(Experience)
