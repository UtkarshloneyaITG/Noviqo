/**
 * LobbyWorld — the equipped lobby background (LobbyBackdrop), the party
 * standing on glowing pedestals with up-light beams, a hologram on each free
 * spot (invites live in the friends list), and name plates above heads (DOM via drei <Html>).
 * Your own character can be dragged to spin it round. Signed out, it shows
 * one pedestal with the starter being picked (also spinnable).
 */
import { Suspense, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { useAppStore } from '../../store/appStore'
import { useCharacterModel, DEFAULT_CHARACTER } from '../world/characters'
import { animateFigure, LOBBY_EMOTES } from '../world/lobbyMotion'
import { glowTexture, beamMaterial, PALETTE } from '../world/sky'
import LobbyBackdrop from '../world/LobbyBackdrop'
import Entrance, { EntranceLight, SHAKE, useEntranceFigure } from '../world/Entrance'
import { prewarmEntranceTextures } from '../world/entranceFx'
import { Crest, rankColor } from '../../lobby/ui'

// Leader front and centre, two flanks, two far spots (max party of 5).
const SPOTS = [[0, 0.35], [-1.25, -0.45], [1.25, -0.45], [-2.3, -1.55], [2.3, -1.55]]
const H = 0.16 // pedestal height
const GHOST = 'char:w-Casual'
const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const HOLO = new THREE.MeshBasicMaterial({
  color: PALETTE.cyan,
  transparent: true,
  opacity: 0.1,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
})

// Lobby and table share the canvas's one camera and each sets it up on mount.
// Not drei's <PerspectiveCamera makeDefault>: after a Suspense hide/show (a
// party member's model loading) it "restores" itself on unmount, and the
// table was then drawn through this 34° lens — zoomed in.
function Camera() {
  const camera = useThree((s) => s.camera)
  const aspect = useThree((s) => s.size.width / s.size.height)
  // Pull back on narrow screens so the whole formation stays in view.
  const z = 6.5 * Math.min(1.9, Math.max(1, 16 / 9 / aspect))
  useLayoutEffect(() => {
    camera.fov = 34
    camera.position.set(-0.55, 1.3, z)
    camera.lookAt(-0.55, 1.12, 0)
    camera.updateProjectionMatrix()
  }, [camera, z])
  // Impacts in your own entrance (landings, lightning) shake the view a little.
  const shaking = useRef(false)
  useFrame(() => {
    const a = SHAKE.amount
    SHAKE.amount = 0
    if (!a && !shaking.current) return
    shaking.current = a > 0
    const t = performance.now() / 1000
    camera.position.set(-0.55 + a * Math.sin(t * 91), 1.3 + a * Math.sin(t * 77 + 1), z)
    camera.lookAt(-0.55, 1.12, 0)
  })
  return null
}

// Shared by every pedestal (two colours): built once, never per render or frame.
const GEO = {
  disc: new THREE.CylinderGeometry(0.62, 0.68, 0.16, 48),
  rim: new THREE.TorusGeometry(0.64, 0.018, 6, 96),
  pool: new THREE.PlaneGeometry(1.5, 1.5),
  beam: new THREE.CylinderGeometry(0.95, 0.3, 5.5, 32, 1, true),
}
const DISC = new THREE.MeshStandardMaterial({ color: '#1b1f3a', metalness: 0.7, roughness: 0.3 })
const MATS = {}
function pedestalMaterials(color) {
  return (MATS[color] ??= {
    rim: new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2) }), // HDR, so it blooms
    pool: new THREE.MeshBasicMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
    beam: beamMaterial(color),
  })
}

export function Pedestal({ x, z, color }) {
  const m = pedestalMaterials(color)
  return (
    <group position={[x, 0, z]} dispose={null}>
      <mesh position-y={0.08} geometry={GEO.disc} material={DISC} receiveShadow />
      <mesh rotation-x={Math.PI / 2} position-y={0.161} geometry={GEO.rim} material={m.rim} />
      <mesh rotation-x={-Math.PI / 2} position-y={0.165} geometry={GEO.pool} material={m.pool} />
      <mesh position={[0, 2.75, -0.55]} geometry={GEO.beam} material={m.beam} />
    </group>
  )
}

export function Figure({ character, memberId, x, z, phase, y = H, yaw = -x * 0.08 }) {
  const model = useCharacterModel(character, 'stand')
  const emote = useAppStore((s) => s.emotes[memberId])
  const entrance = useEntranceFigure(model) // inside an <Entrance>: its body pose + materialise effect
  const lift = useRef()
  useFrame(({ clock }) => {
    const now = performance.now()
    const dy = animateFigure(model, reduce ? 0 : clock.elapsedTime, phase, emote, now, entrance.pose(now))
    entrance.reveal(now)
    lift.current.position.y = reduce ? 0 : dy
  })
  return (
    <group ref={lift}>
      <primitive object={model.root} position={[x, y, z]} rotation-y={yaw} />
    </group>
  )
}

/** The emote's emoji popping up over a name plate while it plays. */
function EmoteBubble({ memberId }) {
  const emote = useAppStore((s) => s.emotes[memberId])
  const def = emote && LOBBY_EMOTES[emote.id]
  const [, expire] = useReducer((n) => n + 1, 0)
  useEffect(() => {
    if (!def) return
    const id = setTimeout(expire, def.secs * 1000) // re-render to drop it, even with animations off
    return () => clearTimeout(id)
  }, [emote, def])
  if (!def || performance.now() - emote.at > def.secs * 1000) return null
  return (
    <span key={emote.at} className="lb-emote-pop" style={{ animationDuration: `${def.secs}s` }} aria-hidden="true">
      {def.icon}
    </span>
  )
}

const SPIN = 0.012 // radians per pixel dragged
const setCursor = (c) => { document.body.style.cursor = c }

const HOME_AFTER = 1.5 // seconds at rest before a spun figure turns back to face the camera

/** Drag left/right on the character to spin it; let go and it coasts to a stop,
 *  then turns back to face the front. */
function Spinnable({ x, z, children }) {
  const group = useRef()
  const st = useRef({ drag: false, lastX: 0, vel: 0, yaw: 0, still: 0 })
  useFrame((_, dt) => {
    const s = st.current
    dt = Math.min(dt, 0.05)
    if (!s.drag && Math.abs(s.vel) > 1e-4) {
      s.yaw += s.vel
      s.vel *= Math.pow(0.02, dt)   // friction: settles within about a second
    } else if (!s.drag && (s.still += dt) > HOME_AFTER) {
      const home = Math.round(s.yaw / (2 * Math.PI)) * 2 * Math.PI // nearest full turn: never unwinds several spins
      s.yaw += (home - s.yaw) * (1 - Math.pow(0.03, dt))
    }
    if (group.current) group.current.rotation.y = -x * 0.08 + s.yaw
  })
  const end = (e) => {
    if (!st.current.drag) return
    st.current.drag = false
    e.target.releasePointerCapture?.(e.pointerId)
    setCursor('grab')
  }
  return (
    <group ref={group} position={[x, H, z]}>
      {children}
      {/* invisible grab area around the figure (the skinned mesh is fiddly to hit) */}
      <mesh
        position-y={0.95}
        onPointerDown={(e) => {
          e.stopPropagation()
          e.target.setPointerCapture(e.pointerId)
          Object.assign(st.current, { drag: true, lastX: e.clientX, vel: 0, still: 0 })
          setCursor('grabbing')
        }}
        onPointerMove={(e) => {
          const s = st.current
          if (!s.drag) return
          const step = (e.clientX - s.lastX) * SPIN
          s.lastX = e.clientX
          s.yaw += step
          s.vel = step
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerOver={() => !st.current.drag && setCursor('grab')}
        onPointerOut={() => !st.current.drag && setCursor('auto')}
      >
        <cylinderGeometry args={[0.45, 0.45, 1.9, 12]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
    </group>
  )
}

function Ghost({ x, z }) {
  const model = useCharacterModel(GHOST, 'stand')
  useMemo(
    () =>
      model.root.traverse((o) => {
        if (o.isMesh) {
          o.material = HOLO
          o.castShadow = false
        }
      }),
    [model],
  )
  return <primitive object={model.root} position={[x, H, z]} rotation-y={-x * 0.08} />
}

function NamePlate({ x, z, name, color, status, statusClass, children }) {
  return (
    <Html position={[x, H + 2.1, z]} center zIndexRange={[4, 0]}>
      <div className="lb-tag" style={{ '--tc': color }}>
        <div className="lb-plate">
          <Crest color={color} />
          <span className="n">{name}</span>
        </div>
        {status && <div className={`st ${statusClass}`}>{status}</div>}
        {children}
      </div>
    </Html>
  )
}

/** The signed-in party: members on pedestals, holograms on the free spots. */
function Party() {
  // Only what the scene shows: coins, chat, toasts etc. never re-render it.
  const party = useAppStore((s) => s.party)
  const me = useAppStore(
    useShallow((s) => ({
      id: s.profile?.id,
      display_name: s.profile?.display_name,
      character: s.profile?.equipped?.character,
      entry: s.profile?.equipped?.entry,
      rank_label: s.profile?.rank?.label,
    })),
  )
  const send = useAppStore((s) => s.send)
  const entryPreview = useAppStore((s) => s.entryPreview)

  const members = party?.members?.length ? party.members : [me]
  const iLead = (party?.leader_id ?? me.id) === me.id

  useEffect(() => {
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500))
    idle(prewarmEntranceTextures)
  }, [])

  const spots = SPOTS.slice(0, party?.max ?? 5).map(([x, z], i) => {
    const m = members[i]
    const lead = i === 0
    if (!m) {
      return (
        <group key={`spot-${i}`}>
          <Pedestal x={x} z={z} color={PALETTE.cyan} />
          <Suspense fallback={null}>
            <Ghost x={x} z={z} />
          </Suspense>
        </group>
      )
    }
    const [status, cls] = lead ? ['Party leader', 'lead'] : m.ready ? ['Ready', 'ok'] : ['Not ready', 'wait']
    return (
      <group key={m.id}>
        <Pedestal x={x} z={z} color={lead ? PALETTE.amber : PALETTE.cyan} />
        <Suspense fallback={null}>
          {/* Entrance plays as the figure appears (its origin is the pedestal top) */}
          {m.id === me.id ? (
            <Spinnable x={x} z={z}>
              <Entrance id={me.entry} who={m.id} preview={entryPreview} mine>
                <Figure character={m.character} memberId={m.id} x={0} z={0} y={0} yaw={0} phase={i * 1.7} />
              </Entrance>
            </Spinnable>
          ) : (
            <group position={[x, H, z]} rotation-y={-x * 0.08}>
              <Entrance id={m.entry} who={m.id}>
                <Figure character={m.character} memberId={m.id} x={0} z={0} y={0} yaw={0} phase={i * 1.7} />
              </Entrance>
            </group>
          )}
        </Suspense>
        <NamePlate x={x} z={z} name={m.display_name} color={rankColor(m.rank_label)} status={status} statusClass={cls}>
          <EmoteBubble memberId={m.id} />
          {iLead && !lead && (
            <button className="lb-kick" onClick={() => send('party_kick', { id: m.id })} aria-label={`Remove ${m.display_name} from the party`}>
              Remove
            </button>
          )}
        </NamePlate>
      </group>
    )
  })
  return (
    <>
      <EntranceLight />
      {spots}
    </>
  )
}

/** Signed out: one pedestal showing the starter being picked. */
function Preview() {
  const auth = useAppStore((s) => s.auth)
  const signup = useAppStore((s) => s.signup)
  const character = signup?.character ?? (auth === 'signed_out' ? DEFAULT_CHARACTER : null)
  return (
    <>
      <Pedestal x={0} z={0.35} color={PALETTE.amber} />
      <Suspense fallback={null}>
        {character ? (
          <Spinnable x={0} z={0.35}>
            <Figure character={character} x={0} z={0} y={0} yaw={0} phase={0} />
          </Spinnable>
        ) : (
          <Ghost x={0} z={0.35} />
        )}
      </Suspense>
      {signup && <NamePlate x={0} z={0.35} name={signup.name || 'Your name'} color={PALETTE.amber} />}
    </>
  )
}

export default function LobbyWorld() {
  const signedIn = useAppStore((s) => s.auth === 'signed_in' && !!s.profile)
  const lobby = useAppStore((s) => s.profile?.equipped?.lobby)

  return (
    <>
      <Camera />
      <LobbyBackdrop themeId={lobby} />
      {signedIn ? <Party /> : <Preview />}
    </>
  )
}
