/**
 * Friends — the right-edge strip, the full friends panel (requests, add by
 * @username, remove) and the invite picker used by the empty pedestals.
 */
import { useState } from 'react'
import { useAppStore } from '../store/appStore'
import { Avatar, Icon, Modal, USERNAME_RE, lastSeen, normalizeUsername, rankColor } from './ui'

const ORDER = { online: 0, in_game: 1, offline: 2 }
const RING = { online: 'var(--green)', in_game: 'var(--amber)', offline: '#4a5170' }

function statusLabel(f, inParty) {
  if (inParty) return 'In your party'
  if (f.status === 'online') return 'Online'
  if (f.status === 'in_game') return 'In a game'
  return lastSeen(f.last_seen)
}

const sortFriends = (list) =>
  [...list].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.display_name.localeCompare(b.display_name))

/** Shared friend/party facts and the two party actions. */
function useFriendState() {
  const friends = useAppStore((s) => s.friends)
  const party = useAppStore((s) => s.party)
  const send = useAppStore((s) => s.send)
  const inParty = new Set((party?.members || []).map((m) => m.id))
  const full = !!party && party.members.length >= party.max
  return {
    friends: sortFriends(friends),
    inParty,
    full,
    online: friends.filter((f) => f.status !== 'offline').length,
    // The server confirms both with a notice.
    invite: (f) => send('party_invite', { id: f.id }),
    join: (f) => send('party_request', { id: f.id }),
  }
}

export function FriendsStrip() {
  const openPanel = useAppStore((s) => s.openPanel)
  const { friends, inParty, full, online, invite, join } = useFriendState()

  return (
    <aside className="lb-panel lb-friends" aria-label="Friends">
      <button className="fh" onClick={() => openPanel('friends')} aria-label={`Friends, ${online} online`}>
        <Icon name="friends" />
        <small>{online} online</small>
      </button>
      {friends.slice(0, 6).map((f) => {
        const mine = inParty.has(f.id)
        const label = mine ? 'Party' : statusLabel(f)
        return (
          <div key={f.id} className={`fbtn ${f.status === 'offline' ? 'off' : ''}`} style={{ '--rc': mine ? 'var(--green)' : RING[f.status] }}>
            <button className="who" onClick={() => openPanel('friends')} aria-label={`${f.display_name}, ${label}`}>
              <Avatar character={f.character} />
              <i className="ring" />
              <span>{f.display_name}</span>
              <em>{label}</em>
            </button>
            {!mine && f.status === 'online' && !full && (
              <button className="inv" aria-label={`Invite ${f.display_name} to your party`} onClick={() => invite(f)}>
                +
              </button>
            )}
            {!mine && f.status === 'in_game' && (
              <button className="inv inv--join" aria-label={`Ask to join ${f.display_name}'s party`} onClick={() => join(f)}>
                Join
              </button>
            )}
          </div>
        )
      })}
      <button className="fadd" aria-label="Add a friend by @username" onClick={() => openPanel('friends')}>
        +
      </button>
    </aside>
  )
}

function Row({ person, ring, sub, children }) {
  return (
    <div className="lb-row">
      <div className="lb-rav" style={{ '--rc': ring || 'transparent' }}>
        <Avatar character={person.character} />
        <i className="ring" />
      </div>
      <div className="lb-rtext">
        <b>{person.display_name}</b>
        <small>{person.username}</small>
        {sub && <small>{sub}</small>}
      </div>
      <div className="lb-ractions">{children}</div>
    </div>
  )
}

export function FriendsPanel({ onClose }) {
  const incoming = useAppStore((s) => s.incoming)
  const outgoing = useAppStore((s) => s.outgoing)
  const send = useAppStore((s) => s.send)
  const { friends, inParty, full, online, invite, join } = useFriendState()
  const [handle, setHandle] = useState('')
  const [tried, setTried] = useState(false)
  const [removing, setRemoving] = useState(null)

  const uname = normalizeUsername(handle)
  const ok = USERNAME_RE.test(uname)
  const add = (e) => {
    e.preventDefault()
    setTried(true)
    if (!ok) return
    send('friend_request', { username: uname })
    setHandle('')
    setTried(false)
  }

  return (
    <Modal title="Friends" onClose={onClose}>
      <form className="lb-addf" onSubmit={add} noValidate>
        <label className="lb-field">
          <span>Add a friend</span>
          <span className="lb-at">
            <i aria-hidden="true">@</i>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value.replace(/^@/, '').toLowerCase())}
              placeholder="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={21}
              aria-invalid={tried && !ok}
              aria-describedby="lb-err-add"
            />
          </span>
          <em id="lb-err-add">{tried && !ok && 'Use 3 to 20 letters, numbers or underscores'}</em>
        </label>
        <button className="lb-btn go">Send request</button>
      </form>

      {incoming.length > 0 && (
        <section className="lb-sec">
          <h3>Requests</h3>
          {incoming.map((p) => (
            <Row key={p.id} person={p} sub="Wants to be your friend">
              <button className="lb-btn go" onClick={() => send('friend_accept', { id: p.id })}>
                Accept
              </button>
              <button className="lb-btn no" onClick={() => send('friend_decline', { id: p.id })}>
                Decline
              </button>
            </Row>
          ))}
        </section>
      )}

      {outgoing.length > 0 && (
        <section className="lb-sec">
          <h3>Sent</h3>
          {outgoing.map((p) => (
            <Row key={p.id} person={p} sub="Waiting for them to accept" />
          ))}
        </section>
      )}

      <section className="lb-sec">
        <h3>
          Friends <small>{online} online</small>
        </h3>
        {friends.length === 0 && <p className="lb-empty">No friends yet. Add someone by their @username.</p>}
        {friends.map((f) => {
          const mine = inParty.has(f.id)
          return (
            <Row
              key={f.id}
              person={f}
              ring={mine ? 'var(--green)' : RING[f.status]}
              sub={
                <>
                  {statusLabel(f, mine)}
                  {f.rank_label && (
                    <span className="lb-rank" style={{ color: rankColor(f.rank_label) }}>
                      {f.rank_label}
                    </span>
                  )}
                </>
              }
            >
              {!mine && f.status === 'online' && (
                <button className="lb-btn go" disabled={full} onClick={() => invite(f)}>
                  Invite
                </button>
              )}
              {!mine && f.status !== 'offline' && (
                <button className="lb-btn no" onClick={() => join(f)}>
                  Ask to join
                </button>
              )}
              {removing === f.id ? (
                <button
                  className="lb-btn danger"
                  onClick={() => {
                    send('friend_remove', { id: f.id })
                    setRemoving(null)
                  }}
                >
                  Confirm remove
                </button>
              ) : (
                <button className="lb-btn no" onClick={() => setRemoving(f.id)} aria-label={`Remove ${f.display_name}`}>
                  Remove
                </button>
              )}
            </Row>
          )
        })}
      </section>
    </Modal>
  )
}

export function InvitePicker({ onClose }) {
  const openPanel = useAppStore((s) => s.openPanel)
  const { friends, inParty, full, invite } = useFriendState()
  const [sent, setSent] = useState([])
  const available = friends.filter((f) => f.status === 'online' && !inParty.has(f.id))

  return (
    <Modal title="Invite to your party" onClose={onClose}>
      {full && <p className="lb-empty">Your party is full.</p>}
      {!full && available.length === 0 && (
        <div className="lb-empty">
          <p>None of your friends are online right now.</p>
          <button className="lb-btn go" onClick={() => openPanel('friends')}>
            Add a friend
          </button>
        </div>
      )}
      {!full &&
        available.map((f) => (
          <Row key={f.id} person={f} ring={RING.online} sub={f.rank_label}>
            <button
              className="lb-btn go"
              disabled={sent.includes(f.id)}
              onClick={() => {
                invite(f)
                setSent([...sent, f.id])
              }}
            >
              {sent.includes(f.id) ? 'Invited' : 'Invite'}
            </button>
          </Row>
        ))}
    </Modal>
  )
}
