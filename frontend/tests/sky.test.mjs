// cd frontend && node --test "tests/*.test.mjs"  (no deps: node's built-in runner)
import test from 'node:test'
import assert from 'node:assert/strict'
import { fitUniform } from '../src/three/world/skyShader.js'
import { paintWidth } from '../src/three/world/paint.js'

const HV = 408 / 900 // horizon height in the image, from the bottom
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≉ ${b}`)

test('16:9 screens show the whole image', () => {
  assert.deepEqual(fitUniform(1600, 900), [0, 0, 1, 1])
})

test('wider screens keep the full width and crop around the horizon', () => {
  const [ox, oy, sx, sy] = fitUniform(2400, 1080)
  near(ox, 0); near(sx, 1); near(sy, 0.8)
  near(oy + HV * sy, HV) // the horizon stays at the same height on screen
})

test('narrower screens keep the full height and crop the sides evenly', () => {
  const [ox, oy, sx, sy] = fitUniform(1024, 768)
  near(ox, 0.125); near(oy, 0); near(sx, 0.75); near(sy, 1)
})

test('paint width follows the screen, capped at 1.5x density, in 320 px steps', () => {
  assert.equal(paintWidth(1920, 1080, 1), 1920)
  assert.equal(paintWidth(2560, 1440, 2), 2560) // capped
  assert.equal(paintWidth(412, 915, 2.625), 1600) // phone, either orientation
  assert.equal(paintWidth(800, 600, 1), 1280) // floor
})

test('the moon path on the water never raises a signed distance to a power (pow(x<0) is NaN on some GPUs)', async () => {
  const { SKY_FRAG } = await import('../src/three/world/skyShader.js')
  assert.doesNotMatch(SKY_FRAG, /pow\(\s*\(p\.x - uMoonX\)/)
})
