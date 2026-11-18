/**
 * Avatar3D — an opponent's equipped character seated on a stool, holding a
 * small fan of cards in their own card-back design.
 *
 * The GLB has no animations: useCharacterModel(…, 'sit') poses it (thighs
 * forward, shins down, forearms up) and seatDrop lowers it so the hips rest
 * on the cushion; applyIdle adds breathing and a slow look around. The
 * figure is scaled to the oversized cards/table (FIGURE_H) so faces and upper
 * bodies read clearly above the table edge.
 * The active seat gets the lobby's amber spotlight treatment (floor ring,
 * pool of light, up-light beam) plus a glowing amber arc on the table rim in
 * front of them; offline players turn grey and still.
 */
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { createPortal, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import Chair3D, { SEAT_TOP } from './Chair3D'
import { getCardBackTexture } from './tileTextures'
import { getCardGeometries } from './tileGeometry'
import { useCharacterModel, seatDrop, applyIdle, applyLook } from './world/characters'
import { looks } from '../store/appStore'
import { beamMaterial, glowTexture, PALETTE } from './world/sky'
import { FIGURE_H, FIGURE_SCALE as S, FLOOR_Y, SEAT_RADIUS, TABLE_RADIUS, TABLE_TOP_Y } from './layout'

const HIP_LIFT = 0.07 * S // the hip joint sits this far above the cushion
const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// One double-sided plane per held card (no edge/back meshes — they're small
// and far away), one shared material per card-back design.
const heldMats = new Map()
function heldMaterial(back) {
  const tex = getCardBackTexture(back)
  let m = heldMats.get(tex)
  if (!m) {
    m = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide })
    heldMats.set(tex, m)
  }
  return m
}

/* Cards fanned from one point (where the hand grips them), backs outward.
   Card centres sit FAN_R from that point, so their bottoms (half a card,
   0.75, below the centre) meet just under it, inside the fist. */
const FAN_R = 0.55
const FAN_SCALE = 0.7
const FAN_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.32, 0, 0.35)) // lean back + out to their right
function HeldCards({ count, back }) {
  const shown = Math.min(5, Math.max(0, count))
  if (!shown) return null
  const { front } = getCardGeometries()
  const mat = heldMaterial(back)
  const mid = (shown - 1) / 2
  return Array.from({ length: shown }, (_, i) => {
    const a = (i - mid) * 0.2
    return (
      <mesh
        key={i}
        geometry={front}
        material={mat}
        position={[Math.sin(a) * FAN_R, Math.cos(a) * FAN_R, i * 0.02]}
        rotation-z={-a}
      />
    )
  })
}

function Figure({ character, offline, count, back, phase, playerId }) {
  const model = useCharacterModel(character, 'sit', FIGURE_H)
  const drop = useMemo(() => seatDrop(model, SEAT_TOP + HIP_LIFT), [model])

  // Own material copies, so greying out one seat never tints another seat
  // (or the lobby) that uses the same character.
  const mats = useMemo(() => {
    const list = []
    model.root.traverse((o) => {
      if (o.isMesh && !Array.isArray(o.material)) {
        o.material = o.material.clone()
        list.push([o.material, o.material.color.clone()])
      }
    })
    return list
  }, [model])
  useEffect(() => {
    for (const [m, c] of mats) {
      if (offline) m.color.setRGB(0.2, 0.21, 0.26)
      else m.color.copy(c)
    }
  }, [mats, offline])

  // The fan is mounted on the right-hand bone, so the hand really holds it and
  // it moves with idle sway and head turns. Its pose is worked out once, in
  // the model's own frame (grip point in the palm, a hand-length past the
  // wrist), then expressed in the bone's space.
  const fan = useMemo(() => {
    const { root, bones } = model
    const hand = bones.handr
    if (!hand || !bones.lowerarmr) return null
    root.updateMatrixWorld(true)
    const toModel = root.matrixWorld.clone().invert()
    const handM = toModel.clone().multiply(hand.matrixWorld)
    const wrist = new THREE.Vector3().setFromMatrixPosition(handM)
    const elbow = new THREE.Vector3().setFromMatrixPosition(toModel.clone().multiply(bones.lowerarmr.matrixWorld))
    const palm = wrist.clone().addScaledVector(wrist.clone().sub(elbow).normalize(), (0.07 * S) / root.scale.x)
    const want = new THREE.Matrix4().compose(palm, FAN_Q, new THREE.Vector3().setScalar(FAN_SCALE / root.scale.x))
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
    handM.invert().multiply(want).decompose(p, q, s)
    return { hand, p, q, s }
  }, [model])

  // Where this player is looking (from their camera), eased so it never snaps.
  const look = useRef({ yaw: 0, pitch: 0 })
  useFrame((s, dt) => {
    applyIdle(model, REDUCED ? 0 : s.clock.elapsedTime, phase, offline ? 0 : 1)
    const want = (!offline && looks[playerId]) || ZERO_LOOK
    const k = Math.min(1, dt * 8)
    look.current.yaw += (want.yaw - look.current.yaw) * k
    look.current.pitch += (want.pitch - look.current.pitch) * k
    applyLook(model, look.current.yaw * 1.25, look.current.pitch * 1.25)
  })

  return (
    <>
      <primitive object={model.root} position-y={-drop} />
      {fan && createPortal(
        <group position={fan.p} quaternion={fan.q} scale={fan.s}>
          <HeldCards count={count} back={back} />
        </group>,
        fan.hand,
      )}
    </>
  )
}

/* Amber spotlight on whoever's turn it is (modelled in metres, scaled). */
const RING_GEO = new THREE.TorusGeometry(0.34, 0.012, 8, 64)
const POOL_GEO = new THREE.PlaneGeometry(1.1, 1.1)
const BEAM_GEO = new THREE.CylinderGeometry(0.75, 0.2, 2.6, 40, 1, true)
const RIM_ARC = 0.55 // radians of table rim lit in front of the active seat
const RIM_GEO = new THREE.TorusGeometry(TABLE_RADIUS + 0.5, 0.06, 8, 48, RIM_ARC)
const AMBER_HDR = new THREE.Color(PALETTE.amber).multiplyScalar(2.2) // HDR, so it blooms
const RIM_MAT = new THREE.MeshBasicMaterial({ color: AMBER_HDR })
const POOL_MAT = new THREE.MeshBasicMaterial({
  map: glowTexture(),
  color: PALETTE.amber,
  transparent: true,
  opacity: 0.5,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
})
const BEAM_MAT = beamMaterial(PALETTE.amber)

function TurnBeam() {
  const ring = useRef()
  useFrame(({ clock }) => {
    if (ring.current && !REDUCED) ring.current.material.opacity = 0.7 + Math.sin(clock.elapsedTime * 4) * 0.3
  })
  return (
    <>
      <group position-y={FLOOR_Y} scale={S}>
        <mesh ref={ring} geometry={RING_GEO} position-y={0.01} rotation-x={Math.PI / 2}>
          <meshBasicMaterial color={AMBER_HDR} transparent />
        </mesh>
        <mesh geometry={POOL_GEO} material={POOL_MAT} position-y={0.008} rotation-x={-Math.PI / 2} />
        <mesh geometry={BEAM_GEO} material={BEAM_MAT} position={[0, 1.3, -0.12]} />
      </group>
      {/* Rim arc, centred on the table (local +Z = toward the centre) */}
      <group position={[0, TABLE_TOP_Y + 0.27, SEAT_RADIUS]} rotation-x={-Math.PI / 2}>
        <mesh geometry={RIM_GEO} material={RIM_MAT} rotation-z={Math.PI / 2 - RIM_ARC / 2} />
      </group>
    </>
  )
}

const ZERO_LOOK = { yaw: 0, pitch: 0 }

export default function Avatar3D({ seat, hue = 200, active = false, offline = false, count = 0, character, back, playerId }) {
  const yaw = Math.atan2(-seat.x, -seat.z) // face the table centre

  return (
    <group position={[seat.x, 0, seat.z]} rotation={[0, yaw, 0]}>
      <Chair3D hue={hue} offline={offline} />
      <Suspense fallback={null}>
        <Figure character={character} offline={offline} count={count} back={back} phase={hue / 57} playerId={playerId} />
      </Suspense>
      {active && !offline && <TurnBeam />}
    </group>
  )
}
