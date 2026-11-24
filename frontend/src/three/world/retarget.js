/**
 * Retarget animation clips from another skeleton onto our characters' rig
 * (used by three/world/clipMotion.js). Bakes a new clip once per character,
 * by sampling the source frame by frame:
 *
 *   body bones  copy the source bone's world rotation *relative to its rest
 *               pose*. Works when both skeletons rest in the same pose — our
 *               rig and the Quaternius animation library are both T-pose,
 *               facing +Z.
 *   aim bones   point the bone the same way the source bone points (bone →
 *               child direction). Works across different rest poses; loses
 *               forearm twist.
 *   hips        also follow the source's hip bob, scaled to our hip height.
 *
 * Source skeletons and clips come from public/models/motion/motions.json
 * (made from the CC0 Quaternius files; see the LICENSE.txt there).
 */
import * as THREE from 'three'

/** Our rig ← animation library (Rigify "DEF-" names; GLTFLoader drops the dots). */
export const LIBRARY_MAP = (() => {
  const m = { Hips: 'DEF-hips', Abdomen: 'DEF-spine001', Torso: 'DEF-spine002', Chest: 'DEF-spine003', Neck: 'DEF-neck', Head: 'DEF-head' }
  for (const s of ['L', 'R']) {
    Object.assign(m, {
      [`Shoulder${s}`]: `DEF-shoulder${s}`, [`UpperArm${s}`]: `DEF-upper_arm${s}`, [`LowerArm${s}`]: `DEF-forearm${s}`, [`Hand${s}`]: `DEF-hand${s}`,
      [`UpperLeg${s}`]: `DEF-thigh${s}`, [`LowerLeg${s}`]: `DEF-shin${s}`, [`Foot${s}`]: `DEF-foot${s}`,
      [`Thumb2${s}`]: `DEF-thumb02${s}`, [`Thumb3${s}`]: `DEF-thumb03${s}`,
    })
    for (const f of ['index', 'middle', 'ring', 'pinky']) {
      const F = f[0].toUpperCase() + f.slice(1)
      for (let k = 1; k <= 3; k++) m[`${F}${k + 1}${s}`] = `DEF-f_${f}0${k}${s}`
    }
  }
  return m
})()

/** Rebuild a source skeleton from motions.json as plain nodes an AnimationMixer can drive. */
export function buildSource(source) {
  const sk = source.skeleton
  const holder = new THREE.Object3D()
  holder.matrixAutoUpdate = false
  holder.matrix.fromArray(sk.parentMatrix) // the armature transform above the root bone
  const byName = {}
  for (const b of sk.bones) {
    const o = new THREE.Object3D()
    o.name = b.name
    o.position.fromArray(b.p)
    o.quaternion.fromArray(b.q)
    o.scale.fromArray(b.s)
    byName[b.name] = o
    ;(b.parent ? byName[b.parent] : holder).add(o)
  }
  const clips = Object.fromEntries(
    source.clips.map((c) => [
      c.name,
      new THREE.AnimationClip(c.name, c.duration, c.tracks.map((t) =>
        t.type === 'quaternion' ? new THREE.QuaternionKeyframeTrack(t.name, t.times, t.values) : new THREE.VectorKeyframeTrack(t.name, t.times, t.values))),
    ]),
  )
  const mixer = new THREE.AnimationMixer(holder)
  return { holder, byName, clips, mixer, action: null }
}

/**
 * Pose a source at time t of `clip`: a clip name (loops), or a sequence
 * [[clipName, seconds], …] played in order — a "_Loop" clip repeats for its
 * seconds, any other plays once (or its first seconds) and holds its last frame.
 */
function sample(src, clip, t) {
  let name = clip
  if (typeof clip !== 'string') {
    let i = 0
    while (i < clip.length - 1 && t > clip[i][1]) t -= clip[i++][1]
    name = clip[i][0]
    const d = src.clips[name].duration
    t = name.endsWith('_Loop') ? t % d : Math.min(t, clip[i][1], d - 1e-4)
  }
  const c = src.clips[name]
  if (src.action?.getClip() !== c) {
    src.mixer.stopAllAction()
    src.action = src.mixer.clipAction(c).play()
  }
  src.mixer.setTime(t % c.duration)
  src.holder.updateMatrixWorld(true)
}

const JOIN = 0.15 // seconds to blend across a join in a clip sequence
const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion())
const wp = (o) => o.getWorldPosition(new THREE.Vector3())

/**
 * Bake a clip for `target` (a fresh clone of one of our character scenes, still
 * in its bind pose, root at the origin).
 *   body: { src, clip, ref, map }          rotation transfer (ref = the source's T-pose clip;
 *                                          clip = a name or a sequence, see sample())
 *   aim:  { src, clip, pairs: [[ourBone, ourChild, srcBone, srcChild]] }   optional
 *   lift: (t) => metres                    optional: raise the hips (a jump the source does in place)
 */
export function bakeClip(target, { name, duration, fps = 30, body, aim, authored, lift }) {
  target.updateMatrixWorld(true)
  const bones = []
  target.traverse((o) => o.isBone && bones.push(o)) // parents before children
  const childOf = new Map(bones.map((b) => [b, b.children.find((c) => c.isBone) || b.children[0]]))
  const rest = new Map(bones.map((b) => [b, { local: b.quaternion.clone(), world: wq(b) }]))
  const byName = Object.fromEntries(bones.map((b) => [b.name, b]))

  // the source's reference (T-pose) world rotations
  sample(body.src, body.ref, 0)
  const srcRef = {}
  for (const s of Object.values(body.map)) if (body.src.byName[s]) srcRef[s] = wq(body.src.byName[s])
  const hips = byName.Hips
  const srcHips = body.src.byName[body.map.Hips]
  const srcHipsRef = wp(srcHips)
  const hipScale = wp(hips).y / srcHipsRef.y
  const hipsRestWorld = wp(hips)

  const aimPairs = new Map((aim?.pairs || []).filter(([b, c]) => byName[b] && byName[c]).map((p) => [byName[p[0]], p]))
  const frames = Math.max(2, Math.round(duration * fps) + 1)
  const times = new Float32Array(frames)
  const tracks = new Map() // bone -> Float32Array of quaternions
  const hipPos = new Float32Array(frames * 3)
  const W = new Map()
  const Wbody = new Map() // the same frame with body transfer only (no aim overrides)
  const moved = new Set() // aim bones and everything below them
  const tmpQ = new THREE.Quaternion()
  const inv = new THREE.Quaternion()
  const dir = new THREE.Vector3()
  const want = new THREE.Vector3()

  for (let f = 0; f < frames; f++) {
    const t = (f / (frames - 1)) * duration
    times[f] = t
    sample(body.src, body.clip, t)
    if (aim) sample(aim.src, aim.clip, (t / duration) * aim.src.clips[aim.clip].duration)
    const keys = authored?.(t) // { dirs: { bone: [x, y, z] }, weight, palmForward? }
    W.clear()
    Wbody.clear()
    moved.clear()
    for (const b of bones) {
      const parentW = W.get(b.parent) ?? wq(b.parent)
      const parentBody = Wbody.get(b.parent) ?? parentW
      const r = rest.get(b)
      const s = body.map[b.name] && body.src.byName[body.map[b.name]]
      // body transfer: world delta from the source's T-pose, applied to our T-pose
      const wBody = s ? wq(s).multiply(inv.copy(srcRef[body.map[b.name]]).invert()).multiply(r.world) : parentBody.clone().multiply(r.local)
      Wbody.set(b, wBody)
      let w = wBody
      const pair = aimPairs.get(b)
      const authored = keys && keys.dirs[b.name]
      if (pair) {
        const w0 = parentW.clone().multiply(r.local)
        dir.copy(byName[pair[1]].position).applyQuaternion(w0).normalize()
        want.copy(wp(aim.src.byName[pair[3]])).sub(wp(aim.src.byName[pair[2]])).normalize()
        w = tmpQ.setFromUnitVectors(dir, want).clone().multiply(w0)
        moved.add(b)
      } else if (authored && keys.weight > 0) {
        // authored keyframe: point this bone (bone → first child) along a model-space direction,
        // blended over the body pose by the key's weight
        const w0 = parentW.clone().multiply(r.local)
        dir.copy(childOf.get(b).position).applyQuaternion(w0).normalize()
        want.fromArray(authored).normalize()
        w = wBody.clone().slerp(tmpQ.setFromUnitVectors(dir, want).clone().multiply(w0), keys.weight)
        moved.add(b)
      } else if (moved.has(b.parent)) {
        // below a re-aimed bone (hand, fingers): keep the body pose RELATIVE to the parent,
        // so the hand follows the raised forearm instead of keeping the idle's world angle
        const local = inv.copy(parentBody).invert().multiply(wBody)
        if (keys?.openHand && keys.weight > 0 && new RegExp(`^(Index|Middle|Ring|Pinky|Thumb)\\d${keys.openHand}$`).test(b.name)) {
          local.slerp(r.local, keys.weight) // fingers straighten (their T-pose) for an open, waving hand
        }
        w = parentW.clone().multiply(local)
        moved.add(b)
        if (keys?.palmForward === b.name && keys.weight > 0) {
          // turn the hand about the forearm so the palm faces forward (+Z), the way people wave
          const axis = dir.copy(childOf.get(b).position).applyQuaternion(w).normalize()
          const palm = want.set(0, -1, 0).applyQuaternion(inv.copy(r.world).invert()).applyQuaternion(w) // palms face down in the T-pose
          const flat = (v) => v.clone().sub(axis.clone().multiplyScalar(v.dot(axis))).normalize()
          const from = flat(palm)
          const to = flat(new THREE.Vector3(0, 0, 1))
          const angle = Math.atan2(from.clone().cross(to).dot(axis), from.dot(to))
          w = tmpQ.setFromAxisAngle(axis, angle * keys.weight).clone().multiply(w)
        }
      }
      W.set(b, w)
      if (s || pair) {
        if (!tracks.has(b)) tracks.set(b, new Float32Array(frames * 4))
        inv.copy(parentW).invert().multiply(w).normalize().toArray(tracks.get(b), f * 4)
      }
    }
    // hips: follow the source's bob, scaled to our hip height
    const d = wp(srcHips).sub(srcHipsRef)
    if (lift) d.y += lift(t)
    d.multiplyScalar(hipScale)
    hips.parent.worldToLocal(d.add(hipsRestWorld)).toArray(hipPos, f * 3)
  }

  // a sequence's steps needn't meet in the same pose (a step cut short): over JOIN seconds
  // after each join, ease from the pose just before it into the next step instead of snapping
  if (typeof body.clip !== 'string') {
    let at = 0
    for (const [, secs] of body.clip.slice(0, -1)) {
      at += secs
      const k0 = Math.floor((at / duration) * (frames - 1))
      const n = Math.round(JOIN * fps)
      for (let k = k0 + 1; k <= Math.min(k0 + n, frames - 1); k++) {
        const w = (k - k0) / (n + 1)
        const s = w * w * (3 - 2 * w)
        for (const v of tracks.values()) THREE.Quaternion.slerpFlat(v, k * 4, v, k0 * 4, v, k * 4, s)
        for (let c = 0; c < 3; c++) hipPos[k * 3 + c] += (hipPos[k0 * 3 + c] - hipPos[k * 3 + c]) * (1 - s)
      }
    }
  }

  const out = [...tracks].map(([b, v]) => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, v))
  out.push(new THREE.VectorKeyframeTrack(`${hips.name}.position`, times, hipPos))
  return new THREE.AnimationClip(name, duration, out)
}
