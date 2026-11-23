/**
 * SeatCard — one player at the table: name, a bar in their seat colour, and
 * four pips for their pawns (outlined = at home, filled = on the board, gold
 * = home at the centre). Glows while it's their turn; shows their place once
 * they've finished. Used over each seated opponent (three/route) and for you
 * in the corner (RouteHud).
 */
import { COLOUR_HEX } from './info'

const ORDINAL = ['', '1st', '2nd', '3rd', '4th']

export default function SeatCard({ seat, acting, you = false }) {
  const pips = [...Array(seat.finished).fill('done'), ...Array(seat.active).fill('out'), ...Array(seat.home).fill('home')]
  return (
    <div className={`rt-card ${acting ? 'acting' : ''} ${seat.left || !seat.connected ? 'away' : ''}`} style={{ '--seat': COLOUR_HEX[seat.colour] }}>
      <div className="nm">
        <b>{you ? 'You' : seat.name}</b>
        {seat.bot && <small>bot</small>}
        {seat.place && <em>{ORDINAL[seat.place]}</em>}
      </div>
      <div className="pips" aria-label={`${seat.home} at home, ${seat.active} on the board, ${seat.finished} finished`}>
        {pips.map((p, i) => (
          <i key={i} className={p} />
        ))}
      </div>
    </div>
  )
}
