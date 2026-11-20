/**
 * Emblem — the detailed tier badge for the Ranks page. A metal shield that
 * gains wings (Silver), a laurel (Gold), a tiara (Platinum), a starburst and
 * gems (Diamond) and finally a full crown (Master) as the tiers climb; each
 * tier has its own metal and face symbol, and the division (III / II / I)
 * sits on a ribbon. Pure SVG on a 200×200 box. Small inline badges keep the
 * plain Crest; this one is for sizes from about 36 px up.
 */
import { useId } from 'react'

const METAL = {
  Bronze: { hi: '#ffe1c4', light: '#f0b07c', mid: '#c27236', dark: '#5a2c0e' },
  Silver: { hi: '#ffffff', light: '#e6ecf5', mid: '#9daabf', dark: '#3a4457' },
  Gold: { hi: '#fffbe0', light: '#ffe27a', mid: '#e0a21f', dark: '#5f3f05' },
  Platinum: { hi: '#ecfffb', light: '#a3f6e8', mid: '#2fbca7', dark: '#0a4842' },
  Diamond: { hi: '#f4f7ff', light: '#b9cdff', mid: '#5b7cee', dark: '#1a2570' },
  Master: { hi: '#ffe9fb', light: '#f8a9e8', mid: '#c63da6', dark: '#470d3f' },
}
const LEVEL = { Bronze: 0, Silver: 1, Gold: 2, Platinum: 3, Diamond: 4, Master: 5 }
const TRIM = '#ffd56a' // Master's gold trim

const SHIELD = 'M100 42 L148 57 V102 C148 135 128 153 100 167 C72 153 52 135 52 102 V57 Z'
const HALF = 'M100 42 L52 57 V102 C52 135 72 153 100 167 Z' // the lit left half
const inset = (k) => `translate(100 104) scale(${k}) translate(-100 -104)`

/** Points around (cx, cy) alternating between two radii: stars and bursts. */
function starPoints(cx, cy, tips, outer, inner, turn = -90) {
  return Array.from({ length: tips * 2 }, (_, i) => {
    const a = ((turn + (i * 180) / tips) * Math.PI) / 180
    const r = i % 2 ? inner : outer
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`
  }).join(' ')
}

/** One wing of feathers fanned from the shield's shoulder (drawn on the left; mirrored for the right). */
function Wing({ level, fill, line }) {
  const n = [0, 3, 4, 5, 5, 6][level]
  const scale = [0, 0.72, 0.82, 0.9, 1, 1.12][level]
  return (
    <g transform={`translate(60 84) scale(${scale})`}>
      {Array.from({ length: n }, (_, i) => {
        const angle = 44 - (i * 78) / (n - 1) // top feather points up-left, the last down-left
        const len = 1 - Math.abs(i - (n - 1) * 0.35) * 0.07
        return (
          <g key={i} transform={`rotate(${angle}) scale(${len})`}>
            <path d="M0 0 C-18 -10 -46 -11 -66 -4 C-46 5 -20 9 0 7 Z" fill={fill} stroke={line} strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M-4 3 L-56 -3" stroke={line} strokeOpacity=".35" strokeWidth="1.2" />
          </g>
        )
      })}
    </g>
  )
}

/** Laurel branch curving up the left side (mirrored for the right). */
function Laurel({ fill, line }) {
  const P = [[98, 182], [36, 176], [30, 104]] // quadratic bezier: base, pull, tip (swept wide of the shield)
  const at = (t) => {
    const u = 1 - t
    return [0, 1].map((k) => u * u * P[0][k] + 2 * u * t * P[1][k] + t * t * P[2][k])
  }
  const leaves = [0.12, 0.26, 0.4, 0.54, 0.68, 0.82, 0.95]
  return (
    <g>
      <path d={`M${P[0]} Q${P[1]} ${P[2]}`} fill="none" stroke={line} strokeWidth="2.2" strokeLinecap="round" />
      {leaves.map((t, i) => {
        const [x, y] = at(t)
        const [x2, y2] = at(Math.min(1, t + 0.01))
        const tangent = (Math.atan2(y2 - y, x2 - x) * 180) / Math.PI
        const side = i % 2 ? 38 : -38
        return (
          <ellipse key={t} cx={x} cy={y} rx="9" ry="3.6" fill={fill} stroke={line} strokeWidth="1"
            transform={`rotate(${tangent + side} ${x} ${y}) translate(${side > 0 ? 6 : -6} 0)`} />
        )
      })}
    </g>
  )
}

/** The tier's mark on the shield face. */
function Symbol({ level, fill, line }) {
  const p = { fill, stroke: line, strokeWidth: 2, strokeLinejoin: 'round' }
  if (level === 0) return <path d="M82 94 L100 108 L118 94 L118 102 L100 116 L82 102 Z" {...p} />
  if (level === 1)
    return (
      <>
        <path d="M82 86 L100 100 L118 86 L118 94 L100 108 L82 94 Z" {...p} />
        <path d="M82 102 L100 116 L118 102 L118 110 L100 124 L82 110 Z" {...p} />
      </>
    )
  if (level === 2) return <polygon points={starPoints(100, 104, 5, 19, 8)} {...p} />
  if (level === 3)
    return (
      <>
        <polygon points={starPoints(100, 104, 3, 17, 17, -90) /* hexagon */} {...p} />
        <path d="M100 87 V121 M85.3 95.5 L114.7 112.5 M114.7 95.5 L85.3 112.5" stroke={line} strokeOpacity=".45" strokeWidth="1.2" />
      </>
    )
  if (level === 4)
    return (
      <>
        <path d="M84 96 L91 86 H109 L116 96 L100 120 Z" {...p} />
        <path d="M84 96 H116 M91 86 L96 96 L100 120 L104 96 L109 86 M96 96 L100 86 L104 96" fill="none" stroke={line} strokeOpacity=".5" strokeWidth="1.1" />
      </>
    )
  return (
    <>
      <circle cx="100" cy="106" r="17" fill="none" stroke={fill} strokeWidth="2.5" />
      <polygon points={starPoints(100, 106, 5, 14, 6)} {...p} />
      <path d="M88 86 L90 78 L96 83 L100 75 L104 83 L110 78 L112 86 Z" {...p} strokeWidth="1.5" />
    </>
  )
}

export default function Emblem({ tier = 'Bronze', division, size = 200, className = '' }) {
  const uid = useId().replace(/:/g, '')
  const id = (n) => `${uid}${n}`
  const url = (n) => `url(#${id(n)})`
  const c = METAL[tier] || METAL.Bronze
  const level = LEVEL[tier] ?? 0
  const line = c.dark
  const accent = level === 5 ? TRIM : c.light

  return (
    <svg className={className} width={size} height={size} viewBox="0 0 200 200" role="img" aria-label={`${tier}${division ? ` ${division}` : ''} emblem`}>
      <defs>
        <linearGradient id={id('body')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={c.hi} />
          <stop offset=".35" stopColor={c.light} />
          <stop offset=".7" stopColor={c.mid} />
          <stop offset="1" stopColor={c.dark} />
        </linearGradient>
        <linearGradient id={id('rim')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={level === 5 ? TRIM : c.light} />
          <stop offset=".5" stopColor={c.mid} />
          <stop offset="1" stopColor={c.dark} />
        </linearGradient>
        <radialGradient id={id('plate')} cx=".5" cy=".42" r=".65">
          <stop offset="0" stopColor={c.mid} />
          <stop offset="1" stopColor={c.dark} />
        </radialGradient>
        <linearGradient id={id('wing')} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor={c.mid} />
          <stop offset=".6" stopColor={c.light} />
          <stop offset="1" stopColor={c.hi} />
        </linearGradient>
        <radialGradient id={id('burst')} cx=".5" cy=".5" r=".5">
          <stop offset=".3" stopColor={c.light} stopOpacity=".9" />
          <stop offset="1" stopColor={c.mid} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id('gem')} cx=".35" cy=".3" r=".8">
          <stop offset="0" stopColor="#fff" />
          <stop offset=".35" stopColor={c.light} />
          <stop offset="1" stopColor={c.dark} />
        </radialGradient>
        <linearGradient id={id('ribbon')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c.mid} />
          <stop offset="1" stopColor={c.dark} />
        </linearGradient>
      </defs>

      {level >= 4 && (
        <g>
          <polygon points={starPoints(100, 100, 16, 98, 62)} fill={url('burst')} opacity=".75" />
          {level === 5 && <polygon points={starPoints(100, 100, 16, 90, 58, -78.75)} fill={url('burst')} opacity=".5" />}
        </g>
      )}

      {level >= 1 && (
        <>
          <Wing level={level} fill={url('wing')} line={line} />
          <g transform="translate(200 0) scale(-1 1)">
            <Wing level={level} fill={url('wing')} line={line} />
          </g>
        </>
      )}

      {level >= 2 && (
        <>
          <Laurel fill={accent} line={line} />
          <g transform="translate(200 0) scale(-1 1)">
            <Laurel fill={accent} line={line} />
          </g>
        </>
      )}

      {/* shield: rim, body, lit half, inner plate */}
      <path d={SHIELD} fill={url('rim')} stroke={line} strokeWidth="3" strokeLinejoin="round" />
      <path d={SHIELD} transform={inset(0.87)} fill={url('body')} stroke={line} strokeOpacity=".6" strokeWidth="1.5" />
      <path d={HALF} transform={inset(0.87)} fill="#fff" opacity=".16" />
      <path d={SHIELD} transform={inset(0.62)} fill={url('plate')} stroke={c.hi} strokeOpacity=".55" strokeWidth="2" />
      {level <= 2 &&
        [[62, 66], [138, 66], [60, 100], [140, 100], [100, 52]].map(([x, y]) => (
          <circle key={`${x}${y}`} cx={x} cy={y} r="3" fill={c.hi} stroke={line} strokeWidth="1.2" />
        ))}

      <Symbol level={level} fill={url('body')} line={line} />

      {level >= 3 && (
        <g>
          {level === 5 ? (
            <>
              <path d="M68 54 L66 22 L83 38 L92 14 L100 32 L108 14 L117 38 L134 22 L132 54 Z" fill={TRIM} stroke={line} strokeWidth="2.5" strokeLinejoin="round" />
              <rect x="66" y="46" width="68" height="9" rx="2" fill={c.mid} stroke={line} strokeWidth="2" />
              {[[66, 22], [92, 14], [108, 14], [134, 22]].map(([x, y]) => (
                <circle key={x} cx={x} cy={y} r="4.5" fill={url('gem')} stroke={line} strokeWidth="1.2" />
              ))}
              <circle cx="100" cy="50.5" r="4" fill={url('gem')} stroke={line} strokeWidth="1.2" />
            </>
          ) : (
            <>
              <path d="M78 52 L80 34 L90 43 L100 26 L110 43 L120 34 L122 52 Z" fill={c.light} stroke={line} strokeWidth="2.2" strokeLinejoin="round" />
              {[[80, 34], [100, 26], [120, 34]].map(([x, y]) => (
                <circle key={x} cx={x} cy={y} r="3.6" fill={url('gem')} stroke={line} strokeWidth="1.1" />
              ))}
            </>
          )}
        </g>
      )}

      {level >= 4 &&
        [[57, 86], [143, 86]].map(([x, y]) => (
          <circle key={x} cx={x} cy={y} r="6" fill={url('gem')} stroke={line} strokeWidth="1.5" />
        ))}

      {division && (
        <g>
          <path d="M54 146 L38 150 L45 159 L37 168 L54 164 Z M146 146 L162 150 L155 159 L163 168 L146 164 Z" fill={c.dark} stroke={line} strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M52 144 Q100 158 148 144 L150 162 Q100 176 50 162 Z" fill={url('ribbon')} stroke={line} strokeWidth="2" strokeLinejoin="round" />
          <text x="100" y="166" textAnchor="middle" className="lb-emblem-div" fill="#fff" stroke={line} strokeWidth="1" paintOrder="stroke">
            {division}
          </text>
        </g>
      )}

      {level === 5 &&
        [[30, 40, 6], [172, 46, 5], [24, 150, 4], [176, 142, 6], [100, 186, 4]].map(([x, y, r]) => (
          <polygon key={x} points={starPoints(x, y, 4, r, r / 3.5)} fill="#fff" opacity=".9" />
        ))}
    </svg>
  )
}
