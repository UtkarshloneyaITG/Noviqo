/**
 * RouteWorld — the Ang Mang Chok Chang table: the same rooftop, table and
 * first-person seat as the other games. (The board, pawns, shells and the
 * seated players arrive with Board3D / Pawns3D / Shells3D.)
 */
import Room3D from '../Room3D'
import Table3D from '../Table3D'
import LookControls from '../LookControls'
import { HORIZON_FOG } from '../world/sky'

export default function RouteWorld() {
  return (
    <>
      <color attach="background" args={['#080a24']} />
      <fog attach="fog" args={[HORIZON_FOG, 22, 52]} />
      <LookControls position={[0, 4.6, 10]} lookAt={[0, 1.1, 1]} />
      <Room3D />
      <Table3D />
    </>
  )
}
