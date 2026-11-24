// cd frontend && node --test tests/*.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { clipKey, quantizeMove, sampleFighters } from '../src/stage/info.js'

test('the stick snaps to 8 directions in ring space, with a dead zone', () => {
  assert.equal(quantizeMove(0.1, 0), null)
  assert.deepEqual(quantizeMove(1, 0), [1, 0])
  assert.deepEqual(quantizeMove(0, 1), [0, -1]) // screen up = away from the camera = -z
  assert.deepEqual(quantizeMove(0.7, 0.7), [0.707, -0.707])
  assert.deepEqual(quantizeMove(-0.2, -0.9), [0, 1])
})

const frame = (at, x, yaw) => ({ at, fighters: [{ id: 'a', x, z: 0, yaw, state: 'walk', ms: 100 }] })

test('fighters are drawn between the two snapshots around the moment shown', () => {
  const frames = [frame(0, 0, 0), frame(100, 1, 0)]
  assert.equal(sampleFighters(frames, 50).get('a').x, 0.5)
  assert.equal(sampleFighters(frames, 200).get('a').x, 1)
  assert.equal(sampleFighters(frames, -50).get('a').x, 0)
  assert.equal(sampleFighters(frames, 150).get('a').ms, 150) // time past the newest snapshot keeps counting
  const turn = sampleFighters([frame(0, 0, 3.1), frame(100, 0, -3.1)], 50).get('a').yaw
  assert.ok(Math.abs(turn) > 3.0, `turned the short way through pi, got ${turn}`)
  assert.equal(sampleFighters([], 10).size, 0)
})

test('each fighter state plays its clip', () => {
  assert.equal(clipKey('idle', 'fight', false), 'stance')
  assert.equal(clipKey('walk', 'fight', false), 'walk')
  assert.equal(clipKey('ko', 'ko', false), 'ko')
  assert.equal(clipKey('out', 'fight', false), 'rest')
  assert.equal(clipKey('idle', 'over', true), 'win')
  assert.equal(clipKey('ko', 'over', false), 'ko')
})

import { clipStart, makeBudget } from '../src/stage/info.js'
import { useAppStore } from '../src/store/appStore.js'

test('a stick resting near a sector boundary does not flicker between directions', () => {
  const at = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)]
  assert.deepEqual(quantizeMove(...at(25), 0.25, [1, 0]), [1, 0]) // just past the 22.5° line: keep going right
  assert.deepEqual(quantizeMove(...at(-25), 0.25, [1, 0]), [1, 0])
  assert.deepEqual(quantizeMove(...at(36), 0.25, [1, 0]), [0.707, -0.707]) // clearly diagonal now
  assert.deepEqual(quantizeMove(...at(25)), [0.707, -0.707]) // with nothing held before, plain nearest
})

test('all ring messages share one budget, well under the socket limit', () => {
  const ok = makeBudget(12, 1000)
  const sent = Array.from({ length: 13 }, (_, i) => ok(i * 10))
  assert.equal(sent.filter(Boolean).length, 12)
  assert.equal(ok(1005), true) // the window moved on
})

test('the stance and guard hold their raised-fists pose instead of replaying the wind-up', () => {
  assert.equal(clipStart({ hold: true }, 0, 0.87), 0.87 - 0.001)
  assert.equal(clipStart({ hold: true }, 500, 0.87), 0.87 - 0.001)
  assert.equal(clipStart({ speed: 2 }, 100, 1), 0.2) // a move starts where the server is
  assert.equal(clipStart({ speed: 2 }, 900, 1), 1 - 0.001)
  assert.equal(clipStart({ loop: true }, 300, 1), null) // loops just run
})

test('a snapshot of the match you just left does not reopen the ring', () => {
  useAppStore.setState({ sendMessage: () => true, isConnected: true })
  const st = { id: 'm1', you: 0, phase: 'fight', round: 1, counted: 0, tiebreak: false, ms_left: 5000, events: [], standings: null, reward: null,
    fighters: [{ id: 'a', name: 'A', character: 'char:m-Casual', bot: false, x: 0, z: 0, yaw: 0, hp: 100, state: 'idle', ms: 0, wins: 0, auto: false, left: false, in_round: true }] }
  const { handleMessage } = useAppStore.getState()
  handleMessage({ type: 'stage_state', state: st })
  useAppStore.getState().stageLeave()
  handleMessage({ type: 'stage_state', state: st }) // already on its way when you pressed Leave
  assert.equal(useAppStore.getState().stageState, null)
  handleMessage({ type: 'stage_state', state: { ...st, id: 'm2' } }) // a new match opens as usual
  assert.equal(useAppStore.getState().stageState?.id, 'm2')
})

import { readFileSync } from 'node:fs'
import { RING_HALF } from '../src/stage/info.js'

test('the client draws the ring the server plays in', () => {
  const py = readFileSync(new URL('../../backend/core/stage.py', import.meta.url), 'utf8')
  assert.equal(RING_HALF, Number(py.match(/^RING_HALF = ([\d.]+)/m)[1]))
})

import { firstPerson } from '../src/stage/info.js'

test('you see through your own eyes while you fight, and from above while you watch', () => {
  const me = { in_round: true, left: false, state: 'idle', ms: 0 }
  assert.equal(firstPerson('fight', me), true)
  assert.equal(firstPerson('ready', me), true)
  assert.equal(firstPerson('ko', { ...me, state: 'ko', ms: 600 }), true) // ride the fall down
  assert.equal(firstPerson('ko', { ...me, state: 'ko', ms: 1500 }), false) // then watch from above
  assert.equal(firstPerson('fight', { ...me, in_round: false, state: 'out' }), false) // sitting a tie-break out
  assert.equal(firstPerson('over', me), false)
  assert.equal(firstPerson('fight', undefined), false)
})

import { ARENA_HALF, MAT_EDGE } from '../src/stage/info.js'

test('the client draws the arena the server plays in, and jumps play their clip', () => {
  const py = readFileSync(new URL('../../backend/core/stage.py', import.meta.url), 'utf8')
  assert.equal(ARENA_HALF, Number(py.match(/^ARENA_HALF = ([\d.]+)/m)[1]))
  assert.equal(MAT_EDGE, RING_HALF + Number(py.match(/^MAT_EDGE = RING_HALF \+ ([\d.]+)/m)[1]))
  assert.equal(clipKey('jump', 'fight', false), 'jump')
})
