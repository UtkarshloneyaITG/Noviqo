/**
 * Effects for the lobby emotes (clipMotion.js LOBBY_EMOTES), built from the
 * entrance kit (entranceFx.jsx). Mounted by each lobby Figure.
 *
 * `prog.current` is the seconds since the emote started, so every [a, b]
 * below is in seconds. Times were read off the library clips (bone heights
 * and hand speeds, frame by frame). <At> puts effects at a bone: following it
 * every frame, or (`drop`) left where the bone was at that moment (dust,
 * sparks flung off), on the floor under it with `ground`.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { LOBBY_EMOTES } from './clipMotion'
import { Confetti, Flash, Puffs, Shockwave, Sparks, SpeedLines, clamp01, seg } from './entranceFx'
import { QUALITY, useDisplay } from '../../store/display'

const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const hdr = (c, k) => new THREE.Color(c).multiplyScalar(k)
const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }

function useOwned(make, free) {
  const o = useMemo(make, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => free(o), [o]) // eslint-disable-line react-hooks/exhaustive-deps
  return o
}

/** Its children sit at a bone of the figure (see the header). */
function At({ model, prog, n, bone, drop, ground, children, ...rest }) { // eslint-disable-line no-unused-vars
  const ref = useRef()
  const placed = useRef(false)
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const g = ref.current
    const b = model.bones[bone]
    if (!b || (drop != null && placed.current && prog.current > drop)) return
    b.getWorldPosition(v)
    g.parent.updateWorldMatrix(true, false)
    g.parent.worldToLocal(v)
    if (ground) v.y = model.root.position.y
    g.position.copy(v)
    placed.current = true
  })
  return (
    <group ref={ref}>
      <group {...rest}>{children}</group>
    </group>
  )
}

/** A fading ribbon swept from the hand out along the forearm's line: a blade's swoosh. */
function Swoosh({ model, prog, a, b, side = 'r', color = '#9ff0ff', reach = 0.5, life = 0.15 }) {
  const N = 32 // samples kept: one per frame, enough for `life` seconds at up to ~200 fps
  const mesh = useOwned(
    () => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3)) // per sample: hand edge, tip edge
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 6), 3))
      const idx = []
      for (let k = 0; k < (N - 1) * 2; k += 2) idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
      g.setIndex(idx)
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ ...additive, vertexColors: true, color: hdr(color, 1.3), side: THREE.DoubleSide }))
      m.userData.ts = new Float64Array(N).fill(-Infinity) // when each sample was taken
      m.frustumCulled = false
      m.visible = false
      return m
    },
    (m) => (m.geometry.dispose(), m.material.dispose()),
  )
  const [hand, elbow, tip] = useMemo(() => [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], [])
  useFrame(() => {
    const T = prog.current
    const { position, color: col } = mesh.geometry.attributes
    const ts = mesh.userData.ts
    if (T >= a && T <= b && model.bones['hand' + side] && model.bones['lowerarm' + side]) {
      model.bones['hand' + side].getWorldPosition(hand)
      model.bones['lowerarm' + side].getWorldPosition(elbow)
      mesh.parent.updateWorldMatrix(true, false)
      mesh.parent.worldToLocal(hand)
      mesh.parent.worldToLocal(elbow)
      tip.copy(hand).sub(elbow).setLength(reach).add(hand)
      const p = position.array
      p.copyWithin(6, 0, (N - 1) * 6) // newest first
      ts.copyWithin(1, 0, N - 1)
      ts[0] = T
      hand.toArray(p, 0)
      tip.toArray(p, 3)
      if (ts[1] === -Infinity) for (let i = 1; i < N; i++) p.copyWithin(i * 6, 0, 6) // unused slots: no wedge to the origin
      position.needsUpdate = true
    }
    let any = false
    for (let i = 0; i < N; i++) {
      const f = clamp01(1 - (T - ts[i]) / life) ** 2
      any ||= f > 0
      col.array.fill(f * 0.3, i * 6, i * 6 + 3) // brightest at the tip
      col.array.fill(f, i * 6 + 3, i * 6 + 6)
    }
    col.needsUpdate = true
    mesh.visible = any
  })
  return <primitive object={mesh} />
}

let star
const starTexture = () =>
  (star ??= (() => {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const g = c.getContext('2d')
    g.translate(32, 32)
    g.fillStyle = '#fff'
    g.shadowColor = '#fff'
    g.shadowBlur = 8
    g.beginPath()
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 10 : 25
      const ang = (i / 10) * Math.PI * 2 - Math.PI / 2
      g.lineTo(Math.cos(ang) * r, Math.sin(ang) * r)
    }
    g.fill()
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  })())

/** Little stars circling over the head: dazed. */
function Stars({ prog, a, b, n = 5, color = '#ffd27a', r = 0.2, size = 0.15, y = 0.22 }) {
  const group = useOwned(
    () => {
      const g = new THREE.Group()
      const mat = new THREE.SpriteMaterial({ ...additive, map: starTexture(), color: hdr(color, 1.2) })
      for (let i = 0; i < n; i++) g.add(new THREE.Sprite(mat))
      g.visible = false
      return g
    },
    (g) => g.children[0]?.material.dispose(),
  )
  useFrame(() => {
    const T = prog.current
    const t = seg(T, a, b)
    group.visible = t > 0 && t < 1
    if (!group.visible) return
    group.children.forEach((s, i) => {
      const ang = T * 4 + (i / n) * Math.PI * 2
      s.position.set(Math.cos(ang) * r, y + 0.03 * Math.sin(T * 6 + i), Math.sin(ang) * r)
      const k = size * (0.8 + 0.2 * Math.sin(T * 9 + i * 2)) // twinkle
      s.scale.set(k, k, 1)
    })
    group.children[0].material.opacity = Math.min(1, t / 0.12, (1 - t) / 0.2)
  })
  return <primitive object={group} />
}

const UP = Math.PI / 2
const IMPACT = '#ffe9b0'
const DUST = { ground: true, opacity: 0.7 }

/** A punch landing: a flash and a ring facing the camera, at the fist. */
const hit = (P, hand, at) => (
  <At key={hand} {...P} bone={hand}>
    <Flash prog={P.prog} a={at} b={at + 0.18} color={IMPACT} size={0.7} y={0} />
    <group rotation-x={UP}>
      <Shockwave prog={P.prog} a={at} b={at + 0.3} color={IMPACT} size={0.55} />
    </group>
  </At>
)

// Sprint_Loop's foot strikes (it starts on the idle, so the first is skipped).
const STRIDES = [[0.4, 'footr'], [0.71, 'footl'], [1.07, 'footr'], [1.37, 'footl'], [1.73, 'footr']]

/** Per emote: (P = { model, prog, n }) => effects. Wave, chat and push have none. */
const FX = {
  jump: (P) => (
    <At {...P} bone="hips" ground drop={0.62}>
      <Puffs {...DUST} prog={P.prog} a={0.62} b={1.4} n={P.n(10)} spread={0.65} size={0.55} />
      <Shockwave prog={P.prog} a={0.62} b={1.1} color="#cfe6ff" size={1.7} glow={1.4} />
    </At>
  ),
  box: (P) => [hit(P, 'handl', 1.06), hit(P, 'handr', 2.0)],
  magic: (P) => (
    <At {...P} bone="handl" drop={0.6}>
      <Flash prog={P.prog} a={0.58} b={0.85} color="#d9c7ff" size={0.9} y={0} />
      {/* the burst's "up" turned to face the camera: a starburst off the palm */}
      <group rotation-x={UP} scale={0.2}>
        <Sparks mode="burst" prog={P.prog} a={0.6} b={1.25} n={P.n(28)} color="#b28cff" size={0.07} />
      </group>
    </At>
  ),
  sprint: (P) => [
    ...STRIDES.map(([at, foot]) => (
      <At key={at} {...P} bone={foot} ground drop={at}>
        <Puffs {...DUST} prog={P.prog} a={at} b={at + 0.6} n={P.n(5)} spread={0.35} size={0.4} opacity={0.6} />
      </At>
    )),
    // the kit's rising streaks turned sideways: wind rushing out past both sides
    <At key="lines" {...P} bone="hips" ground>
      {[-1, 1].map((s) => (
        <group key={s} position={[0.3 * s, 1, 0]} rotation-z={-UP * s} scale={[1, 0.28, 1]}>
          <SpeedLines prog={P.prog} a={0.15} b={2} n={P.n(6)} />
        </group>
      ))}
    </At>,
  ],
  dance: (P) => (
    <At {...P} bone="hips" ground scale={[0.45, 0.7, 0.45]}>
      <Confetti prog={P.prog} a={0.15} b={1.9} n={P.n(36)} />
      <Confetti prog={P.prog} a={1.3} b={3} n={P.n(36)} />
    </At>
  ),
  slash: (P) => <Swoosh {...P} a={0.3} b={0.52} />,
  roll: (P) => (
    <At {...P} bone="hips" ground drop={0.7}>
      <Puffs {...DUST} prog={P.prog} a={0.7} b={1.5} n={P.n(12)} spread={0.75} size={0.55} />
    </At>
  ),
  faint: (P) => [
    <At key="dust" {...P} bone="hips" ground drop={0.95}>
      <Puffs {...DUST} prog={P.prog} a={0.95} b={1.8} n={P.n(12)} spread={0.8} size={0.6} />
    </At>,
    <At key="stars" {...P} bone="head">
      <Stars prog={P.prog} a={1.25} b={3.1} />
    </At>,
  ],
}

/** The effects of whatever emote this figure is playing. */
export default function GestureFx({ model, emote }) {
  const [run, setRun] = useState(null)

  useEffect(() => {
    const def = emote && LOBBY_EMOTES[emote.id]
    if (reduce || !def || performance.now() - emote.at >= def.secs * 1000) return
    // same rule as the animator: the same emote again, while it plays, just carries on
    setRun((r) => {
      const cur = r && LOBBY_EMOTES[r.id]
      return r?.id === emote.id && performance.now() - r.at < (cur.secs - cur.fade[1]) * 1000 ? r : { id: emote.id, at: emote.at }
    })
  }, [emote])
  useFrame(() => run && performance.now() - run.at >= LOBBY_EMOTES[run.id].secs * 1000 && setRun(null))

  const P = useMemo(() => {
    if (!run) return null
    // counts are fixed per emote (the kit sizes its buffers once); Low graphics: half as many
    const k = QUALITY[useDisplay.getState().quality]?.particles ?? 1
    return {
      model,
      prog: { get current() { return (performance.now() - run.at) / 1000 } }, // read by the kit each frame
      n: (x) => Math.max(1, Math.round(x * k)),
    }
  }, [run, model])
  const fx = run && FX[run.id]
  return fx ? <group key={run.at}>{fx(P)}</group> : null
}
