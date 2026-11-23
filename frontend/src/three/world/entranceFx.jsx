/**
 * Effects for lobby entrances (three/world/Entrance.jsx). Each effect runs
 * over its own slice [a, b] of the entrance's progress, read from `prog`
 * (a ref, updated every frame — nothing here re-renders per frame).
 * Local origin = the pedestal top; the character faces +Z.
 * Colours above 1 are HDR on purpose: the lobby's bloom makes them glow.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { glowTexture } from './sky'

export const clamp01 = (v) => Math.min(1, Math.max(0, v))
export const seg = (p, a, b) => clamp01((p - a) / (b - a))
export const easeOut = (t) => 1 - (1 - t) ** 3
export const easeIn = (t) => t * t
export const backOut = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2
export const bump = (t) => Math.sin(Math.PI * t)
/** 0 → 1 → 0 over an effect: quick in, hold, fade out. */
const envelope = (t, inn = 0.12, out = 0.3) => (t <= 0 || t >= 1 ? 0 : Math.min(1, t / inn, (1 - t) / out))
const hdr = (c, k) => new THREE.Color(c).multiplyScalar(k)
const rnd = (lo, hi) => lo + Math.random() * (hi - lo)

// ── generated textures (made once, on first use) ─────────────────────────

function canvasTexture(size, draw, h = size) {
  const c = document.createElement('canvas')
  c.width = size
  c.height = h
  draw(c.getContext('2d'), size, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
const once = (make) => {
  let t
  return () => (t ??= make())
}

/** Magic circle: rings, tick marks, a hexagram and a band of runes. */
export const runeTexture = once(() =>
  canvasTexture(512, (g, s) => {
    const c = s / 2
    g.strokeStyle = '#fff'
    g.fillStyle = '#fff'
    g.translate(c, c)
    const circle = (r, w) => {
      g.lineWidth = w
      g.beginPath()
      g.arc(0, 0, r, 0, Math.PI * 2)
      g.stroke()
    }
    circle(244, 6)
    circle(226, 2)
    circle(168, 4)
    circle(150, 2)
    circle(70, 3)
    circle(18, 3)
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2
      const long = i % 6 === 0
      g.lineWidth = long ? 3 : 1.5
      g.beginPath()
      g.moveTo(Math.cos(a) * 228, Math.sin(a) * 228)
      g.lineTo(Math.cos(a) * (long ? 210 : 218), Math.sin(a) * (long ? 210 : 218))
      g.stroke()
    }
    g.lineWidth = 3
    for (const off of [0, Math.PI]) {
      g.beginPath()
      for (let k = 0; k <= 3; k++) {
        const a = off + (k / 3) * Math.PI * 2 - Math.PI / 2
        g[k ? 'lineTo' : 'moveTo'](Math.cos(a) * 150, Math.sin(a) * 150)
      }
      g.stroke()
    }
    for (let i = 0; i < 24; i++) {
      // a little glyph between the two middle rings, turned to face the centre
      const a = (i / 24) * Math.PI * 2
      g.save()
      g.rotate(a)
      g.translate(0, -197)
      g.lineWidth = 2.5
      g.beginPath()
      const pts = [[-7, -8], [rnd(-7, 7), rnd(-8, 8)], [rnd(-7, 7), rnd(-8, 8)], [7, 8]]
      pts.forEach(([x, y], k) => g[k ? 'lineTo' : 'moveTo'](x, y))
      g.stroke()
      g.restore()
    }
  }),
)

/** Ground cracks radiating from an impact. */
export const crackTexture = once(() =>
  canvasTexture(512, (g, s) => {
    const c = s / 2
    const grad = g.createRadialGradient(c, c, 0, c, c, 70)
    grad.addColorStop(0, 'rgba(255,255,255,.9)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, s, s)
    g.strokeStyle = '#fff'
    g.lineCap = 'round'
    const crack = (x, y, a, len, w) => {
      g.lineWidth = w
      g.beginPath()
      g.moveTo(x, y)
      for (let d = 0; d < len; d += 14) {
        a += rnd(-0.35, 0.35)
        x += Math.cos(a) * 14
        y += Math.sin(a) * 14
        g.lineTo(x, y)
        if (w > 2 && Math.random() < 0.12) {
          g.stroke()
          crack(x, y, a + rnd(-0.9, 0.9), (len - d) * 0.5, w * 0.55)
          g.lineWidth = w
          g.beginPath()
          g.moveTo(x, y)
        }
        w = Math.max(1, w * 0.94)
        g.lineWidth = w
      }
      g.stroke()
    }
    for (let i = 0; i < 10; i++) crack(c, c, (i / 10) * Math.PI * 2 + rnd(-0.2, 0.2), rnd(150, 230), 7)
  }),
)

/** Soft ring for shockwaves. */
export const ringTexture = once(() =>
  canvasTexture(256, (g, s) => {
    const c = s / 2
    const grad = g.createRadialGradient(c, c, c * 0.55, c, c, c)
    grad.addColorStop(0, 'rgba(255,255,255,0)')
    grad.addColorStop(0.7, 'rgba(255,255,255,1)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, s, s)
  }),
)

/** A soft, lumpy puff for smoke and dust. */
export const smokeTexture = once(() =>
  canvasTexture(128, (g, s) => {
    for (let i = 0; i < 14; i++) {
      const x = s / 2 + rnd(-22, 22)
      const y = s / 2 + rnd(-22, 22)
      const r = rnd(18, 40)
      const grad = g.createRadialGradient(x, y, 0, x, y, r)
      grad.addColorStop(0, 'rgba(255,255,255,.35)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = grad
      g.fillRect(0, 0, s, s)
    }
  }),
)

/** Vertical streak, bright in the middle, for speed lines. */
export const streakTexture = once(() =>
  canvasTexture(16, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, 'rgba(255,255,255,0)')
    grad.addColorStop(0.5, 'rgba(255,255,255,1)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(w * 0.3, 0, w * 0.4, h)
  }, 256),
)

// ── shaders ──────────────────────────────────────────────────────────────

const VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  void main() {
    vUv = uv;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }

/** Column of light with energy bands running up it. */
function beamMaterial(color) {
  return new THREE.ShaderMaterial({
    ...additive,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: hdr(color, 2.2) } },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform float uTime, uOpacity; uniform vec3 uColor;
      varying vec2 vUv; varying vec3 vN;
      void main() {
        float bands = 0.55 + 0.45 * sin(vUv.y * 34.0 - uTime * 13.0 + sin(vUv.x * 18.85) * 2.0);
        float fade = pow(1.0 - vUv.y, 1.7) * smoothstep(0.0, 0.04, vUv.y);
        float rim = pow(1.0 - abs(vN.z), 1.4);
        float a = fade * (0.3 + 0.7 * bands) * (0.35 + 0.65 * rim) * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  })
}

/** Swirling portal disc with a bright rim. */
function vortexMaterial(inner, outer) {
  return new THREE.ShaderMaterial({
    ...additive,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uA: { value: hdr(outer, 2.4) }, uB: { value: hdr(inner, 1.4) } },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform float uTime, uOpacity; uniform vec3 uA, uB;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        if (r > 1.0) discard;
        float ang = atan(p.y, p.x);
        float sw = 0.5 + 0.5 * sin(ang * 5.0 + r * 11.0 - uTime * 6.0);
        float core = smoothstep(1.0, 0.0, r);
        float rim = smoothstep(0.78, 0.95, r) * smoothstep(1.0, 0.95, r);
        vec3 col = mix(uB, uA, r) * (0.35 + 0.9 * sw) * core + uA * rim * 1.6;
        float a = clamp(core * (0.3 + 0.6 * sw) + rim, 0.0, 1.0) * uOpacity;
        gl_FragColor = vec4(col * a, a);
      }`,
  })
}

/** Twisting funnel of wind for the tornado. */
function funnelMaterial(color) {
  return new THREE.ShaderMaterial({
    ...additive,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: hdr(color, 1.8) } },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform float uTime, uOpacity; uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float s = 0.5 + 0.5 * sin(vUv.x * 25.13 + vUv.y * 9.0 - uTime * 14.0);
        s *= 0.6 + 0.4 * sin(vUv.x * 12.57 - vUv.y * 4.0 + uTime * 5.0);
        float fade = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
        float a = s * fade * 0.55 * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  })
}

// ── building blocks ──────────────────────────────────────────────────────

/** A thing (material, geometry, object) made once per effect and freed with it. */
function useOwned(make, free = (o) => o.dispose?.()) {
  const o = useMemo(make, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => free(o), [o])
  return o
}
const PLANE = new THREE.PlaneGeometry(1, 1)
const DISC = new THREE.CircleGeometry(1, 64)
const TUBE = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true)
const CONE = new THREE.CylinderGeometry(1.15, 0.22, 2.7, 40, 1, true)
const TORUS = new THREE.TorusGeometry(1, 0.025, 8, 96)

/** Ground decal (magic circle, cracks, shockwave). */
export function Decal({ a, b, prog, tex, color, size = 2.2, spin = 0, grow = 0, glow = 2, inn = 0.12, out = 0.3, y = 0.012 }) {
  const ref = useRef()
  const mat = useOwned(() => new THREE.MeshBasicMaterial({ map: tex(), color: hdr(color, glow), ...additive, opacity: 0 }))
  useFrame((_, dt) => {
    const t = seg(prog.current, a, b)
    const m = ref.current
    m.visible = t > 0 && t < 1
    if (!m.visible) return
    const s = size * (grow ? 0.15 + 0.85 * easeOut(t) : backOut(Math.min(1, t / 0.15))) // grow: shockwave spreading out
    m.scale.set(s, s, 1)
    m.rotation.z += spin * dt
    mat.opacity = envelope(t, inn, out)
  })
  return <mesh ref={ref} geometry={PLANE} material={mat} rotation-x={-Math.PI / 2} position-y={y} visible={false} />
}

export const Runes = (p) => <Decal tex={runeTexture} spin={0.9} {...p} />
export const Cracks = (p) => <Decal tex={crackTexture} size={2.4} glow={2.6} inn={0.04} out={0.6} {...p} />
export const Shockwave = (p) => <Decal tex={ringTexture} size={3.6} grow={1} inn={0.02} out={0.85} {...p} />

export function Beam({ a, b, prog, color, h = 5, r = 0.6 }) {
  const ref = useRef()
  const mat = useOwned(() => beamMaterial(color))
  useFrame((st) => {
    const t = seg(prog.current, a, b)
    ref.current.visible = t > 0 && t < 1
    mat.uniforms.uTime.value = st.clock.elapsedTime
    mat.uniforms.uOpacity.value = envelope(t, 0.15, 0.35)
  })
  return <mesh ref={ref} geometry={TUBE} material={mat} scale={[r, h, r]} position-y={h / 2} visible={false} />
}

export function Funnel({ a, b, prog, color }) {
  const ref = useRef()
  const mat = useOwned(() => funnelMaterial(color))
  useFrame((st) => {
    const t = seg(prog.current, a, b)
    ref.current.visible = t > 0 && t < 1
    mat.uniforms.uTime.value = st.clock.elapsedTime
    mat.uniforms.uOpacity.value = envelope(t, 0.2, 0.3)
    ref.current.rotation.y -= 0.25
  })
  return <mesh ref={ref} geometry={CONE} material={mat} position-y={1.35} visible={false} />
}

export function Portal({ a, b, prog, inner, outer, z = -1.15 }) {
  const disc = useRef()
  const rim = useRef()
  const mat = useOwned(() => vortexMaterial(inner, outer))
  const rimMat = useOwned(() => new THREE.MeshBasicMaterial({ color: hdr(outer, 3), ...additive }))
  useFrame((st) => {
    const t = seg(prog.current, a, b)
    const open = t < 0.18 ? backOut(t / 0.18) : t > 0.8 ? 1 - easeIn((t - 0.8) / 0.2) : 1
    for (const r of [disc, rim]) {
      r.current.visible = t > 0 && t < 1
      r.current.scale.set(0.8 * open, 1.12 * open, 1)
    }
    mat.uniforms.uTime.value = st.clock.elapsedTime
    mat.uniforms.uOpacity.value = Math.min(1, open)
  })
  return (
    <group position={[0, 1.05, z]}>
      <mesh ref={disc} geometry={DISC} material={mat} visible={false} />
      <mesh ref={rim} geometry={TORUS} material={rimMat} visible={false} />
    </group>
  )
}

/** A big soft flash of light. */
export function Flash({ a, b, prog, color = '#eaf3ff', size = 8, y = 1.2 }) {
  const ref = useRef()
  const mat = useOwned(() => new THREE.SpriteMaterial({ map: glowTexture(), color: hdr(color, 1.3), ...additive, opacity: 0 }))
  useFrame(() => {
    const t = seg(prog.current, a, b)
    ref.current.visible = t > 0 && t < 1
    mat.opacity = 0.6 * (t < 0.15 ? t / 0.15 : (1 - t) ** 2) // a flash, not a white-out
  })
  return <sprite ref={ref} material={mat} position-y={y} scale={[size, size, 1]} visible={false} />
}

/** Glowing particles: `place(seed, t, out)` positions each one. */
function Points({ a, b, prog, n, size, color, seed, place, fade = (t) => envelope(t, 0.1, 0.4), glow = 2.2 }) {
  const pts = useOwned(
    () => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
      const p = new THREE.Points(g, new THREE.PointsMaterial({ size, map: glowTexture(), color: hdr(color, glow), ...additive }))
      p.userData.seeds = Array.from({ length: n }, (_, i) => seed(i))
      p.frustumCulled = false
      return p
    },
    (p) => (p.geometry.dispose(), p.material.dispose()),
  )
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const t = seg(prog.current, a, b)
    pts.visible = t > 0 && t < 1
    if (!pts.visible) return
    const pos = pts.geometry.attributes.position
    for (let i = 0; i < n; i++) {
      place(pts.userData.seeds[i], t, v)
      pos.setXYZ(i, v.x, v.y, v.z)
    }
    pos.needsUpdate = true
    pts.material.opacity = fade(t)
  })
  return <primitive object={pts} />
}

/** Sparks: 'rise' spiral up around the figure, 'burst' out and fall, 'orbit' a tornado. */
export function Sparks({ mode = 'rise', n = 50, size = 0.09, ...p }) {
  if (mode === 'burst') {
    return (
      <Points n={n} size={size} {...p}
        seed={() => { const a = rnd(0, 6.28); const out = rnd(1.5, 4.2); return { vx: Math.cos(a) * out, vz: Math.sin(a) * out, vy: rnd(1.5, 4.5) } }}
        place={(s, t, v) => { const T = t * 0.9; v.set(s.vx * T, Math.max(0.03, 0.2 + s.vy * T - 5 * T * T), s.vz * T) }}
        fade={(t) => (1 - t) ** 1.3} />
    )
  }
  if (mode === 'orbit') {
    return (
      <Points n={n} size={size} {...p}
        seed={(i) => ({ a: (i / n) * 6.28, h: rnd(0, 2.4), r: rnd(0.5, 1.2) })}
        place={(s, t, v) => { const r = s.r * (0.45 + 0.55 * (s.h / 2.4)); const a = s.a + t * 16 + s.h; v.set(Math.cos(a) * r, s.h, Math.sin(a) * r) }} />
    )
  }
  return (
    <Points n={n} size={size} {...p}
      seed={() => ({ a: rnd(0, 6.28), r: rnd(0.25, 0.75), y: rnd(-0.1, 0.4), v: rnd(1.5, 3) })}
      place={(s, t, v) => { const a = s.a + t * 4; v.set(Math.cos(a) * s.r, s.y + t * s.v, Math.sin(a) * s.r) }} />
  )
}

/** Puffs of smoke or dust (sprites, so each can turn). */
export function Puffs({ a, b, prog, n = 18, color = '#8e93a8', spread = 1.2, size = 1.3, ground = false, opacity = 0.8 }) {
  const group = useOwned(
    () => {
      const g = new THREE.Group()
      for (let i = 0; i < n; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTexture(), color, transparent: true, depthWrite: false, opacity: 0 }))
        const ang = (i / n) * 6.28 + rnd(-0.3, 0.3)
        s.userData = { dx: Math.cos(ang), dz: Math.sin(ang), up: ground ? rnd(0.05, 0.4) : rnd(-0.3, 1.1), sp: rnd(0.6, 1), rot: rnd(-1.5, 1.5), k: rnd(0.7, 1.2) }
        g.add(s)
      }
      return g
    },
    (g) => g.children.forEach((s) => s.material.dispose()),
  )
  useFrame(() => {
    const t = seg(prog.current, a, b)
    group.visible = t > 0 && t < 1
    if (!group.visible) return
    const e = easeOut(t)
    for (const s of group.children) {
      const u = s.userData
      const d = spread * u.sp * (0.15 + 0.85 * e)
      s.position.set(u.dx * d, (ground ? 0.15 : 0.9) + u.up * d * 0.7, u.dz * d)
      const k = size * u.k * (0.4 + 0.9 * e)
      s.scale.set(k, k, 1)
      s.material.rotation = u.rot * t * 2
      s.material.opacity = opacity * (t < 0.08 ? t / 0.08 : (1 - t) ** 1.4)
    }
  })
  return <primitive object={group} />
}

/** 3D confetti: little tumbling paper rectangles. */
export function Confetti({ a, b, prog, n = 90 }) {
  const mesh = useOwned(
    () => {
      const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.055, 0.09), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), n)
      const colors = ['#ff3f5f', '#ffc53d', '#3df2a0', '#4fd8ff', '#ff7ad9', '#ffffff', '#b28cff']
      const c = new THREE.Color()
      m.userData.seeds = Array.from({ length: n }, (_, i) => {
        m.setColorAt(i, c.set(colors[i % colors.length]))
        const ang = rnd(0, 6.28)
        const out = rnd(0.5, 2.2)
        return { vx: Math.cos(ang) * out, vz: Math.sin(ang) * out, vy: rnd(3.5, 6.5), rx: rnd(4, 12), ry: rnd(3, 9), drift: rnd(0.6, 1.4) }
      })
      m.frustumCulled = false
      return m
    },
    (m) => (m.geometry.dispose(), m.material.dispose()),
  )
  const o = useMemo(() => new THREE.Object3D(), [])
  useFrame(() => {
    const t = seg(prog.current, a, b)
    mesh.visible = t > 0 && t < 1
    if (!mesh.visible) return
    const T = t * 2.2
    mesh.userData.seeds.forEach((s, i) => {
      // shot up, then flutters down slower than it rose (air drag)
      const up = s.vy * T - 4.8 * T * T
      const y = T < s.vy / 9.6 ? up : Math.max(0.02, s.vy * s.vy / 19.2 - (T - s.vy / 9.6) * s.drift * 1.2)
      o.position.set(s.vx * T * 0.8 + Math.sin(T * 5 + i) * 0.08, 0.4 + y, s.vz * T * 0.8)
      o.rotation.set(T * s.rx, T * s.ry, 0)
      o.updateMatrix()
      mesh.setMatrixAt(i, o.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  })
  return <primitive object={mesh} />
}

/** Forked lightning: glowing ribbons from the sky to the pedestal, re-forked every few frames. */
export function Lightning({ a, b, prog, color = '#cfe6ff' }) {
  const STEPS = 14
  const bolts = useOwned(
    () => {
      const mat = new THREE.MeshBasicMaterial({ color: hdr(color, 2.6), ...additive })
      return [0.07, 0.035, 0.03].map((w) => {
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(STEPS * 2 * 3), 3))
        const idx = []
        for (let i = 0; i < STEPS - 1; i++) {
          const k = i * 2
          idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
        }
        g.setIndex(idx)
        const m = new THREE.Mesh(g, mat)
        m.userData.w = w
        m.frustumCulled = false
        return m
      })
    },
    (list) => {
      list.forEach((m) => m.geometry.dispose())
      list[0].material.dispose()
    },
  )
  const last = useRef(0)
  const fork = (m, from, to) => {
    const pos = m.geometry.attributes.position
    const w = m.userData.w
    for (let i = 0; i < STEPS; i++) {
      const k = i / (STEPS - 1)
      const j = i === 0 || i === STEPS - 1 ? 0 : 0.28 * Math.sin(k * Math.PI)
      const x = from[0] + (to[0] - from[0]) * k + rnd(-j, j)
      const y = from[1] + (to[1] - from[1]) * k
      const z = from[2] + (to[2] - from[2]) * k + rnd(-j, j) * 0.5
      const ww = w * (1 - k * 0.5)
      pos.setXYZ(i * 2, x - ww, y, z)
      pos.setXYZ(i * 2 + 1, x + ww, y, z)
    }
    pos.needsUpdate = true
    m.geometry.computeBoundingSphere()
  }
  useFrame((st) => {
    const t = seg(prog.current, a, b)
    const on = t > 0 && t < 1 && Math.random() > 0.15
    bolts.forEach((m) => (m.visible = on))
    if (!on || st.clock.elapsedTime - last.current < 0.05) return
    last.current = st.clock.elapsedTime
    fork(bolts[0], [rnd(-0.6, 0.6), 8, -0.6], [0, 0.05, 0])
    fork(bolts[1], [rnd(-2, -0.8), 7, -1], [rnd(-0.5, -0.1), 1.5, 0])
    fork(bolts[2], [rnd(0.8, 2), 7, -1], [rnd(0.1, 0.5), 2.2, 0])
  })
  return (
    <group>
      {bolts.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  )
}

/** Speed lines streaming past a falling figure. */
export function SpeedLines({ a, b, prog, color = '#ffffff', n = 12 }) {
  const group = useOwned(
    () => {
      const g = new THREE.Group()
      const mat = new THREE.MeshBasicMaterial({ map: streakTexture(), color: hdr(color, 1.4), ...additive, opacity: 0.8 })
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(PLANE, mat)
        const ang = (i / n) * 6.28
        const r = rnd(0.35, 0.8)
        m.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r)
        m.scale.set(0.05, rnd(1.2, 2.4), 1)
        m.userData = { off: rnd(0, 1), sp: rnd(2.5, 4) }
        g.add(m)
      }
      return g
    },
    (g) => g.children[0]?.material.dispose(),
  )
  useFrame((st) => {
    const t = seg(prog.current, a, b)
    group.visible = t > 0 && t < 1
    if (!group.visible) return
    // the planes face +Z, i.e. the lobby camera; they stream upward past the falling figure
    for (const m of group.children) m.position.y = ((st.clock.elapsedTime * m.userData.sp + m.userData.off) % 1) * 3.2 + 0.2
    group.children[0].material.opacity = 0.8 * envelope(t, 0.1, 0.2)
  })
  return <primitive object={group} />
}

/** A bright ring sweeping up the figure (hologram scan). */
export function ScanRing({ a, b, prog, color = '#4fd8ff', sweeps = 2 }) {
  const ref = useRef()
  const mat = useOwned(() => new THREE.MeshBasicMaterial({ color: hdr(color, 2), ...additive }))
  useFrame(() => {
    const t = seg(prog.current, a, b)
    ref.current.visible = t > 0 && t < 1
    ref.current.position.y = 1.95 * ((t * sweeps) % 1)
    mat.opacity = envelope(t, 0.05, 0.25)
  })
  return <mesh ref={ref} geometry={TORUS} material={mat} rotation-x={Math.PI / 2} scale={[0.55, 0.55, 0.6]} visible={false} />
}

/** Paint the effect textures ahead of time (lobby idle), so the first entrance doesn't hitch. */
export function prewarmEntranceTextures() {
  for (const t of [runeTexture, crackTexture, ringTexture, smokeTexture, streakTexture]) t()
}
