/**
 * What the hands at the table are doing right now, shared between the pieces
 * (Pawns3D, Shells3D) and the hands (your Hand3D, the seated players' arms).
 * Plain module state, read every frame; never React state, so it never
 * re-renders anything.
 *
 *   acts.carry[seatId] = { phase: 'reach' | 'carry' | 'release', at: Vector3 }  a pawn in hand
 *   acts.toss[seatId]  = { phase: 'hold' | 'fling', since: seconds }            shells in hand / flung
 *   acts.hands[seatId] = { anchor(out) → Vector3 | null }                        where that hand's palm is
 *   acts.localHold     = true while you hold THROW (your hand shakes)
 */
export const acts = { carry: {}, toss: {}, hands: {}, localHold: false }

// Mirrors of the server's pauses (backend/core/route.py) so hands finish in time.
export const REACH_S = 0.3
export const HOP_S = 0.24
export const THROW_S = 0.9
export const CAPTURE_S = 0.6
export const RELEASE_S = 0.25
