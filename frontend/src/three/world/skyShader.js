/**
 * Backdrop shaders and the screen fit. No imports: node's test runner loads
 * fitUniform() straight from this file.
 *
 * The painted backdrop is 16:9 (1600x900 logical px, horizon 408 px up from
 * the bottom). It is drawn "cover": wider screens keep the full width and
 * crop the sky/sea around the horizon, narrower ones keep the full height and
 * crop the sides. Nothing is ever stretched, and the horizon keeps its height
 * on screen so it still meets the 3D floor's fog line.
 *
 * Effects are compiled in per background with #defines (see scenes/*.js `fx`).
 */

const ASPECT = 16 / 9
const HORIZON_V = 408 / 900

/** [ox, oy, sx, sy]: image uv = offset + screen uv * scale (v measured up from the bottom). */
export function fitUniform(width, height) {
  const a = width / height
  if (a >= ASPECT) {
    const sy = ASPECT / a
    return [0, HORIZON_V * (1 - sy), 1, sy]
  }
  const sx = a / ASPECT
  return [0.5 - sx / 2, 0, sx, 1]
}

export const SKY_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0); // on the far plane: everything else draws over it
}`

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}`

export const SKY_FRAG = /* glsl */ `
uniform sampler2D tBack;
uniform vec4 uFit;
uniform float uTime;
varying vec2 vUv;
#ifdef MID
uniform sampler2D tMid;
uniform float uMidSpeed;
#endif
#ifdef FRONT
uniform sampler2D tFront;
uniform vec2 uBand;
#endif
${NOISE}
#ifdef SUN
uniform vec3 uSun; // centre x, y (logical px, y down), radius
// A retro sun: yellow to hot pink, the lower half cut by stripes that widen
// toward the bottom and slide slowly down.
vec3 sun(vec3 col, vec2 p) {
  vec2 q = (p - uSun.xy) / uSun.z;
  float r = length(q);
  col += vec3(1.0, 0.05, 0.3) * 0.22 * exp(-max(r - 1.0, 0.0) * 3.5);
  float aa = fwidth(r);
  float w = fwidth(q.y / 0.14);                       // derivatives before any branch
  float disc = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
  if (disc <= 0.0) return col;
  float v = q.y * 0.5 + 0.5;
  vec3 c = v < 0.45 ? mix(vec3(1.0, 0.87, 0.2), vec3(1.0, 0.43, 0.045), v / 0.45)
                    : mix(vec3(1.0, 0.43, 0.045), vec3(1.0, 0.022, 0.18), (v - 0.45) / 0.55);
  float band = (q.y + 0.08) / 1.08;
  if (band > 0.0) {
    float s = fract(q.y / 0.14 - uTime * 0.22) - 0.5;
    float gap = mix(0.04, 0.32, band);
    disc *= 1.0 - (1.0 - smoothstep(gap - w, gap + w, abs(s))) * smoothstep(0.0, 0.06, band);
  }
  return mix(col, c * mix(1.2, 0.95, v), disc); // a touch over 1 at the top so it blooms, without bleaching the colours
}
#endif
#ifdef HORIZON_GLOW
uniform vec3 uGlowColor;
#endif
#ifdef PLANET
uniform vec4 uPlanet; // centre x, y (logical px, y down), radius, tilt
// A banded gas giant as a lit sphere: bands drift with its spin, a soft
// terminator, a warm atmosphere rim and a halo on the sunlit side.
vec3 planet(vec3 col, vec2 p) {
  vec2 q = (p - uPlanet.xy) / uPlanet.z;
  q.y = -q.y;
  float r = length(q);
  float aa = fwidth(r);
  vec3 L = normalize(vec3(-0.65, 0.55, 0.52));
  float side = clamp(dot(normalize(vec3(q, 0.001)), L) * 0.8 + 0.4, 0.0, 1.0);
  col += vec3(1.0, 0.45, 0.2) * 0.3 * exp(-max(r - 1.0, 0.0) * 16.0) * side;
  if (r > 1.0 + aa) return col;
  vec3 n = vec3(q, sqrt(max(0.0, 1.0 - r * r)));
  float c = cos(uPlanet.w), s = sin(uPlanet.w);
  vec3 m = vec3(c * n.x - s * n.y, s * n.x + c * n.y, n.z);
  float lat = asin(clamp(m.y, -1.0, 1.0));
  float lon = atan(m.x, m.z) + uTime * 0.01;
  float b = lat * 7.0 + fbm(vec2(lon * 1.5, lat * 9.0)) * 1.6 + 0.4 * sin(lon * 2.0 + lat * 5.0);
  vec3 band = mix(vec3(0.85, 0.42, 0.14), vec3(0.42, 0.12, 0.06), 0.5 + 0.5 * sin(b));
  band = mix(band, vec3(0.25, 0.07, 0.16), smoothstep(0.55, 0.95, abs(sin(b * 0.5 + 1.3))) * 0.6);
  float d = dot(n, L);
  vec3 lit = band * (0.06 + 1.1 * max(d, 0.0)) * (0.35 + 0.65 * smoothstep(-0.05, 0.35, d));
  lit += vec3(1.0, 0.5, 0.25) * pow(1.0 - n.z, 3.0) * 0.5 * smoothstep(-0.1, 0.4, d);
  return mix(col, lit, 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r));
}
#endif
#ifdef WATER
uniform float uMoonX;
// Moonlight on the sea: glints along the moon's path, faint crests rolling in.
vec3 water(vec2 p, float depth) {
  float path = exp(-pow((p.x - uMoonX) / (24.0 + depth * 300.0), 2.0));
  float n = noise(vec2(p.x * 0.05 + uTime * 0.3, p.y * 0.5 - uTime * 1.4));
  float glint = pow(n, 9.0) * 5.0 * path * (1.0 - 0.5 * depth);
  float crest = pow(max(0.0, sin(830.0 / (p.y - 478.0) + uTime * 0.7)), 30.0)
              * smoothstep(545.0, 610.0, p.y) * (0.4 + 0.6 * noise(vec2(p.x * 0.01, p.y * 0.05))) * 0.1;
  return vec3(0.75, 0.88, 1.0) * glint + vec3(0.5, 0.7, 0.95) * crest;
}
#endif
#ifdef STREAKS
uniform vec3 uStreak; // seconds per slot, chance a slot has one, lowest y (logical px) they start above
// A shooting star now and then: a thin tapering streak with a bright head.
vec3 streak(vec2 p) {
  float i = floor(uTime / uStreak.x);
  float t = uTime - i * uStreak.x;
  if (hash(vec2(i, 1.7)) > uStreak.y || t > 0.9) return vec3(0.0);
  vec2 a = vec2(200.0 + hash(vec2(i, 3.1)) * 1200.0, 30.0 + hash(vec2(i, 5.3)) * (uStreak.z - 130.0));
  vec2 d = normalize(vec2(hash(vec2(i, 7.9)) > 0.5 ? 1.0 : -1.0, 0.32));
  vec2 q = p - (a + d * t * 560.0);
  float along = dot(q, -d);
  float across = abs(dot(q, vec2(-d.y, d.x)));
  float tail = step(0.0, along) * (1.0 - smoothstep(0.0, 150.0, along)) * smoothstep(1.4, 0.0, across);
  float head = smoothstep(5.0, 0.0, length(q));
  float life = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.5, 0.9, t));
  return vec3(0.85, 0.92, 1.0) * (tail + head) * life * 1.8;
}
#endif

void main() {
  vec2 uv = uFit.xy + vUv * uFit.zw;                 // image uv, v up
  vec2 p = vec2(uv.x * 1600.0, (1.0 - uv.y) * 900.0); // logical px, y down like the painters
  vec2 bu = uv;
#ifdef WATER
  float depth = clamp((p.y - 492.0) / 408.0, 0.0, 1.0);  // 0 at the horizon, 1 at the bottom
  bu.x += (sin(p.y * 0.9 + uTime * 1.5) * 0.6 + sin(p.y * 0.37 + p.x * 0.01 - uTime * 0.9) * 0.4) * depth * 8.0 / 1600.0;
#endif
  vec3 col = texture2D(tBack, bu).rgb;
#ifdef WATER
  if (depth > 0.0) col += water(p, depth);
#endif

#ifdef SUN
  col = sun(col, p);
#endif
#ifdef PLANET
  col = planet(col, p);
#endif

#ifdef MID
  vec2 mu = uv;
  #ifdef MID_SCROLL
  mu.x += uTime * uMidSpeed;                         // texture repeats: clouds drift and wrap
  #endif
  #ifdef MID_RIPPLE
  mu.x += sin(uv.y * 30.0 + uTime * 0.7) * 0.003 + sin(uv.x * 9.0 - uTime * 0.35) * 0.004;
  mu.y += sin(uv.x * 14.0 + uTime * 0.5) * 0.012;  // curtains wave
  #endif
  vec4 m = texture2D(tMid, mu);
  #ifdef MID_RIPPLE
  // brightness rolls across the sky; the colours drift toward pink and back
  m.rgb = mix(m.rgb, m.gbr, 0.1 + 0.1 * sin(uTime * 0.15 + uv.x * 3.0)) * (0.75 + 0.5 * noise(vec2(uv.x * 6.0 - uTime * 0.15, uTime * 0.1)));
  #endif
  col = col * (1.0 - m.a) + m.rgb;                   // premultiplied
#endif

#ifdef STREAKS
  col += streak(p);                                  // behind the silhouettes
#endif

#ifdef FRONT
  if (uv.y >= uBand.x && uv.y <= uBand.y) {
    vec2 fu = vec2(uv.x, (uv.y - uBand.x) / (uBand.y - uBand.x));
  #ifdef FRONT_SWAY
    float sw = smoothstep(0.47, 0.85, uv.y);           // trunks and the headland hold still, crowns sway
    fu.x += sin(uTime * 0.9 + uv.x * 2.0) * 0.008 * sw * sw + sin(uTime * 2.1 + uv.y * 9.0) * 0.0015 * sw;
  #endif
    vec4 f = texture2D(tFront, fu);
    col = col * (1.0 - f.a) + f.rgb;
  }
#endif

#ifdef HORIZON_GLOW
  // a neon seam along the horizon, rippling
  float shimmer = 0.55 + 0.25 * sin(uTime * 1.3 + p.x * 0.02) + 0.15 * sin(uTime * 2.7 - p.x * 0.047);
  col += uGlowColor * shimmer * exp(-abs(p.y - 492.0) / 9.0);
#endif

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

export const LIGHTS_VERT = /* glsl */ `
attribute vec3 tint;
attribute vec3 info; // size (logical px), phase 0..1, mode (0 star, 1 window, 2 blink)
uniform vec4 uFit;
uniform float uPx;
uniform float uTime;
varying vec3 vTint;
varying float vMode;
float hash1(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  vec2 img = vec2(position.x / 1600.0, 1.0 - position.y / 900.0);
  gl_Position = vec4((img - uFit.xy) / uFit.zw * 2.0 - 1.0, 1.0, 1.0);
  float ph = info.y;
  float k;
  if (info.z < 0.5) k = 0.65 + 0.35 * sin(uTime * (1.0 + 2.0 * ph) + ph * 40.0);       // twinkle
  else if (info.z < 1.5) k = step(0.12, hash1(floor(uTime / 9.0 + ph * 13.0) + ph));   // window: off now and then
  else k = pow(max(0.0, sin(uTime * 2.4 + ph * 6.2832)), 12.0);                        // blink
  vTint = tint * k;
  vMode = info.z;
  gl_PointSize = info.x * uPx;
}`

export const LIGHTS_FRAG = /* glsl */ `
varying vec3 vTint;
varying float vMode;
void main() {
  float a = (vMode > 0.5 && vMode < 1.5) ? 1.0 : smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
  gl_FragColor = vec4(vTint * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

export const MOTES_VERT = /* glsl */ `
attribute float phase;
uniform float uTime;
uniform float uSpeed;
uniform float uSize;
uniform float uScale;
uniform float uDrift;
uniform float uTwinkle;
varying float vA;
void main() {
  vec3 p = position;
  p.y = mod(p.y + uSpeed * uTime, 4.5);                 // rise (or fall) and wrap
  p.x += sin(uTime * 0.6 + phase * 6.2832) * uDrift;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * uScale / -mv.z;
  vA = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * 3.0 + phase * 20.0));
}`

export const MOTES_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)) * vA;
  gl_FragColor = vec4(uColor * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`
