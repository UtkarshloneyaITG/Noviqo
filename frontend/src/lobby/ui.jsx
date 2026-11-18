/**
 * Small shared pieces for the lobby HUD: avatars, rank colours, icons,
 * the modal shell and item artwork.
 */
import { themeThumb } from '../three/world/themes'
import { useEffect, useId, useMemo, useRef } from 'react'
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
      <path d="M19 2 L35 8 V22 Q35 35 19 42 Q3 35 3 22 V8 Z" fill={color} stroke="rgba(0,0,0,.5)" strokeWidth="2" />
      <path d="M19 5.5 L7 10 V22 Q7 31.5 19 38.2 Z" fill="rgba(255,255,255,.2)" />
      <path d="m11.5 17.5 7.5 5 7.5-5M11.5 24.5l7.5 5 7.5-5" fill="none" stroke="rgba(0,0,0,.38)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Coin({ size = 22, className }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
      <defs>
        <linearGradient id="nq-coin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe28a" />
          <stop offset="1" stopColor="#d0861c" />
        </linearGradient>
      </defs>
      <circle cx="11" cy="11" r="10" fill="url(#nq-coin)" stroke="#8a5212" strokeWidth="1" />
      <circle cx="11" cy="11" r="6.7" fill="none" stroke="#a8641a" strokeWidth="1.3" />
      <path d="M11 7.4 12 9.6l2.4.3-1.8 1.6.5 2.4-2.1-1.2-2.1 1.2.5-2.4-1.8-1.6 2.4-.3z" fill="#fff3c4" />
    </svg>
  )
}

const SUITS = ['#2d7fd4', '#2bb24c', '#e8b417', '#d9352c'] // the table's card colours (tileTextures.js)

/** The game's icon: four cards fanned from one corner, the front one carrying a star. */
export function GameLogo({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      {SUITS.map((c, i) => (
        <g key={c} transform={`rotate(${-33 + i * 22} 20 35)`}>
          <rect x="13" y="8" width="14" height="21" rx="2.6" fill={c} stroke="#0b0f22" />
          <rect x="14.8" y="9.8" width="10.4" height="17.4" rx="1.6" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth=".9" />
        </g>
      ))}
      <path transform="rotate(33 20 35)" d="M20 13.6l1.5 3.3 3.6.4-2.7 2.4.8 3.5-3.2-1.9-3.2 1.9.8-3.5-2.7-2.4 3.6-.4z" fill="#fff" />
    </svg>
  )
}

const HAND = [['#d9352c', '3'], ['#e8b417', '9'], [null, ''], ['#2bb24c', '5'], ['#2d7fd4', '7']] // null = the wild
const SPARKS = [[58, 22, 5, '#4fd8ff'], [214, 72, 4, '#ffc53d'], [204, 16, 3, '#fff'], [30, 84, 3, '#ffc53d']]

/** Game picker illustration: a hand of cards fanned over a glowing table. Decorative. */
export function GameArt() {
  const id = useId().replace(/:/g, '') // gradient ids must be unique per instance
  return (
    <svg className="lb-gart" viewBox="0 0 240 120" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#140f3a" />
          <stop offset="1" stopColor="#2a1550" />
        </linearGradient>
        <radialGradient id={`${id}g`} cx=".5" cy=".62" r=".55">
          <stop offset="0" stopColor="#ffc53d" stopOpacity=".55" />
          <stop offset=".45" stopColor="#ff8a1e" stopOpacity=".18" />
          <stop offset="1" stopColor="#ff8a1e" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#17845a" />
          <stop offset="1" stopColor="#0a3d27" />
        </linearGradient>
      </defs>
      <rect width="240" height="120" fill={`url(#${id}s)`} />
      <rect width="240" height="120" fill={`url(#${id}g)`} />
      <ellipse cx="120" cy="150" rx="160" ry="54" fill={`url(#${id}f)`} stroke="#4fd8ff" strokeOpacity=".7" strokeWidth="1.5" />
      <ellipse cx="120" cy="104" rx="40" ry="4" fill="#000" opacity=".22" />
      <rect x="22" y="26" width="22" height="32" rx="3.5" fill="#2d7fd4" opacity=".55" transform="rotate(-18 34 42)" />
      <rect x="196" y="24" width="22" height="32" rx="3.5" fill="#d9352c" opacity=".55" transform="rotate(16 206 40)" />
      {HAND.map(([c, n], i) => (
        <g key={i} transform={`rotate(${-44 + i * 22} 120 142)`}>
          <rect x="103" y="34" width="34" height="50" rx="5" fill={c || '#15151f'} stroke="#0b0f22" strokeWidth="1.5" />
          {c ? (
            <>
              <rect x="106.5" y="37.5" width="27" height="43" rx="3" fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth="1.2" />
              <text x="120" y="68" textAnchor="middle" fontSize="26" fill="#fff" stroke="#0b0f22" strokeWidth="1" paintOrder="stroke">{n}</text>
              <text x="109.5" y="46" fontSize="8" fill="#fff">{n}</text>
            </>
          ) : (
            SUITS.map((q, k) => <circle key={q} cx={113 + (k % 2) * 14} cy={52 + (k >> 1) * 14} r="5.5" fill={q} />)
          )}
        </g>
      ))}
      {SPARKS.map(([x, y, r, c]) => (
        <path key={x} d={`M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}z`} fill={c} />
      ))}
    </svg>
  )
}

// One 24-grid two-tone set: 2px rounded outlines in currentColor plus a soft
// fill (.f) on each icon's main shape, so they stay readable when the HUD is
// scaled down on phones.
const ICONS = {
  friends: <><circle className="f" cx="9" cy="7.8" r="3.6" /><path className="f" d="M2.8 20.2c.5-3.7 3-5.9 6.2-5.9s5.7 2.2 6.2 5.9z" /><circle cx="16.9" cy="8.6" r="2.7" /><path d="M17.7 14.2c2.1.5 3.4 2.3 3.6 4.8" /></>,
  mail: <><rect className="f" x="3" y="5" width="18" height="14" rx="2.6" /><path d="m3.9 7.3 8.1 5.9 8.1-5.9" /></>,
  gear: <><path className="f" d="M10.3 2.8h3.4l.5 2.4 1.7.7 2-1.4 2.4 2.4-1.4 2 .7 1.7 2.4.5v3.4l-2.4.5-.7 1.7 1.4 2-2.4 2.4-2-1.4-1.7.7-.5 2.4h-3.4l-.5-2.4-1.7-.7-2 1.4-2.4-2.4 1.4-2-.7-1.7-2.4-.5v-3.4l2.4-.5.7-1.7-1.4-2 2.4-2.4 2 1.4 1.7-.7z" /><circle cx="12" cy="12" r="3" /></>,
  bag: <><path className="f" d="M4.6 8.6h14.8l-1.1 10.9a1.7 1.7 0 0 1-1.7 1.5H7.4a1.7 1.7 0 0 1-1.7-1.5z" /><path d="M8.6 8.6V7a3.4 3.4 0 0 1 6.8 0v1.6M9 12.4h.01M15 12.4h.01" /></>,
  shop: <><path className="f" d="M4.4 11.6V20h15.2v-8.4" /><path d="M3 10.3 4.7 4h14.6l1.7 6.3a2.6 2.6 0 0 1-4.5 1.8 2.7 2.7 0 0 1-4.5 0 2.7 2.7 0 0 1-4.5 0A2.6 2.6 0 0 1 3 10.3zM9.6 20v-4.4h4.8V20M3.4 20h17.2" /></>,
  medal: <><path d="M8.2 3 10.6 9M15.8 3 13.4 9" /><circle className="f" cx="12" cy="14.6" r="5.6" /><path d="m12 11.9 1 1.9 2 .3-1.5 1.4.4 2.1-1.9-1-1.9 1 .4-2.1-1.5-1.4 2-.3z" /></>,
  bars: <><path className="f" d="M12 2.8 19.5 6v6.1c0 4.5-3.2 7.7-7.5 9.1-4.3-1.4-7.5-4.6-7.5-9.1V6z" /><path d="m8.4 9.6 3.6 2.5 3.6-2.5M8.4 13.6l3.6 2.5 3.6-2.5" /></>,
  trophy: <><path className="f" d="M7 3.5h10v5.6a5 5 0 0 1-10 0z" /><path d="M7 5.6H4.2v1.2a3.7 3.7 0 0 0 3.4 3.7M17 5.6h2.8v1.2a3.7 3.7 0 0 1-3.4 3.7M12 14.1v3.2M8.6 20.6h6.8l-.7-3.3H9.3z" /></>,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  smile: <><circle className="f" cx="12" cy="12" r="9" /><path d="M8.3 14.1a4.5 4.5 0 0 0 7.4 0M9.2 9.4v.8M14.8 9.4v.8" /></>,
  left: <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />,
  right: <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
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
