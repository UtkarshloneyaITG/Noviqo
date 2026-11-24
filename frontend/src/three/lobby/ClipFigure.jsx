/**
 * ClipFigure — PROTOTYPE: a character animated by real animation clips
 * (THREE.AnimationMixer) instead of the lobby's procedural bone posing, to
 * compare the two side by side. Loops "Idle"; crossfades into "Wave" when
 * clicked or whenever `waveAt` changes (your own Wave emote), then back.
 * Shown in the lobby only with ?anim=1 in the address.
 * Model: Quaternius "RobotExpressive" (CC0) — public/models/proto/.
 */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'

const MODEL = '/models/proto/RobotExpressive.glb'
const HEIGHT = 1.8 // same standing height as the lobby characters
const FADE_IN = 0.25
const FADE_BACK = 0.4

export default function ClipFigure({ waveAt = 0 }) {
  const { scene, animations } = useGLTF(MODEL)
  const { root, mixer, actions } = useMemo(() => {
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
    const actions = Object.fromEntries(animations.map((c) => [c.name, mixer.clipAction(c)]))
    actions.Wave.setLoop(THREE.LoopOnce, 1)
    actions.Wave.clampWhenFinished = true
    return { root, mixer, actions }
  }, [scene, animations])

  useEffect(() => {
    actions.Idle.play()
    const back = (e) => {
      if (e.action !== actions.Wave) return
      actions.Idle.reset().play()
      actions.Wave.crossFadeTo(actions.Idle, FADE_BACK, false)
    }
    mixer.addEventListener('finished', back)
    return () => {
      mixer.removeEventListener('finished', back)
      mixer.stopAllAction()
    }
  }, [mixer, actions])

  const wave = () => {
    actions.Wave.reset().play()
    actions.Idle.crossFadeTo(actions.Wave, FADE_IN, false)
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
