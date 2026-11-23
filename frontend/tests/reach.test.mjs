// cd frontend && node --test "tests/*.test.mjs"
import test from 'node:test'
import assert from 'node:assert/strict'
import { solveElbow } from '../src/three/world/reach.js'

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`)

test('the elbow keeps both bone lengths', () => {
  const e = solveElbow([0, 0, 0], [1, 0, 0], 0.6, 0.6, [0, -1, 0])
  near(dist([0, 0, 0], e), 0.6)
  near(dist(e, [1, 0, 0]), 0.6)
})

test('the elbow bends toward the pole', () => {
  assert.ok(solveElbow([0, 0, 0], [1, 0, 0], 0.6, 0.6, [0, -1, 0])[1] < 0)
  assert.ok(solveElbow([0, 0, 0], [1, 0, 0], 0.6, 0.6, [0, 0, 1])[2] > 0)
})

test('a target out of reach straightens the arm toward it', () => {
  const e = solveElbow([0, 0, 0], [5, 0, 0], 0.6, 0.6, [0, -1, 0])
  near(e[0], 0.6, 1e-2)
  near(e[1], 0, 5e-2) // all but straight (the clamp leaves 1 mm of bend)
})

test('reaching left, ahead or right from a seat keeps the lengths', () => {   // a figure on each side of the table
  for (const T of [[-0.8, -0.3, 0.4], [0, -0.4, 0.85], [0.8, -0.3, 0.4]]) { // all within reach (0.55 + 0.5)
    const e = solveElbow([0, 0, 0], T, 0.55, 0.5, [0.4, -1, 0])
    near(dist([0, 0, 0], e), 0.55)
    near(dist(e, T), 0.5)
  }
})
