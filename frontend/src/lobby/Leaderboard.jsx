/**
 * Leaderboard — top 50 by ranked points or by wins, worldwide or among your
 * friends. Your own row is highlighted, or pinned under the list when you
 * aren't in the top 50. Asks the server afresh each time a tab changes.
 */
import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { Avatar, Crest, Modal, rankColor } from './ui'

const BOARDS = [['rp', 'Ranked points'], ['wins', 'Wins']]
const SCOPES = [['global', 'Global'], ['friends', 'Friends']]

function Seg({ label, options, value, onChange }) {
  return (
    <div className="lb-seg" role="tablist" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} role="tab" aria-selected={value === id} className={value === id ? 'act' : ''} onClick={() => onChange(id)}>
          {text}
        </button>
      ))}
    </div>
  )
}

function Row({ r, board, mine }) {
  return (
    <li className={mine ? 'me' : ''} aria-current={mine || undefined}>
      <span className="pl">{r.place ?? '–'}</span>
      <Avatar character={r.character} />
      <span className="who">
        <b>{r.display_name}</b>
        <small>{r.username}</small>
      </span>
      <span className="rk">
        <Crest color={rankColor(r.rank_label)} />
        {r.rank_label}
      </span>
      <span className="val">{board === 'rp' ? `${r.rp} RP` : `${r.wins} ${r.wins === 1 ? 'win' : 'wins'}`}</span>
    </li>
  )
}

export default function Leaderboard({ onClose }) {
  const [board, setBoard] = useState('rp')
  const [scope, setScope] = useState('global')
  const data = useAppStore((s) => s.leaderboard)
  const send = useAppStore((s) => s.send)
  useEffect(() => {
    send('leaderboard', { board, scope })
  }, [board, scope, send])

  const ready = data && data.board === board && data.scope === scope
  const listed = ready && data.rows.some((r) => r.id === data.me.id)

  return (
    <Modal title="Leaderboard" onClose={onClose} className="lb-dialog--wide">
      <div className="lb-lead-tabs">
        <Seg label="Rank by" options={BOARDS} value={board} onChange={setBoard} />
        <Seg label="Players" options={SCOPES} value={scope} onChange={setScope} />
      </div>
      {!ready ? (
        <p className="lb-note">Loading…</p>
      ) : data.rows.length ? (
        <ol className="lb-lead">
          {data.rows.map((r) => (
            <Row key={r.id} r={r} board={board} mine={r.id === data.me.id} />
          ))}
        </ol>
      ) : (
        <p className="lb-note">No one is on this board yet. Finish a game to get on it.</p>
      )}
      {ready && !listed && (
        <ol className="lb-lead lb-lead--me" aria-label="Your place">
          <Row r={data.me} board={board} mine />
        </ol>
      )}
    </Modal>
  )
}
