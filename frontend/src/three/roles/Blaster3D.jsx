/**
 * Blaster3D — the Mantri's toy blaster: Kenney's CC0 "blaster" model
 * (public/models/props/handheld.glb, see LICENSE.txt there), sized as an
 * oversized 42 cm toy in metres (callers scale it to the table), its origin at
 * the orange handle so a hand holds it there, barrel along +Z (as the model
 * comes) so Object3D.lookAt aims it. Shot3D is one fired shot in world space: a
 * muzzle flash, a foam dart that flies to the target, and a burst where it lands.
 */
import { forwardRef, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

const MODEL = '/models/props/handheld.glb'
const LENGTH = 0.42 // metres: an oversized toy, so it reads from across the table
const TRIM = new THREE.MeshStandardMaterial({ color: '#ff7a1a', roughness: 0.45, metalness: 0.05 })
const GLOW = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd23a').multiplyScalar(3) }) // HDR, so it blooms

/** Muzzle point in the blaster's own frame (metres): the barrel tip. Set once the model loads. */
export const MUZZLE = new THREE.Vector3(0, 0.02, 0.33)

function useBlasterModel() {
  const { scene } = useGLTF(MODEL)
  return useMemo(() => {
    const root = scene.clone(true)
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const centre = box.getCenter(new THREE.Vector3())
    const k = LENGTH / size.z // nose to tail is LENGTH
    // The handle: the orange part behind the trigger, low and to the rear.
    const grip = new THREE.Vector3(centre.x, box.min.y + 0.4 * size.y, box.min.z + 0.22 * size.z)
    root.scale.setScalar(k)
    root.position.copy(grip).multiplyScalar(-k) // the handle sits at the origin, in the hand
    MUZZLE.set(0, (0.47 * size.y - 0.4 * size.y) * k, (box.max.z - grip.z) * k)
    root.traverse((o) => {
      if (o.isMesh) o.castShadow = true
    })
    return root
  }, [scene])
}

/** Suspends while the model loads — render inside <Suspense>. */
export const Blaster = forwardRef(function Blaster(props, ref) {
  const model = useBlasterModel()
  return (
    <group ref={ref} {...props}>
      <primitive object={model} />
    </group>
  )
})
useGLTF.preload(MODEL)

const FLASH = 0.12 // s
const FLY = 0.3
const BURST = 0.45
const tmp = new THREE.Vector3()

/** One shot from `from` to `to` (world Vector3s); calls onDone when it has played out. */
export function Shot3D({ from, to, scale = 1, onDone }) {
  const t0 = useRef(null)
  const flash = useRef()
  const dart = useRef()
  const burst = useRef()
  const dir = useMemo(() => to.clone().sub(from).normalize(), [from, to])
  const mats = useMemo(
    () => ({
      flash: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe08a').multiplyScalar(4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      burst: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff9a3d').multiplyScalar(3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    }),
    [],
  )

  useFrame(({ clock }) => {
    t0.current ??= clock.elapsedTime
    const t = clock.elapsedTime - t0.current
    const f = Math.min(1, t / FLASH)
    flash.current.scale.setScalar(scale * (0.4 + f * 1.4))
    mats.flash.opacity = 1 - f
    const k = Math.min(1, t / FLY)
    dart.current.visible = k < 1
    dart.current.position.copy(tmp.copy(from).lerp(to, k * k * (3 - 2 * k)))
    dart.current.lookAt(to)
    const b = Math.max(0, (t - FLY) / BURST)
    burst.current.visible = t >= FLY && b < 1
    burst.current.scale.setScalar(scale * (0.3 + b * 3))
    mats.burst.opacity = 1 - b
    if (t > FLY + BURST) onDone?.()
  })

  return (
    <>
      <mesh ref={flash} position={from} material={mats.flash}>
        <sphereGeometry args={[0.18, 16, 12]} />
      </mesh>
      <group ref={dart} scale={scale}>
        <mesh material={TRIM} rotation-x={Math.PI / 2}>
          <capsuleGeometry args={[0.05, 0.22, 4, 10]} />
        </mesh>
        <mesh material={GLOW} position-z={0.17}>
          <sphereGeometry args={[0.055, 10, 8]} />
        </mesh>
      </group>
      <mesh ref={burst} position={to} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().negate())} material={mats.burst}>
        <ringGeometry args={[0.2, 0.32, 24]} />
      </mesh>
    </>
  )
}
