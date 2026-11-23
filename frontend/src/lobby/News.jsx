/**
 * News — one-time announcement popups in the lobby, newest first. A moment
 * after the lobby appears it shows the first one this browser hasn't seen;
 * Play now (opens Change game) or Later dismisses it for good, and the next
 * one waits for the next visit. Add an entry at the top for a new announcement.
 */
import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { Modal, RolesArt, RouteArt } from './ui'

const NEWS = [
  { id: 'nq.news.route-1', title: 'Ang Mang Chok Chang has arrived', text: 'A new game is here. Play now.', Art: RouteArt },
  { id: 'nq.news.new-game-1', title: 'Raja Mantri Chor Sipahi has arrived', text: 'A new game is here. Play now.', Art: RolesArt },
]

function seen(id) {
  try {
    return localStorage.getItem(id) === '1'
  } catch {
    return false // storage blocked: show it, it just can't be remembered
  }
}

export default function News() {
  const panel = useAppStore((s) => s.panel)
  const openPanel = useAppStore((s) => s.openPanel)
  const [item, setItem] = useState(null)

  useEffect(() => {
    const next = NEWS.find((n) => !seen(n.id))
    if (!next) return
    const t = setTimeout(() => setItem(next), 1200)
    return () => clearTimeout(t)
  }, [])

  const dismiss = () => {
    try {
      localStorage.setItem(item.id, '1')
    } catch {
      /* not remembered; fine */
    }
    setItem(null)
  }

  if (!item || panel) return null // never on top of another panel
  const { Art } = item
  return (
    <Modal title={item.title} onClose={dismiss} className="lb-news">
      <Art />
      <p className="lb-news-text">{item.text}</p>
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
