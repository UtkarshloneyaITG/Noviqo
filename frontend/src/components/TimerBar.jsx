/**
 * TimerBar — top-centre turn countdown: whose turn it is, the seconds left
 * and a depleting bar. The server owns the clock (15/30/60s per room,
 * 2-card penalty at zero); each new turn clock arrives with `turn_ms_left`,
 * so a reconnecting client shows the real time left.
 */
import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../store/appStore'
import '../styles/table.css'

export default function TimerBar() {
  const status = useAppStore((s) => s.gameState?.status)
  const currentId = useAppStore((s) => s.gameState?.current_player_id)
  const deadline = useAppStore((s) => s.gameState?.turn_deadline)
  const msLeft = useAppStore((s) => s.gameState?.turn_ms_left)
  const turnSeconds = useAppStore((s) => s.gameState?.settings?.turn_seconds ?? 30)
  const name = useAppStore((s) => s.gameState?.players?.find((p) => p.id === s.gameState?.current_player_id)?.name ?? '')
  const playerId = useAppStore((s) => s.playerId)
  const resetKey = `${currentId}-${deadline ?? ''}`

  // Snapshot when a new turn clock arrives: local end time + how far into
  // the turn we already are (negative delay starts the CSS bar mid-way).
  // turn_ms_left is relative, so client/server clock skew doesn't matter.
  const clock = useMemo(() => {
    const ms = msLeft ?? turnSeconds * 1000
    return { end: Date.now() + ms, delay: ms / 1000 - turnSeconds }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (status !== 'playing') return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [status])

  if (status !== 'playing') return null

  // The first turn's clock also covers the 3-2-1, so cap at a full turn (the bar waits full).
  const left = Math.min(turnSeconds, Math.max(0, Math.ceil((clock.end - now) / 1000)))
  const isMyTurn = currentId === playerId

  return (
    <div className={`tb tb-panel tb-timer${left <= 3 ? ' tb-timer--danger' : ''}${isMyTurn ? ' tb-timer--mine' : ''}`}>
      <div className="tb-timer-top">
        <span className="tb-timer-who">{isMyTurn ? 'Your turn' : `${name}'s turn`}</span>
        <span className="tb-timer-secs">{left}s</span>
      </div>
      <div className="tb-timer-track">
        {/* key restarts the CSS deplete animation on each new turn/action */}
        <div
          key={resetKey}
          className="tb-timer-fill"
          style={{ animationDuration: `${turnSeconds}s`, animationDelay: `${clock.delay}s` }}
        />
      </div>
    </div>
  )
}
