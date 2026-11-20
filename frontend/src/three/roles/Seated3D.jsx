/**
 * Seated3D — one other player at the Raja Mantri Chor Sipahi table: their
 * character on a stool (idle, head turned to where they're looking), a
 * spotlight in their role's colour while it's in play, and — when they're
 * the Mantri — the toy blaster in their right hand, the arm swinging to point
 * at `aimAt`. Recoils when fired at (`hitAt`). While you're the Mantri, the
 * invisible column around a suspect is what you click to aim at them.
 * Children (the name tag) are placed in the seat's frame.
 */
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import Chair3D, { SEAT_TOP } from '../Chair3D'
import { Blaster, MUZZLE } from './Blaster3D'
import { aim, applyIdle, applyLook, seatDrop, useCharacterModel } from '../world/characters'
import { looks } from '../../store/appStore'
import { beamMaterial, glowTexture } from '../world/sky'
import { FIGURE_H, FIGURE_SCALE as S, FLOOR_Y } from '../layout'

const HIP_LIFT = 0.07 * S // the hip joint sits this far above the cushion
const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const ZERO = { yaw: 0, pitch: 0 }

/** Where each blaster's muzzle is right now (world space), keyed by player id; the shot starts there. */
export const muzzles = {}

const v1 = new THREE.Vector3()
const v2 = new THREE.Vector3()
const q0 = new THREE.Quaternion()
const q1 = new THREE.Quaternion()

function Figure({ character, playerId, offline, phase, armed, aimAt, hitAt }) {
  const model = useCharacterModel(character, 'sit', FIGURE_H)
  const drop = useMemo(() => seatDrop(model, SEAT_TOP + HIP_LIFT), [model])
  // Bones the blaster arm moves that applyIdle doesn't reset each frame.
  const rest = useMemo(
    () => ['lowerarmr', 'handr'].filter((k) => model.bones[k]).map((k) => [model.bones[k], model.bones[k].quaternion.clone()]),
    [model],
  )
  const mats = useMemo(() => {
    const list = []
    model.root.traverse((o) => {
      if (o.isMesh && !Array.isArray(o.material)) {
        o.material = o.material.clone() // own copies, so greying this seat never tints another
        list.push([o.material, o.material.color.clone()])
      }
    })
    return list
  }, [model])
  useEffect(() => {
    for (const [m, c] of mats) offline ? m.color.setRGB(0.2, 0.21, 0.26) : m.color.copy(c)
  }, [mats, offline])

  const lean = useRef()
  const blaster = useRef()
  const look = useRef({ yaw: 0, pitch: 0 })
  const raise = useRef(0) // 0 = arm at rest, 1 = pointing the blaster

  useFrame((s, dt) => {
    const b = model.bones
    for (const [bone, q] of rest) bone.quaternion.copy(q)
    applyIdle(model, REDUCED ? 0 : s.clock.elapsedTime, phase, offline ? 0 : 1)
    const want = (!offline && looks[playerId]) || ZERO
    const k = Math.min(1, dt * 8)
    look.current.yaw += (want.yaw - look.current.yaw) * k
    look.current.pitch += (want.pitch - look.current.pitch) * k
    applyLook(model, look.current.yaw * 1.25, look.current.pitch * 1.25)

    raise.current += ((armed ? 1 : 0) - raise.current) * Math.min(1, dt * 5)
    const w = raise.current
    if (w > 0.01 && aimAt && b.upperarmr && b.lowerarmr && b.handr) {
      const dir = v1.copy(aimAt).sub(b.upperarmr.getWorldPosition(v2)).normalize()
      for (const [bone, child] of [[b.upperarmr, b.lowerarmr], [b.lowerarmr, b.handr]]) {
        q0.copy(bone.quaternion)
        aim(bone, child, dir)
        q1.copy(bone.quaternion)
        bone.quaternion.copy(q0).slerp(q1, w) // straight arm, eased up from rest
      }
    }

    const g = blaster.current
    g.visible = armed && w > 0.3
    if (g.visible && b.handr) {
      b.handr.updateWorldMatrix(true, false)
      g.position.copy(g.parent.worldToLocal(b.handr.getWorldPosition(v2)))
      g.lookAt(aimAt)
      g.updateWorldMatrix(true, false)
      muzzles[playerId] = g.localToWorld(MUZZLE.clone())
    }

    // Knocked back a little when the dart lands, then settles.
    const t = hitAt ? (performance.now() - hitAt) / 1000 : 99
    lean.current.rotation.x = t >= 0 && t < 2 && !REDUCED ? -0.16 * Math.exp(-t * 3) * Math.cos(t * 14) : 0
  })

  return (
    <group ref={lean}>
      <primitive object={model.root} position-y={-drop} />
      <Blaster ref={blaster} scale={S} visible={false} />
    </group>
  )
}

const SPOT_MATS = {}
function spotMaterials(color) {
  return (SPOT_MATS[color] ??= {
    ring: new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2) }), // HDR, so it blooms
    pool: new THREE.MeshBasicMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
    beam: beamMaterial(color),
  })
}
const RING = new THREE.TorusGeometry(0.34, 0.012, 8, 64)
const POOL = new THREE.PlaneGeometry(1.1, 1.1)
const BEAM = new THREE.CylinderGeometry(0.75, 0.2, 2.6, 40, 1, true)

/** Floor ring, light pool and up-beam (modelled in metres, scaled) in the role's colour. */
function Spot({ color }) {
  const m = spotMaterials(color)
  return (
    <group position-y={FLOOR_Y} scale={S}>
      <mesh geometry={RING} material={m.ring} position-y={0.01} rotation-x={Math.PI / 2} />
      <mesh geometry={POOL} material={m.pool} position-y={0.008} rotation-x={-Math.PI / 2} />
      <mesh geometry={BEAM} material={m.beam} position={[0, 1.3, -0.12]} />
    </group>
  )
}

const setCursor = (c) => {
  document.body.style.cursor = c
}

export default function Seated3D({ seat, player, hue, spot, armed, aimAt, hitAt, aimable, onAim, children }) {
  const yaw = Math.atan2(-seat.x, -seat.z) // face the table centre
  useEffect(() => () => setCursor(''), [aimable]) // never leave a crosshair behind
  return (
    <group position={[seat.x, 0, seat.z]} rotation={[0, yaw, 0]}>
      <Chair3D hue={hue} offline={!player.connected} />
      <Suspense fallback={null}>
        <Figure character={player.character} playerId={player.id} offline={!player.connected}
          phase={hue / 57} armed={armed} aimAt={aimAt} hitAt={hitAt} />
      </Suspense>
      {spot && <Spot color={spot} />}
      {aimable && (
        <mesh
          position-y={FLOOR_Y + FIGURE_H * 0.45}
          onClick={(e) => {
            e.stopPropagation()
            onAim()
          }}
          onPointerOver={() => setCursor('crosshair')}
          onPointerOut={() => setCursor('')}
        >
          <cylinderGeometry args={[1.6, 1.6, FIGURE_H * 0.9, 12]} />
          <meshBasicMaterial colorWrite={false} depthWrite={false} />
        </mesh>
      )}
      {children}
    </group>
  )
}
