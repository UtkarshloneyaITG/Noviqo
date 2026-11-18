/**
 * ColorPicker — modal that appears when the player plays a Wild or Wild
 * Draw Four card. They must choose a colour (Escape or a click outside
 * cancels).
 */
import { useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import '../styles/table.css'

const COLORS = [
  ['red', 'Red', '#d9352c'],
  ['yellow', 'Yellow', '#e8b417'],
  ['green', 'Green', '#2bb24c'],
  ['blue', 'Blue', '#2d7fd4'],
]

export default function ColorPicker() {
  const chooseColor = useAppStore((s) => s.chooseColor)
  const cancelColorPicker = useAppStore((s) => s.cancelColorPicker)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && cancelColorPicker()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancelColorPicker])

  return (
    <div className="tb tb-modal" onClick={cancelColorPicker}>
      <div
        className="tb-panel tb-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tb-pick-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="tb-pick-title" className="tb-title">
          Choose a colour
        </h2>
        <div className="tb-colors">
          {COLORS.map(([key, label, hex], i) => (
            <button
              key={key}
              className="tb-color"
              style={{ '--cc': hex }}
              onClick={() => chooseColor(key)}
              autoFocus={i === 0}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="tb-btn tb-btn--ghost" onClick={cancelColorPicker}>
          Cancel
        </button>
      </div>
    </div>
  )
}
