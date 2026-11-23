// cd frontend && node --test "tests/*.test.mjs"
import test from 'node:test'
import assert from 'node:assert/strict'
import { pathFor, rotate, viewTurns, SAFE, CENTRE } from '../src/route/info.js'

test('client path matches the server literals (backend/core/route.py)', () => {
  assert.deepEqual(pathFor(0).slice(0, 16), [[4, 2], [4, 3], [4, 4], [3, 4], [2, 4], [1, 4], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [4, 1]])
  assert.deepEqual(pathFor(0).slice(16), [[3, 1], [2, 1], [1, 1], [1, 2], [1, 3], [2, 3], [3, 3], [3, 2], [2, 2]])
  assert.deepEqual(CENTRE, [2, 2])
  assert.equal(SAFE.length, 5)
})

test('every seat path is 25 distinct adjacent cells', () => {
  for (let s = 0; s < 4; s++) {
    const p = pathFor(s)
    assert.equal(new Set(p.map(String)).size, 25)
    p.slice(1).forEach((c, i) => assert.equal(Math.abs(c[0] - p[i][0]) + Math.abs(c[1] - p[i][1]), 1))
  }
})

test('every seat sees its own home nearest', () => {
  for (let s = 0; s < 4; s++) assert.deepEqual(rotate(pathFor(s)[0], viewTurns(s)), [4, 2])
})
