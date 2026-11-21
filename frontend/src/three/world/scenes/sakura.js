/**
 * Sakura dawn — first light over a temple garden. The sun climbs behind a
 * snow-capped mountain through a pink-and-violet sky; mist drifts across its
 * foot (MID_SCROLL). A pagoda with flickering lanterns stands on the left
 * hill, a torii gate on the right, and blossom trees frame the edges while
 * petals fall over the stone courtyard (the theme's motes).
 */
import { W, HORIZON, STAR, WINDOW, vertical, glow, scratch, stamp } from '../paint'

const SUN = [1000, 372] // in the gap beside the peak, clear of the party

function back(g, rand, add) {
  vertical(g, [[0, '#18214a'], [0.2, '#353874'], [0.34, '#6e5596'], [0.44, '#b679a6'], [0.5, '#ec9ea8'], [0.53, '#ffbf98'], [0.547, '#ffd7a6'], [0.56, '#6e5272'], [1, '#33243c']])
  const [sx, sy] = SUN
  glow(g, sx, sy, 520, 'rgba(255,170,150,.32)')
  glow(g, sx, sy, 170, 'rgba(255,224,190,.7)')
  glow(g, sx, sy, 58, 'rgba(255,246,228,1)')
  // the mountain: a broad cone, lit pink on the sun side, snow on top, hazed at its foot
  const peak = [1090, 268]
  const m = g.createLinearGradient(peak[0] - 300, 0, peak[0] + 300, 0)
  m.addColorStop(0, '#6a4f88')
  m.addColorStop(0.45, '#8a6aa0') // the sunward face
  m.addColorStop(0.55, '#5e4680')
  m.addColorStop(1, '#4f3c72')
  g.fillStyle = m
  g.beginPath()
  g.moveTo(peak[0] - 520, HORIZON + 6)
  g.quadraticCurveTo(peak[0] - 160, peak[1] + 120, peak[0] - 34, peak[1])
  g.lineTo(peak[0] + 34, peak[1])
  g.quadraticCurveTo(peak[0] + 170, peak[1] + 125, peak[0] + 540, HORIZON + 6)
  g.fill()
  g.fillStyle = '#f6e9f1'
  g.beginPath()
  g.moveTo(peak[0] - 34, peak[1])
  g.lineTo(peak[0] + 34, peak[1])
  g.lineTo(peak[0] + 96, peak[1] + 70)
  for (let x = peak[0] + 96; x > peak[0] - 96; x -= 12) g.lineTo(x, peak[1] + 58 + rand() * 30)
  g.closePath()
  g.fill()
  vertical(g, [[0, 'rgba(255,200,190,0)'], [1, 'rgba(255,200,190,.55)']], HORIZON - 110, HORIZON + 6)
  // the last stars, high up where the sky is still night
  for (let i = 0; i < 70; i++) add(rand() * W, 6 + 170 * rand() ** 1.6, 1.2 + rand() * 1.2, '#ffffff', STAR)
}

/** Mist banks across the mountain's foot and a few thin high clouds, wrapping as they drift. */
function mid(g, rand) {
  const s = scratch(g)
  const puffs = []
  for (let c = 0; c < 9; c++) {
    const low = c < 6
    const cx = rand() * W
    const cy = low ? 400 + rand() * 80 : 130 + rand() * 120
    const w = low ? 300 + rand() * 400 : 180 + rand() * 220
    for (let k = 0; k < 12; k++) puffs.push({ x: cx + (rand() - 0.5) * w, y: cy + (rand() - 0.5) * (low ? 26 : 10), rx: w * (0.12 + rand() * 0.15), ry: low ? 10 + rand() * 14 : 4 + rand() * 6, a: low ? 0.16 : 0.12 })
  }
  for (const p of puffs) {
    for (const dx of [-W, 0, W]) {
      s.fillStyle = `rgba(255,226,232,${p.a})`
      s.beginPath()
      s.ellipse(p.x + dx, p.y, p.rx, p.ry, 0, 0, Math.PI * 2)
      s.fill()
    }
  }
  stamp(g, s, 'source-over', 'blur(6px)')
}

function pagoda(g, add, x, base) {
  g.fillStyle = '#2b1d36'
  let y = base
  for (let i = 0; i < 5; i++) {
    const w = 74 - i * 10
    const h = 24 - i * 2
    g.fillRect(x - w * 0.36, y - h, w * 0.72, h) // the storey
    g.beginPath() // its roof, eaves sweeping up at the tips
    g.moveTo(x - w * 0.62, y - h - 2)
    g.quadraticCurveTo(x - w * 0.42, y - h + 4, x - w * 0.3, y - h - 6)
    g.lineTo(x + w * 0.3, y - h - 6)
    g.quadraticCurveTo(x + w * 0.42, y - h + 4, x + w * 0.62, y - h - 2)
    g.lineTo(x + w * 0.4, y - h - 13)
    g.lineTo(x - w * 0.4, y - h - 13)
    g.closePath()
    g.fill()
    if (i < 3) add(x - w * 0.2, y - h * 0.5, 2.4, '#ffb45e', WINDOW)
    if (i < 3) add(x + w * 0.2, y - h * 0.5, 2.4, '#ffb45e', WINDOW)
    add(x - w * 0.55, y - h + 3, 5, '#ffb46a', STAR) // lanterns hanging from the eaves
    add(x + w * 0.55, y - h + 3, 5, '#ffb46a', STAR)
    y -= h + 13
  }
  g.fillRect(x - 1.5, y - 40, 3, 40) // the finial
  for (let k = 0; k < 5; k++) g.fillRect(x - 5, y - 10 - k * 6, 10, 2)
}

function torii(g, x, base) {
  const red = '#8f3134'
  g.fillStyle = red
  g.fillRect(x - 46, base - 92, 7, 92)
  g.fillRect(x + 39, base - 92, 7, 92)
  g.fillRect(x - 52, base - 74, 104, 6) // nuki
  g.beginPath() // kasagi, curving up at the ends
  g.moveTo(x - 72, base - 98)
  g.quadraticCurveTo(x, base - 90, x + 72, base - 98)
  g.lineTo(x + 66, base - 88)
  g.quadraticCurveTo(x, base - 82, x - 66, base - 88)
  g.closePath()
  g.fill()
  g.fillStyle = 'rgba(255,170,140,.55)' // dawn catching the top edge
  g.fillRect(x - 66, base - 99, 132, 2)
}

/** A blossom tree: a dark leaning trunk with a few branches, under a clustered canopy lit from the sun's side. */
function tree(g, rand, x, base, lean, size) {
  g.strokeStyle = '#2a1a26'
  g.lineCap = 'round'
  const top = [x + lean, base - 240 * size]
  g.lineWidth = 16 * size
  g.beginPath()
  g.moveTo(x, base + 20)
  g.quadraticCurveTo(x + lean * 0.2, base - 120 * size, top[0], top[1])
  g.stroke()
  const tips = []
  for (let b = 0; b < 5; b++) {
    const a = -Math.PI / 2 + (b - 2) * 0.55 + (rand() - 0.5) * 0.3
    const len = (90 + rand() * 70) * size
    const tip = [top[0] + Math.cos(a) * len, top[1] + Math.sin(a) * len * 0.7]
    g.lineWidth = 6 * size
    g.beginPath()
    g.moveTo(top[0], top[1] + 30 * size)
    g.quadraticCurveTo(top[0] + Math.cos(a) * len * 0.4, top[1] + Math.sin(a) * len * 0.2, tip[0], tip[1])
    g.stroke()
    tips.push(tip)
  }
  // blossoms: a shaded underlayer, the body, then highlights on the sun side, and stray petals at the edges
  const toSun = Math.sign(SUN[0] - x)
  const blob = (n, r0, r1, color, dx, dy) => {
    for (const [tx, ty] of [top, ...tips]) {
      for (let k = 0; k < n; k++) {
        const a = rand() * Math.PI * 2
        const d = Math.sqrt(rand())
        g.fillStyle = color()
        g.beginPath()
        g.arc(tx + Math.cos(a) * d * 70 * size + dx * size, ty + Math.sin(a) * d * 44 * size + dy * size, (r0 + rand() * (r1 - r0)) * size, 0, Math.PI * 2)
        g.fill()
      }
    }
  }
  blob(26, 10, 19, () => `rgb(${180 + rand() * 20},${96 + rand() * 20},${140 + rand() * 20})`, 0, 10)
  blob(42, 7, 14, () => `rgb(${236 + rand() * 19},${150 + rand() * 30},${190 + rand() * 25})`, 0, 0)
  blob(22, 4, 9, () => `rgb(255,${205 + rand() * 30},${222 + rand() * 25})`, 16 * toSun, -10)
  blob(14, 1.4, 2.8, () => 'rgba(255,214,230,.9)', 0, 26)
}

function front(g, rand, add) {
  // far hills with a fringe of trees, hazed into the mist
  const s = scratch(g)
  s.fillStyle = '#5b4573'
  s.beginPath()
  s.moveTo(-10, HORIZON + 6)
  for (let x = -10; x <= W + 10; x += 16) s.lineTo(x, HORIZON - 40 - 34 * Math.sin(x / 260) - 18 * Math.sin(x / 97 + 1) - (x < 600 ? 40 * Math.exp(-(((x - 330) / 160) ** 2)) : 0))
  s.lineTo(W + 10, HORIZON + 6)
  s.fill()
  for (let x = -10; x <= W + 10; x += 9) {
    const y = HORIZON - 40 - 34 * Math.sin(x / 260) - 18 * Math.sin(x / 97 + 1) - (x < 600 ? 40 * Math.exp(-(((x - 330) / 160) ** 2)) : 0)
    s.beginPath()
    s.arc(x, y + 4, 6 + rand() * 8, 0, Math.PI * 2)
    s.fill()
  }
  s.globalCompositeOperation = 'source-atop'
  const haze = s.createLinearGradient(0, HORIZON - 130, 0, HORIZON)
  haze.addColorStop(0, 'rgba(255,190,200,.12)')
  haze.addColorStop(1, 'rgba(255,200,205,.55)')
  s.fillStyle = haze
  s.fillRect(-10, HORIZON - 140, W + 20, 150)
  stamp(g, s)
  pagoda(g, add, 330, HORIZON - 72)
  torii(g, 1250, HORIZON - 22)
  tree(g, rand, 70, 520, 60, 1.15)
  tree(g, rand, 1530, 520, -70, 1.2)
  vertical(g, [[0, 'rgba(255,190,200,0)'], [1, 'rgba(255,200,205,.3)']], HORIZON - 60, HORIZON + 8)
}

export default {
  seed: 88,
  backScale: 0.5,
  band: [60, 500],
  back,
  mid,
  front,
  fx: { defines: { MID_SCROLL: '' }, uniforms: { uMidSpeed: 0.002 } },
}
