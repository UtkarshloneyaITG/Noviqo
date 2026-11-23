/**
 * Lobby — the screen-space HUD over LobbyWorld: sign-in when signed out;
 * otherwise profile, coins, the play column (start/ready, mode, event
 * banner), friends strip, chat, dock and the panel overlays.
 */
import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { LOBBY_EMOTES } from '../three/world/lobbyMotion'
import { Avatar, Crest, Coin, GameLogo, Icon, ItemArt, RolesLogo, RouteLogo, SecondsLeft, rankColor, useItemMap } from './ui'
import SignIn from './SignIn'
import Chat from './Chat'
import { FriendsStrip, FriendsPanel, AddFriend } from './Friends'
import { Inventory, Shop, Milestones, Settings, GamePicker } from './Panels'
import Ranks from './Ranks'
import News from './News'
import '../styles/lobby.css'

const PANELS = {
  inventory: Inventory,
  shop: Shop,
  milestones: Milestones,
  ranks: Ranks,
  settings: Settings,
  friends: FriendsPanel,
  addfriend: AddFriend,
  games: GamePicker,
}

const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// The HUD is laid out on a 1600×900 stage and zoomed to fit the window.
function useFitZoom() {
  useEffect(() => {
    const fit = () => {
      const z = Math.min(1.3, Math.max(0.6, Math.min(innerWidth / 1600, innerHeight / 900)))
      document.documentElement.style.setProperty('--lb-zoom', z.toFixed(3))
    }
    fit()
    addEventListener('resize', fit)
    return () => removeEventListener('resize', fit)
  }, [])
}

export default function Lobby() {
  const auth = useAppStore((s) => s.auth)
  const isConnected = useAppStore((s) => s.isConnected)
  useFitZoom()

  return (
    <div className="lb">
      <div className="lb-hud">
        {auth === 'signed_in' ? <Hub /> : auth === 'signed_out' ? <SignIn /> : <p className="lb-status">Signing you in…</p>}
        {!isConnected && (
          <p className="lb-status lb-status--conn" role="status">
            {auth === 'signed_in' ? 'Reconnecting…' : 'Connecting…'}
          </p>
        )}
        <Toasts />
      </div>
    </div>
  )
}

function Hub() {
  const panel = useAppStore((s) => s.panel)
  const closePanel = useAppStore((s) => s.closePanel)
  const Panel = PANELS[panel]
  return (
    <>
      <Profile />
      <TopRight />
      <PlayColumn />
      <FriendsStrip />
      <Chat />
      <Dock />
      {Panel && <Panel onClose={closePanel} />}
      <News />
    </>
  )
}

function Profile() {
  const p = useAppStore((s) => s.profile)
  const r = p.rank || {}
  const pct = r.span ? Math.min(100, (100 * r.into) / r.span) : 100
  return (
    <div className="lb-profile">
      <div className="pframe">
        <Avatar character={p.equipped?.character} />
      </div>
      <div className="who">
        <div className="n">{p.display_name}</div>
        <div className="h">{p.username}</div>
        <div className="rk">
          <Crest color={rankColor(r.label)} />
          <b>{r.label}</b>
          <div>
            <div className="lb-bar lb-bar--rank">
              <i style={{ width: `${pct}%` }} />
            </div>
            <small>{r.next_label ? `${r.into} of ${r.span} RP` : `${r.rp} RP`}</small>
          </div>
        </div>
      </div>
    </div>
  )
}

function TopRight() {
  const coins = useAppStore((s) => s.profile.coins)
  const requests = useAppStore((s) => s.incoming.length)
  const openPanel = useAppStore((s) => s.openPanel)
  return (
    <div className="lb-tr">
      <div className="lb-panel lb-coin">
        <Coin />
        <b aria-label={`${coins} coins`}>{coins.toLocaleString()}</b>
        <button className="add" aria-label="Open the shop" onClick={() => openPanel('shop')}>
          +
        </button>
      </div>
      <button
        className="lb-panel lb-ib"
        aria-label={requests ? `Friend requests, ${requests} new` : 'Friend requests'}
        onClick={() => openPanel('friends')}
      >
        <Icon name="mail" />
        {requests > 0 && <span className="dot">{requests}</span>}
      </button>
      <button className="lb-panel lb-ib" aria-label="Settings" onClick={() => openPanel('settings')}>
        <Icon name="gear" />
      </button>
    </div>
  )
}

const TURN_OPTIONS = [15, 30, 60]

function PlayColumn() {
  const myId = useAppStore((s) => s.profile.id)
  const nextLabel = useAppStore((s) => s.profile.rank?.next_label)
  const party = useAppStore((s) => s.party)
  const send = useAppStore((s) => s.send)
  const openPanel = useAppStore((s) => s.openPanel)

  const members = party?.members || []
  const iLead = !!party && party.leader_id === myId
  const me = members.find((m) => m.id === myId)
  const others = members.slice(1)
  const notReady = others.filter((m) => !m.ready).length
  const route = party?.game === 'route' // Ang Mang Chok Chang: 1–4 people, bots fill the other seats
  const roles = party?.game === 'roles' || route // Raja Mantri Chor Sipahi too: same seating rules
  const bots = 4 - members.length

  let start
  if (!party) {
    start = (
      <button className="lb-start" disabled>
        Start<small>Setting up your party</small>
      </button>
    )
  } else if (iLead) {
    const status = roles
      ? members.length > 4 ? 'Seats 4 at most' : notReady ? `${notReady} not ready` : bots ? `${bots} bot${bots > 1 ? 's' : ''} fill in` : 'Everyone ready'
      : members.length < 2 ? 'Invite a friend' : notReady ? `${notReady} not ready` : 'Everyone ready'
    start = (
      <button className="lb-start" disabled={(roles ? members.length > 4 : members.length < 2) || notReady > 0} onClick={() => send('party_start')}>
        Start
        <small>
          Party of {members.length}
          <br />
          {status}
        </small>
      </button>
    )
  } else {
    start = me?.ready ? (
      <button className="lb-start lb-start--cancel" onClick={() => send('party_ready', { ready: false })}>
        Cancel
        <small>Waiting for the leader</small>
      </button>
    ) : (
      <button className="lb-start" onClick={() => send('party_ready', { ready: true })}>
        Ready
        <small>Tap when you are set</small>
      </button>
    )
  }

  const locked = !iLead
  return (
    <div className="lb-play">
      {start}
      {party && (
        <div className="lb-panel lb-mode">
          <div className="mrow">
            <div className="glogo">
              {route ? <RouteLogo /> : roles ? <RolesLogo /> : <GameLogo />}
            </div>
            <div className={`gname ${roles ? 'gname--long' : ''}`}>{route ? 'Ang Mang Chok Chang' : roles ? 'Raja Mantri Chor Sipahi' : 'UNO'}</div>
            {iLead && (
              <button className="chg" onClick={() => openPanel('games')}>
                Change game
              </button>
            )}
          </div>
          {route ? (
            <>
              <p className="lb-roles-note">4 seats · 4 pawns each · bots fill empty seats</p>
              <div className="lb-seg" role="radiogroup" aria-label="Rules">
                {['traditional', 'basic'].map((r) => (
                  <button
                    key={r}
                    role="radio"
                    aria-checked={(party.route_rules || 'traditional') === r}
                    disabled={locked}
                    className={(party.route_rules || 'traditional') === r ? 'act' : ''}
                    onClick={() => send('party_set', { route_rules: r })}
                  >
                    {r === 'traditional' ? 'Traditional' : 'Basic'}
                  </button>
                ))}
              </div>
            </>
          ) : roles ? (
            <p className="lb-roles-note">4 seats · 10 rounds · bots fill empty seats</p>
          ) : (
            <>
          <div className="lb-seg" role="radiogroup" aria-label="Mode">
            {['casual', 'ranked'].map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={party.mode === m}
                disabled={locked}
                className={party.mode === m ? 'act' : ''}
                onClick={() => send('party_set', { mode: m })}
              >
                {m === 'casual' ? 'Casual' : 'Ranked'}
              </button>
            ))}
          </div>
          <div className="lb-opt">
            <span id="lb-turn">Turn time</span>
            <div className="lb-chips" role="radiogroup" aria-labelledby="lb-turn">
              {TURN_OPTIONS.map((t) => (
                <button
                  key={t}
                  role="radio"
                  aria-checked={party.turn_seconds === t}
                  disabled={locked}
                  className={party.turn_seconds === t ? 'act' : ''}
                  onClick={() => send('party_set', { turn_seconds: t })}
                >
                  {t}s
                </button>
              ))}
            </div>
          </div>
          <div className="lb-opt">
            <span id="lb-stack">Stack +2 and +4</span>
            <button
              role="switch"
              aria-checked={!!party.stack_draw_cards}
              aria-labelledby="lb-stack"
              disabled={locked}
              className={`lb-switch ${party.stack_draw_cards ? 'on' : ''}`}
              onClick={() => send('party_set', { stack_draw_cards: !party.stack_draw_cards })}
            >
              <i />
            </button>
          </div>
            </>
          )}
          <div className="pstat">
            <span>
              {roles ? (
                'Casual: coins by final place'
              ) : party.mode === 'ranked' ? (
                nextLabel ? (
                  <>
                    Wins here count toward <b>{nextLabel}</b>
                  </>
                ) : (
                  'Ranked games change your RP'
                )
              ) : (
                'Casual games keep your rank'
              )}
            </span>
            {members.length > 1 && (
              <button className="lb-link" onClick={() => send('party_leave')}>
                Leave party
              </button>
            )}
          </div>
          {locked && <p className="lb-note">Only the party leader can change these</p>}
        </div>
      )}
      <EventBanner />
    </div>
  )
}

/** Rotating banner: rank climb and the closest milestone, from real profile data. */
function EventBanner() {
  const rank = useAppStore((s) => s.profile.rank) || {}
  const progress = useAppStore((s) => s.profile.milestones)
  const defs = useAppStore((s) => s.catalog.milestones)
  const openPanel = useAppStore((s) => s.openPanel)
  const items = useItemMap()
  const [slide, setSlide] = useState(0)

  const slides = [
    {
      panel: 'games', // opens Change game, where it's listed
      title: 'New game has arrived',
      text: 'Raja Mantri Chor Sipahi is here. Tap to play.',
      art: (
        <div className="emb">
          <span className="tagnew">New</span>
          <RolesLogo size={84} />
        </div>
      ),
    },
    {
      panel: 'games',
      title: 'Ang Mang Chok Chang',
      text: 'New game has arrived. Tap to play.',
      art: (
        <div className="emb">
          <span className="tagnew">New</span>
          <RouteLogo size={84} />
        </div>
      ),
    },
    {
      panel: 'ranks',
      title: rank.next_label ? `Climb to ${rank.next_label}` : `${rank.label} tier`,
      text: rank.next_label
        ? `${rank.span - rank.into} RP to go. Win ranked games to climb.`
        : 'You are at the top. Keep winning to hold it.',
      art: <Crest color={rankColor(rank.next_label || rank.label)} className="emb" />,
    },
  ]
  const next = (progress || [])
    .filter((m) => !m.unlocked)
    .sort((a, b) => b.progress / b.goal - a.progress / a.goal)[0]
  const def = next && defs.find((d) => d.id === next.id)
  if (def) {
    slides.push({
      panel: 'milestones',
      title: def.name,
      text: `${next.progress} of ${next.goal}. Unlocks ${items[def.reward]?.name || 'a reward'}.`,
      art: (
        <div className="emb">
          <ItemArt item={items[def.reward]} />
        </div>
      ),
    })
  }
  const cur = slides[slide % slides.length]

  useEffect(() => {
    if (reduce || slides.length < 2) return
    const id = setInterval(() => setSlide((s) => s + 1), 7000)
    return () => clearInterval(id)
  }, [slides.length])

  return (
    <div className="lb-banner">
      <button className="body" onClick={() => openPanel(cur.panel)}>
        <span className="bt">{cur.title}</span>
        <span className="bs">{cur.text}</span>
        {cur.art}
      </button>
      {slides.length > 1 && (
        <div className="dots">
          {slides.map((s, i) => (
            <button
              key={s.title}
              aria-label={`Show ${s.title}`}
              aria-current={i === slide % slides.length}
              onClick={() => setSlide(i)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const DOCK = [
  ['inventory', 'Inventory', 'bag'],
  ['shop', 'Shop', 'shop'],
  ['milestones', 'Milestones', 'medal'],
  ['ranks', 'Ranks', 'bars'],
]

function Dock() {
  const openPanel = useAppStore((s) => s.openPanel)
  const fresh = useAppStore((s) => s.newItems.length)
  const [emoting, setEmoting] = useState(false)
  return (
    <nav className="lb-dock" aria-label="Main menu">
      <div className="lb-emote-wrap">
        <button className="lb-panel lb-dk" aria-expanded={emoting} aria-haspopup="menu" onClick={() => setEmoting(!emoting)}>
          <Icon name="smile" />
          <b>Emote</b>
        </button>
        {emoting && <EmotePicker setOpen={setEmoting} />}
      </div>
      {DOCK.map(([id, label, icon]) => (
        <button key={id} className="lb-panel lb-dk" onClick={() => openPanel(id)}>
          <Icon name={icon} />
          <b>{label}</b>
          {id === 'inventory' && fresh > 0 && <span className="tagnew">{fresh} new</span>}
        </button>
      ))}
    </nav>
  )
}

/** Your emotes; locked ones say how to get their pack. Closes on pick, Esc or a click elsewhere. */
function EmotePicker({ setOpen }) {
  const emotes = useAppStore((s) => s.catalog.emotes)
  const inventory = useAppStore((s) => s.profile.inventory)
  const milestones = useAppStore((s) => s.catalog.milestones)
  const send = useAppStore((s) => s.send)
  const items = useItemMap()
  const ref = useRef(null)

  useEffect(() => {
    const away = (e) => !ref.current?.parentElement.contains(e.target) && setOpen(false)
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    addEventListener('pointerdown', away)
    addEventListener('keydown', esc)
    ref.current?.querySelector('button')?.focus()
    return () => {
      removeEventListener('pointerdown', away)
      removeEventListener('keydown', esc)
    }
  }, [setOpen])

  const howToGet = (pack) => {
    const item = items[pack]
    const m = milestones.find((d) => d.id === item?.milestone)
    return m ? `Unlocks with the ${m.name} milestone` : `Get ${item?.name || 'its emote pack'} in the shop`
  }

  return (
    <div ref={ref} className="lb-panel lb-emote-pick" role="menu" aria-label="Emotes">
      {emotes.map(({ id, pack }) => {
        const look = LOBBY_EMOTES[id]
        if (!look) return null
        const owned = inventory.includes(pack)
        return (
          <button
            key={id}
            role="menuitem"
            aria-disabled={!owned}
            title={owned ? look.name : howToGet(pack)}
            aria-label={owned ? look.name : `${look.name}, locked. ${howToGet(pack)}`}
            onClick={() => {
              if (!owned) return
              send('emote', { emote: id })
              setOpen(false)
            }}
          >
            <span className="ic">{look.icon}</span>
            <small>{owned ? look.name : 'Locked'}</small>
          </button>
        )
      })}
    </div>
  )
}

function Toasts() {
  const invite = useAppStore((s) => s.invites[0])
  const request = useAppStore((s) => s.requests[0])
  const party = useAppStore((s) => s.party)
  const error = useAppStore((s) => s.error)
  const notification = useAppStore((s) => s.notification)
  const { acceptInvite, dismissInvite, answerRequest } = useAppStore.getState()
  const left = party ? party.max - party.members.length : 0

  return (
    <div className="lb-toasts" aria-live="polite">
      {request && (
        <div className="lb-panel lb-toast">
          <Avatar character={request.from.character} />
          <p>
            <b>{request.from.display_name}</b> wants to join your party
            <span>{left > 0 ? `${left} ${left === 1 ? 'spot' : 'spots'} left` : 'Party is full'}</span>
          </p>
          <button className="lb-btn go" disabled={left <= 0} onClick={() => answerRequest(request.from.id, true)}>
            Let them in
          </button>
          <button className="lb-btn no" onClick={() => answerRequest(request.from.id, false)}>
            Not now
          </button>
        </div>
      )}
      {invite && (
        <div className="lb-panel lb-toast">
          <Avatar character={invite.from.character} />
          <p>
            <b>{invite.from.display_name}</b> invited you to their party
            <span>
              Party of {invite.size} · <SecondsLeft until={invite.expires_at} />s left
            </span>
          </p>
          <button className="lb-btn go" onClick={() => acceptInvite(invite.party_id)}>
            Join party
          </button>
          <button className="lb-btn no" onClick={() => dismissInvite(invite.party_id)}>
            Not now
          </button>
        </div>
      )}
      {notification && <div className="lb-panel lb-toast lb-toast--info">{notification}</div>}
      {error && (
        <div className="lb-panel lb-toast lb-toast--error" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
