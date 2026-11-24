/**
 * Lobby figure animation: real clips through a THREE.AnimationMixer, from the
 * Quaternius Universal Animation Library (CC0, public/models/motion/), retargeted
 * onto our rig per character and cached for the session (three/world/retarget.js).
 *
 *   idle     the library's Idle_Loop, baked when the character first appears
 *   emotes   LOBBY_EMOTES: each a sequence of library clips (Wave: the idle plus
 *            an authored arm), baked the first time that character plays it
 *
 * Entrances pose the body on top of the clip each frame (lobbyMotion.layerPose).
 * Emote ids, and the pack that unlocks each, come from the server catalog.
 */
import { useMemo } from 'react'
import { useLoader } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { characterUrl } from './characters'
import { bakeClip, buildSource, LIBRARY_MAP } from './retarget'
import { layerPose } from './lobbyMotion'

const MOTIONS = '/models/motion/motions.json'

// ── the authored wave (model space: +Y up, +Z forward; the right arm is on −X) ──
const WAVE_SECS = 2.0
const smooth = (x) => x * x * (3 - 2 * x)
const seg = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)))
function waveKeys(t) {
  const weight = Math.min(smooth(seg(t, 0, 0.3)), 1 - smooth(seg(t, 1.6, WAVE_SECS)))
  const swing = t > 0.3 ? Math.sin((t - 0.3) * Math.PI * 2 * 1.5) : 0 // ~two waves
  return {
    weight,
    palmForward: 'HandR',
    openHand: 'R',
    dirs: {
      UpperArmR: [-0.6, 0.65, 0.3], // out to the side and up
      LowerArmR: [-0.12 - 0.38 * swing, 0.92, 0.18], // upright, swinging at the elbow
    },
  }
}

// The library jumps in place: lift the hips ~30 cm between take-off (0.1 s) and touch-down.
const jumpArc = (t) => (t > 0.1 && t < 0.56 ? (0.3 * 4 * (t - 0.1) * (0.56 - t)) / 0.46 ** 2 : 0)

/**
 * Lobby emotes. seq = [[library clip, seconds], …] (a "_Loop" clip repeats for
 * its seconds; any other plays once, or its first seconds, then holds);
 * fade = seconds to blend in from / back out to the idle.
 */
export const LOBBY_EMOTES = {
  wave: { name: 'Wave', icon: '👋', secs: WAVE_SECS, authored: waveKeys },
  chat: { name: 'Chat', icon: '💬', seq: [['Idle_Talking_Loop', 2.93]] },
  jump: { name: 'Jump', icon: '🦘', seq: [['Jump_Start', 0.5], ['Jump_Land', 1.27]], lift: jumpArc, fade: [0.12, 0.3] },
  box: { name: 'Box', icon: '🥊', seq: [['Punch_Enter', 0.87], ['Punch_Jab', 0.87], ['Punch_Cross', 1]] },
  magic: { name: 'Magic', icon: '✨', seq: [['Spell_Simple_Enter', 0.53], ['Spell_Simple_Shoot', 0.5], ['Spell_Simple_Exit', 0.43]] },
  push: { name: 'Push', icon: '🧱', seq: [['Push_Loop', 2.67]] },
  sprint: { name: 'Sprint', icon: '🏃', seq: [['Sprint_Loop', 2]] },
  dance: { name: 'Dance', icon: '🕺', seq: [['Dance_Loop', 3]] },
  slash: { name: 'Slash', icon: '⚔️', seq: [['Sword_Attack', 1.53]] },
  roll: { name: 'Roll', icon: '🤸', seq: [['Roll', 1.47]], fade: [0.15, 0.3] },
  faint: { name: 'Faint', icon: '😵', seq: [['Death01', 3.4]], fade: [0.3, 0.7] }, // lies there a moment, then gets up
}
for (const e of Object.values(LOBBY_EMOTES)) {
  e.secs ??= e.seq.reduce((s, [, x]) => s + x, 0)
  e.fade ??= [0.3, 0.3]
}

// ── baking, per character per session ───────────────────────────────────
let library = null // the parsed motion source, shared
const baked = new Map() // character item id -> { bind, idle, [emote id]: clip }

/** This character's clips (suspends while files load): `idle` now, emotes on first use. */
export function useCharacterClips(character) {
  const { scene } = useGLTF(characterUrl(character))
  const text = useLoader(THREE.FileLoader, MOTIONS)
  library ??= buildSource(JSON.parse(text).sources.library)
  if (!baked.has(character)) {
    const bind = clone(scene) // T-pose, used only for baking
    const body = { src: library, clip: 'Idle_Loop', ref: 'A_TPose', map: LIBRARY_MAP }
    baked.set(character, { bind, idle: bakeClip(bind, { name: 'idle', duration: library.clips.Idle_Loop.duration, body }) })
  }
  return baked.get(character)
}

/**
 * The clip `key` for this character, baked on first use from `def`
 * ({ seq, secs, lift?, authored? }, as in LOBBY_EMOTES) and cached in `clips`.
 */
export function clipFor(clips, key, def) {
  clips[key] ??= bakeClip(clips.bind, {
    name: key,
    duration: def.secs,
    body: { src: library, clip: def.seq ?? 'Idle_Loop', ref: 'A_TPose', map: LIBRARY_MAP },
    authored: def.authored,
    lift: def.lift,
  })
  return clips[key]
}

const emoteClip = (clips, id) => clipFor(clips, id, LOBBY_EMOTES[id])

/**
 * The per-figure animator. `update(dt, emote, now, entrancePose)` each frame:
 * starts / crossfades clips, runs the mixer, then layers the entrance's pose
 * on top. Returns how far to lift the figure.
 */
export function useClipAnimator(model, clips, phase = 0) {
  return useMemo(() => {
    const mixer = new THREE.AnimationMixer(model.root)
    const act = { idle: mixer.clipAction(clips.idle) }
    act.idle.play()
    act.idle.time = (phase * 0.37) % clips.idle.duration // party members don't breathe in step
    const out = [] // [bone, the mixer's output for it last frame]
    model.root.traverse((o) => o.isBone && out.push([o, o.quaternion.clone()]))
    let playing = 'idle'
    let startedAt = 0
    let seen = 0 // the last emote message looked at

    const switchTo = (name, fade) => {
      const to = act[name].reset().play()
      act[playing].crossFadeTo(to, fade, false)
      playing = name
    }

    return {
      update(dt, emote, now, entrancePose) {
        const def = emote && LOBBY_EMOTES[emote.id]
        if (def && emote.at !== seen) {
          seen = emote.at
          // a new emote takes over; the same one again just carries on
          if (emote.id !== playing && now - emote.at < def.secs * 1000) {
            if (!act[emote.id]) {
              act[emote.id] = mixer.clipAction(emoteClip(clips, emote.id))
              act[emote.id].setLoop(THREE.LoopOnce, 1)
              act[emote.id].clampWhenFinished = true
            }
            switchTo(emote.id, def.fade[0])
            startedAt = now
          }
        }
        if (playing !== 'idle') {
          const cur = LOBBY_EMOTES[playing]
          if (now - startedAt >= (cur.secs - cur.fade[1]) * 1000) switchTo('idle', cur.fade[1])
        }

        // undo last frame's layered pose by restoring the mixer's own output. Not the bind
        // pose: the mixer skips writing a value that hasn't changed since last frame, so a
        // bone holding still would show the T-pose for that frame (the hips twitched 14°).
        for (const [b, q] of out) b.quaternion.copy(q)
        mixer.update(Math.min(dt, 0.1))
        for (const [b, q] of out) q.copy(b.quaternion)

        return entrancePose ? layerPose(model, entrancePose, 1) : 0
      },
    }
  }, [model, clips]) // eslint-disable-line react-hooks/exhaustive-deps
}
