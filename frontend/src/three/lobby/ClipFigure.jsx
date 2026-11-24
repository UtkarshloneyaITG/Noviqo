/**
 * ClipFigure — PROTOTYPE: one of OUR characters driven by real animation
 * clips (THREE.AnimationMixer) instead of the lobby's procedural bone posing,
 * to compare the two side by side. Shown only with ?anim=1 in the address.
 *
 *   Idle  — Quaternius Universal Animation Library "Idle_Loop" (real human idle)
 *   Wave  — that idle for the body, plus an authored wave on the right arm:
 *           arm up, forearm vertical, palm turned forward, two swings at the
 *           elbow, back into the idle (the free library has no wave)
 *
 * Both are retargeted onto our rig once at load (three/world/retarget.js).
 * Plays Idle; crossfades into Wave when clicked or whenever `waveAt` changes
 * (your own Wave emote), then back.
 */
import { useEffect, useMemo } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { characterUrl } from '../world/characters'
import { bakeClip, buildSource, LIBRARY_MAP } from '../world/retarget'

const MOTIONS = '/models/proto/motions.json'
const HEIGHT = 1.8 // same standing height as the lobby characters
// Wave keyframes in model space (+Y up, +Z forward; the right arm is on −X).
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

export default function ClipFigure({ character, waveAt = 0 }) {
  const { scene } = useGLTF(characterUrl(character))
  const text = useLoader(THREE.FileLoader, MOTIONS)

  const { root, mixer, actions } = useMemo(() => {
    const motions = JSON.parse(text)
    const lib = buildSource(motions.sources.library)
    const idleBody = { src: lib, clip: 'Idle_Loop', ref: 'A_TPose', map: LIBRARY_MAP }
    const bind = clone(scene) // bind (T) pose, used only for baking
    const idle = bakeClip(bind, { name: 'Idle', duration: lib.clips.Idle_Loop.duration, body: idleBody })
    const wave = bakeClip(bind, { name: 'Wave', duration: WAVE_SECS, body: idleBody, authored: waveKeys })

    const root = clone(scene)
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true
        o.frustumCulled = false
      }
    })
    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(root)
    root.scale.setScalar(HEIGHT / (box.max.y - box.min.y))

    const mixer = new THREE.AnimationMixer(root)
    const actions = { Idle: mixer.clipAction(idle), Wave: mixer.clipAction(wave) }
    actions.Wave.setLoop(THREE.LoopOnce, 1)
    actions.Wave.clampWhenFinished = true
    return { root, mixer, actions }
  }, [scene, text])

  useEffect(() => {
    actions.Idle.play()
    const back = (e) => {
      if (e.action !== actions.Wave) return
      actions.Idle.reset().play()
      actions.Wave.crossFadeTo(actions.Idle, 0.4, false)
    }
    mixer.addEventListener('finished', back)
    return () => {
      mixer.removeEventListener('finished', back)
      mixer.stopAllAction()
    }
  }, [mixer, actions])

  const wave = () => {
    actions.Wave.reset().play()
    actions.Idle.crossFadeTo(actions.Wave, 0.25, false)
  }
  useEffect(() => {
    if (waveAt) wave()
  }, [waveAt]) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, dt) => mixer.update(Math.min(dt, 0.1)))

  return (
    <primitive
      object={root}
      onClick={(e) => {
        e.stopPropagation()
        wave()
      }}
    />
  )
}
