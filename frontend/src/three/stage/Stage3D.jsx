/**
 * Stage3D — the arena for Ring Clash. All procedural: no image files, no text,
 * no logos.
 *
 *   ring       a raised mat (9 m inside the ropes, top at y = 0 so fighters
 *              in the ring stand at 0) with its own emblem, a skirt with a lit
 *              trim, steel posts, padded turnbuckles (a warm corner, a cool
 *              corner, two neutral), three ropes a side with rope ties
 *   floor      a metre below the mat: padded ringside mats, steel steps, and a
 *              barricade with a lit top edge where the arena floor ends
 *              (ARENA_HALF: the server stops fighters there too)
 *   around it  tiered stands on three sides with a seated crowd and phone
 *              lights twinkling, an announce table, the entrance stage with
 *              its ramp and an animated screen, a lighting rig over the ring
 *              throwing beams down, and the hall's walls — it ends, it isn't a void
 *
 * Geometry and materials are built once per module; the crowd is instanced.
 */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { ARENA_HALF, FLOOR_Y, MAT_EDGE, RING_HALF } from '../../stage/info'
import { beamMaterial } from '../world/sky'

export const MAT = MAT_EDGE
const POST = RING_HALF + 0.2
const ROPES = [0.45, 0.85, 1.25]
const STAND_FROM = ARENA_HALF + 1.4 // the first row of seats
const TIERS = 8
const TIER_D = 1.05
const TIER_H = 0.55

// ── textures, drawn once ──────────────────────────────────────────────────
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(repeat, repeat)
  }
  return t
}

let matTex
const matTexture = () =>
  (matTex ??= canvasTex(1024, 1024, (g, w) => {
    g.fillStyle = '#25387e'
    g.fillRect(0, 0, w, w)
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})` // canvas weave
      g.fillRect(Math.random() * w, Math.random() * w, 2, 2)
    }
    const c = w / 2
    const bandIn = w * (RING_HALF - 0.55) / (2 * MAT)
    g.strokeStyle = 'rgba(120,170,255,.28)'
    g.lineWidth = 10
    g.strokeRect(c - bandIn, c - bandIn, bandIn * 2, bandIn * 2)
    // the emblem: rings and an eight-pointed star, quiet against the canvas
    g.save()
    g.translate(c, c)
    g.strokeStyle = 'rgba(150,190,255,.22)'
    g.lineWidth = 8
    for (const r of [170, 200]) {
      g.beginPath()
      g.arc(0, 0, r, 0, Math.PI * 2)
      g.stroke()
    }
    g.fillStyle = 'rgba(150,190,255,.13)'
    g.beginPath()
    for (let k = 0; k < 16; k++) {
      const r = k % 2 ? 62 : 150
      const a = (k / 16) * Math.PI * 2
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    g.closePath()
    g.fill()
    g.restore()
    // the apron, beyond the ropes, a shade darker
    const apron = w * (0.4 / (2 * MAT))
    g.fillStyle = 'rgba(0,0,20,.35)'
    g.fillRect(0, 0, w, apron)
    g.fillRect(0, w - apron, w, apron)
    g.fillRect(0, 0, apron, w)
    g.fillRect(w - apron, 0, apron, w)
  }))

let floorTex
const floorTexture = () =>
  (floorTex ??= canvasTex(256, 256, (g, w) => {
    g.fillStyle = '#12141f'
    g.fillRect(0, 0, w, w)
    g.strokeStyle = 'rgba(255,255,255,.05)'
    g.lineWidth = 2
    g.strokeRect(1, 1, w - 2, w - 2)
  }, 2 * ARENA_HALF / 2))

let skirtTex
const skirtTexture = () =>
  (skirtTex ??= canvasTex(512, 64, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, '#111640')
    grad.addColorStop(1, '#05071a')
    g.fillStyle = grad
    g.fillRect(0, 0, w, h)
    for (let x = 0; x < w; x += 16) {
      g.fillStyle = 'rgba(255,255,255,.035)' // fabric folds
      g.fillRect(x, 0, 6, h)
    }
  }))

// ── materials and shapes ─────────────────────────────────────────────────
const M = {
  steel: new THREE.MeshStandardMaterial({ color: '#9aa3b8', metalness: 0.75, roughness: 0.3 }),
  dark: new THREE.MeshStandardMaterial({ color: '#0b0d18', roughness: 0.85 }),
  rope: new THREE.MeshStandardMaterial({ color: '#f3f3f6', roughness: 0.55, emissive: '#ffffff', emissiveIntensity: 0.06 }),
  tie: new THREE.MeshStandardMaterial({ color: '#d8dbe6', roughness: 0.7 }),
  padWarm: new THREE.MeshStandardMaterial({ color: '#d93a37', roughness: 0.55 }),
  padCool: new THREE.MeshStandardMaterial({ color: '#2c76ea', roughness: 0.55 }),
  padPlain: new THREE.MeshStandardMaterial({ color: '#e9e9ee', roughness: 0.55 }),
  led: new THREE.MeshStandardMaterial({ color: '#4fd8ff', emissive: '#4fd8ff', emissiveIntensity: 2.2, toneMapped: false }),
  ledSoft: new THREE.MeshStandardMaterial({ color: '#2a8fb0', emissive: '#4fd8ff', emissiveIntensity: 0.7 }),
  gold: new THREE.MeshStandardMaterial({ color: '#ffc53d', emissive: '#ffc53d', emissiveIntensity: 0.5, roughness: 0.45 }),
  ringsideMat: new THREE.MeshStandardMaterial({ color: '#232842', roughness: 0.9 }),
  stand: new THREE.MeshStandardMaterial({ color: '#141729', roughness: 0.95 }),
  seat: new THREE.MeshStandardMaterial({ roughness: 1 }),
  wall: new THREE.MeshStandardMaterial({ color: '#07080f', roughness: 1, side: THREE.BackSide }),
  table: new THREE.MeshStandardMaterial({ color: '#1b1f34', roughness: 0.6 }),
  monitor: new THREE.MeshStandardMaterial({ color: '#0d1020', emissive: '#3b7bff', emissiveIntensity: 0.9, toneMapped: false }),
}
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  post: new THREE.CylinderGeometry(0.075, 0.085, 1.55, 16),
  rope: new THREE.CylinderGeometry(0.03, 0.03, 1, 10),
  turn: new THREE.BoxGeometry(0.2, 0.2, 0.2),
  head: new THREE.SphereGeometry(0.15, 10, 8),
  plane: new THREE.PlaneGeometry(1, 1),
  lamp: new THREE.CylinderGeometry(0.22, 0.3, 0.45, 14),
  cone: new THREE.CylinderGeometry(1.9, 0.22, 1, 32, 1, true), // narrow end down: aimed so it sits at the lamp
}
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
const CORNER_PAD = [M.padWarm, M.padPlain, M.padCool, M.padPlain]

function Box({ m, p, s, r }) {
  return <mesh geometry={G.box} material={m} position={p} scale={s} rotation={r} />
}

// ── the ring ─────────────────────────────────────────────────────────────
function Ring() {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ map: matTexture(), roughness: 0.85 }), [])
  const skirt = useMemo(() => new THREE.MeshStandardMaterial({ map: skirtTexture(), roughness: 0.9 }), [])
  useEffect(() => () => (mat.dispose(), skirt.dispose()), [mat, skirt])
  return (
    <group>
      <mesh geometry={G.box} material={skirt} position={[0, FLOOR_Y / 2 - 0.03, 0]} scale={[MAT * 2, -FLOOR_Y - 0.06, MAT * 2]} />
      <mesh geometry={G.box} material={mat} position={[0, -0.03, 0]} scale={[MAT * 2, 0.06, MAT * 2]} receiveShadow />
      <Box m={M.gold} p={[0, -0.075, 0]} s={[MAT * 2 + 0.03, 0.03, MAT * 2 + 0.03]} />
      <Box m={M.led} p={[0, -0.32, 0]} s={[MAT * 2 + 0.02, 0.035, MAT * 2 + 0.02]} />
      {CORNERS.map(([sx, sz], i) => (
        <group key={i} position={[sx * POST, 0, sz * POST]}>
          <mesh geometry={G.post} material={M.steel} position={[0, 0.775, 0]} castShadow />
          <Box m={M.dark} p={[0, 1.57, 0]} s={[0.2, 0.06, 0.2]} />
          {ROPES.map((y) => (
            <mesh key={y} geometry={G.turn} material={CORNER_PAD[i]} position={[-sx * 0.12, y, -sz * 0.12]} rotation-y={Math.PI / 4} castShadow />
          ))}
        </group>
      ))}
      {CORNERS.map(([ax, az], i) => {
        const [bx, bz] = CORNERS[(i + 1) % 4]
        const mid = [((ax + bx) / 2) * POST, ((az + bz) / 2) * POST]
        const alongX = az === bz
        return (
          <group key={i}>
            {ROPES.map((y) => (
              <mesh key={y} geometry={G.rope} material={M.rope} position={[mid[0], y, mid[1]]}
                rotation={alongX ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0]} scale={[1, POST * 2, 1]} castShadow />
            ))}
            {/* rope ties holding the three together at each side's middle */}
            <Box m={M.tie} p={[mid[0], (ROPES[0] + ROPES[2]) / 2, mid[1]]} s={[0.05, ROPES[2] - ROPES[0], 0.05]} />
          </group>
        )
      })}
    </group>
  )
}

// ── the floor round the ring, steps, barricade ───────────────────────────
function Floor() {
  const floor = useMemo(() => new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.9 }), [])
  useEffect(() => () => floor.dispose(), [floor])
  const span = ARENA_HALF * 2 + 0.3
  return (
    <group>
      <mesh geometry={G.plane} material={floor} position={[0, FLOOR_Y, 0]} rotation-x={-Math.PI / 2} scale={[ARENA_HALF * 2, ARENA_HALF * 2, 1]} receiveShadow />
      <mesh geometry={G.plane} material={M.ringsideMat} position={[0, FLOOR_Y + 0.01, 0]} rotation-x={-Math.PI / 2}
        scale={[(MAT + 2.6) * 2, (MAT + 2.6) * 2, 1]} receiveShadow />
      {/* steel steps up to two corners */}
      {[[1, 1], [-1, -1]].map(([sx, sz]) => (
        <group key={sx} position={[sx * (MAT + 0.75), FLOOR_Y, sz * (MAT + 0.75)]} rotation-y={sx > 0 ? Math.PI / 4 : -3 * Math.PI / 4}>
          {[0, 1, 2].map((k) => (
            <Box key={k} m={M.steel} p={[0, 0.17 * (k + 1), -0.28 * k]} s={[1.0, 0.34 * (k + 1), 0.3]} />
          ))}
        </group>
      ))}
      {/* the barricade: where the arena floor ends */}
      {[[0, ARENA_HALF, span, 0.25], [0, -ARENA_HALF, span, 0.25], [ARENA_HALF, 0, 0.25, span], [-ARENA_HALF, 0, 0.25, span]].map(([x, z, sx, sz], i) => (
        <group key={i}>
          <Box m={M.dark} p={[x, FLOOR_Y + 0.55, z]} s={[sx, 1.1, sz]} />
          <Box m={M.ledSoft} p={[x, FLOOR_Y + 1.11, z]} s={[sx + 0.01, 0.03, sz + 0.01]} />
        </group>
      ))}
    </group>
  )
}

// ── the stands, the crowd, phone lights ──────────────────────────────────
const SHIRTS = ['#3a2d5c', '#5c2d3a', '#2d4a5c', '#4a4a52', '#5c4a2d', '#2d5c45', '#20243c', '#6a2f2f', '#2f3f6a']

/** Seats along one side: [centre-out direction, half-length]; returns tier boxes and seat spots. */
function sideLayout(sides) {
  const tiers = []
  const seats = []
  for (const { dir, from = STAND_FROM } of sides) {
    for (let k = 0; k < TIERS; k++) {
      const dist = from + k * TIER_D
      const half = dist + TIER_D // the stands widen as they rise, meeting at the corners
      const top = FLOOR_Y + 0.6 + k * TIER_H
      tiers.push({ dir, dist, half, top })
      for (let s = -half + 0.4; s <= half - 0.4; s += 0.62) {
        if (Math.random() < 0.08) continue // an empty seat here and there
        seats.push({ dir, dist, s, top, h: 0.5 + Math.random() * 0.2 })
      }
    }
  }
  return { tiers, seats }
}
const place = (dir, along, out) => (dir === 'x+' ? [out, along] : dir === 'x-' ? [-out, along] : dir === 'z+' ? [along, out] : [along, -out])

function Stands() {
  const { tiers, crowd, lights } = useMemo(() => {
    const { tiers, seats } = sideLayout([{ dir: 'z+' }, { dir: 'x+' }, { dir: 'x-', from: STAND_FROM + 2.2 }])
    const bodies = new THREE.InstancedMesh(G.box, M.seat, seats.length)
    const heads = new THREE.InstancedMesh(G.head, M.seat, seats.length)
    const m = new THREE.Matrix4()
    const c = new THREE.Color()
    const spots = []
    seats.forEach((p, i) => {
      const [x, z] = place(p.dir, p.s, p.dist + TIER_D * 0.45)
      m.makeScale(0.42, p.h, 0.32).setPosition(x, p.top + p.h / 2, z)
      bodies.setMatrixAt(i, m)
      bodies.setColorAt(i, c.set(SHIRTS[(i * 7) % SHIRTS.length]).multiplyScalar(0.4))
      m.makeTranslation(x, p.top + p.h + 0.13, z)
      heads.setMatrixAt(i, m)
      heads.setColorAt(i, c.set('#3a2c25').multiplyScalar(0.6))
      if (Math.random() < 0.12) spots.push(x, p.top + p.h + 0.35, z)
    })
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(spots, 3))
    geo.setAttribute('phase', new THREE.Float32BufferAttribute(spots.filter((_, k) => k % 3 === 0).map(() => Math.random() * 6.28), 1))
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'attribute float phase; uniform float uTime; varying float vA; void main(){ vA = smoothstep(0.55, 1.0, sin(uTime * 1.7 + phase * 3.0)); vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = 90.0 / -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * vA * smoothstep(0.5, 0.0, d), 1.0); }',
    })
    return { tiers, crowd: [bodies, heads], lights: new THREE.Points(geo, mat) }
  }, [])
  useEffect(() => () => {
    crowd.forEach((c) => c.dispose())
    lights.geometry.dispose()
    lights.material.dispose()
  }, [crowd, lights])
  useFrame(({ clock }) => (lights.material.uniforms.uTime.value = clock.elapsedTime))
  return (
    <group>
      {tiers.map((t, i) => {
        const [x, z] = place(t.dir, 0, t.dist + TIER_D / 2)
        const along = t.half * 2
        const h = t.top - FLOOR_Y
        const sx = t.dir[0] === 'x' ? TIER_D : along
        const sz = t.dir[0] === 'x' ? along : TIER_D
        return <Box key={i} m={M.stand} p={[x, FLOOR_Y + h / 2, z]} s={[sx, h, sz]} />
      })}
      {crowd.map((c, i) => <primitive key={i} object={c} />)}
      <primitive object={lights} />
    </group>
  )
}

// ── the entrance: a stage, a ramp to the barricade, a big moving screen ──
function Entrance() {
  const screen = useMemo(
    () =>
      new THREE.ShaderMaterial({
        toneMapped: false,
        uniforms: { uTime: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform float uTime; varying vec2 vUv;
          void main(){
            vec2 p = vUv - 0.5; p.x *= 2.4;
            float stripes = 0.5 + 0.5 * sin((vUv.x * 3.0 + vUv.y * 1.2) * 18.0 - uTime * 2.2);
            float ring = smoothstep(0.02, 0.0, abs(length(p) - 0.3 - 0.03 * sin(uTime * 2.0)));
            vec3 a = vec3(0.31, 0.85, 1.0), b = vec3(1.0, 0.77, 0.24), c = vec3(0.5, 0.2, 0.9);
            vec3 col = (mix(c * 0.3, a * 0.4, stripes) + b * ring * 1.2) * 0.7;
            col *= 0.75 + 0.25 * sin(vUv.y * 220.0);   // LED rows
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    [],
  )
  useEffect(() => () => screen.dispose(), [screen])
  useFrame(({ clock }) => (screen.uniforms.uTime.value = clock.elapsedTime))
  const back = -(ARENA_HALF + 7.5)
  const stageTop = FLOOR_Y + 1.2
  const rampLen = 6.2
  const rampDrop = stageTop - FLOOR_Y
  return (
    <group>
      <Box m={M.dark} p={[0, FLOOR_Y + 0.6, back]} s={[16, 1.2, 5]} />
      <Box m={M.led} p={[0, stageTop + 0.01, back + 2.49]} s={[16, 0.03, 0.03]} />
      {/* the ramp down to the barricade */}
      <mesh geometry={G.box} material={M.table} position={[0, FLOOR_Y + rampDrop / 2, back + 2.5 + rampLen / 2]}
        rotation-x={Math.atan2(rampDrop, rampLen)} scale={[3.2, 0.12, Math.hypot(rampLen, rampDrop)]} />
      <mesh geometry={G.plane} material={screen} position={[0, stageTop + 4.2, back - 2.3]} scale={[16, 6.4, 1]} />
      {[-9.2, 9.2].map((x) => (
        <group key={x}>
          <Box m={M.dark} p={[x, stageTop + 3.5, back - 2]} s={[1.6, 7, 1.6]} />
          <Box m={M.led} p={[x, stageTop + 3.5, back - 1.19]} s={[0.06, 6.8, 0.02]} />
        </group>
      ))}
    </group>
  )
}

/** The announce table, behind the barricade on one side. */
function Table() {
  const x = -(ARENA_HALF + 1.6)
  return (
    <group position={[x, FLOOR_Y, 0]}>
      <Box m={M.table} p={[0, 0.38, 0]} s={[0.9, 0.76, 4.4]} />
      <Box m={M.led} p={[0.46, 0.7, 0]} s={[0.02, 0.04, 4.4]} />
      {[-1.4, 0, 1.4].map((z) => (
        <group key={z}>
          <Box m={M.monitor} p={[0.05, 0.98, z]} s={[0.05, 0.3, 0.5]} r={[0, 0, -0.25]} />
          <Box m={M.dark} p={[-0.9, 0.5, z]} s={[0.5, 1.0, 0.5]} />
        </group>
      ))}
    </group>
  )
}

/** The lighting rig over the ring: a square truss, lamps, beams down onto the mat. */
function Rig() {
  const beam = useMemo(() => beamMaterial('#fff1d6'), [])
  const tint = useMemo(() => beamMaterial('#7aa8ff'), [])
  useEffect(() => () => (beam.dispose(), tint.dispose()), [beam, tint])
  const y = 7.6
  const r = RING_HALF + 1.2
  const lamps = []
  for (const [sx, sz] of CORNERS) lamps.push([sx * r, sz * r])
  for (const s of [-1, 1]) lamps.push([s * r, 0], [0, s * r])
  return (
    <group>
      {[[0, r, 2 * r + 0.3, 0.3], [0, -r, 2 * r + 0.3, 0.3], [r, 0, 0.3, 2 * r + 0.3], [-r, 0, 0.3, 2 * r + 0.3]].map(([x, z, sx, sz], i) => (
        <Box key={i} m={M.steel} p={[x, y, z]} s={[sx, 0.3, sz]} />
      ))}
      {lamps.map(([x, z], i) => {
        const aim = new THREE.Vector3(-x * 0.55, -y, -z * 0.55)
        const len = aim.length()
        const down = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), aim.clone().normalize())
        const up = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), aim.clone().normalize())
        const mid = new THREE.Vector3(x, y, z).addScaledVector(aim, 0.5)
        return (
          <group key={i}>
            <mesh geometry={G.lamp} material={M.dark} position={[x, y - 0.3, z]} quaternion={down} />
            {/* the beam: narrow and brightest at the lamp (beamMaterial fades along the cone), wide on the mat */}
            <mesh geometry={G.cone} material={i % 4 === 3 ? tint : beam} position={mid} quaternion={up} scale={[1, len, 1]} />
          </group>
        )
      })}
    </group>
  )
}

export default function Stage3D() {
  return (
    <group>
      <mesh geometry={G.box} material={M.wall} position={[0, 6, -2]} scale={[64, 22, 64]} />
      <Ring />
      <Floor />
      <Stands />
      <Entrance />
      <Table />
      <Rig />
    </group>
  )
}
