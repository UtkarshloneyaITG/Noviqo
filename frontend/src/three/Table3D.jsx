/**
 * Table3D — a modern round table: a thin slab with a felt top (colour from
 * the room's `felt` item), a dark metal rim edged in glowing cyan, and a
 * pedestal on a glowing floor ring, grounded by a soft blob (no shadow
 * maps). Purely decorative; no interaction.
 */
import * as THREE from 'three'
import { useAppStore } from '../store/appStore'
import { FELTS, DEFAULT_FELT } from '../items'
import { PALETTE, glowTexture } from './world/sky'
import { TABLE_RADIUS as R, TABLE_TOP_Y, FLOOR_Y } from './layout'

const TOP = TABLE_TOP_Y + 0.21 // felt surface (cards rest just above it)
const METAL = '#161b36'
const RIM = new THREE.Color(PALETTE.cyan).multiplyScalar(2.2) // HDR, so it blooms

// Soft vignette for the felt (bright centre, darker edge); tinted by the colour.
let feltMap = null
function feltTexture() {
  if (feltMap) return feltMap
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')
  const r = g.createRadialGradient(128, 128, 10, 128, 128, 128)
  r.addColorStop(0, '#ffffff')
  r.addColorStop(0.7, '#c8c8c8')
  r.addColorStop(1, '#8a8a8a')
  g.fillStyle = r
  g.fillRect(0, 0, 256, 256)
  feltMap = new THREE.CanvasTexture(c)
  feltMap.colorSpace = THREE.SRGBColorSpace
  return feltMap
}

export default function Table3D() {
  const felt = useAppStore((s) => s.gameState?.felt)
  const color = FELTS[felt] || FELTS[DEFAULT_FELT]

  return (
    <group>
      {/* Felt slab */}
      <mesh position={[0, TOP - 0.1, 0]}>
        <cylinderGeometry args={[R, R, 0.2, 96]} />
        <meshStandardMaterial color={color} map={feltTexture()} roughness={0.95} metalness={0} />
      </mesh>

      {/* Metal rim, a little proud of the felt */}
      <mesh position={[0, TOP - 0.1, 0]}>
        <cylinderGeometry args={[R + 0.5, R + 0.38, 0.28, 96, 1, true]} />
        <meshStandardMaterial color={METAL} metalness={0.7} roughness={0.3} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, TOP + 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[R - 0.02, R + 0.5, 96]} />
        <meshStandardMaterial color={METAL} metalness={0.7} roughness={0.3} />
      </mesh>

      {/* Glowing cyan edge + a faint inner line on the felt */}
      <mesh position={[0, TOP + 0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[R + 0.5, 0.035, 8, 128]} />
        <meshBasicMaterial color={RIM} />
      </mesh>
      <mesh position={[0, TOP + 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[R - 0.38, R - 0.33, 96]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.12} depthWrite={false} />
      </mesh>

      {/* Pedestal, floor ring, soft contact blob */}
      <mesh position={[0, (FLOOR_Y + TOP - 0.2) / 2, 0]}>
        <cylinderGeometry args={[0.8, 1.3, TOP - 0.2 - FLOOR_Y, 40]} />
        <meshStandardMaterial color={METAL} metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh position={[0, FLOOR_Y + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[R * 2.6, R * 2.6]} />
        <meshBasicMaterial map={glowTexture()} color="#000000" transparent opacity={0.6} depthWrite={false} />
      </mesh>
      <mesh position={[0, FLOOR_Y + 0.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.0, 0.03, 8, 96]} />
        <meshBasicMaterial color={RIM} />
      </mesh>
    </group>
  )
}
