/**
 * Dock and settings panels: Inventory, Shop, Milestones, Ranks, Settings,
 * and the game picker. All read the live profile + server catalog.
 */
import { useState } from 'react'
import { useAppStore } from '../store/appStore'
import { useDisplay } from '../store/display'
import { Coin, GameArt, RolesArt, ItemArt, Modal, USERNAME_RE, normalizeUsername, useItemMap } from './ui'

const KINDS = [
  ['character', 'Characters'],
  ['card_back', 'Card backs'],
  ['felt', 'Table felts'],
  ['emotes', 'Emotes'],
  ['lobby', 'Backgrounds'],
  ['entry', 'Entrances'],
]

function KindTabs({ kinds, kind, setKind }) {
  return (
    <div className="lb-seg lb-seg--kinds" role="tablist" aria-label="Item type">
      {kinds.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={kind === id} className={kind === id ? 'act' : ''} onClick={() => setKind(id)}>
          {label}
        </button>
      ))}
    </div>
  )
}

function Bar({ value, max }) {
  return (
    <div className="lb-bar" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)}>
      <i style={{ width: `${max ? Math.min(100, (100 * value) / max) : 0}%` }} />
    </div>
  )
}

function ItemTile({ item, shop }) {
  // Primitive selectors: a tile re-renders only when its own state changes.
  const owned = useAppStore((s) => s.profile.inventory.includes(item.id))
  const equipped = useAppStore((s) => Object.values(s.profile.equipped || {}).includes(item.id))
  const coins = useAppStore((s) => (shop ? s.profile.coins : 0))
  const progress = useAppStore((s) => s.profile.milestones?.find((m) => m.id === item.milestone))
  const def = useAppStore((s) => s.catalog.milestones.find((d) => d.id === item.milestone))
  const isNew = useAppStore((s) => s.newItems.includes(item.id))
  const { send, openPanel } = useAppStore.getState()

  let action
  if (owned) {
    action =
      item.kind === 'emotes' ? (
        <span className="lb-state">Owned</span>
      ) : equipped ? (
        <span className="lb-state on">Equipped</span>
      ) : (
        <button className="lb-btn go" onClick={() => send('equip', { item_id: item.id })} aria-label={`Equip ${item.name}`}>
          Equip
        </button>
      )
  } else if (shop) {
    const short = item.price - coins
    action = (
      <button className="lb-btn go" disabled={short > 0} onClick={() => send('buy', { item_id: item.id })} aria-label={`Buy ${item.name} for ${item.price} coins`}>
        {short > 0 ? `Need ${short} more` : 'Buy'}
      </button>
    )
  } else if (item.price != null) {
    action = (
      <button className="lb-link" onClick={() => openPanel('shop')}>
        In the shop for {item.price}
      </button>
    )
  } else {
    action = (
      <span className="lb-how">
        {def ? `Unlock with ${def.name}${progress ? `, ${progress.progress} of ${progress.goal}` : ''}` : 'Not available yet'}
      </span>
    )
  }

  return (
    <div className={`lb-item ${owned ? '' : 'locked'} ${equipped ? 'eq' : ''}`}>
      {isNew && <span className="tagnew">New</span>}
      <ItemArt item={item} />
      <b>{item.name}</b>
      {shop && !owned && (
        <span className="lb-price">
          <Coin size={15} />
          {item.price}
        </span>
      )}
      {action}
      {item.kind === 'entry' && (
        <button className="lb-link lb-preview" onClick={() => useAppStore.getState().previewEntry(item.id)} aria-label={`Preview ${item.name} on your character`}>
          Preview
        </button>
      )}
    </div>
  )
}

export function Inventory({ onClose }) {
  const items = useAppStore((s) => s.catalog.items)
  const inventory = useAppStore((s) => s.profile.inventory)
  const clearNewItems = useAppStore((s) => s.clearNewItems)
  const [kind, setKind] = useState('character')

  const owns = (i) => inventory.includes(i.id)
  const list = items.filter((i) => i.kind === kind).sort((a, b) => owns(b) - owns(a))

  return (
    <Modal
      title="Inventory"
      className="lb-dialog--wide"
      onClose={() => {
        clearNewItems()
        onClose()
      }}
    >
      <KindTabs kinds={KINDS} kind={kind} setKind={setKind} />
      <p className="lb-note">
        You own {list.filter(owns).length} of {list.length}
      </p>
      <div className="lb-grid">
        {list.map((i) => (
          <ItemTile key={i.id} item={i} />
        ))}
      </div>
    </Modal>
  )
}

export function Shop({ onClose }) {
  const items = useAppStore((s) => s.catalog.items)
  const coins = useAppStore((s) => s.profile.coins)
  const inventory = useAppStore((s) => s.profile.inventory)
  const forSale = items.filter((i) => i.price != null)
  const kinds = KINDS.filter(([k]) => forSale.some((i) => i.kind === k))
  const [kind, setKind] = useState('character')

  const list = forSale
    .filter((i) => i.kind === kind)
    .sort((a, b) => inventory.includes(a.id) - inventory.includes(b.id) || a.price - b.price)

  return (
    <Modal title="Shop" onClose={onClose} className="lb-dialog--wide">
      <p className="lb-wallet">
        <Coin /> <b>{coins.toLocaleString()}</b> coins. Earn more by finishing games.
      </p>
      <KindTabs kinds={kinds} kind={kind} setKind={setKind} />
      <div className="lb-grid">
        {list.map((i) => (
          <ItemTile key={i.id} item={i} shop />
        ))}
      </div>
    </Modal>
  )
}

export function Milestones({ onClose }) {
  const defs = useAppStore((s) => s.catalog.milestones)
  const progress = useAppStore((s) => s.profile.milestones || [])
  const items = useItemMap()

  return (
    <Modal title="Milestones" onClose={onClose}>
      <div className="lb-list">
        {defs.map((d) => {
          const p = progress.find((m) => m.id === d.id) || { progress: 0, goal: d.goal, unlocked: false }
          const reward = items[d.reward]
          return (
            <div key={d.id} className={`lb-ms ${p.unlocked ? 'done' : ''}`}>
              <ItemArt item={reward} />
              <div className="t">
                <b>{d.name}</b>
                <small>{d.description}</small>
                <Bar value={p.progress} max={p.goal} />
                <small>
                  {p.unlocked
                    ? `Unlocked ${reward?.name || 'reward'}`
                    : `${Math.min(p.progress, p.goal)} of ${p.goal}. Reward: ${reward?.name || 'an item'}`}
                </small>
              </div>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

const QUALITY_OPTIONS = [['auto', 'Auto'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]
const QUALITY_HINTS = {
  auto: 'Adjusts itself to your device.',
  high: 'Sharpest picture, with glow and shadows.',
  medium: 'Normal resolution, with glow and shadows.',
  low: 'Best for older phones and battery: no glow or shadows, still backgrounds.',
}
const FPS_OPTIONS = [[30, '30'], [60, '60'], [0, 'Unlimited']]

/** A row of mutually exclusive buttons (the lobby's segmented control). */
function Choice({ label, hint, options, value, onPick }) {
  return (
    <div className="lb-field" role="group" aria-label={label}>
      <span>{label}</span>
      <div className="lb-seg">
        {options.map(([v, text]) => (
          <button key={text} type="button" className={v === value ? 'act' : ''} aria-pressed={v === value} onClick={() => onPick(v)}>
            {text}
          </button>
        ))}
      </div>
      {hint && <small className="lb-hint">{hint}</small>}
    </div>
  )
}

/** Graphics and frame-rate settings, saved on this device (store/display.js). */
function Graphics() {
  const { quality, fps, showFps, setDisplay } = useDisplay()
  return (
    <section className="lb-gfx" aria-label="Graphics">
      <Choice label="Graphics quality" hint={QUALITY_HINTS[quality]} options={QUALITY_OPTIONS} value={quality} onPick={(q) => setDisplay({ quality: q })} />
      <Choice label="Frame-rate limit" hint={fps ? `Never above ${fps} frames a second.` : "As fast as your screen allows."} options={FPS_OPTIONS} value={fps} onPick={(f) => setDisplay({ fps: f })} />
      <Choice label="Show FPS" options={[[false, 'Off'], [true, 'On']]} value={showFps} onPick={(v) => setDisplay({ showFps: v })} />
    </section>
  )
}

export function Settings({ onClose }) {
  const profile = useAppStore((s) => s.profile)
  const { send, signOut } = useAppStore.getState()
  const [name, setName] = useState(profile.display_name)
  const t = name.trim()
  const ok = t.length >= 1 && t.length <= 20

  const save = (e) => {
    e.preventDefault()
    if (!ok || t === profile.display_name) return
    send('update_profile', { display_name: t })
  }

  return (
    <Modal title="Settings" onClose={onClose}>
      <Graphics />
      <form className="lb-addf" onSubmit={save}>
        <label className="lb-field">
          <span>In-game name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} aria-invalid={!ok} aria-describedby="lb-err-name" />
          <em id="lb-err-name">{!ok && 'Use 1 to 20 characters'}</em>
        </label>
        <button className="lb-btn go" disabled={!ok || t === profile.display_name}>
          Save name
        </button>
      </form>
      <div className="lb-field">
        <span>Username</span>
        <output className="lb-fixed">{profile.username}</output>
        <small className="lb-hint">Your @username can't be changed.</small>
      </div>
      {profile.admin && <AdminGive />}
      <button className="lb-btn danger lb-signout" onClick={signOut}>
        Sign out
      </button>
    </Modal>
  )
}

/** Admins only (the server checks too): give coins to any player by @username. */
function AdminGive() {
  const send = useAppStore((s) => s.send)
  const [who, setWho] = useState('')
  const [amount, setAmount] = useState('10000')
  const username = normalizeUsername(who)
  const n = Number(amount)
  const ok = USERNAME_RE.test(username) && Number.isInteger(n) && n >= 1 && n <= 1_000_000

  const give = (e) => {
    e.preventDefault()
    if (ok) send('admin_give_coins', { username, amount: n })
  }

  return (
    <form className="lb-admin" onSubmit={give}>
      <h3>Admin</h3>
      <label className="lb-field">
        <span>Player</span>
        <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="@username" autoCapitalize="none" autoComplete="off" spellCheck={false} />
      </label>
      <label className="lb-field">
        <span>Coins</span>
        <input type="number" inputMode="numeric" min="1" max="1000000" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <button className="lb-btn go" disabled={!ok}>
        Give coins
      </button>
    </form>
  )
}

const GAMES = [
  { id: 'uno', name: 'UNO', Art: GameArt, seats: '2–5 players' },
  { id: 'roles', name: 'Raja Mantri Chor Sipahi', Art: RolesArt, seats: '1–4 players, bots fill in' },
  { id: 'rummy', name: 'Rummy' },
  { id: 'hearts', name: 'Hearts' },
]

/** The party leader picks what the party plays next. */
export function GamePicker({ onClose }) {
  const game = useAppStore((s) => s.party?.game) || 'uno'
  const send = useAppStore((s) => s.send)
  return (
    <Modal title="Choose a game" onClose={onClose}>
      <div className="lb-games">
        {GAMES.map((g) => (
          <button
            key={g.id}
            className={`lb-game ${game === g.id ? 'act' : ''}`}
            disabled={!g.Art}
            aria-pressed={game === g.id}
            onClick={() => {
              if (g.id !== game) send('party_set', { game: g.id })
              onClose()
            }}
          >
            {g.Art ? <g.Art /> : <span className="soon" aria-hidden="true">?</span>}
            <b>{g.name}</b>
            <small>{!g.Art ? 'Coming soon' : game === g.id ? 'Selected' : g.seats}</small>
          </button>
        ))}
      </div>
    </Modal>
  )
}
