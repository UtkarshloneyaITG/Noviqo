/**
 * Actor3D — one fighter in the ring. The server decides where everyone is and
 * what they're doing; this draws the fighter ~120 ms behind the newest
 * snapshot (blended between two: stage/info.js sampleFighters) and plays the
 * clip for its state, retargeted from the motion library (clipMotion.clipFor).
 * Punches are time-scaled so the fist reaches full stretch exactly when the
 * server checks the hit (jab 0.18 s, cross 0.38 s: backend/core/stage.py).
 * A guard raises both forearms over the stance (lobbyMotion.layerPose).
 *
 * Your own fighter (`me`) is also the first-person camera while you fight:
 * drawn ~60 ms behind, turned to where you look at once (stageAim, not the
 * server's echo), the camera at the eyes. Everything of your own body within
 * NEAR_CUT of the eyes isn't drawn (neck, collar, shoulders, hoods and hats
 * would otherwise fill the view), so you see past yourself and your fists
 * come into view as you punch. Knocked out, the view rides the fall and tips
 * up at the lights before the ring camera takes over.
 *
 * Everyone else carries a name tag with a health bar over their head.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { stageAim, stageFrames, useAppStore } from '../../store/appStore'
import { useCharacterModel } from '../world/characters'
import { clipFor, useCharacterClips } from '../world/clipMotion'
import { layerPose } from '../world/lobbyMotion'
import { clipKey, clipStart, firstPerson, FLOOR_Y, INTERP_DELAY_MS, MAT_EDGE, MY_DELAY_MS, sampleFighters } from '../../stage/info'

// clip key -> the library clips, whether it loops, and its speed
const CLIPS = {
  stance: { seq: [['Punch_Enter', 0.87]], secs: 0.87, hold: true }, // fists up: the clip's last frame
  guard: { seq: [['Punch_Enter', 0.87]], secs: 0.87, hold: true },
  walk: { seq: [['Jog_Fwd_Loop', 0.93]], secs: 0.93, loop: true },
  jab: { seq: [['Punch_Jab', 0.87]], secs: 0.87, speed: 0.2 / 0.18 }, // full stretch at 0.20 s in the clip
  cross: { seq: [['Punch_Cross', 1.0]], secs: 1.0, speed: 0.3 / 0.38 }, // full stretch at 0.30 s
  roll: { seq: [['Roll', 1.47]], secs: 1.47, speed: 1.47 / 0.6 },
  // take off, hang, land: ~half a metre of lift while the server has you in the air (0.1 to 0.6 s)
  jump: { seq: [['Jump_Start', 0.3], ['Jump_Loop', 0.25], ['Jump_Land', 0.5]], secs: 1.05,
    lift: (t) => (t > 0.1 && t < 0.62 ? (0.5 * 4 * (t - 0.1) * (0.62 - t)) / 0.52 ** 2 : 0) },
  hit: { seq: [['Hit_Head', 0.43]], secs: 0.43, speed: 0.43 / 0.35 },
  hit2: { seq: [['Hit_Chest', 0.33]], secs: 0.33, speed: 0.33 / 0.35 },
  ko: { seq: [['Death01', 2.4]], secs: 2.4 },
  win: { seq: [['Dance_Loop', 1]], secs: 1, loop: true },
  rest: { seq: [['Idle_Loop', 2.5]], secs: 2.5, loop: true },
}
const FADE = 0.12
const RINGSIDE = MAT_EDGE + 1.3 // fighters sitting a round out stand on the floor this far from the centre
const EYE = new THREE.Vector3()
const NEAR_CUT = 0.26 // metres around your eyes where your own body isn't drawn

/** Your own copies of the model's materials, cutting away whatever is within `near.value` of the camera. */
function useNearCut(model, on) {
  const near = useMemo(() => {
    if (!on) return null
    const u = { value: 0 }
    const own = (m) => {
      const c = m.clone()
      c.onBeforeCompile = (sh) => {
        sh.uniforms.uNqNear = u
        sh.fragmentShader = sh.fragmentShader.replace(
          'void main() {',
          'uniform float uNqNear;\nvoid main() {\n  if (uNqNear > 0.0 && length(vViewPosition) < uNqNear) discard;',
        )
      }
      c.customProgramCacheKey = () => 'nq-near'
      return c
    }
    model.root.traverse((o) => {
      if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material)
    })
    return u
  }, [model, on])
  useEffect(() => () => near && model.root.traverse((o) => o.isMesh && [].concat(o.material).forEach((m) => m.dispose())), [near, model])
  return near
}
const guardPose = (p) => {
  for (const s of 'lr') p.arm(s, [0.3, -0.3, 0.9], [-0.45, 0.85, 0.3]) // elbows in front, forearms up over the face
}

export default function Actor3D({ id, character, name, me = false }) {
  const model = useCharacterModel(character, 'bind')
  const clips = useCharacterClips(character)
  const camera = useThree((s) => s.camera)
  const near = useNearCut(model, me)
  const group = useRef()
  const tag = useRef()
  const hp = useRef()
  const anim = useMemo(() => {
    const mixer = new THREE.AnimationMixer(model.root)
    const actions = {}
    const out = [] // the mixer's last output per bone (see clipMotion.js: it skips unchanged values)
    model.root.traverse((o) => o.isBone && out.push([o, o.quaternion.clone()]))
    return { mixer, actions, out, key: null, current: null, ms: 0, hits: 0, guard: 0, eyes: false, y: 0 }
  }, [model])

  useFrame((_, dt) => {
    const f = sampleFighters(stageFrames, performance.now() - (me ? MY_DELAY_MS : INTERP_DELAY_MS)).get(id)
    const g = group.current
    if (!f || !g) return
    const st = useAppStore.getState().stageState
    const eyes = me && firstPerson(st?.phase, f)
    if (eyes !== anim.eyes) {
      anim.eyes = eyes
      model.bones.head?.scale.setScalar(eyes ? 0.001 : 1) // out of the way of your own eyes (hair and hat go with it)
      if (near) near.value = eyes ? NEAR_CUT : 0
    }
    if (tag.current) {
      // hidden when down, gone, or close enough to see who it is (up close it would sit over the HUD)
      const near = camera.position.distanceTo(g.position) < 3
      tag.current.style.opacity = f.in_round && !f.left && f.state !== 'ko' && !near ? 1 : 0
      hp.current.style.width = `${f.hp}%`
      hp.current.className = f.hp <= 25 ? 'low' : ''
    }
    g.visible = !f.left
    if (f.in_round) {
      // in the ring the mat is y = 0; out on the floor, a metre down (a quick drop as they roll off the apron)
      anim.y += ((f.outside ? FLOOR_Y : 0) - anim.y) * Math.min(1, dt * 9)
      g.position.set(f.x, anim.y, f.z)
      g.rotation.y = eyes && f.state !== 'ko' ? stageAim.yaw : f.yaw
    } else {
      const a = Math.atan2(f.x, f.z) // sit the round out ringside, facing in
      g.position.set(Math.sin(a) * RINGSIDE, FLOOR_Y, Math.cos(a) * RINGSIDE)
      g.rotation.y = a + Math.PI
    }

    const winner = st?.standings?.[0]?.id === id
    let key = clipKey(f.state, st?.phase, winner)
    const again = f.ms + 60 < anim.ms // the state began afresh (snapshots can miss the moment between two)
    if (key === 'hit') {
      const reacting = anim.key === 'hit' || anim.key === 'hit2'
      key = reacting && !again ? anim.key : anim.hits++ % 2 ? 'hit2' : 'hit' // each new hit: the other reaction
    }
    const restarted = key === anim.key && again
    if (key !== anim.key || restarted) {
      const def = CLIPS[key]
      const clip = clipFor(clips, `ring:${key}`, def) // its own cache name: the lobby has a Jump and a Roll too
      const a = (anim.actions[key] ??= anim.mixer.clipAction(clip))
      a.setLoop(def.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
      a.clampWhenFinished = !def.loop
      a.reset()
      a.timeScale = def.speed || 1
      const start = clipStart(def, f.ms, clip.duration) // in step with the server; held poses at their end
      if (start != null) a.time = start
      a.play()
      if (anim.current && anim.current !== a) anim.current.crossFadeTo(a, FADE, false)
      anim.current = a
      anim.key = key
    }
    anim.ms = f.ms

    for (const [b, q] of anim.out) b.quaternion.copy(q)
    anim.mixer.update(Math.min(dt, 0.1))
    for (const [b, q] of anim.out) q.copy(b.quaternion)
    anim.guard += ((f.state === 'guard' ? 1 : 0) - anim.guard) * Math.min(1, dt * 12)
    if (anim.guard > 0.01) layerPose(model, guardPose, anim.guard)

    if (eyes) {
      // the camera at your eyes, looking where you look; knocked out, it rides the fall and tips up at the lights
      const down = f.state === 'ko'
      const yaw = down ? f.yaw : stageAim.yaw
      g.updateMatrixWorld(true)
      model.bones.head.getWorldPosition(EYE)
      camera.position.set(EYE.x + Math.sin(yaw) * 0.1, EYE.y + 0.11, EYE.z + Math.cos(yaw) * 0.1) // eye level, not the skull's base
      camera.rotation.set(down ? Math.min(1, f.ms / 900) * 1.1 : stageAim.pitch, yaw + Math.PI, 0, 'YXZ')
    }
  })

  return (
    <group ref={group}>
      <primitive object={model.root} />
      {!me && (
        <Html position={[0, 2.08, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          <div className="sg-tag" ref={tag} style={{ opacity: 0 }}>
            <b>{name}</b>
            <span><i ref={hp} /></span>
          </div>
        </Html>
      )}
    </group>
  )
}
