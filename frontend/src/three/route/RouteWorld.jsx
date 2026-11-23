/**
 * RouteWorld — the Ang Mang Chok Chang table: the same rooftop, table and
 * first-person seat as the other games, with the carved board (Board3D)
 * turned so your home is nearest you, the 16 pawns (Pawns3D), the four
 * cowrie shells (Shells3D), and the other three players seated at their own
 * side of the board, each under a name tag in their seat colour.
 *
 * Their right arms do the hand work (Avatar3D `reach`): while it's their
 * throw they hold the shells out over the table edge and shake them, the
 * throw whips the arm toward the board, and a move reaches for the pawn and
 * follows it as it is carried (acts.carry). Your own hand is Hand3D.
 */
import { useEffect, useMemo } from 'react'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useAppStore } from '../../store/appStore'
import Room3D from '../Room3D'
import Table3D from '../Table3D'
import LookControls from '../LookControls'
import Avatar3D from '../Avatar3D'
import { HORIZON_FOG } from '../world/sky'
import { FIGURE_H, FLOOR_Y, SEAT_RADIUS, TABLE_RADIUS } from '../layout'
import { COLOUR_HEX, pathFor, rotate, viewTurns } from '../../route/info'
import Board3D, { BOARD_TOP } from './Board3D'
import Pawns3D from './Pawns3D'
import Shells3D from './Shells3D'
import { acts } from './acts'
import '../../styles/route.css'

const HUE = { red: 0, blue: 210, green: 140, yellow: 45 } // chair colours matching the seat colours
const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const GRIP = new THREE.Vector3(0, 0.45, 0) // the hand hovers this far above a pawn it holds
const PALM = new THREE.Vector3(0, -0.12, 0) // from the wrist bone to the palm
const CENTRE = new THREE.Vector3(0, BOARD_TOP + 0.5, 0)
const FLING_S = 0.45

/** A seat's place round the table: behind its home square, as you see the board. */
function seatSpot(seatIndex, turns) {
  const [r, c] = rotate(pathFor(seatIndex)[0], turns)
  const dx = c - 2
  const dz = r - 2
  const len = Math.hypot(dx, dz)
  return { x: (dx / len) * SEAT_RADIUS, z: (dz / len) * SEAT_RADIUS }
}

function Opponent({ s, spot, acting }) {
  const reach = useMemo(() => ({ target: new THREE.Vector3(), w: 0, hand: null }), [])
  const holdAt = useMemo(
    () => new THREE.Vector3(spot.x, 0, spot.z).normalize().multiplyScalar(TABLE_RADIUS - 0.5).setY(BOARD_TOP + 1.1),
    [spot.x, spot.z],
  )
  useEffect(() => {
    acts.hands[s.id] = { anchor: (out) => (reach.hand ? reach.hand.getWorldPosition(out).add(PALM) : null) }
    return () => delete acts.hands[s.id]
  }, [s.id, reach])

  useFrame(({ clock }, dt) => {
    const carry = acts.carry[s.id]
    const toss = acts.toss[s.id]
    const age = toss ? performance.now() / 1000 - toss.since : 0
    let want = 0
    if (carry) {
      reach.target.copy(carry.at).add(GRIP)
      want = 1
    } else if (toss?.phase === 'hold') {
      reach.target.copy(holdAt) // shells cupped over the table edge, shaken while they decide
      if (!reduce) reach.target.y += Math.sin(clock.elapsedTime * 22) * 0.09
      want = 1
    } else if (toss?.phase === 'fling' && age < FLING_S) {
      const k = age / FLING_S // the arm whips toward the board
      reach.target.lerpVectors(holdAt, CENTRE, k * k)
      want = 1
    }
    reach.w += (want - reach.w) * Math.min(1, dt * 7)
  })

  return (
    <group>
      <Avatar3D seat={spot} hue={HUE[s.colour]} active={acting} offline={!s.connected || s.left} count={0}
        character={s.character} playerId={s.id} reach={reach} />
      <Html position={[spot.x, FLOOR_Y + FIGURE_H * 0.78, spot.z]} center zIndexRange={[5, 0]}>
        <div className="rt-tag" style={{ '--seat': COLOUR_HEX[s.colour] }}>
          {s.name}
          {s.place ? ` · ${s.place}${['', 'st', 'nd', 'rd', 'th'][s.place]}` : ''}
        </div>
      </Html>
    </group>
  )
}

export default function RouteWorld() {
  const st = useAppStore((s) => s.routeState)
  const routeMove = useAppStore((s) => s.routeMove)
  if (!st) return null
  const turns = viewTurns(st.you)

  return (
    <>
      <color attach="background" args={['#080a24']} />
      <fog attach="fog" args={[HORIZON_FOG, 22, 52]} />
      <LookControls position={[0, 4.6, 10]} lookAt={[0, 1.1, 1]} />
      <Room3D />
      <Table3D />
      <Board3D turns={turns} />
      <Pawns3D st={st} turns={turns} onPick={routeMove} />
      <Shells3D st={st} />
      {st.seats
        .filter((s) => s.index !== st.you)
        .map((s) => (
          <Opponent key={s.id} s={s} spot={seatSpot(s.index, turns)} acting={st.turn === s.index && st.phase !== 'over'} />
        ))}
    </>
  )
}
