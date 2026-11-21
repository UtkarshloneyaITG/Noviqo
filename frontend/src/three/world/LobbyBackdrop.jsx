/**
 * LobbyBackdrop — everything around the squad for the equipped lobby
 * background: the painted sky (SkyLayers), fog, floor, light rig and
 * drifting particles.
 *
 *   <LobbyBackdrop themeId={profile.equipped.lobby} />
 *
 * Big themes use an 80 m floor that fades into the fog; island themes
 * (beach deck, station platform) use a finite disc so the painted sea /
 * space shows beyond its edge.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { themeFor } from './themes'
import { MOTES_VERT, MOTES_FRAG } from './skyShader'
import SkyLayers from './SkyLayers'
import { useDisplay, stillBackgrounds, QUALITY } from '../../store/display'

const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

function Floor({ floor }) {
  const map = floor.map()
  const island = floor.size < 40
  const edge = useRef()
  const edgeColor = useMemo(() => new THREE.Color(floor.edge ?? '#000'), [floor.edge])
  useFrame(({ clock }) => {
    if (reduce || stillBackgrounds()) return
    if (floor.scroll) map.offset.y = (clock.elapsedTime * floor.scroll) % 1 // toward the camera
    if (floor.pulse && edge.current) edge.current.color.copy(edgeColor).multiplyScalar(1.6 + 0.6 * Math.sin(clock.elapsedTime * 2))
  })
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        {island ? <circleGeometry args={[floor.size / 2, 72]} /> : <planeGeometry args={[floor.size, floor.size]} />}
        <meshStandardMaterial map={map} roughness={floor.roughness} metalness={floor.metalness} />
      </mesh>
      {island && floor.edge && (
        <mesh rotation-x={Math.PI / 2} position-y={0.03}>
          <torusGeometry args={[floor.size / 2, floor.edgeGlow ? 0.05 : 0.12, 8, 96]} />
          {floor.edgeGlow
            ? <meshBasicMaterial ref={edge} color={floor.edge} />
            : <meshStandardMaterial color={floor.edge} roughness={0.7} />}
        </mesh>
      )}
    </group>
  )
}

/** Drifting particles, moved entirely on the GPU: no per-frame buffer upload. */
function Motes({ motes }) {
  const scale = useDisplay((s) => QUALITY[s.quality]?.particles ?? 1) // Low graphics: half as many
  const count = Math.max(1, Math.round(motes.count * scale))
  const geo = useMemo(() => {
    const p = new Float32Array(count * 3)
    const phase = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      p[i * 3] = (Math.random() - 0.5) * 10
      p[i * 3 + 1] = Math.random() * 4.5
      p[i * 3 + 2] = -4 + Math.random() * 5
      phase[i] = Math.random()
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(p, 3))
    g.setAttribute('phase', new THREE.BufferAttribute(phase, 1))
    return g
  }, [count])
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: MOTES_VERT,
        fragmentShader: MOTES_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uSpeed: { value: motes.speed },
          uSize: { value: motes.size },
          uScale: { value: 1 },
          uDrift: { value: motes.drift ?? 0 },
          uTwinkle: { value: motes.twinkle ?? 0 },
          uColor: { value: new THREE.Color(motes.color) },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [motes],
  )
  useEffect(() => () => (geo.dispose(), mat.dispose()), [geo, mat])
  useFrame(({ clock, gl }) => {
    mat.uniforms.uTime.value = reduce || stillBackgrounds() ? 0 : clock.elapsedTime
    mat.uniforms.uScale.value = gl.domElement.height / 2 // same size rule as PointsMaterial
  })
  return <points geometry={geo} material={mat} frustumCulled={false} />
}

export default function LobbyBackdrop({ themeId }) {
  const theme = themeFor(themeId)
  return (
    <>
      <SkyLayers themeId={themeId} />
      <fog attach="fog" args={[theme.fog.color, theme.fog.near, theme.fog.far]} />
      <Floor floor={theme.floor} />

      <hemisphereLight args={theme.hemi} />
      <directionalLight
        color={theme.key[0]}
        intensity={theme.key[1]}
        position={[2.5, 6, 6]}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0005}
        // light-space bounds of the five spots and the shadows they throw
        shadow-camera-left={-3.4}
        shadow-camera-right={4.3}
        shadow-camera-top={3.2}
        shadow-camera-bottom={-1.6}
        shadow-camera-near={6}
        shadow-camera-far={13}
      />
      <directionalLight color={theme.rimLeft[0]} intensity={theme.rimLeft[1]} position={[-5, 3, -4]} />
      <directionalLight color={theme.rimRight[0]} intensity={theme.rimRight[1]} position={[5, 3, -4]} />
      <directionalLight color={theme.front[0]} intensity={theme.front[1]} position={[0, 1.2, 7]} />

      <Motes key={themeId} motes={theme.motes} />
    </>
  )
}
