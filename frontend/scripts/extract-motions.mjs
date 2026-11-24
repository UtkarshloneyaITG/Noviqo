// Writes public/models/motion/motions.json from the CC0 Quaternius Universal Animation
// Library [Standard] (its .glb): the library skeleton + the clips the lobby and the ring use
// (quaternions for every bone, positions only where they move; constant-at-rest tracks dropped).
//
//   cd frontend && node scripts/extract-motions.mjs <path to the library .glb>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const src = process.argv[2]
if (!src) throw new Error('usage: node scripts/extract-motions.mjs <library .glb>')
const load = (p) => new Promise((res, rej) => { const b = readFileSync(p); new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej) })
const r3 = (a) => Array.from(a, (v) => Math.round(v * 1e3) / 1e3)

const ual = await load(src)
const root = ual.scene.getObjectByName('root')
const bones = []
root.traverse((o) => bones.push({ name: o.name, parent: o === root ? null : o.parent.name, p: r3(o.position.toArray()), q: r3(o.quaternion.toArray()), s: r3(o.scale.toArray()) }))
ual.scene.updateMatrixWorld(true)
const restOf = Object.fromEntries(bones.map((b) => [b.name, b]))
// value: keep only the first N seconds (0 = all)
const CLIPS = { A_TPose: 0, Idle_Loop: 0, Idle_Talking_Loop: 0, Jump_Start: 0, Jump_Loop: 0.6, Jump_Land: 0, Punch_Enter: 0, Punch_Jab: 0, Punch_Cross: 0,
  Spell_Simple_Enter: 0, Spell_Simple_Shoot: 0, Spell_Simple_Exit: 0, Push_Loop: 0, Sprint_Loop: 0, Dance_Loop: 0, Sword_Attack: 0, Roll: 0, Death01: 0,
  Walk_Loop: 0, Jog_Fwd_Loop: 0, Hit_Head: 0, Hit_Chest: 0 }
const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 2e-3)
const clips = Object.entries(CLIPS).map(([name, keep]) => {
  const c = ual.animations.find((a) => a.name === name)
  const dur = keep || c.duration
  const tracks = []
  for (const t of c.tracks) {
    const [node, prop] = t.name.split('.')
    if (!restOf[node] || (prop !== 'quaternion' && prop !== 'position')) continue
    const n = t.times.filter((x) => x <= dur + 1e-4).length
    const st = prop === 'quaternion' ? 4 : 3
    const values = r3(t.values.slice(0, n * st))
    const rest = prop === 'quaternion' ? restOf[node].q : restOf[node].p
    let flat = true
    for (let i = 0; i < n && flat; i++) flat = same(values.slice(i * st, i * st + st), rest)
    if (flat && name !== 'A_TPose') continue // never leaves its rest value: the skeleton already has it
    tracks.push({ name: t.name, type: prop === 'quaternion' ? 'quaternion' : 'vector', times: r3(t.times.slice(0, n)), values })
  }
  return { name, duration: Math.round(dur * 1e4) / 1e4, tracks }
})
const out = { license: 'Motion data: Quaternius Universal Animation Library [Standard] (CC0 1.0).', sources: { library: { skeleton: { root: 'root', parentMatrix: r3(root.parent.matrixWorld.elements), bones }, clips } } }
mkdirSync('public/models/motion', { recursive: true })
const txt = JSON.stringify(out)
writeFileSync('public/models/motion/motions.json', txt)
console.log('bones', bones.length, '| size', (txt.length / 1024).toFixed(0), 'KB, gzipped', (gzipSync(txt).length / 1024).toFixed(0), 'KB')
console.log(clips.map((c) => c.name + ' ' + c.duration + 's/' + c.tracks.length).join('  '))
