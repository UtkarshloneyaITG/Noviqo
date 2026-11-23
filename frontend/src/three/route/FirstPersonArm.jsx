/**
 * FirstPersonArm — your own character's right arm, seen in first person.
 *
 * A copy of your equipped character stands just behind and below the camera,
 * facing where you look. Its head, legs and feet are hidden, and a shader
 * shows only the band round its right arm (shoulder → elbow → fingertips),
 * so what reaches into the bottom right of your view is your character's
 * real arm and hand (same sleeve, gloves, skin), with no body in the way.
 * The same two-bone reach the seated players use (reachArm) drives it:
 *
 *   resting       hand low at the bottom right
 *   your throw    holds the four shells out (Shells3D reads the palm)
 *   holding THROW shakes them (acts.localHold)
 *   the throw     whips forward, the shells fly out
 *   your move     reaches toward the pawn (along your line of sight, at arm's
 *                 length) and follows it as it is carried (acts.carry)
 *
 * Every target is eased per frame, so a new one mid-move just bends the path.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useCharacterModel, reachArm } from '../world/characters'
import { FIGURE_H } from '../layout'
import { stillBackgrounds } from '../../store/display'
import { acts } from './acts'

const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
// Camera space (x right, y up, −z ahead).
const SHOULDER = new THREE.Vector3(1.35, -1.35, -0.15) // just off screen, bottom right
const REST = new THREE.Vector3(1.0, -1.0, -2.2)
const HOLD = new THREE.Vector3(0.55, -0.75, -2.3)
const FLING = new THREE.Vector3(0.2, -0.45, -3.4)
const LOOK_D = 3.0 // how far along your line of sight to a pawn the hand aims (the arm straightens toward it)
const FLING_S = 0.4
const SHOW_R = 0.62 // world units round the arm's bones that are drawn
const UP = new THREE.Vector3(0, 1, 0)
const FACE = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI) // the model faces +Z; turn it to face where you look

/** Discard every fragment farther than uR from the shoulder→elbow→fingertip line. */
function armOnly(material, U) {
  const m = material.clone()
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U)
    shader.vertexShader = 'varying vec3 vArmWorld;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n  vArmWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    )
    shader.fragmentShader = `
      uniform vec3 uA, uB, uC; uniform float uR;
      varying vec3 vArmWorld;
      float armSeg(vec3 p, vec3 a, vec3 b) { vec3 ab = b - a; float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0); return length(p - a - ab * t); }
    ` + shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\n  if (min(armSeg(vArmWorld, uA, uB), armSeg(vArmWorld, uB, uC)) > uR) discard;',
    )
  }
  m.customProgramCacheKey = () => 'nq-arm-only'
  return m
}

const v1 = new THREE.Vector3()
const v2 = new THREE.Vector3()
const v3 = new THREE.Vector3()

export default function FirstPersonArm({ seatId, character }) {
  const { camera } = useThree()
  const model = useCharacterModel(character, 'stand', FIGURE_H)
  const U = useMemo(() => ({ uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uC: { value: new THREE.Vector3() }, uR: { value: SHOW_R } }), [])
  const target = useRef(null)

  // Only the body mesh (it carries the arms), drawn as the arm alone; no shadows from a body nobody sees.
  const owned = useMemo(() => {
    const made = []
    model.root.traverse((o) => {
      if (!o.isMesh) return
      o.castShadow = false
      let p = o
      while (p && p !== model.root && !/_(head|legs|feet)(_\d+)?$/i.test(p.name)) p = p.parent
      if (p && p !== model.root) {
        o.visible = false
        return
      }
      o.material = Array.isArray(o.material) ? o.material.map((m) => armOnly(m, U)) : armOnly(o.material, U)
      made.push(...[o.material].flat())
    })
    return made
  }, [model, U])
  useEffect(() => () => owned.forEach((m) => m.dispose()), [owned])

  // The shells ride the palm while they're in your hand (smaller: it's close to your eye).
  useEffect(() => {
    const b = model.bones
    acts.hands[seatId] = {
      scale: 0.5,
      anchor: (out) => (b.handr && b.lowerarmr ? b.handr.getWorldPosition(out).add(v3.copy(out).sub(b.lowerarmr.getWorldPosition(v2)).normalize().multiplyScalar(0.18)) : null),
    }
    return () => delete acts.hands[seatId]
  }, [seatId, model])

  useFrame(({ clock }, dt) => {
    const { root, bones } = model
    const calm = reduce || stillBackgrounds()
    const toss = acts.toss[seatId]
    const carry = acts.carry[seatId]
    const age = toss ? performance.now() / 1000 - toss.since : 9

    // Where the hand wants to be, in world space.
    const toWorld = (p) => v1.copy(p).applyQuaternion(camera.quaternion).add(camera.position)
    let want
    if (carry) {
      want = v1.copy(carry.at).setY(carry.at.y + 0.6).sub(camera.position).normalize().multiplyScalar(LOOK_D).add(camera.position)
    } else if (toss?.phase === 'fling' && age < FLING_S) {
      want = toWorld(v2.copy(HOLD).lerp(FLING, Math.sin((Math.PI / 2) * (age / FLING_S))))
    } else if (toss?.phase === 'hold') {
      v2.copy(HOLD)
      if (acts.localHold && !calm) v2.add(v3.set(Math.sin(clock.elapsedTime * 31) * 0.06, Math.sin(clock.elapsedTime * 23) * 0.1, 0))
      want = toWorld(v2)
    } else want = toWorld(REST)
    if (!target.current) target.current = want.clone()
    target.current.lerp(want, Math.min(1, dt * (carry ? 9 : 12)))

    // Stand the copy so its right shoulder sits at SHOULDER, facing where you look.
    root.quaternion.copy(camera.quaternion).multiply(FACE)
    root.position.set(0, 0, 0)
    root.updateMatrixWorld(true)
    const shoulder = bones.upperarmr.getWorldPosition(v2)
    root.position.copy(toWorld(SHOULDER)).sub(shoulder)
    root.updateMatrixWorld(true)

    reachArm(model, 'r', target.current, 1, { lean: false })

    // The visible band follows the arm's bones.
    root.updateMatrixWorld(true)
    bones.upperarmr.getWorldPosition(U.uA.value)
    bones.lowerarmr.getWorldPosition(U.uB.value)
    const hand = bones.handr.getWorldPosition(U.uC.value)
    hand.add(v3.copy(hand).sub(U.uB.value).normalize().multiplyScalar(0.45)) // on past the wrist to the fingertips
  })

  return <primitive object={model.root} />
}
