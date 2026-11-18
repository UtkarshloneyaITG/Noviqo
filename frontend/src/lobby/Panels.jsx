/**
 * Dock and settings panels: Inventory, Shop, Milestones, Ranks, Settings,
 * and the game picker. All read the live profile + server catalog.
 */
import { useState } from 'react'
import { useAppStore } from '../store/appStore'
import { Coin, Crest, GameArt, ItemArt, Modal, TIERS, rankColor, useItemMap } from './ui'

const KINDS = [
  ['character', 'Characters'],
  ['card_back', 'Card backs'],
  ['felt', 'Table felts'],
  ['emotes', 'Emotes'],
  ['lobby', 'Backgrounds'],
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

export function Ranks({ onClose }) {
  const profile = useAppStore((s) => s.profile)
  const r = profile.rank || {}
  const stats = profile.stats || { games: 0, wins: 0 }
  const here = TIERS.findIndex((t) => t.name === r.tier)

  return (
    <Modal title="Ranks" onClose={onClose}>
      <div className="lb-rankhero">
        <Crest color={rankColor(r.label)} className="lb-crest lb-crest--big" />
        <div className="t">
          <div className="lb-display">{r.label}</div>
          <small>{r.rp} RP</small>
          <Bar value={r.into} max={r.span} />
          <small>{r.next_label ? `${r.into} of ${r.span} RP to ${r.next_label}` : 'Top tier reached'}</small>
        </div>
        <dl className="lb-stats">
          <div>
            <dt>Games</dt>
            <dd>{stats.games}</dd>
          </div>
          <div>
            <dt>Wins</dt>
            <dd>{stats.wins}</dd>
          </div>
          <div>
            <dt>Win rate</dt>
            <dd>{stats.games ? Math.round((100 * stats.wins) / stats.games) : 0}%</dd>
          </div>
        </dl>
      </div>
      <ol className="lb-ladder">
        {TIERS.map((t, i) => (
          <li key={t.name} className={i === here ? 'cur' : i < here ? 'past' : ''}>
            <Crest color={t.color} />
            <b>{t.name}</b>
            <small>{t.name === 'Master' ? `${t.rp}+ RP` : `${t.rp} RP`}</small>
            {i === here && <span>You are here</span>}
          </li>
        ))}
      </ol>
      <p className="lb-note">
        Only ranked games change RP. In a 4-player game 1st gets +30, 2nd +10, 3rd −5 and 4th −15; leaving early costs 15.
        Each tier has three divisions, III to I, of 100 RP each.
      </p>
    </Modal>
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
      <button className="lb-btn danger lb-signout" onClick={signOut}>
        Sign out
      </button>
    </Modal>
  )
}

const GAMES = [
  { id: 'uno', name: 'UNO', ready: true },
  { id: 'rummy', name: 'Rummy' },
  { id: 'hearts', name: 'Hearts' },
  { id: 'spades', name: 'Spades' },
]

export function GamePicker({ onClose }) {
  return (
    <Modal title="Choose a game" onClose={onClose}>
      <div className="lb-games">
        {GAMES.map((g) => (
          <button key={g.id} className={`lb-game ${g.ready ? 'act' : ''}`} disabled={!g.ready} aria-pressed={!!g.ready} onClick={onClose}>
            {g.ready ? <GameArt /> : <span className="soon" aria-hidden="true">?</span>}
            <b>{g.name}</b>
            <small>{g.ready ? 'Selected' : 'Coming soon'}</small>
          </button>
        ))}
      </div>
    </Modal>
  )
}
