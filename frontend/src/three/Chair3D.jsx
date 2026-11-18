/**
 * Chair3D — a modern stool in the lobby's pedestal style: dark metal, a
 * cushion in the player's colour with a glowing edge, a curved backrest.
 * Modelled in human metres and scaled by FIGURE_SCALE so it fits the seated
 * characters. Local +Z faces the table centre (same as the character), so the
 * backrest sits behind the player.
 *
 * Geometries and the metal material are shared by every stool; nothing here
 * casts or receives shadows (a soft blob grounds it instead).
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { glowTexture } from './world/sky'
import { FIGURE_SCALE as S, FLOOR_Y } from './layout'

const SEAT_H = 0.47 // cushion top above the floor, metres
export const SEAT_TOP = FLOOR_Y + SEAT_H * S // world height of the cushion top

const ARC = [Math.PI * 0.7, Math.PI * 0.6] // backrest arc, centred behind
const GEO = {
  base: new THREE.CylinderGeometry(0.2, 0.22, 0.03, 32),
  post: new THREE.CylinderGeometry(0.025, 0.03, SEAT_H - 0.06, 12),
  seat: new THREE.CylinderGeometry(0.23, 0.19, 0.07, 32),
  edge: new THREE.TorusGeometry(0.23, 0.007, 6, 48),
  back: new THREE.CylinderGeometry(0.24, 0.24, 0.32, 20, 1, true, ...ARC),
  backTop: new THREE.CylinderGeometry(0.242, 0.242, 0.02, 20, 1, true, ...ARC),
  blob: new THREE.PlaneGeometry(1.1, 1.1),
}
const METAL = new THREE.MeshStandardMaterial({ color: '#1b1f3a', metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide })
const BLOB = new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#000000', transparent: true, opacity: 0.55, depthWrite: false })

export default function Chair3D({ hue = 200, offline = false }) {
  const { cushion, accent } = useMemo(
    () => ({
      cushion: new THREE.MeshStandardMaterial({ color: offline ? '#30344a' : `hsl(${hue}, 35%, 26%)`, roughness: 0.8 }),
      accent: new THREE.MeshBasicMaterial({
        color: offline ? new THREE.Color('#4a5170') : new THREE.Color(`hsl(${hue}, 80%, 62%)`).multiplyScalar(1.8), // HDR glow
        side: THREE.DoubleSide,
      }),
    }),
    [hue, offline],
  )
  useEffect(() => () => { cushion.dispose(); accent.dispose() }, [cushion, accent])

  return (
    <group position-y={FLOOR_Y} scale={S}>
      <mesh geometry={GEO.blob} material={BLOB} position-y={0.004} rotation-x={-Math.PI / 2} />
      <mesh geometry={GEO.base} material={METAL} position-y={0.015} />
      <mesh geometry={GEO.post} material={METAL} position-y={(SEAT_H - 0.06) / 2} />
      <mesh geometry={GEO.seat} material={cushion} position-y={SEAT_H - 0.035} />
      <mesh geometry={GEO.edge} material={accent} position-y={SEAT_H - 0.01} rotation-x={Math.PI / 2} />
      <mesh geometry={GEO.back} material={METAL} position-y={SEAT_H + 0.16} />
      <mesh geometry={GEO.backTop} material={accent} position-y={SEAT_H + 0.32} />
    </group>
  )
}
