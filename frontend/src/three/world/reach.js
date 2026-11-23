/**
 * Two-bone reach: where the elbow goes when a hand reaches for a point.
 * Plain arrays, no imports, so node's test runner loads it
 * (tests/reach.test.mjs); characters.js `reachArm` turns it into bone turns.
 */
const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]]
const add = (p, q) => [p[0] + q[0], p[1] + q[1], p[2] + q[2]]
const mul = (p, k) => [p[0] * k, p[1] * k, p[2] * k]
const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2]
const len = (p) => Math.hypot(p[0], p[1], p[2])
const unit = (p) => mul(p, 1 / (len(p) || 1))

/**
 * Elbow position for shoulder `S` reaching target `T` with upper arm `a` and
 * forearm `b`, bending toward `pole` (a direction). A target out of reach
 * straightens the arm toward it.
 */
export function solveElbow(S, T, a, b, pole) {
  const d = sub(T, S)
  const dist = len(d)
  if (dist < 1e-6) return add(S, mul(unit(pole), a))
  const dir = mul(d, 1 / dist)
  const c = Math.min(dist, a + b - 1e-3)
  const x = (a * a - b * b + c * c) / (2 * c) // along the shoulder→target line
  const h = Math.sqrt(Math.max(0, a * a - x * x)) // off it, toward the pole
  let n = sub(pole, mul(dir, dot(pole, dir)))
  if (len(n) < 1e-6) n = Math.abs(dir[1]) < 0.9 ? [0, -1, 0] : [1, 0, 0]
  return add(add(S, mul(dir, x)), mul(unit(n), h))
}
