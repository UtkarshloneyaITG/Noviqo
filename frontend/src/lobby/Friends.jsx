/**
 * Friends — the right-edge strip; the friends sidebar that slides in from the
 * right (search your friends, requests, + to invite with a 30 s countdown,
 * "Add friend" at the bottom) and the full-page Add friend search over every player.
 */
import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { Avatar, Icon, Modal, SecondsLeft, lastSeen, rankColor } from './ui'

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

/** What's typed in a search box, the way names are compared ("@Gam " → "gam"). */
const cleanQuery = (text) => text.trim().replace(/^@/, '').toLowerCase().slice(0, 20)

/** Shared friend/party facts and the two party actions. */
function useFriendState() {
  const friends = useAppStore((s) => s.friends)
  const party = useAppStore((s) => s.party)
  const send = useAppStore((s) => s.send)
  const inviteFriend = useAppStore((s) => s.inviteFriend)
  const sent = useAppStore((s) => s.sentInvites)
  const inParty = new Set((party?.members || []).map((m) => m.id))
  const full = !!party && party.members.length >= party.max
  return {
    friends: sortFriends(friends),
    inParty,
    full,
    online: friends.filter((f) => f.status !== 'offline').length,
    sent, // friend id -> when your invite to them lapses
    // The server confirms both with a notice.
    invite: (f) => inviteFriend(f.id),
    join: (f) => send('party_request', { id: f.id }),
  }
}

export function FriendsStrip() {
  const openPanel = useAppStore((s) => s.openPanel)
  const { friends, inParty, full, online, sent, invite, join } = useFriendState()

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
            {!mine && f.status === 'online' && !full && (sent[f.id] ? (
              <span className="inv inv--wait" aria-label={`Invited ${f.display_name}`}>
                <SecondsLeft until={sent[f.id]} />
              </span>
            ) : (
              <button className="inv" aria-label={`Invite ${f.display_name} to your party`} onClick={() => invite(f)}>
                +
              </button>
            ))}
            {!mine && f.status === 'in_game' && (
              <button className="inv inv--join" aria-label={`Ask to join ${f.display_name}'s party`} onClick={() => join(f)}>
                Join
              </button>
            )}
          </div>
        )
      })}
      <button className="fadd" aria-label="Add a friend" onClick={() => openPanel('addfriend')}>
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

/** + to invite a friend to your party; while the invite is out it counts down its 30 seconds. */
function InviteButton({ friend, until, why, onInvite }) {
  if (until) {
    return (
      <button className="lb-invbtn wait" disabled aria-label={`Invite sent to ${friend.display_name}`}>
        <SecondsLeft until={until} />s
      </button>
    )
  }
  return (
    <button
      className="lb-invbtn"
      disabled={!!why}
      title={why || `Invite ${friend.display_name} to your party`}
      aria-label={why ? `Can't invite ${friend.display_name}: ${why}` : `Invite ${friend.display_name} to your party`}
      onClick={onInvite}
    >
      +
    </button>
  )
}

/** Status line under a name, with the rank in its tier colour. */
const statusAndRank = (p, inParty) => (
  <>
    {statusLabel(p, inParty)}
    {p.rank_label && (
      <span className="lb-rank" style={{ color: rankColor(p.rank_label) }}>
        {p.rank_label}
      </span>
    )}
  </>
)

function SearchBox({ value, onChange, label, inputRef }) {
  return (
    <label className="lb-find">
      <Icon name="search" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        aria-label={label}
        autoCapitalize="none"
        spellCheck={false}
        maxLength={40}
      />
    </label>
  )
}

/** Left sidebar: your friends (the search only filters this list), requests, and Add friend. */
export function FriendsPanel({ onClose }) {
  const incoming = useAppStore((s) => s.incoming)
  const outgoing = useAppStore((s) => s.outgoing)
  const send = useAppStore((s) => s.send)
  const openPanel = useAppStore((s) => s.openPanel)
  const { friends, inParty, full, online, sent, invite, join } = useFriendState()
  const [filter, setFilter] = useState('')

  const q = cleanQuery(filter)
  const shown = q ? friends.filter((f) => f.display_name.toLowerCase().includes(q) || f.username.slice(1).includes(q)) : friends

  return (
    <Modal title="Friends" badge={`${online} online`} onClose={onClose} className="lb-drawer">
      <SearchBox value={filter} onChange={setFilter} label="Search your friends" />

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

      <section className="lb-sec" aria-label="Your friends">
        {friends.length === 0 && <p className="lb-empty">No friends yet. Tap Add friend to find people to play with.</p>}
        {friends.length > 0 && shown.length === 0 && <p className="lb-empty">None of your friends match “{filter.trim()}”.</p>}
        {shown.map((f) => {
          const mine = inParty.has(f.id)
          return (
            <Row key={f.id} person={f} ring={mine ? 'var(--green)' : RING[f.status]} sub={statusAndRank(f, mine)}>
              {!mine && f.status === 'in_game' && (
                <button className="lb-btn no" onClick={() => join(f)}>
                  Ask to join
                </button>
              )}
              {!mine && (
                <InviteButton
                  friend={f}
                  until={sent[f.id]}
                  why={f.status === 'offline' ? 'Offline' : f.status === 'in_game' ? 'In a game' : full ? 'Your party is full' : null}
                  onInvite={() => invite(f)}
                />
              )}
            </Row>
          )
        })}
      </section>

      {outgoing.length > 0 && (
        <section className="lb-sec">
          <h3>Sent</h3>
          {outgoing.map((p) => (
            <Row key={p.id} person={p} sub="Waiting for them to accept" />
          ))}
        </section>
      )}

      <div className="lb-addbar">
        <button className="lb-btn go" onClick={() => openPanel('addfriend')}>
          + Add friend
        </button>
      </div>
    </Modal>
  )
}

/** Full page: search every player by name or @username; an empty box shows a random handful. */
export function AddFriend() {
  const openPanel = useAppStore((s) => s.openPanel)
  const send = useAppStore((s) => s.send)
  const results = useAppStore((s) => s.userResults)
  const friends = useAppStore((s) => s.friends)
  const incoming = useAppStore((s) => s.incoming)
  const outgoing = useAppStore((s) => s.outgoing)
  const [text, setText] = useState('')
  const box = useRef(null)
  const q = cleanQuery(text)

  useEffect(() => box.current?.focus(), []) // runs after the dialog has opened
  useEffect(() => {
    const id = setTimeout(() => send('user_search', { q }), q ? 250 : 0) // wait for a pause in typing
    return () => clearTimeout(id)
  }, [q, send])

  const has = (list, id) => list.some((p) => p.id === id)
  const fresh = results?.q === q
  const users = results?.users || []

  return (
    <Modal title="Add friend" onClose={() => openPanel('friends')} className="lb-page">
      <SearchBox value={text} onChange={setText} label="Search players by name or @username" inputRef={box} />
      <p className="lb-find-note" role="status">
        {q ? `Players matching “${text.trim()}”` : 'Players in the game. Type a name to search.'}
      </p>
      {fresh && users.length === 0 && (
        <p className="lb-empty">{q ? `No players match “${text.trim()}”.` : 'No one else to add yet.'}</p>
      )}
      <div className="lb-people" aria-busy={!fresh}>
        {users.map((p) => (
          <Row key={p.id} person={p} ring={RING[p.status]} sub={statusAndRank(p)}>
            {has(friends, p.id) ? (
              <span className="lb-chip">Friends</span>
            ) : has(outgoing, p.id) ? (
              <button className="lb-btn no" disabled>
                Requested
              </button>
            ) : has(incoming, p.id) ? (
              <button className="lb-btn go" onClick={() => send('friend_accept', { id: p.id })}>
                Accept
              </button>
            ) : (
              <button className="lb-btn go" onClick={() => send('friend_request', { username: p.username })}>
                Add friend
              </button>
            )}
          </Row>
        ))}
      </div>
    </Modal>
  )
}
