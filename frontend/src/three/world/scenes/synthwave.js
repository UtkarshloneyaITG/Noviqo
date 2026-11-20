/**
 * Synthwave — an endless neon grid under a striped retro sun. Two wireframe
 * mountain ranges open into a valley so the sun sits framed in the middle;
 * its stripes slide slowly down, a neon seam ripples along the horizon, the
 * floor grid rolls toward you and the odd shooting star crosses the sky.
 * The sun is drawn by the shader (SUN); `still` bakes it for thumbnails.
 */
import { W, HORIZON, STAR, vertical, glow, scratch, stamp } from '../paint'

const SUN = [800, 372, 185]

function back(g, rand, add) {
  vertical(g, [[0, '#06011a'], [0.24, '#16053a'], [0.38, '#33095a'], [0.46, '#6a0f73'], [0.515, '#c2167f'], [0.54, '#ff3a8c'], [0.547, '#ff6aa0'], [0.555, '#2a0638'], [1, '#12021f']])
  glow(g, 800, 360, 520, 'rgba(255,50,150,.32)')
  glow(g, 800, 470, 300, 'rgba(255,120,80,.18)')
  glow(g, 260, 120, 420, 'rgba(90,30,200,.18)')
  glow(g, 1380, 160, 380, 'rgba(40,80,220,.14)')
  for (let i = 0; i < 170; i++) {
    const r = rand()
    add(rand() * W, 6 + 300 * rand() ** 1.4, 1.3 + r * 1.7, r > 0.88 ? '#ff9ae0' : r > 0.74 ? '#9ff4ff' : '#ffffff', STAR)
  }
}

/** A wireframe ridge: dark fill, contour lines and perspective ribs inside, a glowing edge. */
function range(g, rand, o) {
  const pts = []
  for (let x = -40; x < W + 80; x += o.step * (0.6 + rand() * 0.8)) {
    const open = Math.min(1, Math.abs(x - SUN[0]) / 560) // low in the middle: a valley for the sun
    pts.push([x, HORIZON - (o.minH + rand() * (o.maxH - o.minH)) * (0.18 + 0.82 * open)])
  }
  const outline = (s) => {
    s.beginPath()
    s.moveTo(pts[0][0], pts[0][1])
    for (const [x, y] of pts) s.lineTo(x, y)
  }
  const s = scratch(g)
  outline(s)
  s.lineTo(W + 80, HORIZON + 10)
  s.lineTo(-40, HORIZON + 10)
  s.closePath()
  const fill = s.createLinearGradient(0, HORIZON - o.maxH, 0, HORIZON)
  fill.addColorStop(0, o.fill[0])
  fill.addColorStop(1, o.fill[1])
  s.fillStyle = fill
  s.fill()
  // the wireframe, clipped to the mountain
  s.save()
  s.clip()
  s.strokeStyle = o.wire
  s.lineWidth = 1
  for (let k = 1; k < 5; k++) {
    s.beginPath()
    pts.forEach(([x, y], i) => s[i ? 'lineTo' : 'moveTo'](x, HORIZON - (HORIZON - y) * (1 - k / 5)))
    s.stroke()
  }
  for (const [x, y] of pts) {
    s.beginPath()
    s.moveTo(x, y)
    s.lineTo(SUN[0] + (x - SUN[0]) * 1.25, HORIZON + 10) // ribs fan out toward the viewer
    s.stroke()
  }
  s.restore()
  // glowing edge: a wide soft pass, then the bright line
  s.lineJoin = 'round'
  outline(s)
  s.strokeStyle = o.edge.replace('A', '.22')
  s.lineWidth = 7
  s.stroke()
  s.strokeStyle = o.edge.replace('A', '.95')
  s.lineWidth = 1.8
  s.stroke()
  stamp(g, s)
}

function front(g, rand) {
  range(g, rand, { minH: 60, maxH: 165, step: 95, fill: ['#2c0a52', '#14032a'], wire: 'rgba(255,60,190,.22)', edge: 'rgba(255,70,200,A)' })
  range(g, rand, { minH: 25, maxH: 95, step: 70, fill: ['#150326', '#0a0114'], wire: 'rgba(45,226,230,.2)', edge: 'rgba(45,226,230,A)' })
  vertical(g, [[0, 'rgba(255,46,136,0)'], [1, 'rgba(255,46,136,.3)']], HORIZON - 50, HORIZON + 6)
}

/** The sun as the shader draws it (at time 0), for the baked thumbnail. */
function still(g) {
  const [cx, cy, r] = SUN
  const s = scratch(g)
  const grad = s.createLinearGradient(0, cy - r, 0, cy + r)
  grad.addColorStop(0, '#fff07a')
  grad.addColorStop(0.45, '#ffb13b')
  grad.addColorStop(1, '#ff2975')
  s.fillStyle = grad
  s.beginPath()
  s.arc(cx, cy, r, 0, Math.PI * 2)
  s.fill()
  s.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 8; i++) s.fillRect(cx - r, cy - 0.08 * r + i * 0.14 * r * 1.0, r * 2, (0.02 + i * 0.045) * r)
  stamp(g, s)
}

export default {
  seed: 7,
  backScale: 0.5,
  band: [300, 500],
  back,
  front,
  still,
  fx: {
    defines: { SUN: '', HORIZON_GLOW: '', STREAKS: '' },
    uniforms: { uSun: SUN, uGlowColor: [1.0, 0.03, 0.25], uStreak: [9, 0.4, 300] },
  },
}
