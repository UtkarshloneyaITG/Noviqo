/**
 * One requestAnimationFrame tick of the frame-rate cap (Settings → Graphics).
 * `next` is when the next frame is due (ms, rAF time), `step` = 1000 / fps.
 * Returns whether to draw on this tick and when the following frame is due.
 * No imports: node's test runner loads it directly (tests/display.test.mjs).
 */
export function capTick(next, t, step) {
  if (t < next - 2) return { render: false, next } // 2 ms of slack for vsync jitter
  const due = next + step
  return { render: true, next: due > t ? due : t + step } // behind (first tick, or a stall): restart from now, no burst
}
