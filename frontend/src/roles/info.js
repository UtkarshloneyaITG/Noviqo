/**
 * Raja Mantri Chor Sipahi — what each role is called, worth and looks like.
 * Shared by the 3D table (chit faces, badges) and the HUD. The server owns
 * the rules and the points (backend/core/roles.py); this only presents them.
 */
export const ROLE = {
  raja: { en: 'Raja', hi: 'राजा', title: 'King', points: 1000, icon: '👑', color: '#f1bd3f' },
  mantri: { en: 'Mantri', hi: 'मंत्री', title: 'Minister', points: 800, icon: '🧑‍💼', color: '#4fd8ff' },
  sipahi: { en: 'Sipahi', hi: 'सिपाही', title: 'Police', points: 500, icon: '👮', color: '#7fb2ff' },
  chor: { en: 'Chor', hi: 'चोर', title: 'Thief', points: 0, icon: '🕵️', color: '#ff6b81' },
}

/** The id of whoever holds `role` (only once it's visible to you). */
export const holderOf = (st, role) => st.seats.find((s) => s.role === role)?.id

export const seatName = (st, id) => (id === st.me ? 'You' : st.seats.find((s) => s.id === id)?.name ?? '?')

/** Paper texture for an unrolled chit: the role in Devanagari and English, and its points. */
const faces = {}
export function chitFace(role) {
  if (faces[role]) return faces[role]
  const r = ROLE[role]
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 320
  const g = c.getContext('2d')
  g.fillStyle = '#f4ead2'
  g.fillRect(0, 0, 512, 320)
  g.strokeStyle = 'rgba(120, 90, 40, .18)' // faint ruled lines, like a page torn from a notebook
  g.lineWidth = 2
  for (let y = 46; y < 320; y += 34) {
    g.beginPath()
    g.moveTo(16, y)
    g.lineTo(496, y)
    g.stroke()
  }
  g.strokeStyle = 'rgba(90, 60, 20, .45)'
  g.lineWidth = 6
  g.strokeRect(10, 10, 492, 300)
  g.textAlign = 'center'
  g.fillStyle = '#2a1a08'
  g.font = '700 108px "Nirmala UI", "Noto Sans Devanagari", "Mangal", sans-serif'
  g.fillText(r.hi, 256, 150)
  g.font = '800 46px "Big Shoulders Display", Impact, sans-serif'
  g.fillStyle = r.color === '#f1bd3f' ? '#a36f00' : '#3a2a14'
  g.fillText(`${r.icon} ${r.en.toUpperCase()}`, 256, 228)
  g.font = '700 34px Figtree, system-ui, sans-serif'
  g.fillStyle = '#6b5432'
  g.fillText(r.points ? `${r.points} points` : '0 points', 256, 280)
  faces[role] = c
  return c
}
