/**
 * SkyLayers — the painted background of a lobby theme, drawn behind
 * everything: one full-screen quad (back + mid + front layers and the
 * scene's shader effects) and one Points draw for its lights.
 *
 *   <SkyLayers themeId={profile.equipped.lobby} />
 *
 * Only one background is kept painted: switching paints the new one and
 * frees the old one's GPU textures. Coming back to the same one (e.g. after
 * a match) reuses it without repainting.
 */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { paintScene, paintWidth } from './paint'
import { fitUniform, SKY_VERT, SKY_FRAG, LIGHTS_VERT, LIGHTS_FRAG } from './skyShader'
import { themeFor } from './themes'

const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

function texture(canvas, alpha = false, repeat = false) {
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.generateMipmaps = false // drawn about 1:1, mipmaps would only cost memory
  t.minFilter = THREE.LinearFilter
  t.premultiplyAlpha = alpha // filtered edges stay clean
  if (repeat) t.wrapS = THREE.RepeatWrapping // mid layers scroll and wrap
  return t
}

let painted = null
function paintedFor(themeId) {
  // Keyed by the resolved scene: signed out (no theme id) and the default share one painting.
  const scene = themeFor(themeId).scene
  const width = paintWidth(screen.width, screen.height, devicePixelRatio)
  if (painted && painted.scene === scene && painted.width === width) return painted
  if (painted) {
    for (const t of [painted.back, painted.mid, painted.front]) t?.dispose()
    painted.lights.dispose()
  }
  const p = paintScene(scene, width)
  const lights = new THREE.BufferGeometry()
  lights.setAttribute('position', new THREE.BufferAttribute(p.lights.pos, 3))
  lights.setAttribute('tint', new THREE.BufferAttribute(p.lights.color, 3))
  lights.setAttribute('info', new THREE.BufferAttribute(p.lights.info, 3))
  painted = {
    width,
    scene,
    back: texture(p.back),
    mid: p.mid && texture(p.mid, true, true),
    front: p.front && texture(p.front, true),
    band: p.band,
    lights,
    count: p.lights.count,
  }
  return painted
}

export default function SkyLayers({ themeId }) {
  const L = useMemo(() => paintedFor(themeId), [themeId])

  const mats = useMemo(() => {
    const shared = { uFit: { value: new THREE.Vector4(0, 0, 1, 1) }, uTime: { value: 0 }, uPx: { value: 1 } }
    const own = Object.fromEntries(Object.entries(L.scene.fx.uniforms).map(([k, v]) => [k, { value: v }]))
    const sky = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      defines: { ...(L.mid && { MID: '' }), ...(L.front && { FRONT: '' }), ...L.scene.fx.defines },
      uniforms: {
        ...shared,
        ...own,
        tBack: { value: L.back },
        tMid: { value: L.mid },
        tFront: { value: L.front },
        uBand: { value: new THREE.Vector2(...L.band) },
      },
      depthWrite: false,
    })
    const lights = new THREE.ShaderMaterial({
      vertexShader: LIGHTS_VERT,
      fragmentShader: LIGHTS_FRAG,
      uniforms: shared,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    return { sky, lights, shared }
  }, [L])
  useEffect(() => () => (mats.sky.dispose(), mats.lights.dispose()), [mats])

  useFrame(({ clock, size, gl }) => {
    const u = mats.shared
    u.uTime.value = reduce ? 0 : clock.elapsedTime
    const f = fitUniform(size.width, size.height)
    u.uFit.value.set(...f)
    u.uPx.value = gl.domElement.height / (900 * f[3]) // device px per logical px
  })

  return (
    <>
      <mesh frustumCulled={false} renderOrder={-2} material={mats.sky}>
        <planeGeometry args={[2, 2]} />
      </mesh>
      {L.count > 0 && <points frustumCulled={false} renderOrder={-1} geometry={L.lights} material={mats.lights} />}
    </>
  )
}
