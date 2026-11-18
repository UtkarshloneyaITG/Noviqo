/**
 * ChatBar — bottom-right in-game chat + quick emotes. Messages are broadcast
 * via the store and appear as bubbles above each player's head; your own
 * message echoes here as confirmation.
 */
import { useState, useMemo } from 'react'
import { useAppStore } from '../store/appStore'
import { emotesFor } from '../items'
import '../styles/table.css'

const NO_ITEMS = []

export default function ChatBar() {
  const playing = useAppStore((s) => s.gameState?.status === 'playing')
  const myBubble = useAppStore((s) => s.bubbles?.[s.playerId])
  const sendChat = useAppStore((s) => s.sendChat)
  const inventory = useAppStore((s) => s.profile?.inventory) || NO_ITEMS
  const emojis = useMemo(() => emotesFor(inventory), [inventory])
  const [text, setText] = useState('')
  const [showEmojis, setShowEmojis] = useState(false)

  if (!playing) return null

  const submit = (e) => {
    e?.preventDefault()
    if (text.trim()) {
      sendChat(text)
      setText('')
    }
  }

  return (
    <div className="tb tb-chat">
      {myBubble && <div className="tb-panel tb-chat-echo">{myBubble.text}</div>}

      {showEmojis && (
        <div className="tb-panel tb-emojis">
          {emojis.map((e) => (
            <button key={e} className="tb-emoji" onClick={() => sendChat(e)} type="button" aria-label={`Send ${e}`}>
              {e}
            </button>
          ))}
        </div>
      )}

      <form className="tb-panel tb-chat-form" onSubmit={submit}>
        <button
          type="button"
          className="tb-chat-toggle"
          onClick={() => setShowEmojis((v) => !v)}
          aria-expanded={showEmojis}
          aria-label="Quick emotes"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle className="f" cx="12" cy="12" r="9" />
            <path d="M8.3 14.1a4.5 4.5 0 0 0 7.4 0M9.2 9.4v.8M14.8 9.4v.8" />
          </svg>
        </button>
        <input
          className="tb-chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Say something"
          aria-label="Chat message"
          maxLength={120}
        />
        <button className="tb-btn tb-btn--ghost" type="submit">
          Send
        </button>
      </form>
    </div>
  )
}
