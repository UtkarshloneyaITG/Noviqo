/**
 * Room3D — the rooftop at dusk around the table (same world as the lobby):
 * a gridded rooftop floor that fades into the horizon haze, the city skyline
 * on a far arc (so it turns with the camera when you look around), floating
 * motes, and the lobby's lighting — warm key, cyan + magenta rims, soft sky.
 *
 * All environment lights live here (none casts shadows — the table and
 * stools are grounded by soft blobs instead). Background colour and fog are
 * set by TableWorld.
 */
import { useEffect, useMemo } from 'react'
import { Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import { skyTexture, gridTexture, glowTexture, PALETTE } from './world/sky'
import { FLOOR_Y } from './layout'

// The skyline arc: centred on the table, behind it, wide enough to cover the
// full look-around range. The sky is repeated twice across the arc (seams fall
// between buildings) so it isn't stretched; its horizon sits at the hazy far
// edge of the floor.
const ARC_R = 60
const ARC_SPAN = 3.4 // radians
const SKY_H = ((ARC_R * ARC_SPAN) / 2) * (900 / 1600) // keep the canvas aspect per copy
const HORIZON_Y = FLOOR_Y - 3 // world height of the skyline's base
const SKY_Y = HORIZON_Y + SKY_H * (0.5 - 0.4533) // 0.4533 = horizon height in the canvas (from bottom)

function Skyline() {
  const map = useMemo(() => {
    const t = skyTexture().clone()
    t.wrapS = THREE.RepeatWrapping
    t.repeat.x = 2
    t.offset.x = 0.5 // one copy's centre (the sun) straight behind the table
    return t
  }, [])
  useEffect(() => () => map.dispose(), [map])
  return (
    <mesh position={[0, SKY_Y, 0]} renderOrder={-1}>
      <cylinderGeometry args={[ARC_R, ARC_R, SKY_H, 96, 1, true, Math.PI - ARC_SPAN / 2, ARC_SPAN]} />
      <meshBasicMaterial map={map} side={THREE.BackSide} fog={false} toneMapped={false} depthWrite={false} />
    </mesh>
  )
}

export default function Room3D() {
  return (
    <group>
      {/* ── Lighting (lobby rig, scaled to the table) ─────────────── */}
      <hemisphereLight args={[0xa9b8ff, 0x1a1030, 0.8]} />
      <directionalLight
        position={[6, 14, 12]}
        intensity={2.1}
        color={0xffe3c2}
      />
      <directionalLight position={[-12, 6, -10]} intensity={2.6} color={0x4fd8ff} />
      <directionalLight position={[12, 6, -10]} intensity={2.0} color={0xff4fa3} />
      <directionalLight position={[0, 3, 16]} intensity={0.6} color={0x9fb0ff} />

      <Skyline />

      {/* Rooftop floor with the faint cyan grid */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]}>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial map={gridTexture()} roughness={0.55} metalness={0.3} />
      </mesh>

      {/* Soft cyan pool of light around the table area */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y + 0.01, 0]}>
        <planeGeometry args={[26, 26]} />
        <meshBasicMaterial
          map={glowTexture()}
          color={PALETTE.cyan}
          transparent
          opacity={0.16}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Floating motes */}
      <Sparkles count={60} scale={[26, 8, 22]} position={[0, FLOOR_Y + 4, -2]} size={3} speed={0.25} opacity={0.6} color="#ffd9a8" />
    </group>
  )
}
