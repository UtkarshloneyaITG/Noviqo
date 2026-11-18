/**
 * TableWorld — the complete in-game 3D world: the rooftop at dusk (sky,
 * horizon fog, gridded floor, lobby lighting), the table, the seated
 * characters and play surface (Workspace3D), and the look-around camera.
 * Experience.jsx renders this while a game is playing or finished.
 *
 * No post-processing here — Experience owns the EffectComposer.
 */
import { Suspense } from 'react'
import Room3D from './Room3D'
import Table3D from './Table3D'
import Workspace3D from './Workspace3D'
import LookControls from './LookControls'
import { HORIZON_FOG } from './world/sky'

export default function TableWorld() {
  return (
    <>
      {/* Above the skyline arc only the top of the dusk sky ever shows */}
      <color attach="background" args={['#080a24']} />
      <fog attach="fog" args={[HORIZON_FOG, 22, 52]} />
      <Room3D />
      <Table3D />
      <Suspense fallback={null}>
        <Workspace3D />
      </Suspense>
      <LookControls position={[0, 4.6, 10]} lookAt={[0, 1.1, 1]} />
    </>
  )
}
