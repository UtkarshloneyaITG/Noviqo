/**
 * Announcer — a "Your turn" banner across the screen when the turn switches
 * to you. Shows for ~2.4 seconds.
 */
import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import '../styles/table.css'

export default function Announcer() {
  const currentId = useAppStore((s) => (s.gameState?.status === 'playing' ? s.gameState.current_player_id : null))
  const playerId = useAppStore((s) => s.playerId)
  const [sub, setSub] = useState(null)
  const prevIdRef = useRef(null)
  const timerRef = useRef(null)

  useEffect(() => {
    if (!currentId) return
    const prev = prevIdRef.current
    prevIdRef.current = currentId

    // Only fire when the turn *changes* to me
    if (currentId === playerId && prev !== null && prev !== playerId) {
      const gs = useAppStore.getState().gameState
      let text = 'Play a matching card or draw from the deck.'
      if (gs?.challenge_available) {
        text = 'Draw the penalty, or challenge the Wild Draw 4 first.'
      } else if (gs?.draw_stack > 0) {
        text = `You must draw ${gs.draw_stack} card${gs.draw_stack > 1 ? 's' : ''} from the deck.`
      }
      setSub(text)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setSub(null), 2400)
    }
  }, [currentId, playerId])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  if (!sub) return null

  return (
    <div className="tb tb-announce" aria-live="assertive">
      <div className="tb-announce-band">
        <div className="tb-announce-title">Your turn</div>
        <div className="tb-announce-sub">{sub}</div>
      </div>
    </div>
  )
}
