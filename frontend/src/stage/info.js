/**
 * Ring Clash helpers with no React or three.js in them (node:test loads this
 * file directly: tests/stage.test.mjs). The server runs the fight
 * (backend/core/stage.py); these turn its snapshots into smooth motion and
 * the player's stick or keys into the input it expects.
 *
 * Ring space: metres on the mat, x to the right of the camera, z toward it;
 * yaw = atan2(dx, dz), 0 faces +z (the camera).
 */

/** Draw fighters this far behind the newest snapshot, so there's always a pair to blend between. */
export const INTERP_DELAY_MS = 120
/** …and yourself only this far behind: you're looking through your own eyes. */
export const MY_DELAY_MS = 60

/** The arena, as backend/core/stage.py has it (a test checks): metres from the ring's centre to the ropes,
 *  to the ring platform's edge, and to the barricade round the floor. The floor is FLOOR_Y below the mat. */
export const RING_HALF = 4.5
export const MAT_EDGE = RING_HALF + 0.4
export const ARENA_HALF = 10.0
export const FLOOR_Y = -1

/**
 * Whether you see the fight through your own eyes (else the overhead ring
 * camera): while you're in the round and up — riding a knockout fall down for
 * a moment — and not once the match is over or you sit a tie-break out.
 */
export function firstPerson(phase, me) {
  if (!me || me.left || !me.in_round || phase === 'over') return false
  return me.state !== 'ko' || me.ms < 1200
}

const r3 = (v) => Math.round(v * 1000) / 1000 + 0 // + 0: never -0

const SECTOR = Math.PI / 4
const STICKY = (10 * Math.PI) / 180 // a held direction keeps 10° past its sector's edge

/**
 * A stick or key vector on screen (x right, y up) as one of 8 unit
 * directions in ring space (screen up = away from the camera = -z), or null
 * inside the dead zone. `prev` (the direction already held) is kept until the
 * stick is clearly past its sector, so a thumb resting on a boundary doesn't
 * flick between two directions (and spend messages doing it).
 */
export function quantizeMove(x, y, dead = 0.25, prev = null) {
  if (Math.hypot(x, y) < dead) return null
  const raw = Math.atan2(y, x)
  if (prev) {
    const held = Math.atan2(-prev[1], prev[0])
    const off = Math.abs(((raw - held + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI)
    if (off <= SECTOR / 2 + STICKY) return prev
  }
  const a = Math.round(raw / SECTOR) * SECTOR
  return [r3(Math.cos(a)), r3(-Math.sin(a))]
}

/**
 * One budget for every message the ring sends: `ok(now)` says whether one more
 * fits in `max` per `windowMs` (and counts it). The socket allows 15 a second.
 */
export function makeBudget(max, windowMs) {
  const sent = []
  return (now) => {
    while (sent.length && now - sent[0] >= windowMs) sent.shift()
    if (sent.length >= max) return false
    sent.push(now)
    return true
  }
}

/**
 * Where a clip starts (seconds) when its state begins: a held pose (the
 * stance, the guard) at its last frame, a loop wherever it is (null), a move
 * as far in as the server says it is (`ms`), at the clip's speed.
 */
export function clipStart(def, ms, duration) {
  if (def.hold) return duration - 1e-3
  if (def.loop) return null
  return Math.min((ms / 1000) * (def.speed || 1), duration - 1e-3)
}

const shortTurn = (a, b, t) => {
  const d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
  return a + d * t
}

/**
 * Fighters as they were at time `t` (performance.now() ms), blended between
 * the two snapshots around it: frames = [{ at, fighters }] oldest first.
 * Before the first or after the last frame, that frame (with `ms` still
 * counting up). Returns Map id -> { ...fighter, x, z, yaw, ms }.
 */
export function sampleFighters(frames, t) {
  const out = new Map()
  if (!frames.length) return out
  let i = frames.findIndex((f) => f.at > t)
  if (i === -1) i = frames.length // past the newest
  const a = frames[Math.max(0, i - 1)]
  const b = frames[Math.min(i, frames.length - 1)]
  const k = b.at > a.at ? Math.min(1, Math.max(0, (t - a.at) / (b.at - a.at))) : 0
  const past = Math.max(0, t - b.at)
  for (const fb of b.fighters) {
    const fa = a.fighters.find((f) => f.id === fb.id) || fb
    const now = k < 1 ? fa : fb
    out.set(fb.id, {
      ...now,
      x: fa.x + (fb.x - fa.x) * k,
      z: fa.z + (fb.z - fa.z) * k,
      yaw: shortTurn(fa.yaw, fb.yaw, k),
      ms: k < 1 ? fa.ms + Math.max(0, t - a.at) : fb.ms + past,
    })
  }
  return out
}

const CLIP_OF_STATE = { idle: 'stance', walk: 'walk', guard: 'guard', jab: 'jab', cross: 'cross', roll: 'roll', jump: 'jump', hit: 'hit', ko: 'ko', out: 'rest' }

/** Which clip (three/stage/Actor3D.jsx) a fighter in `state` plays; the winner celebrates at the end. */
export function clipKey(state, phase, isWinner) {
  if (phase === 'over' && isWinner) return 'win'
  return CLIP_OF_STATE[state] || 'stance'
}
