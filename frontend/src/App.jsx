/**
 * App — root component.
 *
 * Everything lives inside one 3D world (React Three Fiber, <Experience/>):
 * the lobby rooftop when not in a game, the table during one. Screen-space
 * HUD is layered on top: the lobby HUD (sign-in, party, friends, chat…) or
 * the in-game HUD (turn flash, hints, colour picker, game over, toasts).
 *
 * The PythonDocs camouflage gate is intentionally left as a plain webpage.
 */

import React, { useState, useEffect } from 'react'
import { useAppStore } from './store/appStore'
import { useWebSocket } from './hooks/useWebSocket'
import Experience from './three/Experience'
import Lobby from './lobby/Lobby'
import Toolbar from './components/Toolbar'
import ChatBar from './components/ChatBar'
import TimerBar from './components/TimerBar'
import Countdown from './components/Countdown'
import HintBar from './components/HintBar'
import Announcer from './components/Announcer'
import ColorPicker from './components/ColorPicker'
import Summary from './components/Summary'
import PythonDocs from './components/PythonDocs'
import RolesHud from './roles/RolesHud'
import { useDisplay } from './store/display'

// Hold the Game Over modal back briefly so the in-scene 3D win moment
// (confetti over the table) reads first.
const SUMMARY_DELAY_MS = 1800

export default function App() {
  const [unlocked, setUnlocked] = useState(false)
  const [showSummary, setShowSummary] = useState(false)

  useWebSocket()

  // Narrow selectors: chat lines, bubbles and timer ticks must not re-render
  // the root (and with it the whole HUD).
  const status = useAppStore((s) => s.gameState?.status)
  const inRoles = useAppStore((s) => !!s.rolesState) // at a Raja Mantri Chor Sipahi table
  const isConnected = useAppStore((s) => s.isConnected)
  const showColorPicker = useAppStore((s) => s.showColorPicker)
  const error = useAppStore((s) => s.error)
  const notification = useAppStore((s) => s.notification)
  const showFps = useDisplay((s) => s.showFps)

  const isFinished = status === 'finished'
  const inGame = status === 'playing' || isFinished

  useEffect(() => {
    if (!isFinished) {
      setShowSummary(false)
      return
    }
    const id = setTimeout(() => setShowSummary(true), SUMMARY_DELAY_MS)
    return () => clearTimeout(id)
  }, [isFinished])

  // Phones and tablets play full screen, locked sideways. Browsers only allow
  // that from a tap: the unlock tap counts, and any later tap re-enters if the
  // player left full screen. (iPhone Safari has no full-screen API for pages.)
  useEffect(() => {
    if (!unlocked || !matchMedia('(pointer: coarse)').matches) return
    const go = () => {
      const el = document.documentElement
      const request = el.requestFullscreen || el.webkitRequestFullscreen
      if (document.fullscreenElement || document.webkitFullscreenElement || !request) return
      Promise.resolve(request.call(el, { navigationUI: 'hide' }))
        .then(() => screen.orientation?.lock?.('landscape'))
        .catch(() => {})
    }
    go()
    addEventListener('pointerup', go)
    return () => removeEventListener('pointerup', go)
  }, [unlocked])

  if (!unlocked) return <PythonDocs onUnlock={() => setUnlocked(true)} />

  return (
    <div className="app app--3d">
      {/* ── 3D world (lobby + table) ───────────────────────────────── */}
      <div className="canvas-root">
        <Experience />
      </div>
      {/* Settings → Graphics → Show FPS; Experience's FpsProbe writes the number. */}
      {showFps && <div id="nq-fps" className="fps-badge" aria-hidden="true" />}

      {/* Phones play sideways; CSS shows this only on narrow portrait screens. */}
      <div className="rotate-hint">
        <svg viewBox="0 0 64 64" width="72" height="72" aria-hidden="true">
          <rect x="22" y="8" width="20" height="36" rx="4" fill="none" stroke="currentColor" strokeWidth="3" />
          <path d="M14 50a20 20 0 0 0 30 4m0 0v-7m0 7h-7" fill="none" stroke="#ffc53d" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <p>Turn your phone sideways to play</p>
      </div>

      {/* ── Screen-space HUD / overlays ────────────────────────────── */}
      {inRoles ? (
        <RolesHud />
      ) : !inGame ? (
        <Lobby />
      ) : (
        <>
          {!isConnected && (
            <div className="banner banner--offline">
              <span className="spinner spinner--banner" aria-hidden="true" />
              Reconnecting to your game…
            </div>
          )}

          {error && <div className="toast toast--error">{error}</div>}
          {notification && <div className="toast toast--info">{notification}</div>}

          <Toolbar />
          <TimerBar />
          <HintBar />
          <ChatBar />
          <Announcer />
          <Countdown />

          {showColorPicker && <ColorPicker />}

          {isFinished && showSummary && <GameSummary />}
        </>
      )}
    </div>
  )
}

// Reads the finished game's winner only once the summary is due.
function GameSummary() {
  const winner = useAppStore((s) => s.gameState?.winner)
  const winnerId = useAppStore((s) => s.gameState?.winner_id)
  const myId = useAppStore((s) => s.playerId)
  return <Summary winner={winner} winnerId={winnerId} myId={myId} />
}
