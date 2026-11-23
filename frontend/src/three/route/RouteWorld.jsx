/**
 * RouteWorld — the Ang Mang Chok Chang table: the same rooftop, table and
 * first-person seat as the other games, with the carved board (Board3D) on
 * the table turned so your home is nearest you, the 16 pawns (Pawns3D), the
 * four cowrie shells (Shells3D), and the other three players seated at their
 * own side of the board (by the board, not by turn order), each under a name
 * tag in their seat colour; the player to act has the turn beam.
 */
import { Html } from '@react-three/drei'
import { useAppStore } from '../../store/appStore'
import Room3D from '../Room3D'
import Table3D from '../Table3D'
import LookControls from '../LookControls'
import Avatar3D from '../Avatar3D'
import { HORIZON_FOG } from '../world/sky'
import { FIGURE_H, FLOOR_Y, SEAT_RADIUS } from '../layout'
import { COLOUR_HEX, pathFor, rotate, viewTurns } from '../../route/info'
import Board3D from './Board3D'
import Pawns3D from './Pawns3D'
import Shells3D from './Shells3D'
import '../../styles/route.css'

const HUE = { red: 0, blue: 210, green: 140, yellow: 45 } // chair colours matching the seat colours

/** A seat's place round the table: behind its home square, as you see the board. */
function seatSpot(seatIndex, turns) {
  const [r, c] = rotate(pathFor(seatIndex)[0], turns)
  const dx = c - 2
  const dz = r - 2
  const len = Math.hypot(dx, dz)
  return { x: (dx / len) * SEAT_RADIUS, z: (dz / len) * SEAT_RADIUS }
}

export default function RouteWorld() {
  const st = useAppStore((s) => s.routeState)
  const routeMove = useAppStore((s) => s.routeMove)
  if (!st) return null
  const turns = viewTurns(st.you)
  const others = st.seats.filter((s) => s.index !== st.you)

  return (
    <>
      <color attach="background" args={['#080a24']} />
      <fog attach="fog" args={[HORIZON_FOG, 22, 52]} />
      <LookControls position={[0, 4.6, 10]} lookAt={[0, 1.1, 1]} />
      <Room3D />
      <Table3D />
      <Board3D turns={turns} seats={st.seats} />
      <Pawns3D st={st} turns={turns} onPick={routeMove} />
      <Shells3D st={st} />
      {others.map((s) => {
        const spot = seatSpot(s.index, turns)
        return (
          <group key={s.id}>
            <Avatar3D seat={spot} hue={HUE[s.colour]} active={st.turn === s.index && st.phase !== 'over'}
              offline={!s.connected || s.left} count={0} character={s.character} playerId={s.id} />
            <Html position={[spot.x, FLOOR_Y + FIGURE_H * 0.78, spot.z]} center zIndexRange={[5, 0]}>
              <div className="rt-tag" style={{ '--seat': COLOUR_HEX[s.colour] }}>
                {s.name}
                {s.place ? ` · ${s.place}${['', 'st', 'nd', 'rd', 'th'][s.place]}` : ''}
              </div>
            </Html>
          </group>
        )
      })}
    </>
  )
}
