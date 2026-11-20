/**
 * Lobby backgrounds: one entry per `lobby:*` inventory item.
 *
 * Each theme is data: a painted scene (./scenes, drawn by SkyLayers.jsx), a
 * floor surface, fog, a light rig and a particle preset. Floor textures are
 * small tiles painted once and cached; no image assets.
 * LobbyBackdrop.jsx turns a theme into a scene.
 */
import * as THREE from 'three'
import { gridTexture, HORIZON_FOG } from './sky'
import { rng, flatCanvas, paintWidth } from './paint'
import rooftop from './scenes/rooftop'
import synthwave from './scenes/synthwave'
import beach from './scenes/beach'
import aurora from './scenes/aurora'
import station from './scenes/station'

const cache = new Map()

function canvas(w, h) {
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

// ── floor tiles ──────────────────────────────────────────────────────────
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

function snowFloor() {
  const [c, g] = canvas(256, 256)
  const rand = rng(9)
  g.fillStyle = '#6f86a3' // darker than the lights make it look: under the key light it reads as moonlit snow, not paper
  g.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 1600; i++) {
    const v = 120 + Math.floor(rand() * 60)
    g.fillStyle = `rgba(${v - 24},${v - 8},${v + 10},.35)`
    g.fillRect(rand() * 256, rand() * 256, 2, 2)
  }
  g.fillStyle = 'rgba(255,255,255,.95)' // sparkle
  for (let i = 0; i < 26; i++) g.fillRect(rand() * 256, rand() * 256, 1, 1)
  return done(c, 14)
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
// floor: `scroll` = texture repeats per second toward the camera; `pulse` = edge glow breathes.
// motes: `twinkle` 0..1 fades each one in and out; `drift` = metres of sideways sway.
export const DEFAULT_LOBBY = 'lobby:rooftop'

export const THEMES = {
  'lobby:rooftop': {
    name: 'Rooftop dusk',
    scene: rooftop,
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
    scene: synthwave,
    fog: { color: '#2a0638', near: 7, far: 24 },
    floor: { map: () => once('synthwave-floor', synthwaveFloor), size: 80, roughness: 0.4, metalness: 0.4, scroll: 0.35 },
    hemi: ['#ff9ad8', '#14021f', 0.6],
    key: ['#ffd6f2', 1.9],
    rimLeft: ['#2de2e6', 2.8],
    rimRight: ['#ff2975', 2.6],
    front: ['#b28cff', 0.5],
    motes: { color: '#ff7ad1', size: 0.06, speed: 0.18, count: 120 },
  },
  'lobby:beach': {
    name: 'Moonlit beach',
    scene: beach,
    fog: { color: '#0b2340', near: 9, far: 26 },
    floor: { map: () => once('beach-floor', beachFloor), size: 14, roughness: 0.85, metalness: 0.05, edge: '#3a2a20' },
    hemi: ['#9fc4ff', '#0a1220', 0.75],
    key: ['#d8e6ff', 1.7],
    rimLeft: ['#4fd8ff', 2.0],
    rimRight: ['#ffb36b', 2.2],
    front: ['#ffcf99', 0.45],
    motes: { color: '#ffe9a0', size: 0.06, speed: 0.05, count: 60, twinkle: 1, drift: 0.3 }, // fireflies
  },
  'lobby:aurora': {
    name: 'Aurora peaks',
    scene: aurora,
    fog: { color: '#122a42', near: 8, far: 24 },
    floor: { map: () => once('snow-floor', snowFloor), size: 80, roughness: 0.95, metalness: 0 },
    hemi: ['#cfe8ff', '#0b1a2b', 0.8],
    key: ['#e6f6ff', 1.8],
    rimLeft: ['#3df2a0', 2.4],
    rimRight: ['#a77bff', 2.2],
    front: ['#b8d4ff', 0.45],
    motes: { color: '#ffffff', size: 0.08, speed: -0.45, count: 260, drift: 0.15 }, // falling snow
  },
  'lobby:station': {
    name: 'Orbital station',
    scene: station,
    fog: { color: '#05061a', near: 10, far: 30 },
    floor: { map: () => once('deck-floor', deckFloor), size: 12, roughness: 0.35, metalness: 0.75, edge: '#4fd8ff', edgeGlow: true, pulse: true },
    hemi: ['#b9c8ff', '#05060f', 0.65],
    key: ['#eef4ff', 2.0],
    rimLeft: ['#4fd8ff', 2.6],
    rimRight: ['#ff9a4d', 2.4],
    front: ['#9fb0ff', 0.5],
    motes: { color: '#9fe6ff', size: 0.05, speed: 0.03, count: 90 },
  },
}

/** Theme for an equipped `lobby:*` id (unknown → the rooftop). */
export function themeFor(itemId) {
  return THEMES[itemId] || THEMES[DEFAULT_LOBBY]
}

const thumbs = new Map()
/** Small 16:9 data-URL preview of a background, for inventory and shop tiles. */
export function themeThumb(itemId) {
  if (!thumbs.has(itemId)) thumbs.set(itemId, flatCanvas(themeFor(itemId).scene, 192).toDataURL('image/png'))
  return thumbs.get(itemId)
}

/** The rooftop as one still picture, for the skyline around the game table (Room3D). */
export function flatSkyTexture() {
  return once('flat-rooftop', () => done(flatCanvas(rooftop, paintWidth(screen.width, screen.height, devicePixelRatio))))
}
