/**
 * LobbyBackdrop — everything around the squad for the equipped lobby
 * background: sky, fog, floor, light rig and drifting particles.
 *
 *   <LobbyBackdrop themeId={profile.equipped.lobby} />
 *
 * Big themes use an 80 m floor that fades into the fog; island themes
 * (beach deck, station platform) use a finite disc so the painted sea /
 * space shows beyond its edge.
 */
import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { glowTexture } from './sky'
import { themeFor } from './themes'

const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

function Floor({ floor }) {
  const map = floor.map()
  const island = floor.size < 40
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
            ? <meshBasicMaterial color={floor.edge} />
            : <meshStandardMaterial color={floor.edge} roughness={0.7} />}
        </mesh>
      )}
    </group>
  )
}

function Motes({ motes }) {
  const { count, speed } = motes
  const geo = useMemo(() => {
    const p = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      p[i * 3] = (Math.random() - 0.5) * 10
      p[i * 3 + 1] = Math.random() * 4.5
      p[i * 3 + 2] = -4 + Math.random() * 5
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(p, 3))
    return g
  }, [count])
  useFrame((_, dt) => {
    if (reduce) return
    const a = geo.attributes.position
    const step = Math.min(dt, 0.05) * speed
    for (let i = 0; i < a.count; i++) {
      let y = a.getY(i) + step
      if (y > 4.5) y -= 4.5
      else if (y < 0) y += 4.5          // snow falls and wraps back to the top
      a.setY(i, y)
    }
    a.needsUpdate = true
  })
  return (
    <points geometry={geo}>
      <pointsMaterial map={glowTexture()} size={motes.size} color={motes.color} transparent depthWrite={false}
        blending={THREE.AdditiveBlending} />
    </points>
  )
}

export default function LobbyBackdrop({ themeId }) {
  const theme = themeFor(themeId)
  const sky = theme.sky()
  return (
    <>
      <primitive attach="background" object={sky} />
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
