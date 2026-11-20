/**
 * Moonlit beach — a wooden deck over a calm night sea. A haloed moon lays a
 * glittering path across the water that ripples and sparkles (WATER), thin
 * clouds drift past it, a lighthouse blinks on the far headland, and three
 * palms frame the edges, their crowns swaying in the breeze (FRONT_SWAY).
 * Fireflies float over the deck.
 */
import { W, H, HORIZON, STAR, BLINK, vertical, glow, scratch, stamp } from '../paint'

const MOON = [1340, 150, 54]
const INK = '#02070f'

function back(g, rand, add) {
  vertical(g, [[0, '#01030c'], [0.3, '#051530'], [0.46, '#0f3159'], [0.53, '#1d4a78'], [0.547, '#2e5f8f'], [0.55, '#163b63'], [1, '#020a16']])
  // moon: wide halo, soft inner glow, shaded disc with maria
  const [mx, my, mr] = MOON
  glow(g, mx, my, 300, 'rgba(150,190,255,.16)')
  glow(g, mx, my, 120, 'rgba(210,230,255,.32)')
  g.save()
  g.beginPath()
  g.arc(mx, my, mr, 0, Math.PI * 2)
  g.clip()
  const disc = g.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.1, mx, my, mr * 1.05)
  disc.addColorStop(0, '#ffffff')
  disc.addColorStop(1, '#d6e2f2')
  g.fillStyle = disc
  g.fillRect(mx - mr, my - mr, mr * 2, mr * 2)
  for (const [dx, dy, r, a] of [[-16, -10, 15, 0.16], [12, 10, 11, 0.14], [20, -18, 7, 0.12], [-6, 22, 9, 0.12], [-24, 12, 6, 0.1], [4, -26, 5, 0.1]]) {
    glow(g, mx + dx, my + dy, r, `rgba(120,140,175,${a * 2})`, 'rgba(120,140,175,0)')
  }
  g.restore()
  for (let i = 0; i < 280; i++) {
    const x = rand() * W
    const y = 6 + 430 * rand() ** 1.3
    const r = rand()
    if (Math.hypot(x - mx, y - my) > 150) add(x, y, 1.3 + r * 1.6, r > 0.85 ? '#cfe2ff' : '#ffffff', STAR)
  }
  // the sea: lighter toward the horizon, faint swell streaks, the moon's glitter path
  vertical(g, [[0, '#1d4a78'], [0.25, '#0d2b4d'], [1, '#020a16']], HORIZON, H)
  for (let y = HORIZON + 3; y < H; y += 3 + (y - HORIZON) * 0.02) {
    const d = (y - HORIZON) / (H - HORIZON)
    g.fillStyle = `rgba(140,180,230,${0.05 * (1 - d)})`
    for (let k = 0; k < 6; k++) g.fillRect(rand() * W, y, 30 + rand() * 120 * (1 + d * 3), 1)
    const spread = 20 + d * 300
    for (let k = 0; k < 7; k++) {
      g.fillStyle = `rgba(225,238,255,${0.5 * (1 - d * 0.8) * rand() * Math.exp(-k * 0.25)})`
      g.fillRect(mx - spread + rand() * spread * 2, y, 6 + rand() * (24 + d * 70), 1.2 + d * 1.8)
    }
  }
  glow(g, mx, HORIZON + 8, 90, 'rgba(200,225,255,.25)')
}

/** Thin moonlit wisps, painted three times across so they wrap as they drift. */
function mid(g, rand) {
  const s = scratch(g)
  const puffs = []
  for (let c = 0; c < 8; c++) {
    const cx = rand() * W
    const cy = 70 + rand() * 300
    const w = 160 + rand() * 260
    const lit = Math.exp(-(((cx - MOON[0]) / 380) ** 2) - ((cy - MOON[1]) / 220) ** 2) // brighter near the moon
    for (let k = 0; k < 10; k++) puffs.push({ x: cx + (rand() - 0.5) * w, y: cy + (rand() - 0.5) * 14, rx: w * (0.12 + rand() * 0.16), ry: 5 + rand() * 9, lit })
  }
  for (const p of puffs) {
    for (const dx of [-W, 0, W]) {
      s.fillStyle = `rgba(${150 + 80 * p.lit},${175 + 60 * p.lit},${215 + 35 * p.lit},${0.07 + 0.2 * p.lit})`
      s.beginPath()
      s.ellipse(p.x + dx, p.y, p.rx, p.ry, 0, 0, Math.PI * 2)
      s.fill()
    }
  }
  stamp(g, s, 'source-over', 'blur(5px)')
}

/** One palm frond: a drooping spine with a saw-tooth edge of leaflets swept toward the tip. */
function frond(g, x, y, ang, len, droop, w, rim) {
  const at = (s) => [x + Math.cos(ang) * len * s, y + Math.sin(ang) * len * s + droop * s * s]
  const upper = []
  const lower = []
  const N = 18
  for (let i = 0; i <= N; i++) {
    const s = i / N
    const [px, py] = at(s)
    const [qx, qy] = at(s + 0.01)
    const tl = Math.hypot(qx - px, qy - py) || 1
    const tx = (qx - px) / tl
    const ty = (qy - py) / tl
    const leaf = w * Math.sin(Math.PI * Math.min(1, s * 1.1)) * (i % 2 ? 1 : 0.3)
    upper.push([px - ty * leaf + tx * leaf * 0.7, py + tx * leaf + ty * leaf * 0.7 - leaf * 0.2])
    lower.push([px + ty * leaf + tx * leaf * 0.7, py - tx * leaf + ty * leaf * 0.7 + leaf * 0.9])
  }
  g.beginPath()
  g.moveTo(x, y)
  for (const [px, py] of upper) g.lineTo(px, py)
  for (const [px, py] of lower.reverse()) g.lineTo(px, py)
  g.closePath()
  g.fill()
  if (rim) {
    g.save()
    g.strokeStyle = rim
    g.lineWidth = 1.2
    g.beginPath()
    for (let i = 0; i <= N; i++) g[i ? 'lineTo' : 'moveTo'](...at(i / N))
    g.stroke()
    g.restore()
  }
}

/** A palm: a ringed, tapering, curved trunk and a crown of drooping fronds. Moonlight rims the side facing the moon. */
function palm(g, rand, bx, by, lean, height, scale) {
  const cx = bx + lean
  const cy = by - height
  const kx = bx + lean * 0.12
  const ky = by - height * 0.55
  const at = (t) => [(1 - t) ** 2 * bx + 2 * (1 - t) * t * kx + t * t * cx, (1 - t) ** 2 * by + 2 * (1 - t) * t * ky + t * t * cy]
  const moonSide = Math.sign(MOON[0] - cx)
  g.fillStyle = INK
  for (let i = 0; i < 34; i++) {
    const t = i / 34
    const [x0, y0] = at(t)
    const [x1, y1] = at(t + 1 / 34 + 0.006)
    const wdt = (20 - 9 * t) * scale
    const a = Math.atan2(y1 - y0, x1 - x0)
    g.save()
    g.translate(x0, y0)
    g.rotate(a)
    g.fillRect(0, -wdt / 2, Math.hypot(x1 - x0, y1 - y0), wdt)
    g.fillStyle = 'rgba(120,160,210,.22)' // moonlit edge
    g.fillRect(0, moonSide > 0 ? -wdt / 2 : wdt / 2 - 1.4, Math.hypot(x1 - x0, y1 - y0), 1.4)
    g.fillStyle = 'rgba(0,0,0,.6)' // ring notch
    g.fillRect(0, -wdt / 2, 1.2, wdt)
    g.restore()
    g.fillStyle = INK
  }
  // coconuts tucked under the crown
  for (const [dx, dy] of [[-7, 9], [6, 11], [0, 15]]) {
    g.beginPath()
    g.arc(cx + dx * scale, cy + dy * scale, 6 * scale, 0, Math.PI * 2)
    g.fill()
  }
  const fronds = [[-158, 0.9, 70], [-128, 1, 55], [-102, 0.85, 40], [-78, 0.9, 45], [-50, 1, 60], [-20, 0.95, 85], [12, 0.8, 95], [168, 0.85, 95], [196, 0.7, 90]]
  for (const [deg, l, droop] of fronds) {
    const a = ((deg + (rand() - 0.5) * 10) * Math.PI) / 180
    const rim = Math.cos(a) * moonSide > 0.2 ? 'rgba(130,170,220,.28)' : null
    frond(g, cx, cy, a, 165 * l * scale, droop * scale, 22 * scale, rim)
  }
}

function front(g, rand, add) {
  // far headland with a lighthouse and a few village lights
  g.fillStyle = '#05142a'
  g.beginPath()
  g.moveTo(-10, HORIZON + 4)
  g.bezierCurveTo(120, HORIZON - 40, 300, HORIZON - 36, 420, HORIZON - 10)
  g.bezierCurveTo(470, HORIZON - 2, 520, HORIZON, 560, HORIZON + 4)
  g.closePath()
  g.fill()
  g.fillRect(300, HORIZON - 58, 7, 26)
  g.fillRect(298, HORIZON - 61, 11, 4)
  add(303.5, HORIZON - 64, 9, '#ffdca0', BLINK)
  g.fillStyle = 'rgba(255,200,130,.75)'
  for (const [x, y] of [[180, -20], [196, -18], [232, -24], [402, -11], [430, -8]]) g.fillRect(x, HORIZON + y, 2, 2)
  g.fillStyle = '#071a33'
  g.beginPath()
  g.moveTo(980, HORIZON + 4)
  g.bezierCurveTo(1100, HORIZON - 14, 1250, HORIZON - 18, 1420, HORIZON + 4)
  g.fill()

  palm(g, rand, 70, 905, 110, 600, 1)
  palm(g, rand, 205, 905, 48, 440, 0.78)
  palm(g, rand, 1545, 905, -120, 640, 1.05)
}

export default {
  seed: 21,
  band: [110, 900],
  back,
  mid,
  front,
  fx: {
    defines: { WATER: '', MID_SCROLL: '', FRONT_SWAY: '' },
    uniforms: { uMoonX: MOON[0], uMidSpeed: 0.003 },
  },
}
