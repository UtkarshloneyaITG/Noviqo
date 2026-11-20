/**
 * Experience — the persistent 3D world.
 *
 * One <Canvas> for the whole app: the lobby (LobbyWorld) when not in a game,
 * the table (TableWorld) while a game is playing or finished. Each world owns
 * its background, lights and camera; post-processing lives here.
 * Screen-space HUD/modals are layered on top in App.jsx.
 */
import { memo, Suspense, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import { EffectComposer, Bloom, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { useAppStore } from '../store/appStore'
import TableWorld from './TableWorld'
import LobbyWorld from './lobby/LobbyWorld'
import RolesWorld from './roles/RolesWorld'

function Experience() {
  const inGame = useAppStore((s) => s.gameState?.status === 'playing' || s.gameState?.status === 'finished')
  const inRoles = useAppStore((s) => !!s.rolesState) // at a Raja Mantri Chor Sipahi table
  const [dpr, setDpr] = useState(1.5)
  const [fx, setFx] = useState(true)
  const declines = useRef(0)

  // ponytail: one-way degrade (resolution first, then post-processing); a reload restores full quality.
  const decline = () => {
    declines.current += 1
    if (declines.current === 1) setDpr(1)
    else setFx(false)
  }

  return (
    <Canvas
      shadows
      dpr={[1, dpr]}
      camera={{ position: [0, 4.6, 10], fov: 46 }}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
    >
      <PerformanceMonitor onDecline={decline} flipflops={3} onFallback={() => (setDpr(1), setFx(false))} />

      <Suspense fallback={null}>{inRoles ? <RolesWorld /> : inGame ? <TableWorld /> : <LobbyWorld />}</Suspense>

      {/* The composer renders the scene un-tonemapped, so bloom only picks up
          what is truly bright (HDR rims, beams) and never the characters;
          ACES is merged into the same pass afterwards. */}
      {fx && (
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
