/**
 * Chat — bottom-left: Everyone (gchat) and Party (pchat) channels, with an
 * emote picker built from the emote packs the player owns.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { emotesFor } from '../items'
import { Icon, nameColor } from './ui'

const CHANNELS = [
  ['gchat', 'Everyone', 'Message everyone'],
  ['pchat', 'Party', 'Message your party'],
]

export default function Chat() {
  const [channel, setChannel] = useState('gchat')
  const [text, setText] = useState('')
  const [picking, setPicking] = useState(false)
  const msgs = useAppStore((s) => s[channel])
  const myId = useAppStore((s) => s.profile.id)
  const inventory = useAppStore((s) => s.profile.inventory)
  const send = useAppStore((s) => s.send)
  const emotes = useMemo(() => emotesFor(inventory), [inventory])
  const list = useRef(null)
  const input = useRef(null)

  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight
  }, [msgs, channel, picking])

  const submit = (e) => {
    e.preventDefault()
    const t = text.trim().slice(0, 200)
    if (!t) return
    send(channel, { text: t })
    setText('')
  }

  return (
    <section className="lb-panel lb-chat" aria-label="Chat">
      <div className="lb-tabs" role="tablist" aria-label="Chat channel">
        {CHANNELS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={channel === id}
            className={`lb-tab ${channel === id ? 'act' : ''}`}
            onClick={() => setChannel(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {picking ? (
        <div className="lb-emotes" role="group" aria-label="Emotes">
          {emotes.map((em) => (
            <button
              key={em}
              type="button"
              aria-label={`Add ${em}`}
              onClick={() => {
                setText((t) => (t + em).slice(0, 200))
                setPicking(false)
                input.current?.focus()
              }}
            >
              {em}
            </button>
          ))}
        </div>
      ) : (
        <div className="lb-msgs" ref={list} role="log" tabIndex={0} aria-label={`${channel === 'gchat' ? 'Everyone' : 'Party'} messages`}>
          {msgs.length === 0 && (
            <p className="sys">{channel === 'gchat' ? 'Say hi to everyone online' : 'Only your party sees these messages'}</p>
          )}
          {msgs.map((m) => (
            <p key={m.id}>
              <b style={{ color: m.from.id === myId ? 'var(--cyan)' : nameColor(m.from.id) }}>{m.from.display_name}</b>
              {m.text}
            </p>
          ))}
        </div>
      )}

      <form className="lb-ci" onSubmit={submit}>
        <button
          type="button"
          className="lb-emo"
          aria-label="Emotes"
          aria-expanded={picking}
          onClick={() => setPicking(!picking)}
        >
          <Icon name="smile" />
        </button>
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={200}
          placeholder={CHANNELS.find(([id]) => id === channel)[2]}
          aria-label={CHANNELS.find(([id]) => id === channel)[2]}
        />
        <button className="lb-btn no">Send</button>
      </form>
    </section>
  )
}
