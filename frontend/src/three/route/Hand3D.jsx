/**
 * Hand3D — your own right hand in first person, bottom right of the view,
 * with a sleeve in your seat colour running back to the corner of the screen.
 *
 *   resting       relaxed, palm down
 *   your throw    palm up, the four shells in it (Shells3D reads the palm)
 *   holding THROW closes into a fist round them and shakes (acts.localHold)
 *   the throw     whips forward and opens, the shells fly out
 *   your move     reaches into the scene to the pawn (acts.carry), pinches it,
 *                 follows it square by square, lets go and comes back
 *
 * Built from simple shapes (palm, three-joint fingers, thumb). Everything is
 * eased every frame, so a new target mid-move just bends the path.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { acts } from './acts'
import { COLOUR_HEX } from '../../route/info'
import { stillBackgrounds } from '../../store/display'

const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const REST = new THREE.Vector3(1.05, -0.95, -2.4) // camera space
const ELBOW = new THREE.Vector3(2.2, -2.3, -0.9) // where the sleeve leaves the screen (camera space)
const GRIP = new THREE.Vector3(0, 0.9, 0) // aim just above a pawn being carried
const ARM = [3.4, 5.0] // how far from your eye the hand goes along that line (first person: it covers the pawn, the arm stays short)
const SCALE = 1.55
const FLING_S = 0.4
const SKIN = new THREE.MeshStandardMaterial({ color: '#d9a07a', roughness: 0.55 })
const NAIL = new THREE.MeshStandardMaterial({ color: '#f1cdb6', roughness: 0.35 })

// Fingers point along −Z, the back of the hand is +Y; the thumb is on the −X side (a right hand).
const PALM_GEO = new THREE.BoxGeometry(0.34, 0.11, 0.38)
const KNUCKLE_GEO = new THREE.CapsuleGeometry(0.052, 0.3, 4, 10).rotateZ(Math.PI / 2)
const SEG_GEO = (len) => new THREE.CapsuleGeometry(0.038, len, 4, 10).rotateX(Math.PI / 2).translate(0, 0, -len / 2)
const FINGERS = [
  { x: -0.11, segs: [0.11, 0.075, 0.06] },
  { x: -0.035, segs: [0.12, 0.08, 0.065] },
  { x: 0.04, segs: [0.115, 0.075, 0.06] },
  { x: 0.11, segs: [0.09, 0.06, 0.05] },
].map((f) => ({ ...f, geos: f.segs.map(SEG_GEO) }))
const THUMB = [0.09, 0.07].map(SEG_GEO)

const v1 = new THREE.Vector3()
const v2 = new THREE.Vector3()
const v3 = new THREE.Vector3()
const q1 = new THREE.Quaternion()
const q2 = new THREE.Quaternion()
const e1 = new THREE.Euler(0, 0, 0, 'YXZ')
const Y = new THREE.Vector3(0, 1, 0)

/** One finger: segment groups nested at the knuckles so a curl bends each joint. */
function Finger({ f, joints }) {
  const refs = useRef([])
  useEffect(() => joints.push(refs.current), [joints])
  const build = (i) =>
    i >= f.geos.length ? null : (
      <group ref={(g) => (refs.current[i] = g)} position={i === 0 ? [f.x, 0, -0.19] : [0, 0, -f.segs[i - 1]]}>
        <mesh geometry={f.geos[i]} material={i === f.geos.length - 1 ? NAIL : SKIN} />
        {build(i + 1)}
      </group>
    )
  return build(0)
}

export default function Hand3D({ seatId, colour }) {
  const { camera } = useThree()
  const hand = useRef()
  const palm = useRef()
  const sleeve = useRef()
  const fingerJoints = useMemo(() => [], [])
  const thumb = useRef([])
  const state = useRef({ pos: null, quat: new THREE.Quaternion(), curl: 0.35, up: 0 })
  const cuffMat = useMemo(() => new THREE.MeshStandardMaterial({ color: COLOUR_HEX[colour] || '#4fd8ff', roughness: 0.6 }), [colour])
  // the sleeve a darker shade of your colour, so the bright cuff reads at the wrist
  const sleeveMat = useMemo(() => new THREE.MeshStandardMaterial({ color: new THREE.Color(COLOUR_HEX[colour] || '#4fd8ff').multiplyScalar(0.45), roughness: 0.85 }), [colour])
  useEffect(() => () => (sleeveMat.dispose(), cuffMat.dispose()), [sleeveMat, cuffMat])

  // The shells ride the palm while they're in your hand.
  useEffect(() => {
    acts.hands[seatId] = {
      scale: 0.42,
      anchor: (out) => (palm.current ? palm.current.getWorldPosition(out).addScaledVector(Y, 0.12) : null),
    }
    return () => delete acts.hands[seatId]
  }, [seatId])

  useFrame(({ clock }, dt) => {
    const g = hand.current
    if (!g) return
    const s = state.current
    const calm = reduce || stillBackgrounds()
    const t = clock.elapsedTime
    const carry = acts.carry[seatId]
    const toss = acts.toss[seatId]
    const age = toss ? performance.now() / 1000 - toss.since : 9
    const holding = toss?.phase === 'hold'
    const fist = holding && acts.localHold
    const flinging = toss?.phase === 'fling' && age < FLING_S

    // Where the hand wants to be, and how.
    const rest = v1.copy(REST).applyQuaternion(camera.quaternion).add(camera.position)
    let want = rest
    let curl = 0.35
    let palmUp = 0
    e1.set(0.25, 0.3, 0)
    let wantQ = q1.copy(camera.quaternion).multiply(q2.setFromEuler(e1))
    if (carry) {
      // Along your line of sight to the pawn, at arm's length: on screen the hand is over the pawn.
      const aim = v3.copy(carry.at).add(GRIP).sub(camera.position)
      const dist = aim.length()
      want = v2.copy(camera.position).addScaledVector(aim.normalize(), Math.min(ARM[1], Math.max(ARM[0], dist * 0.42)))
      curl = carry.phase === 'reach' ? 0.15 : carry.phase === 'release' ? 0.2 : 0.75 // open, pinch, let go
      const dx = carry.at.x - camera.position.x
      const dz = carry.at.z - camera.position.z
      e1.set(-1.05, Math.atan2(-dx, -dz), 0)
      wantQ = q1.setFromEuler(e1)
    } else if (holding || flinging) {
      palmUp = 1
      curl = fist ? 1 : 0.3
      if (flinging) {
        const k = age / FLING_S // whip forward and open
        want = v2.copy(REST).add(v3.set(0, 0.5 * Math.sin(Math.PI * k), -1.2 * Math.sin(Math.PI * k))).applyQuaternion(camera.quaternion).add(camera.position)
        curl = 0
      } else if (fist && !calm) {
        want = v2.copy(REST).add(v3.set(Math.sin(t * 31) * 0.05, Math.sin(t * 23) * 0.09, 0)).applyQuaternion(camera.quaternion).add(camera.position)
      }
    }

    // Ease everything (a new target mid-move just bends the path).
    const k = Math.min(1, dt * (carry ? 9 : 12))
    if (!s.pos) s.pos = want.clone()
    s.pos.lerp(want, k)
    s.quat.slerp(wantQ, k)
    s.curl += (curl - s.curl) * Math.min(1, dt * 14)
    s.up += (palmUp - s.up) * Math.min(1, dt * 10)
    g.position.copy(s.pos)
    g.quaternion.copy(s.quat)
    g.rotateZ(Math.PI * s.up) // roll palm-up to hold the shells

    for (const joints of fingerJoints) joints.forEach((j, i) => j && (j.rotation.x = -s.curl * (i === 0 ? 1.3 : 1.45)))
    thumb.current.forEach((j, i) => j && (j.rotation.y = -s.curl * (i === 0 ? 0.9 : 0.7)))

    // The sleeve runs from the wrist back to the corner of the screen.
    const sl = sleeve.current
    if (sl) {
      const wrist = v1.set(0, 0, 0.26).multiplyScalar(SCALE).applyQuaternion(g.quaternion).add(g.position)
      const elbow = v2.copy(ELBOW).applyQuaternion(camera.quaternion).add(camera.position)
      sl.position.lerpVectors(wrist, elbow, 0.5)
      sl.scale.set(1, wrist.distanceTo(elbow), 1)
      sl.quaternion.setFromUnitVectors(Y, elbow.sub(wrist).normalize())
    }
  })

  return (
    <group>
      <group ref={hand} scale={SCALE}>
        <mesh ref={palm} geometry={PALM_GEO} material={SKIN} />
        <mesh geometry={KNUCKLE_GEO} material={SKIN} position={[0, 0.01, -0.18]} />
        {FINGERS.map((f) => (
          <Finger key={f.x} f={f} joints={fingerJoints} />
        ))}
        <group position={[-0.17, -0.01, 0.02]} rotation={[0, 0.7, -0.3]}>
          <group ref={(g) => (thumb.current[0] = g)}>
            <mesh geometry={THUMB[0]} material={SKIN} />
            <group ref={(g) => (thumb.current[1] = g)} position={[0, 0, -0.09]}>
              <mesh geometry={THUMB[1]} material={NAIL} />
            </group>
          </group>
        </group>
        {/* cuff */}
        <mesh position={[0, 0, 0.23]} rotation-x={Math.PI / 2} material={cuffMat}>
          <cylinderGeometry args={[0.2, 0.2, 0.1, 16]} />
        </mesh>
      </group>
      <mesh ref={sleeve} material={sleeveMat}>
        <cylinderGeometry args={[0.16, 0.23, 1, 16]} />
      </mesh>
    </group>
  )
}
