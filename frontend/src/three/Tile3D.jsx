/**
 * Tile3D — a single physical UNO card with genuinely rounded corners.
 *
 * Geometry is a rounded-rectangle extrusion (white edge wall) with two rounded
 * face planes: the front shows the card art (+Z), the back shows the UNO back
 * (-Z). Orientation (face up / down, tilt) is controlled by the parent <group>.
 *
 * Props:
 *   card        card object, or null for a pure back (draw pile / hidden hand)
 *   faceDown    force the back texture on the front face
 *   playable    glowing outline + lift to signal a legal play
 *   dimmed      slightly darken non-playable cards
 *   onClick     pointer click handler (raycast)
 *   back        CARD_BACKS style id for the back design (default when missing)
 *   ...group props (position/rotation/scale) are spread onto the wrapper group
 *
 * Materials are shared module-wide (one per texture + dim flag, two edge
 * variants, one glow), so a hand of cards costs no per-card material/shader
 * work; a playable card adds a single glow frame mesh.
 */
import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CARD_T, getCardFaceTexture, getCardBackTexture } from './tileTextures'
import { getCardGeometries } from './tileGeometry'

const FACE_OFFSET = CARD_T / 2 + 0.0012

// Playable cards glow only on the BORDER (the rim + a frame behind the card);
// the face itself is never tinted.
const EDGE = new THREE.MeshLambertMaterial({ color: '#f4f4f4' })
const EDGE_HOT = new THREE.MeshLambertMaterial({ color: '#fff0b0', emissive: '#ffd24a', emissiveIntensity: 1.1 })
const GLOW = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd24a').multiplyScalar(1.6), transparent: true, opacity: 0.95, depthWrite: false }) // HDR, so it blooms
const GLOW_HOVER = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff7c8').multiplyScalar(1.6), transparent: true, opacity: 0.95, depthWrite: false })
const DIM = new THREE.Color().setScalar(0.68) // = the old 32% black veil, without the extra mesh

const faceMats = new Map()
function faceMaterial(tex, dim = false) {
  const key = tex.uuid + (dim ? ':dim' : '')
  let m = faceMats.get(key)
  if (!m) {
    m = new THREE.MeshLambertMaterial({ map: tex })
    if (dim) m.color.copy(DIM)
    faceMats.set(key, m)
  }
  return m
}

export default function Tile3D({
  card = null,
  faceDown = false,
  playable = false,
  dimmed = false,
  onClick,
  liftOnHover = true,
  renderOrder = 0,
  back: backStyle, // CARD_BACKS style id for the back face (default design when missing)
  ...groupProps
}) {
  const groupRef = useRef()
  const [hovered, setHovered] = useState(false)

  // A hovered card that unmounts (e.g. it was just played) never gets
  // onPointerOut — reset the cursor here so it doesn't stay a pointer.
  useEffect(() => {
    if (!hovered) return
    return () => { document.body.style.cursor = 'auto' }
  }, [hovered])

  const { front, back, body } = getCardGeometries()
  const backTex = getCardBackTexture(backStyle)
  const faceTex = card && !faceDown ? getCardFaceTexture(card) : backTex
  const edgeMat = playable ? EDGE_HOT : EDGE
  const frontMat = faceMaterial(faceTex, dimmed)
  const backMat = faceMaterial(backTex)

  const innerRef = useRef()

  // Hover lift + tilt happen on an INNER group so the parent-controlled
  // transform (fan position/rotation) is never fought over.
  useFrame(() => {
    if (!innerRef.current || !liftOnHover) return
    const lifted = hovered && (playable || onClick)
    const g = innerRef.current
    g.position.y += ((lifted ? 0.22 : 0) - g.position.y) * 0.25
    g.rotation.x += ((lifted ? -0.12 : 0) - g.rotation.x) * 0.2
    const s = lifted ? 1.04 : 1
    g.scale.x += (s - g.scale.x) * 0.2
    g.scale.y += (s - g.scale.y) * 0.2
    g.scale.z += (s - g.scale.z) * 0.2
  })

  const interactive = !!onClick

  return (
    <group ref={groupRef} {...groupProps}>
      <group ref={innerRef}>
      {/* Rounded white body / edge — also the raycast target */}
      <mesh
        geometry={body}
        material={edgeMat}
        renderOrder={renderOrder}
        onClick={
          interactive
            ? (e) => {
                e.stopPropagation()
                onClick(e)
              }
            : undefined
        }
        onPointerOver={
          interactive
            ? (e) => {
                e.stopPropagation()
                setHovered(true)
                document.body.style.cursor = 'pointer'
              }
            : undefined
        }
        onPointerOut={
          interactive
            ? () => {
                setHovered(false)
                document.body.style.cursor = 'auto'
              }
            : undefined
        }
      >
      </mesh>

      {/* Glowing border frame behind playable cards (bloom softens it) */}
      {playable && (
        <mesh
          geometry={front}
          material={hovered ? GLOW_HOVER : GLOW}
          position={[0, 0, -FACE_OFFSET - 0.012]}
          scale={1.14}
        />
      )}

      {/* Front face art */}
      <mesh geometry={front} material={frontMat} position={[0, 0, FACE_OFFSET]} renderOrder={renderOrder} />

      {/* Back face (flipped to face -Z) */}
      <mesh
        geometry={back}
        material={backMat}
        rotation={[0, Math.PI, 0]}
        position={[0, 0, -FACE_OFFSET]}
        renderOrder={renderOrder}
      />

      </group>
    </group>
  )
}
