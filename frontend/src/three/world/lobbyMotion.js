/**
 * Posing a lobby figure by hand, on top of whatever its animation clip holds
 * this frame — the entrances' body poses (three/world/Entrance.jsx) use it.
 *
 *   layerPose(model, fn, w)  fn(p) poses the body through p.bend / p.arm;
 *                            returns how far to lift the figure (p.lift).
 *
 * Poses are written in the model's own space: +Y up, +Z the way it faces,
 * and +X pointing OUT from whichever arm is posed, so one pose reads the
 * same on either arm. Bend the body before posing arms (they hang off it).
 */
import * as THREE from 'three'
import { aim, turnBone } from './characters'

const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }
const rootQ = new THREE.Quaternion()
const q0 = new THREE.Quaternion()
const q1 = new THREE.Quaternion()
const v = new THREE.Vector3()

/** Aim bone→child along a model-space direction, blended in by w. */
function point(bone, child, [x, y, z], sx, w) {
  if (!bone || !child) return
  q0.copy(bone.quaternion)
  aim(bone, child, v.set(x * sx, y, z).applyQuaternion(rootQ))
  q1.copy(bone.quaternion)
  bone.quaternion.copy(q0).slerp(q1, w)
}

// What a pose function gets as `p`.
const ctx = {
  model: null, side: null, w: 1, lift: 0,
  bend(key, axis, angle) {
    const bone = this.model.bones[key]
    if (bone) turnBone(bone, v.copy(AXES[axis]).applyQuaternion(rootQ), angle * this.w)
  },
  arm(s, upper, lower) {
    const b = this.model.bones
    point(b['upperarm' + s], b['lowerarm' + s], upper, this.side[s], this.w)
    point(b['lowerarm' + s], b['hand' + s], lower, this.side[s], this.w)
  },
}

/** Once per model: which way is "out" for each arm. */
function sides({ root, bones }) {
  root.updateWorldMatrix(true, true)
  const local = (bone) => root.worldToLocal(bone.getWorldPosition(new THREE.Vector3()))
  const mid = bones.chest ? local(bones.chest).x : 0
  const side = {}
  for (const s of 'lr') side[s] = bones['upperarm' + s] ? Math.sign(local(bones['upperarm' + s]).x - mid) || 1 : 1
  return side
}

/**
 * Apply a pose function on top of whatever the bones hold right now (call
 * after the mixer has run). `bend` turns are scaled by w, `arm` aims blend
 * from the current pose by w. Returns how far to lift the figure.
 */
export function layerPose(model, fn, w = 1) {
  model.side ??= sides(model)
  model.root.getWorldQuaternion(rootQ)
  Object.assign(ctx, { model, side: model.side, w, lift: 0 })
  fn(ctx)
  return ctx.lift
}
