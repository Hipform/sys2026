import type { DrawTool, PointerPoint, Stroke } from '../types/note'

export type TextureKind = 'none' | 'grain' | 'chalk' | 'wax'

export interface ToolProfile {
  pressureWidth: (base: number, pressure: number) => number
  alpha: number
  composite: GlobalCompositeOperation
  texture: TextureKind
  stamp: boolean
  calligraphy: boolean
}

export function toolProfile(tool: DrawTool): ToolProfile {
  switch (tool) {
    case 'pencil':
      return {
        pressureWidth: (b, p) => b * (0.7 + p * 0.45),
        alpha: 0.84,
        composite: 'source-over',
        texture: 'grain',
        stamp: false,
        calligraphy: false,
      }
    case 'mechanical':
      return {
        pressureWidth: (b, p) => b * (0.94 + p * 0.1),
        alpha: 1,
        composite: 'source-over',
        texture: 'none',
        stamp: false,
        calligraphy: false,
      }
    case 'fountain':
      return {
        pressureWidth: (b, p) => b * (0.22 + p * 1.7),
        alpha: 0.94,
        composite: 'source-over',
        texture: 'none',
        stamp: false,
        calligraphy: true,
      }
    case 'brush':
      return {
        pressureWidth: (b, p) => b * (0.12 + p * 1.9),
        alpha: 0.72,
        composite: 'source-over',
        texture: 'none',
        stamp: true,
        calligraphy: false,
      }
    case 'pastel':
      return {
        pressureWidth: (b, p) => b * (0.8 + p * 0.4),
        alpha: 0.52,
        composite: 'source-over',
        texture: 'chalk',
        stamp: true,
        calligraphy: false,
      }
    case 'crayon':
      return {
        pressureWidth: (b, p) => b * (0.85 + p * 0.35),
        alpha: 0.9,
        composite: 'source-over',
        texture: 'wax',
        stamp: false,
        calligraphy: false,
      }
    case 'highlighter':
      return {
        // Keep width almost constant so the mark stays even.
        pressureWidth: (b, p) => b * (0.94 + p * 0.08),
        alpha: 0.38,
        // multiply on a transparent overlay turns muddy/black.
        composite: 'source-over',
        texture: 'none',
        stamp: false,
        calligraphy: false,
      }
    case 'eraser':
      return {
        pressureWidth: (b, p) => b * (1.4 + p * 1.2),
        alpha: 1,
        composite: 'destination-out',
        texture: 'none',
        stamp: false,
        calligraphy: false,
      }
    default:
      return {
        pressureWidth: (b, p) => b * (0.45 + p * 1.15),
        alpha: 1,
        composite: 'source-over',
        texture: 'none',
        stamp: false,
        calligraphy: false,
      }
  }
}

export function strokeWidth(
  tool: DrawTool,
  baseWidth: number,
  pressure: number,
): number {
  const p = Number.isFinite(pressure) && pressure > 0 ? pressure : 0.5
  return toolProfile(tool).pressureWidth(baseWidth, p)
}

export function applyStrokeStyle(
  ctx: CanvasRenderingContext2D,
  tool: DrawTool,
  color: string,
  textured: boolean,
): void {
  const profile = toolProfile(tool)
  ctx.globalCompositeOperation = profile.composite
  ctx.globalAlpha = profile.alpha
  ctx.lineCap = profile.calligraphy ? 'butt' : 'round'
  ctx.lineJoin = 'round'
  if (tool === 'eraser') {
    ctx.strokeStyle = 'rgba(0,0,0,1)'
    ctx.fillStyle = 'rgba(0,0,0,1)'
    return
  }
  const pattern =
    textured && profile.texture !== 'none'
      ? grainPattern(ctx, color, profile.texture)
      : null
  ctx.strokeStyle = pattern ?? color
  ctx.fillStyle = pattern ?? color
}

function pointFromEvent(
  e: PointerEvent,
  rect: DOMRect,
  layoutW: number,
  layoutH: number,
): PointerPoint {
  const pressure = e.pressure > 0 && e.pressure < 1 ? e.pressure : 0.5
  return {
    x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * layoutW,
    y: ((e.clientY - rect.top) / Math.max(1, rect.height)) * layoutH,
    pressure,
    timestamp: e.timeStamp || performance.now(),
    pointerType: e.pointerType,
    tiltX: e.tiltX,
    tiltY: e.tiltY,
  }
}

/** Build a pointer sample at known page/world coordinates (e.g. board canvas). */
export function pointerPointFromEvent(
  e: PointerEvent,
  x: number,
  y: number,
): PointerPoint {
  const pressure = e.pressure > 0 && e.pressure < 1 ? e.pressure : 0.5
  return {
    x,
    y,
    pressure,
    timestamp: e.timeStamp || performance.now(),
    pointerType: e.pointerType,
    tiltX: e.tiltX,
    tiltY: e.tiltY,
  }
}

export function samplePointerEvents(
  e: PointerEvent,
  rect: DOMRect,
  layoutW: number,
  layoutH: number,
): { committed: PointerPoint[]; predicted: PointerPoint[] } {
  const coalesced =
    typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length > 0
      ? e.getCoalescedEvents()
      : [e]
  const committed = staggerTimestamps(
    coalesced.map((ev) => pointFromEvent(ev, rect, layoutW, layoutH)),
  )
  const predicted =
    typeof e.getPredictedEvents === 'function'
      ? staggerTimestamps(
          e.getPredictedEvents().map((ev) =>
            pointFromEvent(ev, rect, layoutW, layoutH),
          ),
        )
      : []
  return { committed, predicted }
}

function staggerTimestamps(points: PointerPoint[]): PointerPoint[] {
  const step = 1000 / 240
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!
    const cur = points[i]!
    if (cur.timestamp <= prev.timestamp) {
      cur.timestamp = prev.timestamp + step
    }
  }
  return points
}

type StrokeLike = Pick<Stroke, 'tool' | 'color' | 'width' | 'points'>

export function getInkContext(
  canvas: HTMLCanvasElement,
): CanvasRenderingContext2D | null {
  return (
    canvas.getContext('2d', { alpha: true, desynchronized: true }) ??
    canvas.getContext('2d', { alpha: true })
  )
}

export function configureInkLayer(
  canvas: HTMLCanvasElement,
  layoutW: number,
  layoutH: number,
  rasterZoom: number,
): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1
  const w = Math.max(1, Math.floor(layoutW * rasterZoom * dpr))
  const h = Math.max(1, Math.floor(layoutH * rasterZoom * dpr))
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  canvas.style.width = `${layoutW}px`
  canvas.style.height = `${layoutH}px`
  const ctx = getInkContext(canvas)
  if (!ctx) return null
  ctx.setTransform(dpr * rasterZoom, 0, 0, dpr * rasterZoom, 0, 0)
  return ctx
}

export function strokeBounds(
  stroke: StrokeLike,
  predicted: PointerPoint[] = [],
  pad = 24,
): { x: number; y: number; w: number; h: number } {
  const pts = predicted.length
    ? [...stroke.points, ...predicted]
    : stroke.points
  if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = pts[0]!.x
  let minY = pts[0]!.y
  let maxX = minX
  let maxY = minY
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const extra = pad + stroke.width * 3
  return {
    x: minX - extra,
    y: minY - extra,
    w: maxX - minX + extra * 2,
    h: maxY - minY + extra * 2,
  }
}

/** Variable-width stroke. `live` skips grain/chalk/wax textures. */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: StrokeLike,
  predicted: PointerPoint[] = [],
  options?: { live?: boolean },
): void {
  const pts = stroke.points
  if (pts.length === 0) return
  const live = options?.live === true
  ctx.save()
  applyStrokeStyle(ctx, stroke.tool, stroke.color, !live)
  if (pts.length === 1 && predicted.length === 0) {
    drawMark(ctx, pts[0]!, stroke, null)
    ctx.restore()
    return
  }

  drawBody(ctx, pts, stroke)
  if (predicted.length > 0 && stroke.tool !== 'highlighter') {
    const tail = [pts[pts.length - 1]!, ...predicted]
    ctx.globalAlpha *= 0.35
    drawBody(ctx, tail, stroke)
  }
  ctx.restore()
}

/** Draw only new segments from `fromIndex` (inclusive start point). */
export function drawStrokeFrom(
  ctx: CanvasRenderingContext2D,
  stroke: StrokeLike,
  fromIndex: number,
): void {
  const pts = stroke.points
  if (pts.length === 0) return
  ctx.save()
  applyStrokeStyle(ctx, stroke.tool, stroke.color, false)
  if (pts.length === 1) {
    drawMark(ctx, pts[0]!, stroke, null)
    ctx.restore()
    return
  }
  const start = Math.max(0, fromIndex)
  drawBody(ctx, pts.slice(start), stroke)
  ctx.restore()
}

function drawBody(
  ctx: CanvasRenderingContext2D,
  pts: PointerPoint[],
  stroke: StrokeLike,
): void {
  const profile = toolProfile(stroke.tool)
  if (stroke.tool === 'highlighter') {
    drawSmoothPath(ctx, pts, stroke)
    return
  }
  if (profile.stamp) {
    stampAlong(ctx, pts, stroke)
    return
  }
  if (profile.calligraphy) {
    drawNibRibbon(ctx, pts, stroke)
    return
  }
  drawWidthRibbon(ctx, pts, stroke)
}

/** One path so overlapping highlighter segments do not stack opacity. */
function drawSmoothPath(
  ctx: CanvasRenderingContext2D,
  pts: PointerPoint[],
  stroke: StrokeLike,
): void {
  if (pts.length === 1) {
    drawMark(ctx, pts[0]!, stroke, null)
    return
  }
  ctx.beginPath()
  ctx.lineWidth = strokeWidth(stroke.tool, stroke.width, 0.5)
  ctx.moveTo(pts[0]!.x, pts[0]!.y)
  if (pts.length === 2) {
    ctx.lineTo(pts[1]!.x, pts[1]!.y)
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const curr = pts[i]!
      const next = pts[i + 1]!
      ctx.quadraticCurveTo(
        curr.x,
        curr.y,
        (curr.x + next.x) / 2,
        (curr.y + next.y) / 2,
      )
    }
    const last = pts[pts.length - 1]!
    ctx.lineTo(last.x, last.y)
  }
  ctx.stroke()
}

function drawWidthRibbon(
  ctx: CanvasRenderingContext2D,
  pts: PointerPoint[],
  stroke: StrokeLike,
): void {
  if (pts.length === 1) {
    drawMark(ctx, pts[0]!, stroke, null)
    return
  }

  let sx = pts[0]!.x
  let sy = pts[0]!.y
  for (let i = 1; i < pts.length; i++) {
    const curr = pts[i]!
    const next = pts[i + 1]
    const w = strokeWidth(
      stroke.tool,
      stroke.width,
      (pts[i - 1]!.pressure + curr.pressure) / 2,
    )
    ctx.beginPath()
    ctx.lineWidth = w
    ctx.moveTo(sx, sy)
    if (next) {
      const mx = (curr.x + next.x) / 2
      const my = (curr.y + next.y) / 2
      ctx.quadraticCurveTo(curr.x, curr.y, mx, my)
      sx = mx
      sy = my
    } else {
      ctx.lineTo(curr.x, curr.y)
    }
    ctx.stroke()
  }
}

function drawNibRibbon(
  ctx: CanvasRenderingContext2D,
  pts: PointerPoint[],
  stroke: StrokeLike,
): void {
  if (pts.length === 1) {
    drawMark(ctx, pts[0]!, stroke, pts[0]!)
    return
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    const w = strokeWidth(
      stroke.tool,
      stroke.width,
      (a.pressure + b.pressure) / 2,
    )
    const angle = nibAngle(a, b)
    const dist = Math.hypot(b.x - a.x, b.y - a.y)
    ctx.beginPath()
    ctx.ellipse(
      (a.x + b.x) / 2,
      (a.y + b.y) / 2,
      Math.max(w * 0.4, dist / 2 + w * 0.15),
      Math.max(0.35, w * 0.28),
      angle,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  }
}

function stampAlong(
  ctx: CanvasRenderingContext2D,
  pts: PointerPoint[],
  stroke: StrokeLike,
): void {
  let prev = pts[0]!
  drawMark(ctx, prev, stroke, null)
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const curr = pts[i]!
    const dx = curr.x - prev.x
    const dy = curr.y - prev.y
    const dist = Math.hypot(dx, dy)
    const w = strokeWidth(
      stroke.tool,
      stroke.width,
      (prev.pressure + curr.pressure) / 2,
    )
    const spacing = Math.max(0.6, w * 0.32)
    let t = spacing - carry
    while (t <= dist) {
      const u = t / dist
      drawMark(
        ctx,
        {
          x: prev.x + dx * u,
          y: prev.y + dy * u,
          pressure: prev.pressure + (curr.pressure - prev.pressure) * u,
          timestamp: curr.timestamp,
          pointerType: curr.pointerType,
          tiltX: curr.tiltX,
          tiltY: curr.tiltY,
        },
        stroke,
        curr,
      )
      t += spacing
    }
    carry = dist - (t - spacing)
    prev = curr
  }
}

function drawMark(
  ctx: CanvasRenderingContext2D,
  p: PointerPoint,
  stroke: StrokeLike,
  next: PointerPoint | null,
): void {
  const profile = toolProfile(stroke.tool)
  const r = strokeWidth(stroke.tool, stroke.width, p.pressure) / 2
  if (profile.calligraphy) {
    const angle = next ? nibAngle(p, next) : tiltAngle(p)
    ctx.beginPath()
    ctx.ellipse(p.x, p.y, r * 1.1, r * 0.38, angle, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  ctx.beginPath()
  ctx.arc(p.x, p.y, Math.max(0.3, r), 0, Math.PI * 2)
  ctx.fill()
}

function tiltAngle(p: PointerPoint): number {
  const tx = p.tiltX ?? 0
  const ty = p.tiltY ?? 0
  if (Math.hypot(tx, ty) < 4) return Math.PI / 4
  return Math.atan2(ty, tx)
}

function nibAngle(a: PointerPoint, b: PointerPoint): number {
  const tx = b.tiltX ?? a.tiltX ?? 0
  const ty = b.tiltY ?? a.tiltY ?? 0
  if (Math.hypot(tx, ty) >= 8) return Math.atan2(ty, tx)
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (dx === 0 && dy === 0) return Math.PI / 4
  return Math.atan2(dy, dx) + Math.PI / 2
}

const patternCache = new Map<string, CanvasPattern | null>()

function grainPattern(
  ctx: CanvasRenderingContext2D,
  color: string,
  kind: TextureKind,
): CanvasPattern | null {
  const key = `${kind}:${color}`
  const hit = patternCache.get(key)
  if (hit !== undefined) return hit

  const size = kind === 'chalk' ? 64 : 48
  const tile = document.createElement('canvas')
  tile.width = size
  tile.height = size
  const g = tile.getContext('2d')
  if (!g) {
    patternCache.set(key, null)
    return null
  }
  g.fillStyle = color
  g.fillRect(0, 0, size, size)
  const img = g.getImageData(0, 0, size, size)
  const data = img.data
  for (let i = 0; i < data.length; i += 4) {
    const n = Math.random()
    let alpha = 255
    if (kind === 'grain') {
      alpha = n > 0.42 ? 230 : n > 0.22 ? 110 : 0
    } else if (kind === 'chalk') {
      alpha = n > 0.55 ? 210 : n > 0.28 ? 70 : 0
    } else {
      alpha = n > 0.28 ? 255 : n > 0.12 ? 150 : 35
    }
    data[i + 3] = alpha
  }
  g.putImageData(img, 0, 0)
  const pattern = ctx.createPattern(tile, 'repeat')
  patternCache.set(key, pattern)
  return pattern
}
