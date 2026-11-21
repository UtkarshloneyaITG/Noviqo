/**
 * Lobby figure motion — a relaxed standing idle, with emotes acted out on top.
 * The character models ship without clips, so all of it is procedural.
 *
 *   animateFigure(model, t, phase, emote, now)  call every frame; returns how
 *     far to lift the figure (jumps, bounces), 0 when not emoting.
 *
 * Poses are written in the model's own space: +Y up, +Z the way it faces,
 * and +X pointing OUT from whichever arm is posed, so one pose reads the
 * same on either arm. Bend the body before posing arms (they hang off it).
 * Emote ids, and the emote pack that unlocks each, come from the server catalog.
 */
import * as THREE from 'three'
import { aim, applyIdle, turnBone } from './characters'

/** Rotate a model-space direction about X, the way a forward bend of `a` does. */
const tilt = ([x, y, z], a) => [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)]

export const LOBBY_EMOTES = {
  wave: {
    name: 'Wave', icon: '👋', secs: 2.4,
    pose(t, p) {
      p.bend('head', 'z', 0.08)
      p.arm('r', [0.85, 0.55, 0.2], [0.35 * Math.sin(t * 9), 1, 0.25])
    },
  },
  cheer: {
    name: 'Cheer', icon: '🎉', secs: 2.2,
    pose(t, p) {
      const k = Math.abs(Math.sin(t * 6))
      p.lift = 0.08 * k
      p.bend('head', 'x', -0.15)
      for (const s of 'lr') p.arm(s, [0.5, 0.75 + 0.5 * k, 0.15], [0.2, 1, 0.1])
    },
  },
  thumbs_up: {
    name: 'Thumbs up', icon: '👍', secs: 2,
    pose(t, p) {
      p.bend('head', 'x', 0.12 * Math.max(0, Math.sin(t * 7)))
      p.arm('r', [0.25, -0.75, 0.6], [-0.1, 0.55, 1]) // fist out in front of the chest
    },
  },
  clap: {
    name: 'Clap', icon: '👏', secs: 2.2,
    pose(t, p) {
      const open = 0.5 + 0.5 * Math.sin(t * 13)
      for (const s of 'lr') p.arm(s, [0.25, -0.5, 0.85], [-0.9 + 0.6 * open, 0.3, 1])
    },
  },
  laugh: {
    name: 'Laugh', icon: '😂', secs: 2.2,
    pose(t, p) {
      p.bend('torso', 'x', -0.1 + 0.07 * Math.sin(t * 16))
      p.bend('head', 'x', -0.2)
      for (const s of 'lr') p.arm(s, [0.45, -1, 0.2], [-0.55, -0.1, 0.8]) // hands on the belly
    },
  },
  think: {
    name: 'Think', icon: '🤔', secs: 2.6,
    pose(t, p) {
      p.bend('head', 'z', 0.14)
      p.bend('head', 'x', 0.08)
      p.arm('l', [0.3, -0.95, 0.35], [-1, 0.15, 0.45]) // across the waist, propping the elbow
      p.arm('r', [0.15, -0.9, 0.35], [-0.6, 1, 0.08]) // knuckles under the chin
    },
  },
  shrug: {
    name: 'Shrug', icon: '🤷', secs: 2,
    pose(t, p) {
      const bob = 0.75 + 0.25 * Math.sin(t * 11) // a little double-shrug bounce
      for (const s of 'lr') {
        p.bend('shoulder' + s, 'z', p.side[s] * 0.22 * bob) // shoulders up to the ears
        p.arm(s, [0.22, -0.95, 0.12], [0.62, 0.18, 0.75]) // elbows tucked in, forearms forward and out, palms up
      }
      p.bend('head', 'z', 0.14)
      p.bend('head', 'x', -0.06)
      p.bend('chest', 'x', -0.04)
    },
  },
  dance: {
    name: 'Dance', icon: '🕺', secs: 3.2,
    pose(t, p) {
      const b = Math.sin(t * 7)
      p.lift = 0.04 * Math.abs(Math.cos(t * 7))
      p.bend('torso', 'z', 0.12 * b)
      p.bend('chest', 'y', 0.2 * b)
      p.bend('head', 'z', -0.1 * b)
      p.arm('l', [0.6, 0.1 + 0.7 * Math.max(0, b), 0.45], [0.05, 1, 0.35])
      p.arm('r', [0.6, 0.1 + 0.7 * Math.max(0, -b), 0.45], [0.05, 1, 0.35])
    },
  },
  salute: {
    name: 'Salute', icon: '🫡', secs: 2.2,
    pose(t, p) {
      p.bend('head', 'x', -0.06)
      p.arm('r', [1, 0.1, 0.3], [-0.55, 0.8, -0.1]) // elbow out, fingertips at the brow
    },
  },
  bow: {
    name: 'Bow', icon: '🙏', secs: 2.6,
    pose(t, p) {
      const a = 0.5 * Math.sin(Math.PI * Math.min(1, t / 2.3)) // down and back up
      p.bend('torso', 'x', a)
      p.bend('head', 'x', 0.3 * a)
      // palms together at the chest, carried down with the bow
      for (const s of 'lr') p.arm(s, tilt([0.25, -0.7, 0.6], a * p.w), tilt([-0.55, 0.75, 0.55], a * p.w))
    },
  },
  flex: {
    name: 'Flex', icon: '💪', secs: 2.4,
    pose(t, p) {
      const k = 0.5 + 0.5 * Math.sin(t * 8)
      p.bend('chest', 'x', -0.06)
      for (const s of 'lr') p.arm(s, [1, 0.25, 0.05], [-0.45 - 0.2 * k, 1, 0.15]) // biceps curled toward the head
    },
  },
}

/** Standing idle on top of applyIdle: a slow weight shift through the spine,
 *  breathing in the shoulders, arms swinging loosely and out of step. */
function relax(s, p) {
  const sway = Math.sin(s * 0.8) + 0.3 * Math.sin(s * 1.9)
  const breath = Math.sin(s * 1.5)
  p.bend('abdomen', 'z', 0.035 * sway)
  p.bend('chest', 'z', -0.025 * sway) // keeps the head over the hips
  for (const a of 'lr') {
    const out = p.side[a]
    p.bend('shoulder' + a, 'z', out * 0.02 * breath)
    p.bend('upperarm' + a, 'x', -0.05 * Math.sin(s * 0.8 + out))
    p.bend('lowerarm' + a, 'x', -0.07 * (0.5 + 0.5 * Math.sin(s * 0.8 + out + 0.9)))
  }
}

const IN = 0.2 // seconds to blend into an emote…
const OUT = 0.35 // …and back to the idle
// Bones moved here that applyIdle doesn't reset; put back to the stance every frame.
const EXTRA = ['abdomen', 'torso', 'shoulderl', 'shoulderr', 'lowerarml', 'lowerarmr', 'handl', 'handr',
  'hips', 'upperlegl', 'upperlegr', 'lowerlegl', 'lowerlegr', 'footl', 'footr'] // legs: entrances crouch and step
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

// What relax() and a pose function get as `p`.
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

/** Once per model, before anything moves: the stance of the EXTRA bones, and which way is "out" for each arm. */
function setup({ root, bones }) {
  root.updateWorldMatrix(true, true)
  const local = (bone) => root.worldToLocal(bone.getWorldPosition(new THREE.Vector3()))
  const mid = bones.chest ? local(bones.chest).x : 0
  const side = {}
  for (const s of 'lr') side[s] = bones['upperarm' + s] ? Math.sign(local(bones['upperarm' + s]).x - mid) || 1 : 1
  return { side, rest: EXTRA.filter((k) => bones[k]).map((k) => [bones[k], bones[k].quaternion.clone()]) }
}

/**
 * One frame of a standing lobby figure: idle at time `t` (seconds; pass a
 * constant to hold still), plus `emote` ({ id, at: performance.now() when it
 * arrived }) if one is playing at `now`. Returns how far to lift the figure.
 * `entrance` (optional) is a pose function (see three/world/Entrance.jsx): while
 * it's given it owns the body and emotes wait.
 */
export function animateFigure(model, t, phase, emote, now, entrance) {
  const st = (model.lobby ??= setup(model))
  for (const [bone, q] of st.rest) bone.quaternion.copy(q)
  applyIdle(model, t, phase)
  model.root.getWorldQuaternion(rootQ)
  Object.assign(ctx, { model, side: st.side, w: 1, lift: 0 })
  relax(t + phase, ctx)
  if (entrance) {
    entrance(ctx)
    return ctx.lift
  }

  const def = emote && LOBBY_EMOTES[emote.id]
  const e = def ? (now - emote.at) / 1000 : Infinity
  if (!def || e >= def.secs) return 0
  const r = Math.max(0, Math.min(1, e / IN, (def.secs - e) / OUT))
  ctx.w = r * r * (3 - 2 * r)
  def.pose(e, ctx)
  return ctx.lift * ctx.w
}
