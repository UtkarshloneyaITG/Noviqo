/**
 * Orbital station — a deck hanging in deep space. A banded gas giant turns
 * slowly behind the platform's edge (PLANET, drawn by the shader), its rings
 * passing behind it at the top and in front at the bottom. A layered nebula
 * glows across the sky, a distant station blinks, shooting stars cross now
 * and then, and the deck's rim light breathes. `still` paints the planet for
 * thumbnails.
 */
import { W, H, STAR, BLINK, vertical, glow, scratch, stamp } from '../paint'

const PLANET = [1170, 590, 265, -0.42] // x, y, radius, tilt (rings and bands lean together)

/** Ring bands as concentric ellipses; `half` 'far' = the arc behind the planet (top), 'near' = in front (bottom). */
function rings(g, half) {
  const [px, py, pr, tilt] = PLANET
  const [a0, a1] = half === 'far' ? [Math.PI, Math.PI * 2] : [0, Math.PI]
  for (const [k, wdt, alpha, tint] of [[1.32, 10, 0.18, '230,190,150'], [1.45, 16, 0.42, '255,214,170'], [1.56, 5, 0.2, '200,160,130'], [1.66, 12, 0.5, '255,222,186'], [1.78, 7, 0.28, '235,190,150'], [1.9, 3, 0.18, '210,170,140']]) {
    g.strokeStyle = `rgba(${tint},${alpha})`
    g.lineWidth = wdt
    g.beginPath()
    g.ellipse(px, py, pr * k, pr * k * 0.24, tilt, a0, a1)
    g.stroke()
  }
}

function back(g, rand, add) {
  vertical(g, [[0, '#010109'], [0.45, '#050620'], [1, '#02020a']])
  // nebula: soft layered clouds of violet, blue and ember, blurred together
  const s = scratch(g)
  s.globalCompositeOperation = 'lighter'
  const cloud = (cx, cy, rx, ry, color, n) => {
    for (let i = 0; i < n; i++) {
      const x = cx + (rand() - 0.5) * rx * 2
      const y = cy + (rand() - 0.5) * ry * 2
      const r = 40 + rand() * 120
      glow(s, x, y, r, `rgba(${color},${0.05 + rand() * 0.08})`)
    }
  }
  cloud(380, 230, 330, 140, '130,50,180', 40)
  cloud(600, 150, 260, 90, '50,100,220', 30)
  cloud(250, 330, 200, 80, '200,70,160', 18)
  cloud(1180, 300, 300, 110, '255,100,60', 20)
  stamp(g, s, 'lighter', 'blur(14px)')
  // dark dust lane across the nebula
  g.save()
  g.globalAlpha = 0.5
  for (let i = 0; i < 26; i++) glow(g, 160 + i * 22 + rand() * 20, 260 - i * 6 + rand() * 30, 30 + rand() * 30, 'rgba(1,1,9,.55)')
  g.restore()
  // stars, kept off the planet's disc
  const [px, py, pr] = PLANET
  for (let i = 0; i < 560; i++) {
    const x = rand() * W
    const y = rand() * H * 0.62
    if (Math.hypot(x - px, y - py) < pr + 14) continue
    const r = rand()
    add(x, y, 1.2 + r * 1.8, r > 0.93 ? '#ffd2a8' : r > 0.82 ? '#b8ccff' : '#ffffff', STAR)
  }
  // a distant station: truss, solar wings, a docking ring, blinking beacons
  g.save()
  g.translate(300, 150)
  g.rotate(-0.12)
  g.fillStyle = '#0b0f1e'
  g.fillRect(-70, -2, 140, 4)
  for (const x of [-62, -40, 40, 62]) {
    g.fillStyle = '#18223e'
    g.fillRect(x - 9, -26, 18, 22)
    g.fillRect(x - 9, 4, 18, 22)
    g.fillStyle = 'rgba(90,140,220,.35)'
    g.fillRect(x - 8, -25, 16, 1)
    g.fillRect(x - 8, 5, 16, 1)
  }
  g.strokeStyle = '#1a2240'
  g.lineWidth = 4
  g.beginPath()
  g.ellipse(0, 0, 14, 14, 0, 0, Math.PI * 2)
  g.stroke()
  g.restore()
  add(230, 158, 6, '#ff4040', BLINK)
  add(370, 141, 6, '#7ff7ff', BLINK, 0.5)
  rings(g, 'far')
}

function front(g) {
  rings(g, 'near')
}

/** The planet as the shader draws it, for the baked thumbnail. */
function still(g, rand) {
  const [px, py, pr] = PLANET
  g.save()
  g.beginPath()
  g.arc(px, py, pr, 0, Math.PI * 2)
  g.clip()
  const body = g.createLinearGradient(px - pr, py - pr, px + pr, py + pr)
  body.addColorStop(0, '#f2a65a')
  body.addColorStop(0.45, '#b4573b')
  body.addColorStop(1, '#2a1030')
  g.fillStyle = body
  g.fillRect(px - pr, py - pr, pr * 2, pr * 2)
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(255,${180 + rand() * 60},${120 + rand() * 60},${0.06 + rand() * 0.1})`
    g.fillRect(px - pr, py - pr + i * 40 + rand() * 20, pr * 2, 6 + rand() * 18)
  }
  const shade = g.createRadialGradient(px - pr * 0.45, py - pr * 0.45, pr * 0.2, px, py, pr * 1.05)
  shade.addColorStop(0, 'rgba(0,0,0,0)')
  shade.addColorStop(1, 'rgba(0,0,10,.85)')
  g.fillStyle = shade
  g.fillRect(px - pr, py - pr, pr * 2, pr * 2)
  g.restore()
}

export default {
  seed: 51,
  band: [330, 760],
  back,
  front,
  still,
  fx: { defines: { PLANET: '', STREAKS: '' }, uniforms: { uPlanet: PLANET, uStreak: [8, 0.45, 330] } },
}
