/**
 * Summary — the game-over panel: your placement, what you earned (coins;
 * in ranked also the RP change and your new rank), anything newly unlocked,
 * the final standings, and Play again (host, or anyone if the host is
 * offline) / Back to lobby.
 */
import { useMemo } from 'react'
import { useAppStore } from '../store/appStore'
import { CARD_BACKS, FELTS, EMOTES } from '../items'
import { usePortrait } from '../three/world/characters'
import '../styles/table.css'

const PLACES = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th'] // max 7 players
const CONFETTI = ['#ffc53d', '#ff3f5f', '#4fd8ff', '#3df2a0', '#ff8a1e', '#c13cff']

/** 'char:w-SciFi' → 'Sci Fi', 'back:gold' → 'Gold card back', 'felt:violet' → 'Violet felt'. */
function itemName(id) {
  const [kind, key = ''] = id.split(':')
  const word = key.replace(/^[mw]-/, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2')
  const cap = word.charAt(0).toUpperCase() + word.slice(1)
  return { char: cap, back: `${cap} card back`, felt: `${cap} felt`, emotes: `${cap} emotes` }[kind] ?? cap
}

function Portrait({ id }) {
  const src = usePortrait(id)
  return <span className="tb-swatch">{src && <img src={src} alt="" />}</span>
}

function Swatch({ id }) {
  const kind = id.split(':')[0]
  if (kind === 'char') return <Portrait id={id} />
  if (kind === 'back' && CARD_BACKS[id]) {
    const b = CARD_BACKS[id]
    return <span className="tb-swatch tb-swatch--back" style={{ '--b': b.base, '--e': b.ellipse, '--w': b.word }} />
  }
  if (kind === 'felt' && FELTS[id]) return <span className="tb-swatch tb-swatch--felt" style={{ '--f': FELTS[id] }} />
  return <span className="tb-swatch">{EMOTES[id]?.[0] ?? '★'}</span>
}

function Coin() {
  return (
    <svg className="tb-coin" viewBox="0 0 22 22" aria-hidden="true">
      <defs>
        <linearGradient id="tb-coin-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe28a" />
          <stop offset="1" stopColor="#d0861c" />
        </linearGradient>
      </defs>
      <circle cx="11" cy="11" r="10" fill="url(#tb-coin-g)" />
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="#8a5212" strokeWidth="1.5" />
    </svg>
  )
}

export default function Summary({ winner, winnerId, myId }) {
  const gameState = useAppStore((s) => s.gameState)
  const leaveRoom = useAppStore((s) => s.leaveRoom)
  const rematch = useAppStore((s) => s.rematch)

  const placements = gameState?.placements || []
  const isHost = gameState?.host_player_id === myId
  // The server hands the room to whoever asks if the host has gone offline,
  // so offer the button to everyone then — otherwise the room dead-ends.
  const hostOnline = gameState?.players?.find((p) => p.id === gameState?.host_player_id)?.is_connected
  const canRematch = isHost || !hostOnline
  const roundPoints = gameState?.last_round_points ?? 0
  const scoreById = useMemo(() => {
    const map = {}
    for (const p of gameState?.players || []) map[p.id] = p.score ?? 0
    return map
  }, [gameState?.players])
  const hasScores = Object.values(scoreById).some((s) => s > 0)

  // Fallback: if no placements data, build a minimal one from winner
  const rankings = placements.length > 0 ? placements : winner ? [{ rank: 1, name: winner, id: winnerId }] : []

  const reward = gameState?.rewards?.[myId]
  const ranked = gameState?.mode === 'ranked'
  const myRank = reward?.placement ?? rankings.find((p) => p.id === myId)?.rank ?? null
  const isWinner = myRank === 1 || winnerId === myId

  const confetti = useMemo(() => {
    if (!isWinner) return []
    return Array.from({ length: 50 }, (_, i) => ({
      left: `${(i * 37) % 100}%`,
      delay: `${((i * 0.07) % 1.6).toFixed(2)}s`,
      duration: `${(1.6 + ((i * 0.11) % 1.5)).toFixed(2)}s`,
      color: CONFETTI[i % CONFETTI.length],
      size: 5 + ((i * 4) % 9),
    }))
  }, [isWinner])

  const title = myRank === 1 ? 'Victory' : myRank ? `${PLACES[myRank - 1]} place` : `${winner} wins`
  const sub = myRank === 1
    ? 'You emptied your hand first.'
    : myRank === 2
    ? 'So close. A strong showing.'
    : 'Fortune may favour you next game.'

  return (
    <div className="tb tb-modal">
      {isWinner && (
        <div className="tb-confetti" aria-hidden="true">
          {confetti.map((p, i) => (
            <i
              key={i}
              style={{
                left: p.left,
                width: p.size,
                height: p.size * 1.6,
                background: p.color,
                animationDuration: p.duration,
                animationDelay: p.delay,
              }}
            />
          ))}
        </div>
      )}
      <div className="tb-panel tb-card" role="dialog" aria-modal="true" aria-labelledby="tb-over-title">
        {myRank && <div className={`tb-place${myRank === 1 ? ' tb-place--win' : ''}`}>{PLACES[myRank - 1]}</div>}
        <h2 id="tb-over-title" className="tb-title">
          {title}
        </h2>
        {gameState?.rounds_played > 1 && <div className="tb-sub">Round {gameState.rounds_played}</div>}
        <p className="tb-sub">{sub}</p>

        {reward && (
          <div className="tb-rewards">
            <div className="tb-reward">
              <Coin />
              <b>+{reward.coins ?? 0}</b>
              <small>coins</small>
            </div>
            {ranked && (
              <div className={`tb-reward tb-reward--rp${reward.rp < 0 ? ' tb-reward--loss' : ''}`}>
                <b>
                  {reward.rp > 0 ? '+' : ''}
                  {reward.rp ?? 0}
                </b>
                <small>RP</small>
              </div>
            )}
            {ranked && reward.rank_label && (
              <div className="tb-reward tb-reward--rank">
                <b>{reward.rank_label}</b>
              </div>
            )}
          </div>
        )}

        {reward?.unlocked?.length > 0 && (
          <div className="tb-unlocks">
            <h3>Unlocked</h3>
            {reward.unlocked.map((id) => (
              <div key={id} className="tb-unlock">
                <Swatch id={id} />
                <span>{itemName(id)}</span>
              </div>
            ))}
          </div>
        )}

        {rankings.length > 1 && (
          <div className="tb-ranks">
            {rankings.map((p) => (
              <div key={p.id} className={`tb-rank${p.id === myId ? ' tb-rank--me' : ''}`}>
                <span className="tb-rank-pos">{PLACES[p.rank - 1]}</span>
                <span className="tb-rank-name">
                  {p.name}
                  {p.id === myId && <em>you</em>}
                </span>
                {hasScores && (
                  <span className="tb-rank-pts">
                    {p.rank === 1 && roundPoints > 0 && <b>+{roundPoints}</b>}
                    {scoreById[p.id] ?? 0} pts
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="tb-buttons">
          {canRematch && (
            <button className="tb-btn tb-btn--go tb-btn--big" onClick={rematch}>
              Play again
            </button>
          )}
          <button className="tb-btn tb-btn--ghost" onClick={leaveRoom}>
            Back to lobby
          </button>
        </div>
        {!canRematch && <p className="tb-wait">Waiting for the host to start a rematch</p>}
      </div>
    </div>
  )
}
