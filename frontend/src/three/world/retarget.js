/**
 * Retarget animation clips from another skeleton onto our characters' rig
 * (PROTOTYPE, used by three/lobby/ClipFigure.jsx). Bakes a new clip once, at
 * load, by sampling the source frame by frame:
 *
 *   body bones  copy the source bone's world rotation *relative to its rest
 *               pose*. Works when both skeletons rest in the same pose — our
 *               rig and the Quaternius animation library are both T-pose,
 *               facing +Z.
 *   aim bones   point the bone the same way the source bone points (bone →
 *               child direction). Works across different rest poses (the
 *               robot's wave rests arms-down); loses forearm twist.
 *   hips        also follow the source's hip bob, scaled to our hip height.
 *
 * Source skeletons and clips come from public/models/proto/motions.json
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

/** Pose a source at time t of one of its clips (loops). */
function sample(src, clipName, t) {
  const clip = src.clips[clipName]
  if (src.action?.getClip() !== clip) {
    src.mixer.stopAllAction()
    src.action = src.mixer.clipAction(clip).play()
  }
  src.mixer.setTime(t % clip.duration)
  src.holder.updateMatrixWorld(true)
}

const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion())
const wp = (o) => o.getWorldPosition(new THREE.Vector3())

/**
 * Bake a clip for `target` (a fresh clone of one of our character scenes, still
 * in its bind pose, root at the origin).
 *   body: { src, clip, ref, map }          rotation transfer (ref = the source's T-pose clip)
 *   aim:  { src, clip, pairs: [[ourBone, ourChild, srcBone, srcChild]] }   optional
 */
export function bakeClip(target, { name, duration, fps = 30, body, aim }) {
  target.updateMatrixWorld(true)
  const bones = []
  target.traverse((o) => o.isBone && bones.push(o)) // parents before children
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
  const tmpQ = new THREE.Quaternion()
  const inv = new THREE.Quaternion()
  const dir = new THREE.Vector3()
  const want = new THREE.Vector3()

  for (let f = 0; f < frames; f++) {
    const t = (f / (frames - 1)) * duration
    times[f] = t
    sample(body.src, body.clip, t)
    if (aim) sample(aim.src, aim.clip, (t / duration) * aim.src.clips[aim.clip].duration)
    W.clear()
    for (const b of bones) {
      const parentW = W.get(b.parent) ?? wq(b.parent)
      const r = rest.get(b)
      const s = body.map[b.name] && body.src.byName[body.map[b.name]]
      let w
      if (s) {
        // world delta from the source's T-pose, applied to our T-pose
        w = wq(s).multiply(inv.copy(srcRef[body.map[b.name]]).invert()).multiply(r.world)
      } else {
        w = parentW.clone().multiply(r.local)
      }
      const pair = aimPairs.get(b)
      if (pair) {
        const w0 = parentW.clone().multiply(r.local)
        dir.copy(byName[pair[1]].position).applyQuaternion(w0).normalize()
        want.copy(wp(aim.src.byName[pair[3]])).sub(wp(aim.src.byName[pair[2]])).normalize()
        w = tmpQ.setFromUnitVectors(dir, want).clone().multiply(w0)
      }
      W.set(b, w)
      if (s || pair) {
        if (!tracks.has(b)) tracks.set(b, new Float32Array(frames * 4))
        inv.copy(parentW).invert().multiply(w).normalize().toArray(tracks.get(b), f * 4)
      }
    }
    // hips: follow the source's bob, scaled to our hip height
    const d = wp(srcHips).sub(srcHipsRef).multiplyScalar(hipScale)
    hips.parent.worldToLocal(d.add(hipsRestWorld)).toArray(hipPos, f * 3)
  }

  const out = [...tracks].map(([b, v]) => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, v))
  out.push(new THREE.VectorKeyframeTrack(`${hips.name}.position`, times, hipPos))
  return new THREE.AnimationClip(name, duration, out)
}
