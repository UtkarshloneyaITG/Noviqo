/**
 * TimerBar — top-of-screen turn countdown shown as a depleting loading bar
 * plus the seconds remaining and whose turn it is. The server owns the clock
 * (15/30/60s per room, 2-card penalty at zero); each new turn clock arrives
 * with `turn_ms_left`, so a reconnecting client shows the real time left.
 */
import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../store/appStore'

export default function TimerBar() {
  const { gameState, playerId } = useAppStore()
  const status = gameState?.status
  const currentId = gameState?.current_player_id
  const deadline = gameState?.turn_deadline
  const resetKey = `${currentId}-${deadline ?? ''}`
  const turnSeconds = gameState?.settings?.turn_seconds ?? 30

  // Snapshot when a new turn clock arrives: local end time + how far into
  // the turn we already are (negative delay starts the CSS bar mid-way).
  // turn_ms_left is relative, so client/server clock skew doesn't matter.
  const clock = useMemo(() => {
    const ms = gameState?.turn_ms_left ?? turnSeconds * 1000
    return { end: Date.now() + ms, delay: ms / 1000 - turnSeconds }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (status !== 'playing') return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [status])

  if (!gameState || status !== 'playing') return null

  const left = Math.max(0, Math.ceil((clock.end - now) / 1000))
  const isMyTurn = currentId === playerId
  const name = gameState.players?.find((p) => p.id === currentId)?.name ?? ''
  const danger = left <= 3

  return (
    <div className={`timerbar ${danger ? 'timerbar--danger' : ''} ${isMyTurn ? 'timerbar--mine' : ''}`}>
      <div className="timerbar-top">
        <span className="timerbar-label">{isMyTurn ? '✦ Your turn' : `${name}'s turn`}</span>
        <span className="timerbar-secs">{left}s</span>
      </div>
      <div className="timerbar-track">
        {/* key restarts the CSS deplete animation on each new turn/action */}
        <div
          key={resetKey}
          className="timerbar-fill"
          style={{ animationDuration: `${turnSeconds}s`, animationDelay: `${clock.delay}s` }}
        />
      </div>
    </div>
  )
}
