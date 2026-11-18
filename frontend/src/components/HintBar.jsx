/**
 * HintBar — bottom-centre guidance strip that tells the player exactly what
 * they can / should do right now, with the matching action buttons
 * (Pass turn, Challenge, UNO) beside it.
 */
import { useAppStore } from '../store/appStore'
import '../styles/table.css'

function hintFor(gs, isMyTurn, name) {
  if (!isMyTurn) return ['idle', `${name}'s turn. Waiting for them to play.`]
  const n = gs.draw_stack
  const stacking = gs.settings?.stack_draw_cards
  if (n > 0 && gs.challenge_available) {
    return ['challenge', stacking
      ? `Wild Draw 4! Draw ${n}, stack your own +4 on top, or challenge a bluff.`
      : `Wild Draw 4! Draw ${n} from the deck, or challenge if you suspect a bluff.`]
  }
  if (n > 0) {
    return ['warning', stacking
      ? `Penalty! Stack another +2/+4 to pass it on, or draw ${n}.`
      : `Penalty! Draw ${n} card${n > 1 ? 's' : ''} from the deck.`]
  }
  if (gs.drawn_card_id) return ['action', 'You drew a card. Play it if it matches, or pass your turn.']
  if (gs.challenge_available) return ['challenge', 'Suspect a bluff? Challenge the Wild Draw 4 before drawing.']
  return ['action', 'Your turn. Play a card matching the colour or symbol, or tap the deck to draw.']
}

export default function HintBar() {
  const gameState = useAppStore((s) => s.gameState)
  const playerId = useAppStore((s) => s.playerId)
  const locked = useAppStore((s) => s.actionPending || s.connectionPhase !== 'online')
  const passTurn = useAppStore((s) => s.passTurn)
  const callUno = useAppStore((s) => s.callUno)
  const challengeWildFour = useAppStore((s) => s.challengeWildFour)

  if (!gameState || gameState.status !== 'playing') return null

  const isMyTurn = gameState.current_player_id === playerId
  const name = gameState.players?.find((p) => p.id === gameState.current_player_id)?.name ?? '…'
  const me = gameState.players?.find((p) => p.id === playerId)
  const [type, text] = hintFor(gameState, isMyTurn, name)
  const showPass = isMyTurn && !!gameState.drawn_card_id
  const showChallenge = isMyTurn && gameState.challenge_available
  const showUno = (gameState.my_hand?.length ?? 0) === 1 && !me?.has_called_uno

  return (
    <div className={`tb tb-panel tb-hint tb-hint--${type}`}>
      <span className="tb-hint-text" role="status" aria-live="polite">
        {text}
      </span>
      {(showPass || showChallenge || showUno) && (
        <div className="tb-actions">
          {showChallenge && (
            <button className="tb-btn tb-btn--red" disabled={locked} onClick={() => challengeWildFour()}>
              Challenge
            </button>
          )}
          {showPass && (
            <button className="tb-btn tb-btn--cyan" disabled={locked} onClick={passTurn}>
              Pass turn
            </button>
          )}
          {showUno && (
            <button className="tb-uno" onClick={callUno}>
              UNO
            </button>
          )}
        </div>
      )}
    </div>
  )
}
