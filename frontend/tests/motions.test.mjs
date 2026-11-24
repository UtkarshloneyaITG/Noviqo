// cd frontend && node --test tests/*.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const clips = JSON.parse(readFileSync(new URL('../public/models/motion/motions.json', import.meta.url), 'utf8')).sources.library.clips

test('the motion file has every clip the lobby and the ring use', () => {
  const need = ['A_TPose', 'Idle_Loop', 'Idle_Talking_Loop', 'Jump_Start', 'Jump_Land', 'Punch_Enter', 'Punch_Jab', 'Punch_Cross',
    'Spell_Simple_Enter', 'Spell_Simple_Shoot', 'Spell_Simple_Exit', 'Push_Loop', 'Sprint_Loop', 'Dance_Loop', 'Sword_Attack',
    'Roll', 'Death01', 'Walk_Loop', 'Jog_Fwd_Loop', 'Hit_Head', 'Hit_Chest']
  for (const name of need) {
    const c = clips.find((x) => x.name === name)
    assert.ok(c, `missing clip ${name}`)
    assert.ok(c.duration > 0 && c.tracks.length > 0, `empty clip ${name}`)
  }
})
