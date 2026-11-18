/**
 * Lobby backgrounds — one entry per `lobby:*` inventory item.
 *
 * Each theme is pure data plus painters: a screen-space sky (1600×900
 * canvas, horizon at y≈492 so every theme lines up with the lobby camera),
 * a floor surface, fog, a light rig and a particle preset. Painted once and
 * cached; no image assets. LobbyBackdrop.jsx turns a theme into a scene.
 */
import * as THREE from 'three'
import { skyTexture, gridTexture, HORIZON_FOG } from './sky'

const W = 1600
const H = 900
const HORIZON = 492
const cache = new Map()

function canvas(w = W, h = H) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')]
}

function done(c, repeat) {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(repeat, repeat)
    t.anisotropy = 8
  }
  return t
}

function once(key, paint) {
  if (!cache.has(key)) cache.set(key, paint())
  return cache.get(key)
}

// Deterministic randomness so each sky looks the same on every visit.
function rng(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

function stars(g, rand, count, maxY, alpha = 0.8) {
  for (let i = 0; i < count; i++) {
    const r = rand()
    g.fillStyle = `rgba(255,255,255,${(0.2 + rand() * 0.8) * alpha})`
    const s = r > 0.97 ? 2.4 : r > 0.85 ? 1.7 : 1.1
    g.fillRect(rand() * W, rand() * maxY, s, s)
  }
}

function vertical(g, stops, y0 = 0, y1 = H) {
  const grad = g.createLinearGradient(0, y0, 0, y1)
  for (const [at, color] of stops) grad.addColorStop(at, color)
  g.fillStyle = grad
  g.fillRect(0, y0, W, y1 - y0)
}

function glow(g, x, y, r, inner, outer = 'rgba(0,0,0,0)') {
  const grad = g.createRadialGradient(x, y, 0, x, y, r)
  grad.addColorStop(0, inner)
  grad.addColorStop(1, outer)
  g.fillStyle = grad
  g.fillRect(x - r, y - r, r * 2, r * 2)
}

/** Ridge line for mountains: a jagged polygon from left to right. */
function ridge(g, rand, base, minH, maxH, step, fill) {
  g.beginPath()
  g.moveTo(-10, base + 10)
  let x = -10
  while (x < W + 10) {
    g.lineTo(x, base - (minH + rand() * (maxH - minH)))
    x += step * (0.6 + rand() * 0.8)
  }
  g.lineTo(W + 10, base + 10)
  g.closePath()
  g.fillStyle = fill
  g.fill()
}

// ── 2. Synthwave ─────────────────────────────────────────────────────────
function synthwaveSky() {
  const [c, g] = canvas()
  const rand = rng(7)
  vertical(g, [[0, '#07011a'], [0.3, '#1d0640'], [0.46, '#5a0d6e'], [0.53, '#ff2e88'], [0.55, '#2a0638'], [1, '#12021f']])
  stars(g, rand, 120, 360, 0.9)
  // the striped sun
  const [sc, sg] = canvas(420, 420)
  const sun = sg.createLinearGradient(0, 30, 0, 390)
  sun.addColorStop(0, '#fff07a')
  sun.addColorStop(0.45, '#ffb13b')
  sun.addColorStop(1, '#ff2975')
  sg.fillStyle = sun
  sg.beginPath()
  sg.arc(210, 210, 185, 0, Math.PI * 2)
  sg.fill()
  sg.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 9; i++) {
    const y = 230 + i * 20
    sg.fillRect(0, y, 420, 3 + i * 1.4)
  }
  glow(g, 800, 380, 420, 'rgba(255,60,160,.35)')
  g.drawImage(sc, 800 - 210, HORIZON - 330)
  // wireframe mountains
  ridge(g, rand, HORIZON, 30, 120, 70, '#1a0533')
  g.strokeStyle = 'rgba(45,226,230,.75)'
  g.lineWidth = 2
  g.beginPath()
  const r2 = rng(7)
  for (let i = 0; i < 151; i++) r2()          // follow a similar ridge for the neon edge
  let x = -10
  g.moveTo(x, HORIZON - 40)
  while (x < W + 10) {
    x += 70 * (0.6 + r2() * 0.8)
    g.lineTo(x, HORIZON - (30 + r2() * 90))
  }
  g.stroke()
  vertical(g, [[0, 'rgba(255,46,136,0)'], [1, 'rgba(255,46,136,.35)']], HORIZON - 70, HORIZON + 6)
  return done(c)
}

function synthwaveFloor() {
  const [c, g] = canvas(256, 256)
  g.fillStyle = '#12031f'
  g.fillRect(0, 0, 256, 256)
  g.strokeStyle = 'rgba(255,46,160,.85)'
  g.lineWidth = 3
  g.strokeRect(1.5, 1.5, 253, 253)
  g.strokeStyle = 'rgba(255,46,160,.25)'
  g.lineWidth = 9
  g.strokeRect(1.5, 1.5, 253, 253)
  return done(c, 40)
}

// ── 3. Moonlit beach ─────────────────────────────────────────────────────
function beachSky() {
  const [c, g] = canvas()
  const rand = rng(21)
  vertical(g, [[0, '#01040e'], [0.35, '#071a36'], [0.53, '#1b4572'], [0.547, '#28557f'], [0.55, '#0b2340'], [1, '#03101f']])
  stars(g, rand, 260, 430, 0.85)
  glow(g, 1340, 150, 190, 'rgba(190,220,255,.22)')
  g.fillStyle = '#f2f6ff'
  g.beginPath()
  g.arc(1340, 150, 52, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = 'rgba(160,180,210,.35)'
  for (const [dx, dy, r] of [[-18, -12, 13], [14, 10, 9], [22, -20, 6], [-6, 22, 7]]) {
    g.beginPath()
    g.arc(1340 + dx * 0.8, 150 + dy * 0.8, r * 0.8, 0, Math.PI * 2)
    g.fill()
  }
  // sea: darker water with a shimmering moon path
  vertical(g, [[0, '#123a63'], [1, '#020a16']], HORIZON, H)
  for (let y = HORIZON + 4; y < H; y += 5) {
    const spread = 18 + (y - HORIZON) * 0.55
    for (let k = 0; k < 4; k++) {
      g.fillStyle = `rgba(220,235,255,${0.35 * (1 - (y - HORIZON) / (H - HORIZON + 80)) * rand()})`
      g.fillRect(1340 - spread + rand() * spread * 2, y, 10 + rand() * 40, 2)
    }
  }
  // far headland
  ridge(g, rand, HORIZON + 2, 6, 34, 90, '#06162a')
  // palms at both edges
  const palm = (x, lean, h) => {
    g.strokeStyle = '#02070f'
    g.lineWidth = 16
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(x, H)
    g.quadraticCurveTo(x + lean * 0.4, H - h * 0.55, x + lean, H - h)
    g.stroke()
    g.fillStyle = '#02070f'
    for (let f = 0; f < 7; f++) {
      const a = -Math.PI / 2 + (f - 3) * 0.55 + lean * 0.002
      g.beginPath()
      g.ellipse(x + lean + Math.cos(a) * 70, H - h + Math.sin(a) * 34 + 18, 82, 13, a, 0, Math.PI * 2)
      g.fill()
    }
  }
  palm(60, 90, 620)
  palm(170, 40, 470)
  palm(1530, -110, 650)
  return done(c)
}

function beachFloor() {
  const [c, g] = canvas(256, 256)
  const rand = rng(5)
  for (let i = 0; i < 8; i++) {
    const shade = 46 + Math.floor(rand() * 16)
    g.fillStyle = `rgb(${shade + 18},${shade + 6},${shade - 4})`
    g.fillRect(0, i * 32, 256, 30)
    g.fillStyle = 'rgba(0,0,0,.55)'
    g.fillRect(0, i * 32 + 30, 256, 2)
    g.fillRect(Math.floor(rand() * 256), i * 32, 2, 30)
    g.fillStyle = 'rgba(255,255,255,.04)'
    for (let k = 0; k < 6; k++) g.fillRect(rand() * 256, i * 32 + rand() * 28, 30 + rand() * 50, 1)
  }
  return done(c, 6)
}

// ── 4. Aurora peaks ──────────────────────────────────────────────────────
function auroraSky() {
  const [c, g] = canvas()
  const rand = rng(33)
  vertical(g, [[0, '#010412'], [0.35, '#05122a'], [0.53, '#0f2d48'], [0.56, '#0b1c30'], [1, '#08121f']])
  stars(g, rand, 300, 470, 0.9)
  const [ac, ag] = canvas()
  ag.globalCompositeOperation = 'lighter'
  const curtain = (y0, amp, hue1, hue2, alpha) => {
    for (let x = -40; x < W + 40; x += 6) {
      const y = y0 + Math.sin(x / 210 + y0) * amp + Math.sin(x / 67) * amp * 0.25
      const h = 120 + Math.sin(x / 140 + y0) * 60
      const grad = ag.createLinearGradient(0, y - h, 0, y + 20)
      grad.addColorStop(0, 'rgba(0,0,0,0)')
      grad.addColorStop(0.55, hue2.replace('A', String(alpha * 0.6)))
      grad.addColorStop(1, hue1.replace('A', String(alpha)))
      ag.fillStyle = grad
      ag.fillRect(x, y - h, 8, h + 20)
    }
  }
  curtain(250, 40, 'rgba(61,242,160,A)', 'rgba(80,160,255,A)', 0.55)
  curtain(320, 30, 'rgba(61,242,160,A)', 'rgba(167,123,255,A)', 0.4)
  curtain(190, 26, 'rgba(120,255,200,A)', 'rgba(255,90,200,A)', 0.25)
  g.save()
  g.globalCompositeOperation = 'lighter'
  g.filter = 'blur(10px)'          // one blur for the whole aurora, not one per stroke
  g.drawImage(ac, 0, 0)
  g.restore()
  // mountains with snow caps
  const peaks = (base, minH, maxH, step, body, snow) => {
    let x = -60
    while (x < W + 60) {
      const w = step * (0.7 + rand() * 0.8)
      const h = minH + rand() * (maxH - minH)
      const px = x + w / 2
      g.fillStyle = body
      g.beginPath()
      g.moveTo(x - w * 0.3, base + 8)
      g.lineTo(px, base - h)
      g.lineTo(x + w * 1.3, base + 8)
      g.fill()
      g.fillStyle = snow
      g.beginPath()
      g.moveTo(px, base - h)
      g.lineTo(px - w * 0.22, base - h * 0.72)
      g.lineTo(px - w * 0.06, base - h * 0.78)
      g.lineTo(px + w * 0.08, base - h * 0.7)
      g.lineTo(px + w * 0.25, base - h * 0.74)
      g.fill()
      x += w * 0.85
    }
  }
  peaks(HORIZON, 120, 230, 260, '#1a3150', 'rgba(220,236,255,.85)')
  peaks(HORIZON + 4, 50, 120, 170, '#0e1e33', 'rgba(200,222,250,.7)')
  vertical(g, [[0, 'rgba(160,200,255,0)'], [1, 'rgba(160,200,255,.18)']], HORIZON - 40, HORIZON + 6)
  return done(c)
}

function snowFloor() {
  const [c, g] = canvas(256, 256)
  const rand = rng(9)
  g.fillStyle = '#93a8c2'
  g.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 1600; i++) {
    const v = 150 + Math.floor(rand() * 60)
    g.fillStyle = `rgba(${v - 20},${v - 6},${v},.35)`
    g.fillRect(rand() * 256, rand() * 256, 2, 2)
  }
  return done(c, 14)
}

// ── 5. Orbital station ───────────────────────────────────────────────────
function stationSky() {
  const [c, g] = canvas()
  const rand = rng(51)
  vertical(g, [[0, '#010109'], [0.5, '#050620'], [1, '#02020a']])
  g.save()
  g.globalCompositeOperation = 'lighter'
  glow(g, 380, 240, 420, 'rgba(120,40,160,.35)')
  glow(g, 620, 160, 300, 'rgba(40,90,200,.28)')
  glow(g, 1250, 360, 360, 'rgba(255,90,60,.12)')
  g.restore()
  stars(g, rand, 520, H, 1)
  // ringed planet low on the right, partly behind the deck
  const px = 1240
  const py = 610
  const pr = 280
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
  glow(g, px, py, pr * 1.25, 'rgba(0,0,0,0)', 'rgba(0,0,0,0)')
  g.strokeStyle = 'rgba(255,214,170,.55)'
  g.lineWidth = 10
  g.beginPath()
  g.ellipse(px, py, pr * 1.75, pr * 0.32, -0.22, Math.PI * 1.02, Math.PI * 1.98)
  g.stroke()
  g.strokeStyle = 'rgba(255,214,170,.25)'
  g.lineWidth = 26
  g.stroke()
  return done(c)
}

function deckFloor() {
  const [c, g] = canvas(256, 256)
  g.fillStyle = '#1a1f2e'
  g.fillRect(0, 0, 256, 256)
  g.fillStyle = '#20273a'
  g.fillRect(6, 6, 116, 116)
  g.fillRect(134, 134, 116, 116)
  g.fillStyle = '#171c2a'
  g.fillRect(134, 6, 116, 116)
  g.fillRect(6, 134, 116, 116)
  g.strokeStyle = 'rgba(79,216,255,.35)'
  g.lineWidth = 2
  g.strokeRect(1, 1, 254, 254)
  g.fillStyle = 'rgba(79,216,255,.5)'
  for (const [x, y] of [[10, 10], [246, 10], [10, 246], [246, 246]]) g.fillRect(x - 2, y - 2, 4, 4)
  return done(c, 10)
}

// ── registry ─────────────────────────────────────────────────────────────
export const DEFAULT_LOBBY = 'lobby:rooftop'

export const THEMES = {
  'lobby:rooftop': {
    name: 'Rooftop dusk',
    sky: () => skyTexture(),
    fog: { color: HORIZON_FOG, near: 7, far: 22 },
    floor: { map: () => gridTexture(), size: 80, roughness: 0.55, metalness: 0.3 },
    hemi: ['#a9b8ff', '#1a1030', 0.7],
    key: ['#ffe3c2', 2.1],
    rimLeft: ['#4fd8ff', 2.6],
    rimRight: ['#ff4fa3', 2.0],
    front: ['#9fb0ff', 0.5],
    motes: { color: '#ffd9a8', size: 0.07, speed: 0.12, count: 140 },
  },
  'lobby:synthwave': {
    name: 'Synthwave',
    sky: () => once('synthwave', synthwaveSky),
    fog: { color: '#2a0638', near: 7, far: 24 },
    floor: { map: () => once('synthwave-floor', synthwaveFloor), size: 80, roughness: 0.4, metalness: 0.4 },
    hemi: ['#ff9ad8', '#14021f', 0.6],
    key: ['#ffd6f2', 1.9],
    rimLeft: ['#2de2e6', 2.8],
    rimRight: ['#ff2975', 2.6],
    front: ['#b28cff', 0.5],
    motes: { color: '#ff7ad1', size: 0.06, speed: 0.18, count: 120 },
  },
  'lobby:beach': {
    name: 'Moonlit beach',
    sky: () => once('beach', beachSky),
    fog: { color: '#0b2340', near: 9, far: 26 },
    floor: { map: () => once('beach-floor', beachFloor), size: 14, roughness: 0.85, metalness: 0.05, edge: '#3a2a20' },
    hemi: ['#9fc4ff', '#0a1220', 0.75],
    key: ['#d8e6ff', 1.7],
    rimLeft: ['#4fd8ff', 2.0],
    rimRight: ['#ffb36b', 2.2],
    front: ['#ffcf99', 0.45],
    motes: { color: '#ffe9a0', size: 0.06, speed: 0.05, count: 60 },
  },
  'lobby:aurora': {
    name: 'Aurora peaks',
    sky: () => once('aurora', auroraSky),
    fog: { color: '#122a42', near: 8, far: 24 },
    floor: { map: () => once('snow-floor', snowFloor), size: 80, roughness: 0.95, metalness: 0 },
    hemi: ['#cfe8ff', '#0b1a2b', 0.8],
    key: ['#e6f6ff', 1.8],
    rimLeft: ['#3df2a0', 2.4],
    rimRight: ['#a77bff', 2.2],
    front: ['#b8d4ff', 0.45],
    motes: { color: '#ffffff', size: 0.08, speed: -0.45, count: 260 },   // falling snow
  },
  'lobby:station': {
    name: 'Orbital station',
    sky: () => once('station', stationSky),
    fog: { color: '#05061a', near: 10, far: 30 },
    floor: { map: () => once('deck-floor', deckFloor), size: 12, roughness: 0.35, metalness: 0.75, edge: '#4fd8ff', edgeGlow: true },
    hemi: ['#b9c8ff', '#05060f', 0.65],
    key: ['#eef4ff', 2.0],
    rimLeft: ['#4fd8ff', 2.6],
    rimRight: ['#ff9a4d', 2.4],
    front: ['#9fb0ff', 0.5],
    motes: { color: '#9fe6ff', size: 0.05, speed: 0.03, count: 90 },
  },
}

const thumbs = new Map()
/** Small 16:9 data-URL preview of a theme's sky, for inventory and shop tiles. */
export function themeThumb(itemId) {
  if (!thumbs.has(itemId)) {
    const [c, g] = canvas(192, 108)
    g.drawImage(themeFor(itemId).sky().image, 0, 0, 192, 108)
    thumbs.set(itemId, c.toDataURL('image/png'))
  }
  return thumbs.get(itemId)
}

/** Theme for an equipped `lobby:*` id (unknown → the rooftop). */
export function themeFor(itemId) {
  return THEMES[itemId] || THEMES[DEFAULT_LOBBY]
}
