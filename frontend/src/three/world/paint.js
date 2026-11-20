/**
 * Background painting: the toolkit the scene modules in ./scenes paint with.
 *
 * Every scene paints in one logical 1600x900 space (horizon at y = 492, so it
 * lines up with the lobby camera and Room3D) onto canvases sized for the
 * screen. A scene is up to three layers plus a list of lights:
 *
 *   back    opaque: the sky and everything far          (backScale x paint width)
 *   mid     transparent, low-res, moved by the shader     (midScale, clouds / aurora)
 *   front   transparent silhouettes, only the rows in `band`
 *   lights  points the shader twinkles, flickers or blinks (stars, windows)
 *
 * SkyLayers.jsx turns the result into one full-screen quad + one Points draw.
 * flatCanvas() bakes everything into one still picture (shop thumbnails, the
 * table's skyline). No imports: node's test runner loads this file directly.
 */
export const W = 1600
export const H = 900
export const HORIZON = 492
export const STAR = 0
export const WINDOW = 1
export const BLINK = 2

/** Deterministic randomness, so a background looks the same on every visit. */
export function rng(seed) {
  let s = seed >>> 0
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296
}

export function vertical(g, stops, y0 = 0, y1 = H) {
  const grad = g.createLinearGradient(0, y0, 0, y1)
  for (const [at, color] of stops) grad.addColorStop(at, color)
  g.fillStyle = grad
  g.fillRect(-2, y0, W + 4, y1 - y0)
}

export function glow(g, x, y, r, inner, outer = 'rgba(0,0,0,0)') {
  const grad = g.createRadialGradient(x, y, 0, x, y, r)
  grad.addColorStop(0, inner)
  grad.addColorStop(1, outer)
  g.fillStyle = grad
  g.fillRect(x - r, y - r, r * 2, r * 2)
}

/** Jagged ridge from left to right, filled down to the base. */
export function ridge(g, rand, base, minH, maxH, step, fill) {
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

/** A blank canvas the same size and transform as `g`'s, for blurs and cut-outs. */
export function scratch(g) {
  const c = document.createElement('canvas')
  c.width = g.canvas.width
  c.height = g.canvas.height
  const s = c.getContext('2d')
  s.setTransform(g.getTransform())
  return s
}

/** Draw a scratch canvas back over `g` pixel for pixel. */
export function stamp(g, s, op = 'source-over', filter = 'none') {
  g.save()
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.globalCompositeOperation = op
  g.filter = filter === 'none' ? 'none' : filter.replace(/(\d+(\.\d+)?)px/g, (_, n) => `${n * (g.canvas.width / W)}px`)
  g.drawImage(s.canvas, 0, 0)
  g.restore()
}

/** Device px wide to paint at: the screen's long side at up to 1.5x density, 1280–2560 in 320 px steps. */
export function paintWidth(screenW, screenH, dpr) {
  const px = Math.max(screenW, screenH) * Math.min(dpr || 1, 1.5)
  return Math.min(2560, Math.max(1280, Math.ceil(px / 320) * 320))
}

function layer(width, scale, y0 = 0, y1 = H) {
  const k = (width / W) * scale
  const c = document.createElement('canvas')
  c.width = Math.round(W * k)
  c.height = Math.max(1, Math.round((y1 - y0) * k))
  const g = c.getContext('2d', { willReadFrequently: false })
  g.setTransform(k, 0, 0, k, 0, -y0 * k)
  return g
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
function linear(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLinear(v / 255))
}

function collect(rand) {
  const list = []
  const add = (x, y, size, color, mode, phase = rand()) => list.push({ x, y, size, color, mode, phase })
  return [list, add]
}

/**
 * Paint a scene for the live backdrop. Stars hidden behind the front layer
 * (or within 12 px of it, so swaying silhouettes don't uncover them) are dropped.
 */
export function paintScene(scene, width) {
  const rand = rng(scene.seed)
  const [list, add] = collect(rand)
  const back = layer(width, scene.backScale ?? 1)
  scene.back(back, rand, add)
  let mid = null
  if (scene.mid) {
    mid = layer(width, scene.midScale ?? 0.4)
    scene.mid(mid, rand)
  }
  let front = null
  const [y0, y1] = scene.band ?? [0, H]
  if (scene.front) {
    front = layer(width, 1, y0, y1)
    scene.front(front, rand, add)
  }

  let keep = list
  if (front) {
    const k = width / W
    const { data, width: fw, height: fh } = front.getImageData(0, 0, front.canvas.width, front.canvas.height)
    const solid = (x, y) => {
      const px = Math.round(x * k)
      const py = Math.round((y - y0) * k)
      return px >= 0 && py >= 0 && px < fw && py < fh && data[(py * fw + px) * 4 + 3] > 25
    }
    keep = list.filter((l) => l.mode !== STAR || ![[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12]].some(([dx, dy]) => solid(l.x + dx, l.y + dy)))
  }

  const pos = new Float32Array(keep.length * 3)
  const color = new Float32Array(keep.length * 3)
  const info = new Float32Array(keep.length * 3)
  keep.forEach((l, i) => {
    pos.set([l.x, l.y, 0], i * 3)
    color.set(linear(l.color), i * 3)
    info.set([l.size, l.phase, l.mode], i * 3)
  })
  return {
    back: back.canvas,
    mid: mid?.canvas ?? null,
    front: front?.canvas ?? null,
    band: [1 - y1 / H, 1 - y0 / H],
    lights: { pos, color, info, count: keep.length },
  }
}

/** The whole scene baked into one still picture `width` px wide (thumbnails, the table skyline). */
export function flatCanvas(scene, width) {
  const rand = rng(scene.seed)
  const [list, add] = collect(rand)
  const g = layer(width, 1)
  // Paint each layer on its own canvas so the order matches the live backdrop.
  scene.back(g, rand, add)
  scene.still?.(g, rand)
  if (scene.mid) {
    const m = scratch(g)
    scene.mid(m, rand)
    stamp(g, m)
  }
  const f = scene.front && scratch(g)
  if (f) scene.front(f, rand, add)
  const dots = (lights) => {
    for (const l of lights) {
      g.fillStyle = l.color
      if (l.mode === WINDOW) {
        g.fillRect(l.x - l.size / 2, l.y - l.size / 2, l.size, l.size)
        continue
      }
      g.globalAlpha = 0.85
      g.beginPath()
      g.arc(l.x, l.y, l.size / 2, 0, Math.PI * 2)
      g.fill()
      g.globalAlpha = 1
    }
  }
  dots(list.filter((l) => l.mode === STAR)) // stars behind the silhouettes…
  if (f) stamp(g, f)
  dots(list.filter((l) => l.mode !== STAR)) // …windows and blinkers on them
  return g.canvas
}
