import type { PointerPoint } from '../types/note'

/** Pass handwriting (~1–5 Hz) and cut stylus tremor (~8–12 Hz) without much lag. */
const MIN_CUTOFF = 7
const BETA = 0.18
const D_CUTOFF = 1
const MIN_DT = 1 / 240
const MAX_DT = 0.04
const MIN_STEP = 0.08
/** Blend a little raw position back in so loops and letters do not shrink. */
const FOLLOW = 0.28
const FOLLOW_END = 0.9

function smoothingAlpha(dt: number, cutoff: number): number {
  const tau = 1 / (2 * Math.PI * cutoff)
  return 1 / (1 + tau / dt)
}

function lowpass(value: number, prev: number, alpha: number): number {
  return alpha * value + (1 - alpha) * prev
}

class OneEuroAxis {
  private prev: number | null = null
  private dPrev = 0
  private tPrev: number | null = null
  private minCutoff: number
  private beta: number
  private dCutoff: number

  constructor(minCutoff: number, beta: number, dCutoff: number) {
    this.minCutoff = minCutoff
    this.beta = beta
    this.dCutoff = dCutoff
  }

  reset(): void {
    this.prev = null
    this.dPrev = 0
    this.tPrev = null
  }

  next(value: number, time: number): number {
    if (this.prev === null || this.tPrev === null) {
      this.prev = value
      this.tPrev = time
      this.dPrev = 0
      return value
    }
    let t = time
    if (t <= this.tPrev) t = this.tPrev + MIN_DT * 1000
    const dt = Math.min(MAX_DT, Math.max(MIN_DT, (t - this.tPrev) / 1000))
    const dx = (value - this.prev) / dt
    const edx = lowpass(dx, this.dPrev, smoothingAlpha(dt, this.dCutoff))
    const cutoff = this.minCutoff + this.beta * Math.abs(edx)
    const filtered = lowpass(value, this.prev, smoothingAlpha(dt, cutoff))
    this.prev = filtered
    this.dPrev = edx
    this.tPrev = t
    return filtered
  }
}

function mix(filtered: number, raw: number, follow: number): number {
  return filtered + (raw - filtered) * follow
}

/** Live 1€ filter for a single stroke. Applied only while drawing — not again at commit. */
export class StrokeStabilizer {
  private x = new OneEuroAxis(MIN_CUTOFF, BETA, D_CUTOFF)
  private y = new OneEuroAxis(MIN_CUTOFF, BETA, D_CUTOFF)
  private last: { x: number; y: number } | null = null

  reset(point: PointerPoint): PointerPoint {
    this.x.reset()
    this.y.reset()
    this.x.next(point.x, point.timestamp)
    this.y.next(point.y, point.timestamp)
    this.last = { x: point.x, y: point.y }
    return point
  }

  push(point: PointerPoint, force = false): PointerPoint | null {
    const fx = this.x.next(point.x, point.timestamp)
    const fy = this.y.next(point.y, point.timestamp)
    const follow = force ? FOLLOW_END : FOLLOW
    const next = {
      ...point,
      x: mix(fx, point.x, follow),
      y: mix(fy, point.y, follow),
    }
    if (!force && this.last) {
      const d = Math.hypot(next.x - this.last.x, next.y - this.last.y)
      if (d < MIN_STEP) return null
    }
    this.last = { x: next.x, y: next.y }
    return next
  }
}
