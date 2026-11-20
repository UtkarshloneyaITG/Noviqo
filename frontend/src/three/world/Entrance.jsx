/**
 * Entrance — how a character appears on its lobby pedestal (the `entry:*`
 * shop items). Each entrance has up to six layers, all driven by one
 * progress value p = 0…1:
 *   motion  moves / spins / scales / hides the whole figure (this group)
 *   body    poses the skeleton (crouch landings, arms out, steps) — via
 *           lobbyMotion's pose context, read by the Figure (useEntranceFigure)
 *   reveal  materialises the figure: a glowing, noisy edge sweeps up it
 *   light   one shared point light flashing on the character (EntranceLight)
 *   shake   a little camera shake on impacts (your own entrance only)
 *   fx      effects around the pedestal (entranceFx.jsx)
 *
 *   <Entrance id={member.entry} preview={entryPreview} mine>
 *     <Figure … />          // Figure calls useEntranceFigure(model)
 *   </Entrance>
 *
 * Plays on mount, when the equipped entrance changes, and when a shop preview
 * asks for it. `progress` (0…1) freezes it at one moment (test page only).
 */
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  Beam, Confetti, Cracks, Flash, Funnel, Lightning, Portal, Puffs, Runes, ScanRing, Shockwave, Sparks, SpeedLines,
  backOut, bump, clamp01, easeIn, easeOut, seg,
} from './entranceFx'

const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// ── body poses (model space: +Y up, +Z forward, +X out from the posed arm) ──

const LEG = 0.82 // hip to ankle, metres: how far a knee bend lowers the figure
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k)
const ARMS = {
  rest: [[0.18, -1, 0.04], [0.12, -1, 0.25]],
  out: [[1, 0.05, 0], [1, 0.1, 0.05]],
  up: [[0.3, 1, 0.08], [0.15, 1, 0.12]],
  skydive: [[0.9, 0.55, -0.15], [0.75, 0.7, 0.05]],
  cross: [[-0.25, -0.45, 0.85], [-0.95, 0.25, 0.2]],
  open: [[0.8, 0.35, 0.25], [0.9, 0.5, 0.15]],
  palms: [[0.45, -0.55, 0.3], [0.55, -0.15, 0.8]],
  balance: [[0.35, -0.5, 0.75], [0.2, -0.35, 0.95]],
  flex: [[0.85, 0.2, 0.15], [-0.3, 1, 0.2]],
  fistDown: [[0.25, -0.8, 0.55], [0.05, -1, 0.2]],
  back: [[0.7, 0.2, -0.65], [0.8, 0.35, -0.5]],
  forward: [[0.15, -0.15, 1], [0.05, 0.05, 1]],
}
/** Both arms (or one) from pose A toward pose B by k. */
function arms(c, a, b = a, k = 1, sides = 'lr') {
  for (const s of sides) c.arm(s, mix(ARMS[a][0], ARMS[b][0], k), mix(ARMS[a][1], ARMS[b][1], k))
}
/** Knees bent by `a` radians, feet flat, torso leaning in to balance; lowers the figure to keep the feet down. */
function crouch(c, a, lean = 0.6) {
  if (a <= 0) return
  for (const s of 'lr') {
    c.bend('upperleg' + s, 'x', -a)
    c.bend('lowerleg' + s, 'x', 2 * a)
    c.bend('foot' + s, 'x', -a)
  }
  c.bend('abdomen', 'x', a * lean * 0.5)
  c.bend('chest', 'x', a * lean * 0.3)
  c.lift -= LEG * (1 - Math.cos(a))
}
/** Legs pulled up under the body (mid-air). */
function tuck(c, k) {
  for (const s of 'lr') {
    c.bend('upperleg' + s, 'x', -0.6 * k)
    c.bend('lowerleg' + s, 'x', 1.2 * k)
  }
}
/** Held for the middle of [a, b], blended at both ends. */
const hold = (p, a, b, edge = 0.25) => Math.min(easeOut(seg(p, a, a + (b - a) * edge)), 1 - easeIn(seg(p, b - (b - a) * edge, b)))

// ── the entrances ────────────────────────────────────────────────────────

const C = { cyan: '#4fd8ff', ice: '#9ff0ff', amber: '#ffc53d', gold: '#ffd27a', violet: '#b28cff', pink: '#ff7ad9', storm: '#cfe6ff' }

export const ENTRANCES = {
  'entry:classic': {
    secs: 1.5,
    motion: (p) => ({ s: 0.94 + 0.06 * easeOut(seg(p, 0, 0.6)) }),
    reveal: (p) => ({ cut: easeOut(seg(p, 0.05, 0.6)), color: C.cyan, glow: 2.5 }),
    body: (p, c) => arms(c, 'rest', 'palms', hold(p, 0.45, 1)),
    light: (p) => ({ color: C.cyan, intensity: 3 * bump(p), y: 1 }),
    fx: (P) => [
      <Runes key="runes" {...P} a={0} b={0.95} color={C.cyan} size={1.8} />,
      <Shockwave key="ring" {...P} a={0} b={0.6} color={C.cyan} />,
      <Sparks key="sparks" {...P} a={0.05} b={0.9} color={C.ice} n={30} />,
    ],
  },

  'entry:skydrop': {
    secs: 2.1,
    motion: (p) => ({ y: 7 * (1 - easeIn(seg(p, 0, 0.42))) }),
    body: (p, c) => {
      if (p < 0.42) {
        arms(c, 'skydive')
        for (const s of 'lr') (c.bend('upperleg' + s, 'x', 0.3), c.bend('lowerleg' + s, 'x', 0.6))
        c.bend('head', 'x', -0.25)
        return
      }
      const k = hold(p, 0.42, 0.92, 0.2)
      crouch(c, 1.0 * k)
      arms(c, 'rest', 'balance', k)
    },
    light: (p) => ({ color: C.gold, intensity: 9 * bump(seg(p, 0.42, 0.62)), y: 0.6 }),
    shake: (p) => 0.07 * (1 - seg(p, 0.42, 0.58)) * (p > 0.42 ? 1 : 0),
    fx: (P) => [
      <SpeedLines key="lines" {...P} a={0} b={0.42} />,
      <Shockwave key="ring" {...P} a={0.42} b={0.85} color={C.gold} />,
      <Cracks key="cracks" {...P} a={0.42} b={1} color="#ff9a3c" />,
      <Puffs key="dust" {...P} a={0.42} b={1} color="#c9b79a" spread={1.7} size={1} n={16} ground opacity={0.7} />,
      <Sparks key="sparks" {...P} mode="burst" a={0.42} b={0.8} color={C.gold} n={45} />,
      <Flash key="flash" {...P} a={0.42} b={0.55} color="#ffe7c4" size={5} y={0.3} />,
    ],
  },

  'entry:teleport': {
    secs: 2.0,
    motion: (p) => ({ y: 0.06 * bump(seg(p, 0.2, 0.8)) }),
    reveal: (p) => ({ cut: easeOut(seg(p, 0.22, 0.7)), color: C.cyan, glow: 3.2 }),
    body: (p, c) => {
      const k = hold(p, 0.2, 0.95)
      arms(c, 'rest', 'palms', k)
      c.bend('head', 'x', -0.18 * k)
    },
    light: (p) => ({ color: C.cyan, intensity: 4.5 * bump(seg(p, 0.05, 1)), y: 1.1 }),
    fx: (P) => [
      <Runes key="runes" {...P} a={0} b={0.95} color={C.cyan} size={2.2} />,
      <Beam key="beam" {...P} a={0.05} b={0.85} color={C.cyan} h={5} r={0.6} />,
      <Sparks key="sparks" {...P} a={0.15} b={0.95} color={C.ice} n={60} />,
      <Flash key="flash" {...P} a={0.2} b={0.32} color="#bff4ff" size={4} y={1} />,
      <Shockwave key="ring" {...P} a={0.2} b={0.6} color={C.cyan} />,
    ],
  },

  'entry:rise': {
    secs: 2.1,
    motion: (p) => ({ y: -2.2 * (1 - easeOut(seg(p, 0.05, 0.62))) }),
    body: (p, c) => {
      if (p < 0.62) {
        arms(c, 'cross')
        c.bend('head', 'x', 0.22)
        return
      }
      const k = hold(p, 0.62, 1, 0.12)
      arms(c, 'cross', 'open', easeOut(seg(p, 0.62, 0.7)) * k + (1 - k) * 0)
      if (k < 1 && p > 0.8) arms(c, 'rest', 'open', k)
      c.bend('head', 'x', -0.15 * k)
    },
    light: (p) => ({ color: C.amber, intensity: 4 * bump(p) + 6 * bump(seg(p, 0.62, 0.75)), y: 1 }),
    shake: (p) => (p > 0.62 && p < 0.7 ? 0.035 : 0),
    fx: (P) => [
      <Runes key="runes" {...P} a={0} b={0.95} color={C.amber} size={2.2} />,
      <Beam key="beam" {...P} a={0} b={0.8} color={C.amber} h={3} r={0.65} />,
      <Sparks key="sparks" {...P} a={0.05} b={0.9} color="#ffe2a0" n={50} />,
      <Shockwave key="ring" {...P} a={0.62} b={1} color={C.amber} />,
      <Flash key="flash" {...P} a={0.62} b={0.74} color={C.gold} size={4} y={1.1} />,
    ],
  },

  'entry:tornado': {
    secs: 2.2,
    motion: (p) => ({ ry: 10 * Math.PI * (1 - easeOut(seg(p, 0, 0.85))), s: 0.5 + 0.5 * easeOut(seg(p, 0, 0.4)), y: 0.3 * bump(seg(p, 0, 0.75)) }),
    body: (p, c) => {
      arms(c, 'out', 'rest', easeOut(seg(p, 0.72, 0.95)))
      c.bend('head', 'x', -0.2 * (1 - seg(p, 0.7, 0.9)))
    },
    light: (p) => ({ color: '#bfe9ff', intensity: 3.5 * bump(p), y: 1.2 }),
    fx: (P) => [
      <Funnel key="funnel" {...P} a={0} b={0.85} color="#bfe9ff" />,
      <Sparks key="debris" {...P} mode="orbit" a={0} b={0.85} color="#dff6ff" n={80} size={0.07} />,
      <Puffs key="dust" {...P} a={0} b={0.9} color="#9aa6c0" spread={1.4} size={1.1} n={14} ground opacity={0.5} />,
      <Shockwave key="ring" {...P} a={0.8} b={1} color="#bfe9ff" />,
    ],
  },

  'entry:smoke': {
    secs: 1.9,
    motion: (p) => ({ show: p > 0.2 }),
    reveal: (p) => ({ cut: easeOut(seg(p, 0.2, 0.42)), color: C.violet, glow: 2.2 }),
    body: (p, c) => {
      const k = hold(p, 0.2, 0.9, 0.3)
      crouch(c, 1.1 * k)
      arms(c, 'rest', 'forward', k, 'r')
      arms(c, 'rest', 'back', k, 'l')
    },
    light: (p) => ({ color: C.violet, intensity: 3 * bump(seg(p, 0.15, 0.85)), y: 0.8 }),
    fx: (P) => [
      <Puffs key="smoke" {...P} a={0} b={1} color="#7d7f99" spread={1.3} size={1.7} n={22} opacity={0.88} />,
      <Puffs key="floor" {...P} a={0} b={0.85} color="#5d5f75" spread={1.9} size={1.1} n={12} ground opacity={0.6} />,
      <Sparks key="sparks" {...P} mode="burst" a={0.2} b={0.6} color="#c9a6ff" n={30} />,
      <Shockwave key="ring" {...P} a={0} b={0.5} color="#9b8cff" />,
    ],
  },

  'entry:lightning': {
    secs: 1.9,
    motion: (p) => ({ show: p > 0.2, s: 1 + 0.06 * (1 - seg(p, 0.2, 0.4)) }),
    reveal: (p) => ({ cut: easeOut(seg(p, 0.2, 0.3)), color: C.storm, glow: 4 }),
    body: (p, c) => {
      const land = hold(p, 0.2, 0.5, 0.3)
      crouch(c, 0.8 * land)
      const flex = hold(p, 0.48, 0.95, 0.25)
      arms(c, 'balance', 'flex', flex)
      if (flex === 0) arms(c, 'rest', 'balance', land)
    },
    light: (p) => ({ color: C.storm, intensity: 16 * bump(seg(p, 0.12, 0.42)) + 2 * bump(p), y: 1.4 }),
    shake: (p) => (p > 0.2 && p < 0.38 ? 0.08 * (1 - seg(p, 0.2, 0.38)) : 0),
    fx: (P) => [
      <Flash key="flash" {...P} a={0.12} b={0.42} color="#dfeeff" size={11} y={2} />,
      <Lightning key="bolts" {...P} a={0.1} b={0.32} color={C.storm} />,
      <Cracks key="cracks" {...P} a={0.2} b={1} color="#7fb2ff" />,
      <Shockwave key="ring" {...P} a={0.2} b={0.7} color="#9fc7ff" />,
      <Sparks key="sparks" {...P} mode="burst" a={0.2} b={0.6} color={C.storm} n={55} size={0.07} />,
    ],
  },

  'entry:confetti': {
    secs: 2.0,
    motion: (p) => ({ show: p > 0.03, s: backOut(seg(p, 0.03, 0.25)) }),
    body: (p, c) => {
      const jump = bump(seg(p, 0.05, 0.42))
      c.lift += 0.45 * jump
      tuck(c, jump)
      const k = hold(p, 0.05, 0.85, 0.15)
      arms(c, 'rest', 'up', k)
      crouch(c, 0.5 * bump(seg(p, 0.42, 0.55)))
    },
    light: (p) => ({ color: '#ff9ad0', intensity: 3.5 * bump(p), y: 1.2 }),
    fx: (P) => [
      <Confetti key="confetti" {...P} a={0.03} b={1} />,
      <Shockwave key="ring" {...P} a={0.03} b={0.4} color={C.pink} />,
      <Sparks key="sparks" {...P} mode="burst" a={0.03} b={0.5} color={C.gold} n={40} />,
      <Flash key="flash" {...P} a={0.03} b={0.15} color="#ffd6ef" size={4} y={1} />,
    ],
  },

  'entry:portal': {
    secs: 2.4,
    motion: (p) => ({ show: p > 0.25, z: -1.15 * (1 - seg(p, 0.25, 0.7)) }),
    body: (p, c) => {
      const walking = hold(p, 0.25, 0.75, 0.1)
      const ph = seg(p, 0.25, 0.75) * Math.PI * 4 // two strides
      for (const [s, sign] of [['l', 1], ['r', -1]]) {
        const swing = Math.sin(ph) * sign * walking
        c.bend('upperleg' + s, 'x', -0.45 * swing)
        c.bend('lowerleg' + s, 'x', 0.5 * Math.max(0, swing) * walking + 0.15 * walking)
        c.arm(s, mix(ARMS.rest[0], [0.15, -1, 0.45 * swing], walking), ARMS.rest[1])
      }
    },
    light: (p) => ({ color: C.violet, intensity: 4.5 * bump(p), y: 1.1 }),
    fx: (P) => [
      <Portal key="portal" {...P} a={0} b={1} inner={C.cyan} outer={C.violet} />,
      <Runes key="runes" {...P} a={0} b={0.95} color={C.violet} size={1.6} />,
      <Sparks key="sparks" {...P} a={0} b={0.9} color="#c9a6ff" n={40} />,
      <Shockwave key="ring" {...P} a={0.7} b={1} color={C.violet} />,
    ],
  },

  'entry:hologram': {
    secs: 2.4,
    motion: (p) => {
      const glitch = p < 0.7 && Math.sin(p * 61) > 0.82
      return { show: p > 0.7 || Math.sin(p * 97) + Math.sin(p * 41) > 1.5 - 2.6 * p, x: glitch ? 0.07 * Math.sign(Math.sin(p * 173)) : 0 }
    },
    reveal: (p) => (p < 0.85 ? { cut: easeOut(seg(p, 0, 0.6)), color: C.cyan, glow: 2.2, holo: true } : null),
    body: (p, c) => {
      const k = hold(p, 0, 0.9, 0.15)
      arms(c, 'rest', 'palms', 0.6 * k)
      if (p < 0.7 && Math.sin(p * 61) > 0.82) c.bend('head', 'z', 0.25)
    },
    light: (p) => ({ color: C.cyan, intensity: 2.6 * (0.6 + 0.4 * Math.sin(p * 80)) * bump(p), y: 1.1 }),
    fx: (P) => [
      <Runes key="runes" {...P} a={0} b={0.95} color={C.cyan} size={2} />,
      <ScanRing key="scan" {...P} a={0} b={0.75} color={C.cyan} sweeps={3} />,
      <Sparks key="sparks" {...P} a={0.1} b={0.8} color={C.ice} n={40} />,
      <Shockwave key="ring" {...P} a={0.75} b={1} color={C.cyan} />,
    ],
  },

  'entry:hero': {
    secs: 2.4,
    motion: (p) => {
      const q = seg(p, 0, 0.38)
      return { z: -4 * (1 - q), y: 5 * (1 - easeIn(q)), ry: -0.8 * (1 - q) }
    },
    body: (p, c) => {
      if (p < 0.38) {
        arms(c, 'up', 'up', 1, 'r')
        arms(c, 'back', 'back', 1, 'l')
        tuck(c, 0.8)
        return
      }
      const k = hold(p, 0.38, 0.95, 0.2)
      crouch(c, 1.25 * k, 0.9)
      arms(c, 'rest', 'fistDown', k, 'r')
      arms(c, 'rest', 'back', k, 'l')
      c.bend('head', 'x', -0.35 * k)
    },
    light: (p) => ({ color: C.gold, intensity: 11 * bump(seg(p, 0.38, 0.6)) + 2 * bump(p), y: 0.5 }),
    shake: (p) => (p > 0.38 && p < 0.55 ? 0.09 * (1 - seg(p, 0.38, 0.55)) : 0),
    fx: (P) => [
      <SpeedLines key="lines" {...P} a={0} b={0.36} color="#ffe7b0" />,
      <Shockwave key="ring" {...P} a={0.38} b={0.9} color={C.gold} />,
      <Cracks key="cracks" {...P} a={0.38} b={1} color="#ff8a1e" />,
      <Puffs key="dust" {...P} a={0.38} b={1} color="#c9b79a" spread={1.8} size={1.1} n={16} ground opacity={0.7} />,
      <Sparks key="sparks" {...P} mode="burst" a={0.38} b={0.75} color={C.gold} n={55} />,
      <Flash key="flash" {...P} a={0.38} b={0.5} color="#fff1d0" size={6} y={0.3} />,
    ],
  },
}
const DEFAULT = 'entry:classic'
const REST = { x: 0, y: 0, z: 0, s: 1, sy: 1, ry: 0, show: true }

// ── shared light and camera shake ────────────────────────────────────────

const LIGHT = { intensity: 0, color: new THREE.Color(), pos: new THREE.Vector3() }
export const SHAKE = { amount: 0 } // LobbyWorld's camera reads and clears it each frame

/** The one point light every entrance flashes (rendered once in the lobby). */
export function EntranceLight() {
  const ref = useRef()
  useFrame(() => {
    const l = ref.current
    l.intensity = LIGHT.intensity
    l.color.copy(LIGHT.color)
    l.position.copy(LIGHT.pos)
    LIGHT.intensity = 0 // entrances write again next frame
  })
  return <pointLight ref={ref} intensity={0} distance={7} decay={1.6} />
}

// ── reveal shader on the figure's materials ──────────────────────────────

const REVEAL_VERT = 'varying vec3 vNqWorld;\n'
const REVEAL_FRAG = /* glsl */ `
  uniform float uNqOn, uNqCut, uNqMode, uNqTime; uniform vec3 uNqEdge;
  varying vec3 vNqWorld;
  float nqHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float nqNoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(nqHash(i), nqHash(i + vec3(1,0,0)), f.x), mix(nqHash(i + vec3(0,1,0)), nqHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(nqHash(i + vec3(0,0,1)), nqHash(i + vec3(1,0,1)), f.x), mix(nqHash(i + vec3(0,1,1)), nqHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
`
function withReveal(material, U) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U)
    shader.vertexShader = REVEAL_VERT + shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n  vNqWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    )
    shader.fragmentShader = REVEAL_FRAG + shader.fragmentShader
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float nqGlow = 0.0;
        if (uNqOn > 0.5) {
          float n = nqNoise(vNqWorld * 7.0) * 0.6 + nqNoise(vNqWorld * 19.0) * 0.4;
          float d = uNqCut - vNqWorld.y + (n - 0.5) * 0.22;
          if (d < 0.0) discard;
          nqGlow = 1.0 - smoothstep(0.0, 0.07, d);
          if (uNqMode > 0.5) nqGlow = max(nqGlow, 0.4 * step(0.55, fract(vNqWorld.y * 26.0 - uNqTime * 2.5)));
        }`)
      .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb += uNqEdge * nqGlow;\n#include <tonemapping_fragment>')
  }
  material.customProgramCacheKey = () => 'nq-reveal'
  return material
}

// ── wiring ───────────────────────────────────────────────────────────────

const Ctx = createContext(null)
const progressOf = (run, now) => (run.frozen != null ? run.frozen : reduce ? 1 : clamp01((now - run.t0) / 1000 / run.def.secs))

/**
 * For the Figure inside an <Entrance>: its own copies of the model's materials
 * with the reveal shader, and per frame the entrance's body pose (pass it to
 * animateFigure) — `pose(now)` is null when no entrance is playing.
 */
export function useEntranceFigure(model) {
  const ctx = useContext(Ctx)
  const U = useMemo(() => {
    if (!ctx) return null
    const u = { uNqOn: { value: 0 }, uNqCut: { value: 0 }, uNqMode: { value: 0 }, uNqTime: { value: 0 }, uNqEdge: { value: new THREE.Color() } }
    model.root.traverse((o) => {
      if (!o.isMesh) return
      const own = (m) => withReveal(m.clone(), u)
      o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material)
    })
    return u
  }, [model]) // eslint-disable-line react-hooks/exhaustive-deps
  const base = useMemo(() => new THREE.Vector3(), [])

  return {
    pose(now) {
      const run = ctx?.current
      if (!run) return null
      const p = progressOf(run, now)
      return p < 1 && run.def.body ? (c) => run.def.body(p, c) : null
    },
    reveal(now) {
      if (!U) return
      const run = ctx.current
      const p = run ? progressOf(run, now) : 1
      const r = p < 1 && run.def.reveal?.(p)
      U.uNqOn.value = r ? 1 : 0
      if (!r) return
      model.root.getWorldPosition(base)
      U.uNqCut.value = base.y - 0.15 + r.cut * 2.25
      U.uNqEdge.value.set(r.color).multiplyScalar(r.glow)
      U.uNqMode.value = r.holo ? 1 : 0
      U.uNqTime.value = now / 1000
    },
  }
}

function applyMotion(group, o) {
  group.position.set(o.x, o.y, o.z)
  group.scale.set(o.s, o.s * o.sy, o.s)
  group.rotation.y = o.ry
  group.visible = o.show
}

export default function Entrance({ id, preview, mine = false, progress, children }) {
  const born = useRef(performance.now())
  const [run, setRun] = useState(() => ({ id, t0: performance.now(), n: 0 }))
  const first = useRef(true)
  useEffect(() => {
    if (first.current) return void (first.current = false)
    setRun((r) => ({ id, t0: performance.now(), n: r.n + 1 })) // equipped a new one: show it off
  }, [id])
  useEffect(() => {
    if (preview && preview.at > born.current) setRun((r) => ({ id: preview.id, t0: performance.now(), n: r.n + 1 }))
  }, [preview?.at]) // eslint-disable-line react-hooks/exhaustive-deps

  const def = ENTRANCES[run.id] || ENTRANCES[DEFAULT]
  const live = useRef(null)
  live.current = { def, t0: run.t0, frozen: progress } // read by the Figure every frame
  const ctx = useMemo(() => live, [])
  const group = useRef()
  const prog = useRef(0)
  const [done, setDone] = useState(reduce && progress == null)
  const world = useMemo(() => new THREE.Vector3(), [])

  useLayoutEffect(() => {
    setDone(reduce && progress == null)
    if (group.current) applyMotion(group.current, { ...REST, ...(def.motion?.(progressOf(live.current, performance.now())) || {}) })
  }, [run]) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(() => {
    const g = group.current
    if (!g) return
    const p = progressOf(live.current, performance.now())
    prog.current = p
    applyMotion(g, p >= 1 ? REST : { ...REST, ...(def.motion?.(p) || {}) })
    if (p < 1) {
      const l = def.light?.(p)
      if (l && l.intensity > LIGHT.intensity) {
        g.parent.localToWorld(world.set(0, l.y, 0.7))
        Object.assign(LIGHT, { intensity: l.intensity })
        LIGHT.color.set(l.color)
        LIGHT.pos.copy(world)
      }
      if (mine && def.shake) SHAKE.amount = Math.max(SHAKE.amount, def.shake(p))
    } else if (!done && progress == null) setDone(true)
  })

  return (
    <Ctx.Provider value={ctx}>
      <group ref={group}>{children}</group>
      {!done && <group key={run.n}>{def.fx({ prog })}</group>}
    </Ctx.Provider>
  )
}
