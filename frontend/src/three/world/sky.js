/**
 * Shared environment textures for the lobby and the table: a dusk sky with a
 * lit city skyline, a faint floor grid, and a soft round glow sprite.
 * Each texture is built once (procedurally, no image assets) and cached.
 */
import * as THREE from 'three'

let sky = null
let grid = null
let glow = null

/** Screen-space dusk sky; set as scene.background. Horizon sits at ~55% height. */
export function skyTexture() {
  if (sky) return sky
  const W = 1600
  const H = 900
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  const grad = g.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, '#080a24')
  grad.addColorStop(0.3, '#1d1650')
  grad.addColorStop(0.43, '#55246e')
  grad.addColorStop(0.5, '#c4456f')
  grad.addColorStop(0.535, '#ff8a5a')
  grad.addColorStop(0.56, '#2a1640')
  grad.addColorStop(1, '#140f2c')
  g.fillStyle = grad
  g.fillRect(0, 0, W, H)
  const sun = g.createRadialGradient(820, 480, 10, 820, 480, 420)
  sun.addColorStop(0, 'rgba(255,214,150,.95)')
  sun.addColorStop(0.12, 'rgba(255,150,100,.55)')
  sun.addColorStop(0.5, 'rgba(255,90,120,.12)')
  sun.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = sun
  g.fillRect(0, 0, W, H)
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.7})`
    g.fillRect(Math.random() * W, Math.random() * 330, 1.6, 1.6)
  }
  const horizon = 492
  const layer = (color, minH, maxH, wMin, wMax, lit) => {
    let x = -20
    while (x < W + 20) {
      const w = wMin + Math.random() * (wMax - wMin)
      const h = minH + Math.random() * (maxH - minH)
      g.fillStyle = color
      g.fillRect(x, horizon - h, w, h + 6)
      if (Math.random() < 0.25) g.fillRect(x + w * 0.45, horizon - h - 18, 3, 18)
      if (lit) {
        for (let wy = horizon - h + 8; wy < horizon - 4; wy += 9) {
          for (let wx = x + 5; wx < x + w - 5; wx += 8) {
            if (Math.random() < 0.22) {
              g.fillStyle = Math.random() < 0.8 ? 'rgba(255,200,120,.85)' : 'rgba(110,220,255,.85)'
              g.fillRect(wx, wy, 3, 4)
              g.fillStyle = color
            }
          }
        }
      }
      x += w + Math.random() * 6
    }
  }
  layer('#3b2056', 40, 120, 40, 90, false)
  layer('#22163e', 30, 190, 50, 110, true)
  const haze = g.createLinearGradient(0, horizon - 60, 0, horizon + 8)
  haze.addColorStop(0, 'rgba(255,120,120,0)')
  haze.addColorStop(1, 'rgba(255,120,140,.25)')
  g.fillStyle = haze
  g.fillRect(0, horizon - 60, W, 68)
  sky = new THREE.CanvasTexture(c)
  sky.colorSpace = THREE.SRGBColorSpace
  return sky
}

/** Fog colour that blends the floor's far edge into the skyline base. */
export const HORIZON_FOG = 0x24163c

/** Dark floor tile with a faint cyan grid line; repeat set for an 80×80 plane. */
export function gridTexture() {
  if (grid) return grid
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')
  g.fillStyle = '#191433'
  g.fillRect(0, 0, 256, 256)
  g.strokeStyle = 'rgba(79,216,255,.22)'
  g.lineWidth = 2
  g.strokeRect(1, 1, 254, 254)
  grid = new THREE.CanvasTexture(c)
  grid.wrapS = grid.wrapT = THREE.RepeatWrapping
  grid.repeat.set(40, 40)
  grid.anisotropy = 8
  grid.colorSpace = THREE.SRGBColorSpace
  return grid
}

/** White radial falloff; tint it with a material colour for glows and particles. */
export function glowTexture() {
  if (glow) return glow
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  r.addColorStop(0, 'rgba(255,255,255,1)')
  r.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = r
  g.fillRect(0, 0, 128, 128)
  glow = new THREE.CanvasTexture(c)
  glow.colorSpace = THREE.SRGBColorSpace
  return glow
}

/** Up-light beam material (additive, fades upward). Use on an open CylinderGeometry. */
export function beamMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { c: { value: new THREE.Color(color) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 c; varying vec2 vUv; void main(){ float a = pow(1.0 - vUv.y, 2.2) * 0.32; gl_FragColor = vec4(c * a, a); }',
  })
}

/** UI palette shared with CSS (keep in sync with styles/lobby.css tokens). */
export const PALETTE = {
  cyan: '#4fd8ff',
  amber: '#ffc53d',
  amber2: '#ff8a1e',
  red: '#ff3f5f',
  green: '#3df2a0',
  text: '#eef3ff',
  muted: '#8e9bc0',
}
