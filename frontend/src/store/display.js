/**
 * Display settings: graphics quality, a frame-rate cap and an FPS counter.
 * Saved on this device (localStorage 'nq.gfx'); not account data, so the
 * server never sees them. Experience.jsx applies them to the one Canvas.
 *
 *   quality  'auto' (adapts to the device) | 'high' | 'medium' | 'low'
 *   fps      0 = the screen's own rate, else 30 or 60
 *   showFps  small counter in the corner
 */
import { create } from 'zustand'

const KEY = 'nq.gfx'

/** What each fixed level turns on. 'auto' starts at high and steps down by itself. */
export const QUALITY = {
  high: { dpr: 1.5, fx: true, shadows: true, motion: true, particles: 1 },
  medium: { dpr: 1, fx: true, shadows: true, motion: true, particles: 1 },
  low: { dpr: 1, fx: false, shadows: false, motion: false, particles: 0.5 },
}
const DEFAULTS = { quality: 'auto', fps: 0, showFps: false }

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}')
    return {
      quality: v.quality in QUALITY ? v.quality : 'auto',
      fps: [0, 30, 60].includes(v.fps) ? v.fps : 0,
      showFps: v.showFps === true,
    }
  } catch {
    return { ...DEFAULTS } // private mode or a bad value: defaults
  }
}

export const useDisplay = create((set, get) => ({
  ...load(),
  setDisplay(patch) {
    set(patch)
    const { quality, fps, showFps } = get()
    try {
      localStorage.setItem(KEY, JSON.stringify({ quality, fps, showFps }))
    } catch {
      /* private mode: this visit only */
    }
  },
}))

/** For per-frame code (no re-render): should backgrounds hold still? */
export const stillBackgrounds = () => useDisplay.getState().quality === 'low'
