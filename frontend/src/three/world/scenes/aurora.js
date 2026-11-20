/**
 * Aurora peaks — a polar night over snowfields. Streaked aurora curtains
 * ripple, pulse and drift in colour (MID_RIPPLE) above two mountain ranges
 * lit from the upper left: bright snow on the sunward faces, blue shadow on
 * the rest, frost along the ridges and fog pooling in the valleys. Stars
 * twinkle, the odd shooting star falls, and snow drifts down.
 */
import { W, HORIZON, STAR, vertical, glow, scratch, stamp } from '../paint'

function back(g, rand, add) {
  vertical(g, [[0, '#010312'], [0.28, '#03102a'], [0.45, '#0a2342'], [0.53, '#133a5c'], [0.547, '#1b4a6c'], [0.56, '#0b1c30'], [1, '#08121f']])
  glow(g, 800, HORIZON, 700, 'rgba(61,242,160,.07)')
  glow(g, 300, 120, 400, 'rgba(120,80,220,.08)')
  for (let i = 0; i < 340; i++) {
    const r = rand()
    add(rand() * W, 6 + 420 * rand() ** 1.25, 1.3 + r * 1.7, r > 0.9 ? '#d8ffee' : r > 0.78 ? '#d4dcff' : '#ffffff', STAR)
  }
}

/** Aurora curtains: rows of soft vertical rays hanging from a wavy hem, green at the hem, violet and pink at the top. */
function mid(g, rand) {
  const s = scratch(g)
  s.globalCompositeOperation = 'lighter'
  const curtain = (y0, amp, len, alpha, top) => {
    const seed = rand() * 100
    for (let x = -60; x < W + 60; x += 3) {
      const hem = y0 + Math.sin(x / 230 + seed) * amp + Math.sin(x / 71 + seed * 2) * amp * 0.3
      const k = 0.35 + 0.65 * Math.max(0, Math.sin(x / 41 + seed) * 0.5 + Math.sin(x / 17 + seed * 3) * 0.5 + 0.4) // ray strength
      const h = len * (0.6 + 0.5 * Math.sin(x / 120 + seed))
      const grad = s.createLinearGradient(0, hem - h, 0, hem + 14)
      grad.addColorStop(0, 'rgba(0,0,0,0)')
      grad.addColorStop(0.35, `${top}${(alpha * 0.35 * k).toFixed(3)})`)
      grad.addColorStop(0.8, `rgba(40,220,190,${(alpha * 0.7 * k).toFixed(3)})`)
      grad.addColorStop(0.94, `rgba(110,255,170,${(alpha * k).toFixed(3)})`)
      grad.addColorStop(1, 'rgba(110,255,170,0)')
      s.fillStyle = grad
      s.fillRect(x, hem - h, 4, h + 14)
    }
  }
  curtain(300, 46, 200, 0.5, 'rgba(150,110,255,')
  curtain(225, 34, 150, 0.36, 'rgba(255,100,200,')
  curtain(360, 28, 170, 0.3, 'rgba(90,150,255,')
  curtain(170, 22, 120, 0.2, 'rgba(255,120,210,')
  stamp(g, s, 'source-over', 'blur(3px)')
}

/** One mountain: shadowed body, a sunlit left face split along a jagged spine, snow cap shaded the same way, frost on the lit ridge. */
function mountain(g, rand, px, h, w, c) {
  const base = HORIZON + 6
  const L = px - w * (0.9 + rand() * 0.4)
  const R = px + w * (0.9 + rand() * 0.4)
  const top = [px, base - h]
  const edge = (x0) => {
    const pts = []
    for (let i = 1; i < 7; i++) {
      const t = i / 7
      pts.push([x0 + (px - x0) * t + (rand() - 0.5) * w * 0.16, base - h * t ** (0.9 + rand() * 0.5) + (rand() - 0.5) * h * 0.12 * (1 - t)])
    }
    return pts
  }
  const left = [[L, base], ...edge(L), top]
  const right = [top, ...edge(R).reverse(), [R, base]]
  const spine = [top]
  for (let i = 1; i <= 6; i++) spine.push([px + w * 0.28 * (i / 6) + (rand() - 0.5) * w * 0.12, base - h + h * (i / 6)])
  const path = (pts) => {
    g.beginPath()
    pts.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo'](x, y))
    g.closePath()
  }
  const body = [...left, ...right.slice(1)]
  const lit = [...left, ...spine.slice(1).reverse()]
  path(body)
  g.fillStyle = c.shadow
  g.fill()
  path(lit)
  const lg = g.createLinearGradient(0, base - h, 0, base)
  lg.addColorStop(0, c.lit)
  lg.addColorStop(1, c.shadow)
  g.fillStyle = lg
  g.fill()
  // snow cap: its ragged lower edge climbs away from the peak; gullies of snow run down the slopes
  const line = base - h * (c.snowLine + rand() * 0.12)
  const cap = [[L - 10, line]]
  for (let x = L; x <= R; x += 6) cap.push([x, line + (rand() - 0.5) * h * 0.16 - Math.abs(x - px) * 0.22])
  for (let k = 0, n = 2 + Math.floor(rand() * 4); k < n; k++) {
    const gx = px + (rand() - 0.5) * w * 0.9
    const gy = line - Math.abs(gx - px) * 0.22
    const len = h * (0.12 + rand() * 0.2)
    const gw = 2 + rand() * 4
    cap.splice(1 + Math.floor(((gx - L) / (R - L)) * (cap.length - 2)), 0, [gx - gw, gy], [gx + (rand() - 0.5) * 6, gy + len], [gx + gw, gy])
  }
  cap.push([R + 10, line], [R + 10, base - h - 10], [L - 10, base - h - 10])
  g.save()
  path(body)
  g.clip()
  path(cap)
  g.fillStyle = c.snowDim
  g.fill()
  path(lit)
  g.clip()
  path(cap)
  g.fillStyle = c.snow
  g.fill()
  g.restore()
  // frost along the lit ridge
  g.strokeStyle = c.frost
  g.lineWidth = 1.4
  g.beginPath()
  left.slice(3).forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo'](x, y))
  g.stroke()
}

function range(g, rand, o) {
  const s = scratch(g)
  let x = -80
  while (x < W + 80) {
    const w = o.wMin + rand() * (o.wMax - o.wMin)
    mountain(s, rand, x + w / 2, o.minH + rand() * (o.maxH - o.minH), w * 0.55, o)
    x += w * (0.55 + rand() * 0.35)
  }
  // fog pooling at the feet, only over this range
  s.globalCompositeOperation = 'source-atop'
  const fog = s.createLinearGradient(0, HORIZON - o.fog[0], 0, HORIZON)
  fog.addColorStop(0, 'rgba(40,80,120,0)')
  fog.addColorStop(1, o.fog[1])
  s.fillStyle = fog
  s.fillRect(-10, HORIZON - o.fog[0], W + 20, o.fog[0] + 10)
  stamp(g, s)
}

function front(g, rand) {
  range(g, rand, { minH: 140, maxH: 250, wMin: 170, wMax: 280, lit: '#46648a', shadow: '#1c3354', snow: '#dce9fb', snowDim: '#8aa3c6', frost: 'rgba(235,245,255,.6)', snowLine: 0.62, fog: [130, 'rgba(60,100,140,.8)'] })
  range(g, rand, { minH: 55, maxH: 130, wMin: 130, wMax: 220, lit: '#2a4566', shadow: '#0f1f36', snow: '#eef5ff', snowDim: '#7c95b9', frost: 'rgba(240,248,255,.7)', snowLine: 0.58, fog: [60, 'rgba(70,110,150,.55)'] })
  vertical(g, [[0, 'rgba(160,200,255,0)'], [1, 'rgba(160,200,255,.2)']], HORIZON - 40, HORIZON + 6)
}

export default {
  seed: 33,
  backScale: 0.5,
  band: [220, 500],
  back,
  mid,
  front,
  fx: { defines: { MID_RIPPLE: '', STREAKS: '' }, uniforms: { uStreak: [10, 0.4, 230] } },
}
