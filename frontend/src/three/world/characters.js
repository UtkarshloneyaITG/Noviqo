/**
 * Characters — the 21 CC0 Quaternius figures (public/models/characters).
 *
 * Shared by the lobby and the table:
 *   useCharacterModel(itemId, pose)  → { root, bones, base } ready to <primitive object={root}/>
 *   applyIdle(model, t, phase)       → breathing / look-around, call every frame
 *   usePortrait(itemId)              → URL of the pre-rendered head shot for 2D avatars
 *
 * The models ship without animations, so poses are set procedurally on the
 * named bones (UpperArm.L, LowerLeg.R, Head…; three.js strips the dots).
 */
import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { solveElbow } from './reach'

export const DEFAULT_CHARACTER = 'char:m-Casual'

/** 'char:m-Casual' → '/models/characters/m-Casual.glb' (unknown ids fall back to the default). */
export function characterUrl(itemId) {
  const key = typeof itemId === 'string' && /^char:[mw]-[A-Za-z0-9]+$/.test(itemId) ? itemId.slice(5) : 'm-Casual'
  return `/models/characters/${key}.glb`
}

// ── bone helpers ──────────────────────────────────────────────────────────
const X = new THREE.Vector3(1, 0, 0)
const Y = new THREE.Vector3(0, 1, 0)
const Z = new THREE.Vector3(0, 0, 1)
const v1 = new THREE.Vector3()
const v2 = new THREE.Vector3()
const q1 = new THREE.Quaternion()
const q2 = new THREE.Quaternion()

export function boneMap(root) {
  const m = {}
  root.traverse((o) => {
    if (o.isBone) m[o.name.replace(/[^A-Za-z]/g, '').toLowerCase()] = o
  })
  return m
}

/** Rotate `bone` so the bone→child direction points along `target` (world space). */
export function aim(bone, child, target) {
  bone.parent.updateWorldMatrix(true, false)
  bone.updateWorldMatrix(false, true)
  const dir = child.getWorldPosition(v2).sub(bone.getWorldPosition(v1)).normalize()
  const world = bone.getWorldQuaternion(q2).premultiply(q1.setFromUnitVectors(dir, target.clone().normalize()))
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world))
}

/** Extra rotation about a world axis, whatever the parent's orientation. */
export function turnBone(bone, worldAxis, angle) {
  const axis = worldAxis.clone().applyQuaternion(bone.parent.getWorldQuaternion(q1).invert())
  bone.quaternion.premultiply(q2.setFromAxisAngle(axis, angle))
}

function sideOf(b, s) {
  const up = b['upperarm' + s]
  const lo = b['lowerarm' + s]
  return Math.sign(lo.getWorldPosition(v1).x - up.getWorldPosition(v2).x) || 1
}

/** Arms down from the T-pose: a relaxed standing stance. */
export function poseStanding(root) {
  const b = boneMap(root)
  for (const s of ['l', 'r']) {
    const up = b['upperarm' + s], lo = b['lowerarm' + s], hand = b['hand' + s]
    if (!up || !lo || !hand) continue
    const side = sideOf(b, s)
    aim(up, lo, new THREE.Vector3(side * 0.2, -1, 0.06))
    aim(lo, hand, new THREE.Vector3(side * 0.04, -1, 0.22)) // soft elbow, hand beside the thigh
    relaxHand(hand)
  }
  return b
}

// Flex per joint, knuckle → tip (radians): each finger a little more curled than the last.
const CURL = { index: [0.25, 0.4, 0.3], middle: [0.3, 0.5, 0.35], ring: [0.35, 0.55, 0.35], pinky: [0.4, 0.6, 0.35], thumb: [0.15, 0.25] }

/** The T-pose hand is flat with the fingers fanned out. Draw them together and
 *  curl them softly. The rigs flex a finger about its bones' own X axis and
 *  fan it about Z, so this is all bone-local: it holds however the arm points. */
function relaxHand(hand) {
  const roots = hand.children.filter((o) => o.isBone)
  const middle = roots.find((o) => /^middle/i.test(o.name))?.quaternion.clone()
  for (const root of roots) {
    const curl = CURL[root.name.match(/^[a-z]+/i)?.[0].toLowerCase()]
    if (!curl) continue
    if (middle) root.quaternion.slerp(middle, /^thumb/i.test(root.name) ? 0.4 : 0.75) // close the fan; the thumb only partly
    let bone = root
    for (const a of curl) {
      bone.rotateX(-a) // −X curls toward the palm on these rigs
      bone = bone.children.find((o) => o.isBone && !/_end$/i.test(o.name))
      if (!bone) break
    }
  }
}

/** Seated at a table: thighs forward, shins down, forearms forward holding cards.
 *  The figure faces +Z; the hips stay at their standing height, so the caller
 *  lowers the model by `seatDrop(model)` to put the hips on the seat. */
export function poseSeated(root) {
  const b = boneMap(root)
  for (const s of ['l', 'r']) {
    const thigh = b['upperleg' + s], shin = b['lowerleg' + s], foot = b['foot' + s]
    if (thigh && shin && foot) {
      aim(thigh, shin, new THREE.Vector3(0, -0.08, 1))
      aim(shin, foot, new THREE.Vector3(0, -1, 0.12))
    }
    const up = b['upperarm' + s], lo = b['lowerarm' + s], hand = b['hand' + s]
    if (up && lo && hand) {
      const side = sideOf(b, s)
      aim(up, lo, new THREE.Vector3(side * 0.18, -0.75, 0.55))
      aim(lo, hand, new THREE.Vector3(-side * 0.35, 0.25, 1))
      relaxHand(hand) // fingers closed round the cards, not splayed flat
    }
  }
  return b
}

/**
 * Load (cached by drei) and clone a character, scaled to `height` metres and posed.
 * Suspends while the GLB loads — render inside <Suspense>.
 */
export function useCharacterModel(itemId, pose = 'stand', height = 1.8) {
  const { scene } = useGLTF(characterUrl(itemId))
  return useMemo(() => {
    const root = cloneSkinned(scene)
    root.updateMatrixWorld(true) // skinned bounds read bone world matrices; a fresh clone's are stale (measures ~38 m)
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true
        o.receiveShadow = false // receiving its own shadow blotches the low-poly faces
        o.frustumCulled = false
      }
    })
    const box = new THREE.Box3().setFromObject(root)
    root.scale.setScalar(height / (box.max.y - box.min.y))
    root.updateMatrixWorld(true)
    const bones = pose === 'sit' ? poseSeated(root) : poseStanding(root)
    const base = ['chest', 'neck', 'head', 'upperarml', 'upperarmr']
      .filter((k) => bones[k])
      .map((k) => [bones[k], bones[k].quaternion.clone()])
    return { root, bones, base, axes: idleAxes(root, bones) }
  }, [scene, pose, height])
}

/**
 * The idle rotations are about the model's own axes (X = its left/right,
 * Y = up, Z = forward). Expressed once in each bone's parent space, they
 * stay valid wherever the caller later places or turns the model, so
 * applyIdle never has to recompute world matrices.
 */
function idleAxes(root, b) {
  root.updateMatrixWorld(true)
  const rootQ = root.getWorldQuaternion(new THREE.Quaternion()).invert()
  const local = (bone, axis) => {
    if (!bone) return null
    const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootQ)
    return axis.clone().applyQuaternion(parentQ.invert())
  }
  return {
    chestX: local(b.chest, X),
    chestY: local(b.chest, Y),
    headY: local(b.head, Y),
    headX: local(b.head, X),
    armLZ: local(b.upperarml, Z),
    armRZ: local(b.upperarmr, Z),
  }
}

const r1 = new THREE.Vector3()
const r2 = new THREE.Vector3()
const r3 = new THREE.Vector3()
const r4 = new THREE.Vector3()
const rq1 = new THREE.Quaternion()
const rq2 = new THREE.Quaternion()

/**
 * Reach one arm ('r' or 'l') for a world point, blended in by `w` (0..1)
 * over the current pose: a two-bone solve with the elbow dropping down and
 * out from the body; out of reach, it leans the chest in (off with `lean: false`).
 * Call after applyIdle / applyLook, every frame.
 */
export function reachArm(model, side, target, w, { lean: canLean = true } = {}) {
  const b = model.bones
  const up = b['upperarm' + side]
  const lo = b['lowerarm' + side]
  const hand = b['hand' + side]
  if (!up || !lo || !hand || !(w > 0)) return
  model.root.updateWorldMatrix(true, true)
  let S = up.getWorldPosition(r1)
  const a = S.distanceTo(lo.getWorldPosition(r2))
  const len = r2.distanceTo(hand.getWorldPosition(r3))
  // Too far for the arm alone? Lean the body in (up to ~35°), as a seated player would.
  const lean = b.chest // applyIdle resets it every frame, so the lean never piles up
  const short = S.distanceTo(target) - (a + len) * 0.92
  if (canLean && lean && short > 0) {
    const pivot = lean.getWorldPosition(r4)
    const axis = r2.set(0, 1, 0).cross(r3.copy(target).sub(pivot).setY(0)).normalize()
    turnBone(lean, axis, Math.min(0.6, short / Math.max(1e-3, S.distanceTo(pivot))) * w)
    model.root.updateWorldMatrix(true, true)
    S = up.getWorldPosition(r1)
  }
  const body = (b.chest || up.parent).getWorldPosition(r4)
  const out = r3.copy(S).sub(body).setY(0).normalize().multiplyScalar(0.6)
  const e = solveElbow(S.toArray(), target.toArray(), a, len, [out.x, -1, out.z])
  rq1.copy(up.quaternion)
  rq2.copy(lo.quaternion)
  aim(up, lo, r2.fromArray(e).sub(S))
  aim(lo, hand, r3.copy(target).sub(r2.fromArray(e)))
  if (w < 1) {
    up.quaternion.copy(rq1.slerp(up.quaternion, w))
    lo.quaternion.copy(rq2.slerp(lo.quaternion, w))
  }
}

/** How far to lower a seated model so its hips rest at `seatY` (world, model at y=0). */
export function seatDrop(model, seatY) {
  model.root.updateMatrixWorld(true)
  const hips = model.bones.hips?.getWorldPosition(new THREE.Vector3())
  return hips ? hips.y - model.root.position.y - seatY : 0
}

const _idleQ = new THREE.Quaternion()
function sway(bone, axis, angle) {
  if (bone && axis) bone.quaternion.premultiply(_idleQ.setFromAxisAngle(axis, angle))
}

/** Idle motion: breathing, a slow look around, arms swaying. Call each frame.
 *  Constant cost: five quaternion multiplies, no matrix updates, no allocation. */
export function applyIdle(model, t, phase = 0, amount = 1) {
  for (const [bone, q] of model.base) bone.quaternion.copy(q)
  const s = t + phase
  const b = model.bones
  const a = model.axes
  sway(b.chest, a.chestX, Math.sin(s * 1.5) * 0.018 * amount)
  sway(b.head, a.headY, Math.sin(s * 0.45) * 0.16 * amount)
  sway(b.head, a.headX, Math.sin(s * 0.3) * 0.04 * amount)
  sway(b.upperarml, a.armLZ, Math.sin(s * 1.5) * 0.02 * amount)
  sway(b.upperarmr, a.armRZ, -Math.sin(s * 1.5) * 0.02 * amount)
}

/** Turn the head (and a little of the chest) to where the player is looking.
 *  yaw > 0 = their left, pitch > 0 = up — the same sense as LookControls.
 *  Call after applyIdle, every frame. */
export function applyLook(model, yaw, pitch) {
  const b = model.bones
  const a = model.axes
  sway(b.chest, a.chestY, yaw * 0.3)
  sway(b.head, a.headY, yaw * 0.95)
  sway(b.head, a.headX, -pitch * 0.9)
}

// ── portraits (2D head shots for HTML avatars) ───────────────────────────
// Pre-rendered once into public/models/characters/portraits/ (192×192 PNG,
// ~18 KB each) so an avatar costs an <img>, not a model download + a WebGL
// render. Regenerate them if a model changes.

/** URL of the head shot for a character item id (unknown ids → the default). */
export function portraitUrl(itemId) {
  return characterUrl(itemId).replace('/characters/', '/characters/portraits/').replace(/\.glb$/, '.png')
}

/** Head-shot URL for an <img>; null only when itemId is explicitly null. */
export function usePortrait(itemId) {
  return itemId === null ? null : portraitUrl(itemId || DEFAULT_CHARACTER)
}
