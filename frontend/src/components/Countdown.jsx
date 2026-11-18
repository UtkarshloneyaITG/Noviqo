/**
 * Countdown — 3, 2, 1 over the table when a new deal starts. The server
 * holds the first turn clock until it ends, and the overlay swallows clicks
 * so nobody plays early. countdown_ms_left is relative, so clock skew and a
 * refresh mid-countdown both show the right number.
 */
import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../store/appStore'
import '../styles/table.css'

export default function Countdown() {
  const state = useAppStore((s) => s.gameState)
  const msLeft = state?.countdown_ms_left || 0
  // Re-anchored on every state message (a rematch can repeat the same ms value).
  const end = useMemo(() => Date.now() + msLeft, [state]) // eslint-disable-line react-hooks/exhaustive-deps
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    if (end <= Date.now()) return
    setNow(Date.now())
    const id = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t >= end) clearInterval(id)
    }, 100)
    return () => clearInterval(id)
  }, [end])

  const n = Math.ceil(Math.min(msLeft, end - now) / 1000)
  if (state?.status !== 'playing' || n <= 0) return null
  return (
    <div className="tb tb-countdown" role="status" aria-live="assertive">
      <span key={n} className="tb-countdown-n">{n}</span>
    </div>
  )
}
