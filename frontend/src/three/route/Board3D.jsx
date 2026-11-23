/**
 * Board3D — the carved wooden 5×5 board on the table. Its top is one painted
 * texture: wood grain, routed grooves between the squares, an engraved cross
 * on each safe square (the four homes and the centre), a rosette in the
 * centre and a seat-coloured inlay at each home. A raised frame runs round
 * it. The board is turned so your own home is on the near side.
 *
 *   cellToWorld([r, c], turns) → where a pawn stands on that square
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import { TABLE_TOP_Y } from '../layout'
import { COLOUR_HEX, SAFE, rotate } from '../../route/info'

export const CELL = 0.95
export const HALF = CELL * 2.5
export const FELT_TOP = TABLE_TOP_Y + 0.1
export const BOARD_TOP = FELT_TOP + 0.22 // the felt plus the slab
const FRAME = 0.32

/** World position of a square's centre, with the board turned `turns` quarter turns. */
export function cellToWorld(cell, turns, out = new THREE.Vector3()) {
  const [r, c] = rotate(cell, turns)
  return out.set((c - 2) * CELL, BOARD_TOP, (r - 2) * CELL)
}

const HOME_SEAT = { '4,2': 0, '2,4': 1, '0,2': 2, '2,0': 3 } // seat 0's view: whose home each is

function boardTexture(turns, colours) {
  const S = 1024
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')
  // wood: warm base, long grain streaks, a few knots
  const base = g.createLinearGradient(0, 0, S, S)
  base.addColorStop(0, '#b67a43')
  base.addColorStop(1, '#94592b')
  g.fillStyle = base
  g.fillRect(0, 0, S, S)
  let seed = 11
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 260; i++) {
    const y = rand() * S
    g.strokeStyle = `rgba(${60 + rand() * 30},${30 + rand() * 20},10,${0.05 + rand() * 0.1})`
    g.lineWidth = 1 + rand() * 3
    g.beginPath()
    g.moveTo(0, y)
    for (let x = 0; x <= S; x += 64) g.lineTo(x, y + Math.sin(x / 180 + i) * 6 + (rand() - 0.5) * 3)
    g.stroke()
  }
  const cs = S / 5
  // squares: slightly lighter tops, dark routed grooves between them
  for (let r = 0; r < 5; r++) {
    for (let col = 0; col < 5; col++) {
      g.fillStyle = 'rgba(255,225,180,.07)'
      g.fillRect(col * cs + 10, r * cs + 10, cs - 20, cs - 20)
    }
  }
  g.strokeStyle = 'rgba(40,18,4,.85)'
  g.lineWidth = 10
  for (let i = 0; i <= 5; i++) {
    g.beginPath(); g.moveTo(i * cs, 0); g.lineTo(i * cs, S); g.stroke()
    g.beginPath(); g.moveTo(0, i * cs); g.lineTo(S, i * cs); g.stroke()
  }
  g.strokeStyle = 'rgba(255,220,170,.18)' // light catching the groove edges
  g.lineWidth = 2
  for (let i = 0; i <= 5; i++) {
    g.beginPath(); g.moveTo(i * cs + 6, 0); g.lineTo(i * cs + 6, S); g.stroke()
    g.beginPath(); g.moveTo(0, i * cs + 6); g.lineTo(S, i * cs + 6); g.stroke()
  }
  for (const cell of SAFE) {
    const [r, col] = rotate(cell, turns)
    const x = (col + 0.5) * cs
    const y = (r + 0.5) * cs
    const home = HOME_SEAT[cell.join(',')]
    if (home != null) {
      // seat-coloured inlay ring under the cross
      g.strokeStyle = colours[home]
      g.globalAlpha = 0.85
      g.lineWidth = 12
      g.beginPath()
      g.arc(x, y, cs * 0.36, 0, Math.PI * 2)
      g.stroke()
      g.globalAlpha = 1
    } else {
      // the centre rosette: eight petals
      g.fillStyle = 'rgba(60,28,8,.55)'
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2
        g.beginPath()
        g.ellipse(x + Math.cos(a) * cs * 0.2, y + Math.sin(a) * cs * 0.2, cs * 0.16, cs * 0.06, a, 0, Math.PI * 2)
        g.fill()
      }
    }
    g.strokeStyle = 'rgba(40,18,4,.9)' // the engraved cross
    g.lineWidth = 9
    const d = cs * 0.28
    g.beginPath(); g.moveTo(x - d, y - d); g.lineTo(x + d, y + d); g.stroke()
    g.beginPath(); g.moveTo(x + d, y - d); g.lineTo(x - d, y + d); g.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

export default function Board3D({ turns, seats }) {
  const colours = useMemo(() => [0, 1, 2, 3].map((i) => COLOUR_HEX[seats[i]?.colour] || '#888'), [seats])
  const top = useMemo(() => boardTexture(turns, colours), [turns, colours])
  const wood = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7a4a22', roughness: 0.6 }), [])
  const slabY = BOARD_TOP - 0.11
  const W = HALF * 2
  return (
    <group>
      <mesh position={[0, slabY, 0]} castShadow receiveShadow>
        <boxGeometry args={[W, 0.22, W]} />
        <meshStandardMaterial attach="material-0" color="#6a3e1c" roughness={0.65} />
        <meshStandardMaterial attach="material-1" color="#6a3e1c" roughness={0.65} />
        <meshStandardMaterial attach="material-2" map={top} roughness={0.5} />
        <meshStandardMaterial attach="material-3" color="#4a2a10" roughness={0.7} />
        <meshStandardMaterial attach="material-4" color="#6a3e1c" roughness={0.65} />
        <meshStandardMaterial attach="material-5" color="#6a3e1c" roughness={0.65} />
      </mesh>
      {/* raised frame */}
      {[[0, HALF + FRAME / 2, W + FRAME * 2, FRAME], [0, -HALF - FRAME / 2, W + FRAME * 2, FRAME], [HALF + FRAME / 2, 0, FRAME, W], [-HALF - FRAME / 2, 0, FRAME, W]].map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, slabY + 0.05, z]} material={wood} castShadow receiveShadow>
          <boxGeometry args={[w, 0.32, d]} />
        </mesh>
      ))}
    </group>
  )
}
