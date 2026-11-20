/**
 * Shared environment pieces for the lobby and the table: the rooftop floor
 * grid, a soft round glow sprite, the up-light beam and the UI palette.
 * (The painted skies live in ./scenes; see paint.js.)
 * Each texture is built once (procedurally, no image assets) and cached.
 */
import * as THREE from 'three'

let grid = null
let glow = null

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
