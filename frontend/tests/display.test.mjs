// cd frontend && node --test "tests/*.test.mjs"
import test from 'node:test'
import assert from 'node:assert/strict'
import { capTick } from '../src/store/frameCap.js'

/** Frames rendered in one second when the screen ticks at `hz` and the cap is `fps`. */
function rendered(hz, fps, stallAt = -1) {
  let next = 0
  let n = 0
  for (let i = 0; i < hz; i++) {
    const t = 5000 + (i * 1000) / hz + (i > stallAt && stallAt >= 0 ? 250 : 0)
    const r = capTick(next, t, 1000 / fps)
    next = r.next
    if (r.render) n++
  }
  return n
}

test('a 30 cap on a 60 Hz screen draws every other frame', () => assert.equal(rendered(60, 30), 30))
test('a 60 cap on a 144 Hz screen stays close to 60', () => assert.ok(Math.abs(rendered(144, 60) - 60) <= 2, String(rendered(144, 60))))
test('a 60 cap on a 60 Hz screen draws every frame', () => assert.equal(rendered(60, 60), 60))
test('after a stall it resumes at the cap instead of bursting to catch up', () => {
  let next = 0
  const drawn = []
  for (let i = 0; i < 60; i++) {
    const t = 5000 + (i * 1000) / 60 + (i > 20 ? 250 : 0) // a 250 ms hitch after tick 20
    const r = capTick(next, t, 1000 / 30)
    next = r.next
    if (r.render) drawn.push(t)
  }
  const gaps = drawn.slice(1).map((t, i) => t - drawn[i])
  assert.ok(Math.min(...gaps) >= 1000 / 30 - 2, 'two frames closer than the cap: ' + Math.min(...gaps))
})
