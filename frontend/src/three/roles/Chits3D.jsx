/**
 * Chits3D — the four rolled paper chits, with real (if small) physics.
 *
 * Each round they're tossed onto the table from above the middle: they fall
 * under gravity, bounce on the felt, roll freely across their length (and
 * hardly slide along it), knock into each other, bounce off the rim and settle
 * wherever they come to rest. Click one to take it: it's tossed in an arc to
 * you, lands, rolls a little and opens to show your role. Other players' chits
 * are tossed to their seats and open when that role is revealed (the Raja's at
 * once, the Mantri's next, the rest at the round's result).
 *
 * ponytail: a hand-rolled integrator (gravity, bounce, rolling/sliding drag,
 * circle collisions, rim) — four bodies don't need a physics engine.
 */
import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { chitFace } from '../../roles/info'
import { FIGURE_SCALE, TABLE_RADIUS, TABLE_TOP_Y } from '../layout'

const TOP = TABLE_TOP_Y + 0.21 // the felt
const R = 0.2 // chit radius
const LEN = 1.25
const FLOOR = TOP + R // a chit's centre when it lies on the felt
const G = 9.8 * FIGURE_SCALE // gravity at the table's scale (world units / s²)
const BOUNCE = 0.35 // share of falling speed kept on a bounce
const SETTLE = 1.5 // below this falling speed a landing just stops
const ROLL_DRAG = 1.4 // rolling across its length: little resistance…
const SLIDE_DRAG = 9 // …sliding along it: a lot
const SPIN_DRAG = 3
const HIT_R = 0.55 // chits collide as circles of this radius on the felt
const RIM = TABLE_RADIUS - 1.4 // stay well on the felt, within easy reach
const TOSS_T = 0.6 // seconds a picked chit spends in the air
const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const CYL = new THREE.CylinderGeometry(R, R, LEN, 20)
const BAND = new THREE.TorusGeometry(R + 0.006, 0.035, 8, 24)
const PAPER_GEO = new THREE.PlaneGeometry(2.1, 1.31)
const THREAD = new THREE.MeshStandardMaterial({ color: '#c0262d', roughness: 0.6 })
const faceMats = {}
function faceMaterial(role) {
  if (!faceMats[role]) {
    const tex = new THREE.CanvasTexture(chitFace(role))
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    faceMats[role] = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, side: THREE.DoubleSide })
  }
  return faceMats[role]
}

const rand = (a, b) => a + Math.random() * (b - a)

/** A chit thrown from above the middle of the table (or laid at rest, with reduced motion). */
function tossIn(i) {
  if (REDUCED) {
    return { pos: new THREE.Vector3((i - 1.5) * 1.5, FLOOR, 0.4), vel: new THREE.Vector3(), yaw: 0, spin: 0, roll: 0, air: 0 }
  }
  const a = rand(0, Math.PI * 2)
  const speed = rand(1.8, 3.4)
  return {
    pos: new THREE.Vector3(rand(-0.4, 0.4), TOP + 3 + i * 0.35, rand(0.1, 0.7)),
    vel: new THREE.Vector3(Math.cos(a) * speed, rand(0, 1.5), Math.sin(a) * speed * 0.7),
    yaw: rand(0, Math.PI * 2),
    spin: rand(-5, 5), // around the vertical while it flies and slides
    roll: 0, // around its own length
    air: rand(-14, 14), // tumbling while airborne
  }
}

const tmp = new THREE.Vector3()
const axis = new THREE.Vector3()

function step(b, dt) {
  b.vel.y -= G * dt
  b.pos.addScaledVector(b.vel, dt)
  const grounded = b.pos.y <= FLOOR
  if (grounded) {
    b.pos.y = FLOOR
    if (b.vel.y < -SETTLE) {
      b.vel.y = -b.vel.y * BOUNCE
      b.spin += rand(-2, 2)
    } else b.vel.y = 0
    if (b.landing) {
      // a tossed chit lands near its spot and soaks up most of its speed
      b.vel.x *= 0.2
      b.vel.z *= 0.2
      b.landing = false
    }
    axis.set(Math.cos(b.yaw), 0, -Math.sin(b.yaw)) // the chit's length on the felt
    const along = b.vel.x * axis.x + b.vel.z * axis.z
    const px = b.vel.x - axis.x * along
    const pz = b.vel.z - axis.z * along
    const keepAlong = Math.exp(-SLIDE_DRAG * dt)
    const keepRoll = Math.exp(-ROLL_DRAG * dt)
    b.vel.x = axis.x * along * keepAlong + px * keepRoll
    b.vel.z = axis.z * along * keepAlong + pz * keepRoll
    b.roll += ((b.vel.z * axis.x - b.vel.x * axis.z) / R) * dt // rolls exactly as far as it travels
    b.spin *= Math.exp(-SPIN_DRAG * dt)
  } else {
    b.roll += b.air * dt
  }
  b.yaw += b.spin * dt
  // the rim: bounce back onto the felt
  const r = Math.hypot(b.pos.x, b.pos.z)
  if (r > RIM) {
    const nx = b.pos.x / r
    const nz = b.pos.z / r
    b.pos.x = nx * RIM
    b.pos.z = nz * RIM
    const vn = b.vel.x * nx + b.vel.z * nz
    if (vn > 0) {
      b.vel.x -= 1.5 * vn * nx
      b.vel.z -= 1.5 * vn * nz
    }
  }
}

/** Two chits on the felt that overlap are pushed apart and trade some momentum. */
function collide(a, b) {
  if (a.pos.y > FLOOR + 0.05 || b.pos.y > FLOOR + 0.05) return
  const dx = b.pos.x - a.pos.x
  const dz = b.pos.z - a.pos.z
  const d = Math.hypot(dx, dz)
  if (d >= HIT_R * 2 || d < 1e-6) return
  const nx = dx / d
  const nz = dz / d
  const push = (HIT_R * 2 - d) / 2
  a.pos.x -= nx * push
  a.pos.z -= nz * push
  b.pos.x += nx * push
  b.pos.z += nz * push
  const closing = (a.vel.x - b.vel.x) * nx + (a.vel.z - b.vel.z) * nz
  if (closing > 0) {
    const j = closing * 0.7 // restitution ≈ 0.4, equal masses
    a.vel.x -= j * nx
    a.vel.z -= j * nz
    b.vel.x += j * nx
    b.vel.z += j * nz
  }
}

/** Throw a chit to (x, z): the ballistic velocity that lands it there after TOSS_T. */
function tossTo(b, x, z) {
  if (REDUCED) {
    b.pos.set(x, FLOOR, z)
    b.vel.set(0, 0, 0)
    return
  }
  b.vel.set((x - b.pos.x) / TOSS_T, (G * TOSS_T) / 2 + (FLOOR - b.pos.y) / TOSS_T, (z - b.pos.z) / TOSS_T)
  b.air = rand(-10, 10)
  b.spin = rand(-3, 3)
  b.landing = true
}

/**
 * st: your rolesState; seatSpot(id) → {x, z} of that seat; onPick(slot).
 * Bodies are per round, so each round's chits are thrown in fresh.
 */
export default function Chits3D({ st, seatSpot, onPick }) {
  const groups = useRef([])
  const rolls = useRef([])
  const papers = useRef([])
  const opened = useRef([0, 0, 0, 0])
  const [hover, setHover] = useState(-1)
  const sim = useRef(null)
  if (sim.current?.round !== st.round) {
    sim.current = { round: st.round, bodies: [0, 1, 2, 3].map(tossIn), takers: [null, null, null, null] }
    opened.current = [0, 0, 0, 0]
  }
  const mats = useMemo(() => [0, 1, 2, 3].map(() => new THREE.MeshStandardMaterial({ color: '#efe3c4', roughness: 0.9 })), [])

  const me = st.seats.find((s) => s.id === st.me)
  const canPick = st.phase === 'pick' && !me?.picked
  const roleOf = (i) => (st.slips[i] ? st.seats.find((s) => s.id === st.slips[i])?.role : null)

  // A chit someone just took is tossed to them: in front of your seat, or toward theirs.
  st.slips.forEach((taker, i) => {
    const s = sim.current
    if (!taker || s.takers[i] === taker) return
    s.takers[i] = taker
    const spot = seatSpot(taker)
    if (taker === st.me) tossTo(s.bodies[i], 0, 3.2)
    else tossTo(s.bodies[i], spot.x * 0.42, spot.z * 0.42) // well in front of them, clear of their body
  })

  useFrame((_, delta) => {
    const { bodies } = sim.current
    const dt = Math.min(delta, 1 / 30) / 2
    for (let k = 0; k < 2; k++) {
      // two substeps keep bounces and collisions steady at low frame rates
      for (const b of bodies) step(b, dt)
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) collide(bodies[i], bodies[j])
    }
    bodies.forEach((b, i) => {
      const g = groups.current[i]
      if (!g) return
      const open = (opened.current[i] += ((roleOf(i) && b.pos.y <= FLOOR + 0.01 ? 1 : 0) - opened.current[i]) * Math.min(1, delta * 6))
      g.position.copy(b.pos)
      g.rotation.y = open > 0.5 ? 0 : b.yaw // an opened chit turns to face you
      g.scale.setScalar(hover === i && canPick && !st.slips[i] ? 1.12 : 1)
      rolls.current[i].rotation.x = b.roll
      rolls.current[i].visible = open < 0.5
      papers.current[i].visible = open >= 0.5
      papers.current[i].scale.x = Math.max(0.05, (open - 0.5) * 2) * (st.slips[i] === st.me ? 1 : 0.8)
      const glow = hover === i && canPick && !st.slips[i] ? 0.3 : 0
      mats[i].emissive.setRGB(glow, glow * 0.8, 0)
    })
  })

  return [0, 1, 2, 3].map((i) => {
    const role = roleOf(i)
    const mine = st.slips[i] === st.me
    return (
      <group key={`${st.round}-${i}`} ref={(el) => (groups.current[i] = el)}>
        <group ref={(el) => (rolls.current[i] = el)}>
          {/* the cylinder's axis is Y; turned on its side it lies along X and rolls about X */}
          <group rotation-z={Math.PI / 2}>
            <mesh
              geometry={CYL}
              material={mats[i]}
              onClick={(e) => {
                if (!canPick || st.slips[i]) return
                e.stopPropagation()
                onPick(i)
              }}
              onPointerOver={() => setHover(i)}
              onPointerOut={() => setHover(-1)}
            />
            <mesh geometry={BAND} material={THREAD} rotation-x={Math.PI / 2} />
          </group>
        </group>
        <mesh
          ref={(el) => (papers.current[i] = el)}
          geometry={PAPER_GEO}
          material={role ? faceMaterial(role) : mats[i]}
          visible={false}
          rotation-x={mine ? -Math.PI / 2 + 0.7 : -Math.PI / 2 + 0.15}
          position-y={mine ? 0.45 : 0.02}
          scale-y={mine ? 1 : 0.8}
        />
      </group>
    )
  })
}
