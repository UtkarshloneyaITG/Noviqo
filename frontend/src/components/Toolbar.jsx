/**
 * Toolbar — top-left in-game HUD: the game chip (with casual/ranked), the
 * play direction in words, and the Leave button. Whose turn it is lives in
 * the TimerBar.
 */
import { useAppStore } from '../store/appStore'
import '../styles/table.css'

export default function Toolbar() {
  const playing = useAppStore((s) => s.gameState?.status === 'playing')
  const mode = useAppStore((s) => s.gameState?.mode)
  const direction = useAppStore((s) => s.gameState?.direction)
  const leaveRoom = useAppStore((s) => s.leaveRoom)
  if (!playing) return null

  const ccw = direction === -1
  return (
    <div className="tb tb-bar">
      <div className="tb-panel tb-chip">
        <span className="tb-game">UNO</span>
        {mode && <span className={`tb-mode tb-mode--${mode}`}>{mode === 'ranked' ? 'Ranked' : 'Casual'}</span>}
      </div>
      <div className={`tb-panel tb-chip tb-dir${ccw ? ' tb-dir--ccw' : ''}`} role="status">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 12a8 8 0 1 1-2.34-5.66" />
          <path d="M20 4v4h-4" />
        </svg>
        <span>{ccw ? 'Counter-clockwise' : 'Clockwise'}</span>
      </div>
      <button className="tb-panel tb-btn tb-leave" onClick={leaveRoom}>
        Leave
      </button>
    </div>
  )
}
