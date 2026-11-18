/**
 * Participant3D — one opponent: their equipped character seated at the
 * table holding their cards, and one floating HTML label above the head in
 * the lobby's name-tag style (name, card count, turn / UNO / finished /
 * offline status, a "Catch" button when they fail to call UNO, and their
 * chat bubble on top).
 */
import { memo, useState, useEffect } from 'react'
import { Html } from '@react-three/drei'
import { useAppStore } from '../store/appStore'
import Avatar3D from './Avatar3D'
import { FIGURE_H, FLOOR_Y } from './layout'

const TAG_Y = FLOOR_Y + FIGURE_H * 0.86 // just above a seated head

function Participant3D({ player, seat, hue = 200, isCurrentTurn, dealing = false }) {
  const playerId = useAppStore((s) => s.playerId)
  const catchUno = useAppStore((s) => s.catchUno)
  const playing = useAppStore((s) => s.gameState?.status === 'playing')
  const bubble = useAppStore((s) => s.bubbles?.[player.id])
  const [showCatch, setShowCatch] = useState(false)

  const cardCount = player.card_count ?? 0
  const isOffline = !player.is_connected
  const hasUno = player.has_called_uno
  const canCatch = playing && cardCount === 1 && !hasUno && player.id !== playerId

  // Offer the catch a beat after they drop to one card without calling.
  useEffect(() => {
    setShowCatch(false)
    if (!canCatch) return
    const id = setTimeout(() => setShowCatch(true), 1000)
    return () => clearTimeout(id)
  }, [canCatch])

  const status = hasUno
    ? ['uno', 'UNO']
    : isOffline
    ? ['off', 'Offline']
    : player.rank
    ? ['done', 'Finished']
    : isCurrentTurn
    ? ['turn', 'Playing now']
    : null

  return (
    <group>
      <Avatar3D
        seat={seat}
        hue={hue}
        active={isCurrentTurn}
        offline={isOffline}
        count={dealing ? 0 : cardCount}
        character={player.character}
        playerId={player.id}
        back={player.card_back}
      />

      <Html position={[seat.x, TAG_Y, seat.z]} center distanceFactor={11}>
        <div
          className={`tb t3-tag${isCurrentTurn ? ' t3-tag--turn' : ''}${isOffline ? ' t3-tag--off' : ''}`}
          style={{ '--tc': isOffline ? '#4a5170' : `hsl(${hue}, 85%, 62%)` }}
        >
          {bubble && (
            <div key={bubble.key} className="t3-bubble">
              {bubble.text}
            </div>
          )}
          <div className="t3-plate">
            <span className="t3-name">{player.name}</span>
            <span className="t3-count" title={`${cardCount} card${cardCount === 1 ? '' : 's'}`}>
              {cardCount}
            </span>
          </div>
          {status && <div className={`t3-st t3-st--${status[0]}`}>{status[1]}</div>}
          {showCatch && (
            <button className="t3-catch" onClick={() => catchUno(player.id)}>
              Catch
            </button>
          )}
        </div>
      </Html>
    </group>
  )
}

export default memo(Participant3D)
