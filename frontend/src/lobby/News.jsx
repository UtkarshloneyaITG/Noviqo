/**
 * News — a one-time announcement popup in the lobby. Shown a moment after
 * the lobby appears, once per browser: Play now (opens Change game) or Later
 * both dismiss it for good. Bump NEWS_ID for the next announcement.
 */
import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { Modal, RolesArt } from './ui'

const NEWS_ID = 'nq.news.new-game-1'

function seen() {
  try {
    return localStorage.getItem(NEWS_ID) === '1'
  } catch {
    return false // storage blocked: show it, it just can't be remembered
  }
}

export default function News() {
  const panel = useAppStore((s) => s.panel)
  const openPanel = useAppStore((s) => s.openPanel)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (seen()) return
    const id = setTimeout(() => setOpen(true), 1200)
    return () => clearTimeout(id)
  }, [])

  const dismiss = () => {
    try {
      localStorage.setItem(NEWS_ID, '1')
    } catch {
      /* not remembered; fine */
    }
    setOpen(false)
  }

  if (!open || panel) return null // never on top of another panel
  return (
    <Modal title="New game is arriving" onClose={dismiss} className="lb-news">
      <RolesArt />
      <p className="lb-news-text">Play now.</p>
      <div className="lb-news-act">
        <button className="lb-btn no" onClick={dismiss}>
          Later
        </button>
        <button
          className="lb-btn go"
          onClick={() => {
            dismiss()
            openPanel('games')
          }}
        >
          Play now
        </button>
      </div>
    </Modal>
  )
}
