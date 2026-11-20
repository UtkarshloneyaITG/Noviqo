/**
 * Ranks — a full page. My rank is a showcase: your tier emblem centre stage
 * (light rays, division pips, RP and progress), your ranked record on the
 * left and the tier road on the right. The Server rank button switches to
 * every player, first to last, with the top three on a podium. The server
 * list is fetched each time the page opens.
 */
import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { Avatar, Crest, Modal, TIERS, rankColor } from './ui'
import TierEmblem from './Emblem'

const winsText = (n) => `${n} ${n === 1 ? 'win' : 'wins'}`

/** Your tier emblem, centre stage, on turning light rays. */
function Showcase({ tier, label }) {
  return (
    <div className="lb-rk-emblem" aria-hidden="true">
      <span className="rays" />
      <span className="halo" />
      <TierEmblem tier={tier} division={(label || '').split(' ')[1]} size={270} className="lb-emblem-big" />
    </div>
  )
}

/** Every tier from the top down: the ones you've passed, yours, and what's left to climb. */
function TierRoad({ here }) {
  return (
    <ol className="lb-rk-road" aria-label="Tiers">
      {TIERS.map((t, i) => (
        <li key={t.name} className={i === here ? 'cur' : i < here ? 'past' : 'next'} style={{ '--tc': t.color }} aria-current={i === here || undefined}>
          <TierEmblem tier={t.name} size={42} />
          <span>
            <b>{t.name}</b>
            <small>{t.name === 'Master' ? `${t.rp}+ RP` : `From ${t.rp} RP`}</small>
          </span>
          {i === here && <em>You</em>}
        </li>
      )).reverse()}
    </ol>
  )
}

function Row({ r, mine }) {
  return (
    <li className={mine ? 'me' : ''} aria-current={mine || undefined}>
      <span className="pl">{r.place}</span>
      <Avatar character={r.character} />
      <span className="who">
        <b>{r.display_name}</b>
        <small>{r.username}</small>
      </span>
      <span className="rk">
        <Crest color={rankColor(r.rank_label)} />
        {r.rank_label}
      </span>
      <span className="val">
        {r.rp} RP<small>{winsText(r.wins)}</small>
      </span>
    </li>
  )
}

function ServerRank({ data, onBack, onRetry }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (data) return
    setSlow(false)
    const id = setTimeout(() => setSlow(true), 6000) // no reply: say so instead of spinning forever
    return () => clearTimeout(id)
  }, [data])
  const back = (
    <button className="lb-btn no" onClick={onBack}>
      ‹ My rank
    </button>
  )
  if (!data) {
    return (
      <div className="lb-rk-bar">
        {back}
        <span role="status">{slow ? 'The server didn’t answer.' : 'Loading the server rank…'}</span>
        {slow && (
          <button className="lb-btn go" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    )
  }
  const { rows, me } = data
  const [first, second, third] = rows
  const podium = [second, first, third].filter(Boolean) // 2 · 1 · 3, winner in the middle
  const jumpToMe = () =>
    document.querySelector('.lb-rkpage li.me')?.scrollIntoView({ block: 'center', behavior: 'smooth' })

  return (
    <>
      <div className="lb-rk-bar">
        {back}
        <span>
          {rows.length} {rows.length === 1 ? 'player' : 'players'}, ranked by RP (ties go to more wins)
        </span>
        <button className="lb-btn go" onClick={jumpToMe}>
          Jump to me · #{me.place}
        </button>
      </div>
      <ol className="lb-podium" aria-label="Top three">
        {podium.map((r) => (
          <li key={r.id} className={`p${r.place} ${r.id === me.id ? 'me' : ''}`} aria-current={r.id === me.id || undefined}>
            <span className="pl">{r.place}</span>
            <Avatar character={r.character} />
            <b>{r.display_name}</b>
            <small>{r.username}</small>
            <span className="rk">
              <Crest color={rankColor(r.rank_label)} />
              {r.rank_label}
            </span>
            <span className="val">{r.rp} RP</span>
            <small>{winsText(r.wins)}</small>
          </li>
        ))}
      </ol>
      {rows.length > 3 && (
        <ol className="lb-lead" aria-label="Everyone else">
          {rows.slice(3).map((r) => (
            <Row key={r.id} r={r} mine={r.id === me.id} />
          ))}
        </ol>
      )}
    </>
  )
}

export default function Ranks({ onClose }) {
  const profile = useAppStore((s) => s.profile)
  const board = useAppStore((s) => s.leaderboard)
  const send = useAppStore((s) => s.send)
  const [view, setView] = useState('mine')
  const [asked, setAsked] = useState(0) // bump to ask again (opening Server rank, Try again)
  useEffect(() => {
    send('leaderboard', { board: 'rp', scope: 'server' }) // your place on the record, and the Server rank list
  }, [send, asked])
  const ask = () => setAsked((n) => n + 1)

  const server = board?.scope === 'server' ? board : null
  const place = server?.me.place
  const r = profile.rank || {}
  const stats = profile.stats || {}
  const color = rankColor(r.label)
  const here = TIERS.findIndex((t) => t.name === r.tier)
  const pct = r.span ? Math.min(100, (100 * r.into) / r.span) : 100
  const record = [
    ['Server rank', place ? `#${place}` : '–', server && `of ${server.rows.length}`],
    ['Rank points', r.rp ?? 0],
    ['Games', stats.games ?? 0],
    ['Wins', stats.wins ?? 0],
    ['Win rate', `${stats.games ? Math.round((100 * stats.wins) / stats.games) : 0}%`],
    ['Ranked wins', stats.ranked_wins ?? 0],
  ]

  return (
    <Modal title="Ranks" onClose={onClose} className="lb-page lb-rkpage">
      {view === 'server' ? (
        <ServerRank data={server} onBack={() => setView('mine')} onRetry={ask} />
      ) : (
        <div className="lb-rk-stage" style={{ '--tc': color }}>
          <aside className="lb-rk-side" aria-label="Ranked record">
            <h3>Ranked record</h3>
            <dl className="lb-rk-record">
              {record.map(([k, v, sub]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>
                    {v}
                    {sub && <small>{sub}</small>}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="lb-note">
              Only ranked games change RP. In a 4-player game 1st gets +30, 2nd +10, 3rd −5 and 4th −15; leaving early costs 15.
              Each tier has three divisions, III to I, of 100 RP each.
            </p>
          </aside>

          <section className="lb-rk-center" aria-label="Your rank">
            <Showcase tier={r.tier} label={r.label} />
            <div className="lb-rk-tier">{r.label}</div>
            <div className="lb-rk-rp">
              <b>{r.rp ?? 0}</b> RP
            </div>
            <div className="lb-rk-progress">
              <div className="lb-bar" role="progressbar" aria-label="Progress to the next division" aria-valuemin={0} aria-valuemax={r.span || 1} aria-valuenow={r.span ? r.into : 1}>
                <i style={{ width: `${pct}%` }} />
              </div>
              <small>{r.next_label ? `${r.into} of ${r.span} RP to ${r.next_label}` : 'Top tier reached'}</small>
            </div>
            <button
              className="lb-start lb-rk-cta"
              onClick={() => {
                setView('server')
                ask() // fresh list every time
              }}
            >
              Server rank
              <small>{place ? `You are #${place}` : 'See every player'}</small>
            </button>
          </section>

          <aside className="lb-rk-side lb-rk-roadwrap" aria-label="Tier road">
            <h3>Tier road</h3>
            <TierRoad here={here} />
          </aside>
        </div>
      )}
    </Modal>
  )
}
