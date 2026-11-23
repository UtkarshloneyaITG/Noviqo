/**
 * Ang Mang Chok Chang, client side: the board route (a copy of the server's
 * in backend/core/route.py — tests/route.test.mjs pins the two together),
 * the view rotation that puts your own home nearest you, seat colours and
 * the words for each throw. No imports: node's test runner loads it.
 *
 * Cells are [row, col] on the 5×5 board as seat 0 sees it (row 0 far side).
 */
export const OUTER = [[4, 2], [4, 3], [4, 4], [3, 4], [2, 4], [1, 4], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [4, 1]]
export const INNER = [[3, 1], [2, 1], [1, 1], [1, 2], [1, 3], [2, 3], [3, 3], [3, 2]]
export const CENTRE = [2, 2]
export const SAFE = [[4, 2], [2, 4], [0, 2], [2, 0], [2, 2]]
export const FINISH = 24

/** A quarter turn of the board, k times. */
export function rotate([r, c], k = 1) {
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) [r, c] = [4 - c, r]
  return [r, c]
}

/** The 25 cells a seat's pawns visit: home square first, centre last. */
export function pathFor(seat) {
  return [...OUTER, ...INNER, CENTRE].map((cell) => rotate(cell, seat))
}

/** Quarter turns that bring `mySeat`'s home square to the near side of the view. */
export const viewTurns = (mySeat) => (4 - (mySeat ?? 0)) % 4

export const isSafe = ([r, c]) => SAFE.some(([sr, sc]) => sr === r && sc === c)

export const COLOUR_HEX = { red: '#ff4d5e', blue: '#4fa3ff', green: '#3df2a0', yellow: '#ffc53d' }
export const THROW_NAMES = { 4: 'Chowka', 8: 'Baara' }
export const RULE_NAMES = { traditional: 'Traditional', basic: 'Basic' }
