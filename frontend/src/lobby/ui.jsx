/**
 * Small shared pieces for the lobby HUD: avatars, rank colours, icons,
 * the modal shell and item artwork.
 */
import { themeThumb } from '../three/world/themes'
import { useEffect, useMemo, useRef } from 'react'
import { usePortrait } from '../three/world/characters'
import { CARD_BACKS, FELTS, EMOTES } from '../items'
import { useAppStore } from '../store/appStore'

export const STARTERS = ['char:m-Casual', 'char:m-Casual2', 'char:w-Casual', 'char:w-Worker']

export const USERNAME_RE = /^@[a-z0-9_]{3,20}$/
/** "Alex_1" / "@Alex_1" → "@alex_1" */
export const normalizeUsername = (v) => '@' + v.trim().replace(/^@/, '').toLowerCase()

// Tier ladder (spec: tiers of 300 RP, Master from 1500).
export const TIERS = [
  { name: 'Bronze', rp: 0, color: '#d08a52' },
  { name: 'Silver', rp: 300, color: '#c9d2e3' },
  { name: 'Gold', rp: 600, color: '#f1bd3f' },
  { name: 'Platinum', rp: 900, color: '#5fe3d0' },
  { name: 'Diamond', rp: 1200, color: '#7fb2ff' },
  { name: 'Master', rp: 1500, color: '#ff7ad9' },
]
export function rankColor(label) {
  const tier = (label || '').split(' ')[0]
  return TIERS.find((t) => t.name === tier)?.color || '#8e9bc0'
}

const NAME_COLORS = ['#ffd27a', '#7fe0ff', '#ff9ad0', '#9dffb0', '#c9a6ff', '#ffb38a']
export function nameColor(id = '') {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0
  return NAME_COLORS[Math.abs(h) % NAME_COLORS.length]
}

export function lastSeen(ms) {
  if (!ms) return 'Offline'
  const min = Math.floor((Date.now() - ms) / 60000)
  if (min < 60) return `${Math.max(1, min)}m ago`
  if (min < 60 * 24) return `${Math.floor(min / 60)}h ago`
  return `${Math.floor(min / 1440)}d ago`
}

/** Catalog items keyed by id. */
export function useItemMap() {
  const items = useAppStore((s) => s.catalog.items)
  return useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items])
}

export function Avatar({ character, className = '' }) {
  const url = usePortrait(character)
  return (
    <div className={`lb-av ${className}`}>
      {url && <img src={url} alt="" />}
    </div>
  )
}

export function Crest({ color, className = 'lb-crest' }) {
  return (
    <svg className={className} viewBox="0 0 38 44" aria-hidden="true">
      <path d="M19 2 L35 8 V22 Q35 35 19 42 Q3 35 3 22 V8 Z" fill={color} stroke="rgba(0,0,0,.45)" strokeWidth="2" />
    </svg>
  )
}

export function Coin({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
      <circle cx="11" cy="11" r="10" fill="#f0b43a" />
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="#8a5212" strokeWidth="1.5" />
    </svg>
  )
}

export function GameLogo({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <g transform="rotate(-28 20 20)">
        <ellipse cx="20" cy="20" rx="17" ry="11" fill="#e3342a" />
        <text x="20" y="25" textAnchor="middle" fontFamily="Big Shoulders Display" fontWeight="900" fontSize="15" fill="#ffd400" stroke="#000" strokeWidth=".8">UNO</text>
      </g>
    </svg>
  )
}

const ICONS = {
  friends: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><circle cx="17" cy="9" r="2.8" /><path d="M15.5 14.2A5.5 5.5 0 0 1 21.5 20" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></>,
  bag: <><path d="M5 9h14l-1.4 11H6.4z" /><path d="M9 9V7a3 3 0 0 1 6 0v2" /></>,
  shop: <><path d="M4 10h16l-2-5H6z" /><path d="M5 10v10h14V10" /><path d="M10 20v-5h4v5" /></>,
  medal: <><circle cx="12" cy="9.5" r="5" /><path d="m9 14-1.4 6.5L12 18l4.4 2.5L15 14" /></>,
  bars: <path d="M6 20v-8M12 20V5M18 20v-6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  smile: <><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" /></>,
  left: <path d="m15 5-7 7 7 7" />,
  right: <path d="m9 5 7 7-7 7" />,
}
export function Icon({ name }) {
  return (
    <svg className="lb-ic" viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

/** Native modal dialog: focus trap, Esc and focus return come for free.
 *  The modal makes the page inert, so server notices/errors are echoed inside it. */
export function Modal({ title, onClose, children, className = '' }) {
  const ref = useRef(null)
  const error = useAppStore((s) => s.error)
  const notice = useAppStore((s) => s.notification)
  useEffect(() => {
    const d = ref.current
    d.showModal()
    return () => d.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className={`lb-dialog ${className}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="lb-dframe">
        <header className="lb-dhead">
          <h2>{title}</h2>
          <button className="lb-x" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="lb-dbody">{children}</div>
        {(error || notice) && (
          <p className={`lb-dnote ${error ? 'err' : ''}`} role="status">
            {error || notice}
          </p>
        )}
      </div>
    </dialog>
  )
}

/** Picture for any catalog item. */
export function ItemArt({ item }) {
  const id = item?.id || ''
  if (item?.kind === 'character') return <Avatar character={id} className="lb-art" />
  if (item?.kind === 'lobby') {
    return (
      <div className="lb-art lb-art--wide" aria-hidden="true">
        <img src={themeThumb(id)} alt="" />
      </div>
    )
  }
  if (CARD_BACKS[id]) {
    const b = CARD_BACKS[id]
    return (
      <div className="lb-art" aria-hidden="true">
        <svg viewBox="0 0 40 58" width="44" height="64">
          <rect x="1" y="1" width="38" height="56" rx="5" fill={b.base} stroke="rgba(255,255,255,.7)" strokeWidth="2" />
          <ellipse cx="20" cy="29" rx="12" ry="19" transform="rotate(28 20 29)" fill={b.ellipse} />
          <text x="20" y="33" textAnchor="middle" fontFamily="Big Shoulders Display" fontWeight="900" fontSize="11" fill={b.word} transform="rotate(-28 20 29)">UNO</text>
        </svg>
      </div>
    )
  }
  if (FELTS[id]) {
    return (
      <div className="lb-art" aria-hidden="true">
        <span className="lb-felt" style={{ background: `radial-gradient(circle at 40% 35%, ${FELTS[id]}, #000 120%)` }} />
      </div>
    )
  }
  if (EMOTES[id]) {
    return (
      <div className="lb-art lb-art--emotes" aria-hidden="true">
        {EMOTES[id].slice(0, 4).join(' ')}
      </div>
    )
  }
  return <div className="lb-art" aria-hidden="true" />
}
