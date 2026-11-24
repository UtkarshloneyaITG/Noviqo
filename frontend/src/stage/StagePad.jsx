/**
 * StagePad — Ring Clash controls, first person.
 *
 * Desktop: WASD (or the arrows) move relative to where you look: W forward,
 * S back, A/D sideways. The mouse looks: a left click jabs (and captures the
 * mouse the first time; Esc frees it), a right click crosses. Q jab, E cross,
 * Shift (hold) guard, Space jump, C roll (rolling at the ropes takes you under
 * them, out of the ring or back in). Phones: the joystick moves, swiping the
 * right half of the screen looks, buttons for the rest.
 *
 * What you hold (a direction snapped to 8 ways, the guard, the way you look)
 * goes to the server when it changes, at most 10 times a second, and again
 * once a second while held (so a lost "let go" can't leave you walking);
 * presses go at once, at least 150 ms apart (key repeat ignored; the server
 * ignores presses mid-move, it never queues them). Everything shares one
 * budget of 12 a second; the socket allows 15. Turning is shown on your own
 * screen at once (stageAim), so looking around never waits for the network.
 */
import { useEffect, useRef, useState } from 'react'
import { stageAim, useAppStore } from '../store/appStore'
import { makeBudget, quantizeMove } from './info'

const SEND_GAP_MS = 100
const RESEND_MS = 1000
const PRESS_GAP_MS = 150
const YAW_STEP = 0.03 // radians of turn worth telling the server about
const MOUSE_TURN = 0.0024 // radians per pixel of mouse movement
const SWIPE_TURN = 0.006 // radians per pixel of swipe
const PITCH_MAX = 0.55
const KEYS = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
}
const ACTS = { KeyQ: 'jab', KeyE: 'cross', Space: 'jump', KeyC: 'roll' }
const GUARD_KEYS = new Set(['ShiftLeft', 'ShiftRight'])
const STICK_R = 46 // px the knob travels
const fine = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches
const canvas = () => document.querySelector('canvas')
const look = (dx, dy, k) => {
  stageAim.yaw -= dx * k
  stageAim.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, stageAim.pitch - dy * k))
}

export default function StagePad() {
  const want = useRef({ keys: new Set(), stick: null, guardKey: false, guardBtn: false })
  const [knob, setKnob] = useState(null) // { x, y } px offset while the stick is held
  const [locked, setLocked] = useState(false)
  const budget = useRef(makeBudget(12, 1000)).current
  const lastPress = useRef(-Infinity)
  const press = (a) => {
    const now = performance.now()
    if (now - lastPress.current < PRESS_GAP_MS || !budget(now)) return
    lastPress.current = now
    useAppStore.getState().stageAct(a)
  }

  // each round starts looking where the server stood you (everyone faces the centre)
  useEffect(() => {
    let phase = null
    const sync = (s) => {
      const st = s.stageState
      if (!st) return
      const me = st.fighters[st.you]
      if (st.phase === 'ready' && phase !== 'ready' && me) Object.assign(stageAim, { yaw: me.yaw, pitch: 0 })
      phase = st.phase
    }
    sync(useAppStore.getState())
    return useAppStore.subscribe(sync)
  }, [])

  // send what's held whenever it changes, never faster than SEND_GAP_MS
  useEffect(() => {
    let sent = { q: undefined, guard: undefined, yaw: undefined }
    let last = 0
    const id = setInterval(() => {
      const w = want.current
      let x = 0
      let y = 0
      if (w.stick) [x, y] = w.stick
      else for (const k of w.keys) [x, y] = [x + KEYS[k][0], y + KEYS[k][1]]
      const q = quantizeMove(x, y, 0.25, sent.q || null) // 8-way, as [x, -y]
      const guard = w.guardKey || w.guardBtn
      const yaw = stageAim.yaw
      const now = performance.now()
      const turned = sent.yaw === undefined || Math.abs(yaw - sent.yaw) > YAW_STEP
      const changed = String(q) !== String(sent.q) || guard !== sent.guard || turned
      const due = changed ? now - last >= SEND_GAP_MS : (q || guard) && now - last >= RESEND_MS
      if (due && budget(now)) {
        // the server takes the move relative to the way you look: [right, forward]
        useAppStore.getState().stageInput(q && [q[0], -q[1]], guard, Math.round(yaw * 1000) / 1000)
        sent = { q, guard, yaw }
        last = now
      }
    }, 50)
    return () => {
      clearInterval(id)
      useAppStore.getState().stageInput(null, false) // let go of everything when the pad goes
    }
  }, [])

  // keyboard
  useEffect(() => {
    const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable
    const down = (e) => {
      if (typing(e)) return
      const w = want.current
      if (KEYS[e.code]) w.keys.add(e.code)
      else if (GUARD_KEYS.has(e.code)) w.guardKey = true
      else if (ACTS[e.code]) {
        if (!e.repeat) press(ACTS[e.code])
      } else return
      e.preventDefault()
    }
    const up = (e) => {
      const w = want.current
      if (KEYS[e.code]) w.keys.delete(e.code)
      else if (GUARD_KEYS.has(e.code)) w.guardKey = false
    }
    const blur = () => Object.assign(want.current, { keys: new Set(), guardKey: false, guardBtn: false, stick: null })
    addEventListener('keydown', down)
    addEventListener('keyup', up)
    addEventListener('blur', blur)
    return () => {
      removeEventListener('keydown', down)
      removeEventListener('keyup', up)
      removeEventListener('blur', blur)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // mouse (desktop): look, left click jab, right click cross; the first click also captures the mouse
  useEffect(() => {
    if (!fine) return
    const onLock = () => setLocked(!!canvas() && document.pointerLockElement === canvas())
    const move = (e) => {
      if (document.pointerLockElement === canvas()) look(e.movementX, e.movementY, MOUSE_TURN)
    }
    const click = (e) => {
      const c = canvas()
      if (!c || (e.target !== c && document.pointerLockElement !== c)) return // clicks on the HUD are the HUD's
      if (e.button === 0) press('jab')
      else if (e.button === 2) press('cross')
      else return
      if (document.pointerLockElement !== c) c.requestPointerLock?.()
      e.preventDefault()
    }
    const menu = (e) => {
      if (e.target === canvas() || document.pointerLockElement) e.preventDefault()
    }
    document.addEventListener('pointerlockchange', onLock)
    addEventListener('mousemove', move)
    addEventListener('mousedown', click)
    addEventListener('contextmenu', menu)
    return () => {
      document.removeEventListener('pointerlockchange', onLock)
      removeEventListener('mousemove', move)
      removeEventListener('mousedown', click)
      removeEventListener('contextmenu', menu)
      if (document.pointerLockElement) document.exitPointerLock()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stick = {
    onPointerDown: (e) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      stick.onPointerMove(e)
    },
    onPointerMove: (e) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
      const r = e.currentTarget.getBoundingClientRect()
      let dx = e.clientX - (r.left + r.width / 2)
      let dy = e.clientY - (r.top + r.height / 2)
      const d = Math.hypot(dx, dy)
      if (d > STICK_R) [dx, dy] = [(dx / d) * STICK_R, (dy / d) * STICK_R]
      want.current.stick = [dx / STICK_R, -dy / STICK_R]
      setKnob({ x: dx, y: dy })
    },
    onPointerUp: () => {
      want.current.stick = null
      setKnob(null)
    },
  }
  stick.onPointerCancel = stick.onPointerUp

  // swipe to look (phones)
  const swipe = useRef(null)
  const lookArea = {
    onPointerDown: (e) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      swipe.current = { x: e.clientX, y: e.clientY }
    },
    onPointerMove: (e) => {
      if (!swipe.current) return
      look(e.clientX - swipe.current.x, e.clientY - swipe.current.y, SWIPE_TURN)
      swipe.current = { x: e.clientX, y: e.clientY }
    },
    onPointerUp: () => (swipe.current = null),
    onPointerCancel: () => (swipe.current = null),
  }

  const act = (a) => () => press(a)
  const guard = (on) => () => (want.current.guardBtn = on)

  return (
    <>
      <div className="sg-look" {...lookArea} aria-hidden="true" />
      <div className="sg-stick" {...stick} aria-label="Move" role="application">
        <i style={knob ? { transform: `translate(${knob.x}px, ${knob.y}px)` } : undefined} />
      </div>
      <div className="sg-buttons">
        <button className="sg-act jab" onPointerDown={act('jab')}>Jab<kbd>Q · click</kbd></button>
        <button className="sg-act cross" onPointerDown={act('cross')}>Cross<kbd>E · right</kbd></button>
        <button className="sg-act guard" onPointerDown={guard(true)} onPointerUp={guard(false)} onPointerCancel={guard(false)}
          onPointerLeave={guard(false)}>Guard<kbd>Shift</kbd></button>
        <button className="sg-act roll" onPointerDown={act('roll')}>Roll<kbd>C</kbd></button>
        <button className="sg-act jump" onPointerDown={act('jump')}>Jump<kbd>Space</kbd></button>
      </div>
      <div className="sg-keys" aria-hidden="true">
        <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>Move</span>
        <span><kbd>Click</kbd><kbd>Q</kbd>Jab</span>
        <span><kbd>Right click</kbd><kbd>E</kbd>Cross</span>
        <span><kbd>Shift</kbd>Guard</span>
        <span><kbd>Space</kbd>Jump</span>
        <span><kbd>C</kbd>Roll</span>
        {locked && <span className="esc"><kbd>Esc</kbd>Free the mouse</span>}
      </div>
      {fine && !locked && <div className="sg-grab">Click to fight — the mouse looks around</div>}
    </>
  )
}
