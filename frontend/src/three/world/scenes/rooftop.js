/**
 * Rooftop dusk — the free default, also baked flat for the skyline around
 * the game table (Room3D). A violet-to-amber dusk over a city: the sun just
 * set behind it, rays fanning up, clouds lit from below drifting past.
 * Three skyline layers fade into the evening haze; the nearest has rooftop
 * clutter, lit windows that now and then go dark, and red aircraft lights
 * blinking on the masts. The tallest towers frame the edges so the sun glow
 * stays open in the middle.
 */
import { W, HORIZON, STAR, WINDOW, BLINK, vertical, glow, scratch, stamp } from '../paint'

const SUN_X = 820
const WARM = ['#ffc878', '#ffd9a0', '#ffb45e']
const COOL = '#6edcff'

function back(g, rand) {
  vertical(g, [[0, '#05071c'], [0.2, '#11113f'], [0.34, '#2e1a5c'], [0.43, '#66266f'], [0.49, '#b23f6e'], [0.52, '#f0705e'], [0.54, '#ffa86a'], [0.547, '#ffc98a'], [0.56, '#2a1640'], [1, '#140f2c']])
  // the sun just below the rooftops: wide warm bloom, hot core
  glow(g, SUN_X, 492, 620, 'rgba(255,120,110,.28)')
  glow(g, SUN_X, 492, 260, 'rgba(255,180,120,.55)')
  glow(g, SUN_X, 494, 70, 'rgba(255,244,214,1)')
  // rays fanning up through the haze
  g.save()
  g.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 13; i++) {
    const a = Math.PI * (1.06 + (0.88 * (i + rand() * 0.6)) / 13)
    const spread = 0.025 + rand() * 0.035
    const ray = g.createRadialGradient(SUN_X, 492, 0, SUN_X, 492, 760)
    ray.addColorStop(0, `rgba(255,190,150,${0.07 + rand() * 0.06})`)
    ray.addColorStop(1, 'rgba(255,190,150,0)')
    g.fillStyle = ray
    g.beginPath()
    g.moveTo(SUN_X, 492)
    g.arc(SUN_X, 492, 760, a - spread, a + spread)
    g.closePath()
    g.fill()
  }
  g.restore()
  // the evening star, low over the sun
  glow(g, 1185, 205, 10, 'rgba(255,244,220,.9)')
}

/** Long stratus streaks lit from below, brightest near the sun. Painted three times across so they wrap seamlessly as they drift. */
function mid(g, rand) {
  const s = scratch(g)
  const puffs = []
  for (let c = 0; c < 11; c++) {
    const cx = rand() * W
    const cy = 150 + rand() * 250
    const w = 200 + rand() * 300
    const h = 8 + rand() * 16
    const warm = Math.min(1, (cy - 140) / 260 + 0.45 * Math.exp(-(((cx - SUN_X) / 420) ** 2)))
    for (let k = 0; k < 14; k++) {
      puffs.push({ x: cx + (rand() - 0.5) * w, y: cy + (rand() - 0.5) * h, rx: w * (0.12 + rand() * 0.18), ry: h * (0.5 + rand() * 0.6), warm })
    }
  }
  for (const p of puffs) {
    for (const dx of [-W, 0, W]) {
      const grad = s.createLinearGradient(0, p.y - p.ry, 0, p.y + p.ry)
      grad.addColorStop(0, 'rgba(60,34,100,.20)')
      grad.addColorStop(1, `rgba(255,${110 + 70 * p.warm},${105 + 30 * p.warm},${0.14 + 0.3 * p.warm})`)
      s.fillStyle = grad
      s.beginPath()
      s.ellipse(p.x + dx, p.y, p.rx, p.ry, 0, 0, Math.PI * 2)
      s.fill()
    }
  }
  stamp(g, s, 'source-over', 'blur(4px)')
}

/** One skyline layer, painted on its own and hazed toward the horizon. */
function skyline(g, rand, add, o) {
  const s = scratch(g)
  let x = -30
  while (x < W + 30) {
    const w = o.wMin + rand() * (o.wMax - o.wMin)
    const edge = Math.abs(x + w / 2 - SUN_X) / 800 // taller toward the edges
    const h = (o.minH + rand() * (o.maxH - o.minH)) * (o.frame ? 0.55 + 0.75 * edge : 1)
    tower(s, rand, add, x, w, Math.min(h, o.cap), o)
    x += w + o.gap * rand()
  }
  // haze: only over this layer's own pixels
  s.globalCompositeOperation = 'source-atop'
  const haze = s.createLinearGradient(0, HORIZON - o.cap, 0, HORIZON)
  haze.addColorStop(0, o.haze[0])
  haze.addColorStop(1, o.haze[1])
  s.fillStyle = haze
  s.fillRect(-10, HORIZON - o.cap - 80, W + 20, o.cap + 90)
  stamp(g, s)
}

function tower(g, rand, add, x, w, h, o) {
  const top = HORIZON - h
  g.fillStyle = o.color
  g.fillRect(x, top, w, h + 10)
  let roof = top
  // stepped crown on some of the taller ones
  if (h > 110 && rand() < 0.55) {
    const w2 = w * (0.5 + rand() * 0.25)
    const h2 = 10 + rand() * 20
    g.fillRect(x + (w - w2) / 2, top - h2, w2, h2 + 1)
    roof = top - h2
    if (rand() < 0.5) {
      const w3 = w2 * 0.5
      const h3 = 8 + rand() * 12
      g.fillRect(x + (w - w3) / 2, roof - h3, w3, h3 + 1)
      roof -= h3
    }
  }
  if (o.near) {
    // rooftop clutter: AC boxes, a water tower, a mast with a red light
    for (let k = 0, n = Math.floor(rand() * 3); k < n; k++) g.fillRect(x + 4 + rand() * (w - 16), top - 5, 7 + rand() * 6, 5)
    if (h < 150 && w > 50 && rand() < 0.4) {
      const tx = x + 8 + rand() * (w - 34)
      g.fillRect(tx + 2, top - 10, 2, 10)
      g.fillRect(tx + 14, top - 10, 2, 10)
      g.fillRect(tx, top - 26, 18, 16)
      g.beginPath()
      g.moveTo(tx - 2, top - 26)
      g.lineTo(tx + 9, top - 34)
      g.lineTo(tx + 20, top - 26)
      g.fill()
    }
    if (rand() < 0.4) {
      const mx = x + w * (0.3 + rand() * 0.4)
      const mh = 14 + rand() * 28
      g.fillRect(mx - 1, roof - mh, 2, mh)
      add(mx, roof - mh, 7, '#ff3a3a', BLINK)
    }
  } else if (rand() < 0.2) {
    g.fillRect(x + w * 0.45, roof - 16, 2.5, 16)
  }
  // the edge facing the sun catches its light
  if (o.rim) {
    const ex = x + w / 2 < SUN_X ? x + w - 1.6 : x
    const rim = g.createLinearGradient(0, roof, 0, HORIZON)
    rim.addColorStop(0, `rgba(255,150,120,${o.rim})`)
    rim.addColorStop(1, 'rgba(255,150,120,0)')
    g.fillStyle = rim
    g.fillRect(ex, roof, 1.6, HORIZON - roof)
  }
  // windows: a grid, lit vertical strips, or dark
  const style = rand()
  if (style < 0.18) return
  const strips = style < 0.36
  for (let wx = x + 5; wx < x + w - 6; wx += 8) {
    const col = strips && rand() < 0.5
    for (let wy = top + 8; wy < HORIZON - 16; wy += 9) {
      if (!(col || (!strips && rand() < o.lit))) continue
      const color = rand() < 0.8 ? WARM[Math.floor(rand() * 3)] : COOL
      if (o.near) add(wx + 1.5, wy + 2, 3.2, color, WINDOW)
      else {
        g.globalAlpha = o.windowAlpha * (0.6 + rand() * 0.4)
        g.fillStyle = color
        g.fillRect(wx, wy, 2.6, 3.4)
        g.globalAlpha = 1
        g.fillStyle = o.color
      }
    }
  }
}

function front(g, rand, add) {
  skyline(g, rand, add, { color: '#4b2a69', haze: ['rgba(150,70,130,.25)', 'rgba(220,100,130,.7)'], minH: 50, maxH: 150, cap: 190, wMin: 30, wMax: 80, gap: 4, lit: 0.12, windowAlpha: 0.35 })
  skyline(g, rand, add, { color: '#2a1948', haze: ['rgba(120,50,110,.08)', 'rgba(200,80,120,.45)'], minH: 40, maxH: 180, cap: 230, wMin: 40, wMax: 100, gap: 14, lit: 0.18, windowAlpha: 0.7, rim: 0.35, frame: true })
  skyline(g, rand, add, { color: '#120a22', haze: ['rgba(0,0,0,0)', 'rgba(150,60,110,.3)'], minH: 30, maxH: 170, cap: 250, wMin: 55, wMax: 130, gap: 70, lit: 0.24, rim: 0.55, frame: true, near: true })
  // evening haze along the horizon
  vertical(g, [[0, 'rgba(255,120,140,0)'], [1, 'rgba(255,120,140,.26)']], HORIZON - 70, HORIZON + 8)
}

export default {
  seed: 3,
  backScale: 0.5,
  band: [120, 500],
  back(g, rand, add) {
    back(g, rand)
    for (let i = 0; i < 230; i++) {
      const r = rand()
      add(rand() * W, 8 + 320 * rand() ** 1.5, 1.4 + r * 1.6, r > 0.9 ? '#ffe2c0' : r > 0.7 ? '#cfe0ff' : '#ffffff', STAR)
    }
  },
  mid,
  front,
  fx: { defines: { MID_SCROLL: '', STREAKS: '' }, uniforms: { uMidSpeed: 0.004, uStreak: [11, 0.35, 300] } },
}
