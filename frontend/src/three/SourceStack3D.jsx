/**
 * SourceStack3D — a stack of face-down cards lying flat on the table.
 * Clickable on your turn to draw. When it's your turn (and especially when
 * you must draw), a glowing pulsing ring under the deck highlights it, plus a
 * red up-light beam when drawing is mandatory.
 */
import { useMemo, useRef } from 'react'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useAppStore } from '../store/appStore'
import Tile3D from './Tile3D'
import { CARD_T } from './tileTextures'
import { beamMaterial, PALETTE } from './world/sky'
import { TABLE_TOP_Y as TOP_Y } from './layout'

const URGENT_BEAM = beamMaterial(PALETTE.red)
const RED_HDR = new THREE.Color(PALETTE.red).multiplyScalar(1.8) // HDR, so it blooms
const AMBER_HDR = new THREE.Color(PALETTE.amber).multiplyScalar(1.8)

export default function SourceStack3D({ count = 0, isMyTurn, drawStack = 0, mustDraw = false, back }) {
  const drawCard = useAppStore((s) => s.drawCard)
  const actionPending = useAppStore((s) => s.actionPending)
  const connectionPhase = useAppStore((s) => s.connectionPhase)
  const canDraw = isMyTurn && !actionPending && connectionPhase === 'online'
  const ringRef = useRef()

  const stack = useMemo(() => {
    // Always keep at least one clickable face-down card on your turn, even
    // when the deck reads empty — drawing triggers a server-side reshuffle
    // from the discard pile. Without this the player has nothing to click
    // and is stuck until the turn timer forces a penalty.
    const n = count > 0 ? 3 : isMyTurn ? 1 : 0
    return Array.from({ length: n }, (_, i) => i)
  }, [count, isMyTurn])

  const baseY = TOP_Y + 0.22
  const label = drawStack > 0 ? `Draw ${drawStack}` : count > 0 ? `${count} left` : 'Reshuffle'
  const urgent = mustDraw || drawStack > 0

  // Pulse the ring.
  useFrame((state) => {
    if (ringRef.current) {
      const amp = urgent ? 0.14 : 0.06
      ringRef.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 4) * amp)
    }
  })

  return (
    <group position={[-2.4, 0, 0]}>
      {/* Highlight ring under the deck on your turn */}
      {isMyTurn && (
        <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, baseY - 0.19, 0]}>
          <ringGeometry args={[0.95, 1.25, 44]} />
          <meshBasicMaterial color={urgent ? RED_HDR : AMBER_HDR} transparent opacity={0.9} />
        </mesh>
      )}

      {/* Up-light beam over the deck when you must draw */}
      {urgent && (
        <mesh position={[0, baseY + 1.6, 0]} material={URGENT_BEAM}>
          <cylinderGeometry args={[1.1, 0.9, 3.2, 40, 1, true]} />
        </mesh>
      )}

      {stack.map((i) => (
        <Tile3D
          key={i}
          faceDown
          back={back}
          liftOnHover={false}
          playable={canDraw && i === stack.length - 1}
          onClick={canDraw ? () => drawCard() : undefined}
          position={[0, baseY + i * (CARD_T + 0.004), 0]}
          rotation={[Math.PI / 2, 0, (i % 2) * 0.04]}
        />
      ))}

      <Html
        position={[0, baseY + 0.02, 1.15]}
        center
        distanceFactor={9}
        pointerEvents="none"
      >
        <div className={`tb t3-pile${drawStack > 0 ? ' t3-pile--penalty' : ''}`}>
          {label}
        </div>
      </Html>
    </group>
  )
}
