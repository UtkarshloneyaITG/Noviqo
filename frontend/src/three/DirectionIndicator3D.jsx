/**
 * DirectionIndicator3D — a slowly turning glowing arrow ring at the table
 * centre showing the play direction (clockwise / counter-clockwise). The
 * arrowhead leads the motion; the HUD spells the direction out in words.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { PALETTE } from './world/sky'
import { TABLE_TOP_Y } from './layout'

const R = 0.9
const MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.cyan).multiplyScalar(2) }) // HDR, so it blooms

export default function DirectionIndicator3D({ direction = 1 }) {
  const ref = useRef()
  const prevDir = useRef(direction)
  const boost = useRef(1)

  // A direction flip kicks the ring into a dramatic over-spin that eases
  // back to the normal rate, with a matching scale pulse.
  if (prevDir.current !== direction) {
    prevDir.current = direction
    boost.current = 9
  }

  useFrame((_, dt) => {
    if (!ref.current) return
    boost.current += (1 - boost.current) * Math.min(1, dt * 3)
    ref.current.rotation.z -= direction * dt * 0.4 * boost.current
    ref.current.scale.setScalar(1 + (boost.current - 1) * 0.04)
  })

  // Clockwise (seen from above) leads with the arc's start; counter-clockwise with its end.
  const cw = direction === 1
  return (
    <group position={[0, TABLE_TOP_Y + 0.23, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <group ref={ref}>
        <mesh material={MAT}>
          <torusGeometry args={[R, 0.05, 10, 48, Math.PI * 1.5]} />
        </mesh>
        <mesh material={MAT} position={cw ? [R, 0, 0] : [0, -R, 0]} rotation={[0, 0, cw ? Math.PI : -Math.PI / 2]} scale={[1, 1, 0.35]}>
          <coneGeometry args={[0.17, 0.34, 3]} />
        </mesh>
      </group>
    </group>
  )
}
