import type { DrawTool, PointerPoint } from '../types/note'

export type ShapeKind =
  | 'line'
  | 'ellipse'
  | 'triangle'
  | 'rect'
  | 'diamond'
  | 'pentagon'
  | 'hexagon'
  | 'heptagon'
  | 'octagon'
  | 'polygon'

export interface RecognizedShape {
  kind: ShapeKind
  points: PointerPoint[]
  closed: boolean
  center: { x: number; y: number }
}

type Fit = {
  kind: ShapeKind
  error: number
  points: PointerPoint[]
  closed: boolean
  center: { x: number; y: number }
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function pathLength(pts: { x: number; y: number }[]): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1]!, pts[i]!)
  return len
}

function bbox(pts: { x: number; y: number }[]): {
  x: number
  y: number
  w: number
  h: number
} {
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
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function centroid(pts: { x: number; y: number }[]): { x: number; y: number } {
  let x = 0
  let y = 0
  for (const p of pts) {
    x += p.x
    y += p.y
  }
  const n = Math.max(1, pts.length)
  return { x: x / n, y: y / n }
}

function wrapPi(d: number): number {
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

function heading(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.atan2(b.y - a.y, b.x - a.x)
}

function perpDist(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return dist(p, a)
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len
}

function distToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-6) return dist(p, a)
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2),
  )
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

function distToPoly(
  p: { x: number; y: number },
  verts: { x: number; y: number }[],
): number {
  let min = Infinity
  const n = verts.length
  for (let i = 0; i < n; i++) {
    min = Math.min(min, distToSegment(p, verts[i]!, verts[(i + 1) % n]!))
  }
  return min
}

function chordDeviation(pts: { x: number; y: number }[]): number {
  const a = pts[0]!
  const b = pts[pts.length - 1]!
  const len = dist(a, b)
  if (len < 1) return Infinity
  let max = 0
  for (const p of pts) max = Math.max(max, perpDist(p, a, b))
  return max / len
}

function resampleMeta(
  src: PointerPoint[],
  coords: { x: number; y: number }[],
): PointerPoint[] {
  const first = src[0]!
  const last = src[src.length - 1]!
  let pressure = 0
  for (const p of src) pressure += p.pressure
  pressure /= src.length
  const t0 = first.timestamp
  const t1 = last.timestamp
  const n = Math.max(1, coords.length - 1)
  return coords.map((c, i) => ({
    ...first,
    x: c.x,
    y: c.y,
    pressure,
    timestamp: t0 + ((t1 - t0) * i) / n,
  }))
}

function sampleLine(
  a: { x: number; y: number },
  b: { x: number; y: number },
  n = 24,
): { x: number; y: number }[] {
  const pts = []
  const count = Math.max(2, n)
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  }
  return pts
}

function samplePolygon(
  verts: { x: number; y: number }[],
): { x: number; y: number }[] {
  const n = verts.length
  if (n < 2) return verts.map((v) => ({ x: v.x, y: v.y }))
  const per = Math.max(8, Math.round(72 / n))
  const coords: { x: number; y: number }[] = []
  for (let i = 0; i < n; i++) {
    const a = verts[i]!
    const b = verts[(i + 1) % n]!
    coords.push(...sampleLine(a, b, per).slice(0, -1))
  }
  coords.push({ x: verts[0]!.x, y: verts[0]!.y })
  return coords
}

function snapAxis(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const ang = Math.atan2(dy, dx)
  const snapped = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2)
  const d = wrapPi(ang - snapped)
  if (Math.abs(d) > (15 * Math.PI) / 180) return b
  const len = Math.hypot(dx, dy)
  return {
    x: a.x + Math.cos(snapped) * len,
    y: a.y + Math.sin(snapped) * len,
  }
}

function rdp(pts: PointerPoint[], epsilon: number): PointerPoint[] {
  if (pts.length < 3) return pts.slice()
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  if (dist(first, last) < 1e-4) {
    let far = 0
    let idx = 1
    for (let i = 1; i < pts.length - 1; i++) {
      const d = dist(pts[i]!, first)
      if (d > far) {
        far = d
        idx = i
      }
    }
    if (far <= epsilon) return [first, last]
    const left = rdp(pts.slice(0, idx + 1), epsilon)
    const right = rdp(pts.slice(idx), epsilon)
    return [...left.slice(0, -1), ...right]
  }

  let maxD = 0
  let idx = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i]!, first, last)
    if (d > maxD) {
      maxD = d
      idx = i
    }
  }
  if (maxD > epsilon) {
    const left = rdp(pts.slice(0, idx + 1), epsilon)
    const right = rdp(pts.slice(idx), epsilon)
    return [...left.slice(0, -1), ...right]
  }
  return [first, last]
}

function simplify(pts: PointerPoint[]): PointerPoint[] {
  const box = bbox(pts)
  const size = Math.max(box.w, box.h, pathLength(pts) * 0.08, 8)
  const epsilon = Math.max(1.6, size * 0.035)
  const out = rdp(pts, epsilon)
  return out.length >= 2 ? out : pts.slice(0, 2)
}

function dropTinyEdges(pts: PointerPoint[], minLen: number): PointerPoint[] {
  if (pts.length < 3) return pts
  const out = [pts[0]!]
  for (let i = 1; i < pts.length - 1; i++) {
    if (dist(out[out.length - 1]!, pts[i]!) >= minLen) out.push(pts[i]!)
  }
  const last = pts[pts.length - 1]!
  if (dist(out[out.length - 1]!, last) < minLen && out.length > 1) {
    out[out.length - 1] = last
  } else {
    out.push(last)
  }
  return out
}

function uniqueLoop(pts: PointerPoint[], size: number): PointerPoint[] {
  if (pts.length < 2) return pts
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  if (dist(first, last) <= Math.max(6, size * 0.18)) {
    return pts.slice(0, -1)
  }
  return pts
}

function vertexTurn(
  prev: { x: number; y: number },
  cur: { x: number; y: number },
  next: { x: number; y: number },
): number {
  return wrapPi(heading(cur, next) - heading(prev, cur))
}

function mergeColinear(
  pts: PointerPoint[],
  maxTurnDeg = 36,
): PointerPoint[] {
  if (pts.length < 4) return pts
  const minTurn = (maxTurnDeg * Math.PI) / 180
  const out: PointerPoint[] = []
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const prev = pts[(i + n - 1) % n]!
    const cur = pts[i]!
    const next = pts[(i + 1) % n]!
    if (Math.abs(vertexTurn(prev, cur, next)) >= minTurn) out.push(cur)
  }
  return out.length >= 3 ? out : pts
}

function axisAligned(
  a: { x: number; y: number },
  b: { x: number; y: number },
  tolDeg = 18,
): boolean {
  const ang = heading(a, b)
  const snapped = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2)
  return Math.abs(wrapPi(ang - snapped)) <= (tolDeg * Math.PI) / 180
}

function resampleArc(
  pts: { x: number; y: number }[],
  n: number,
): { x: number; y: number }[] {
  const total = pathLength(pts)
  if (total < 1 || pts.length < 2) {
    return pts.map((p) => ({ x: p.x, y: p.y }))
  }
  const out: { x: number; y: number }[] = []
  for (let k = 0; k < n; k++) {
    const target = (k / (n - 1)) * total
    let acc = 0
    let pushed = false
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!
      const b = pts[i + 1]!
      const seg = dist(a, b)
      if (acc + seg >= target || i === pts.length - 2) {
        const t =
          seg < 1e-6 ? 0 : Math.min(1, Math.max(0, (target - acc) / seg))
        out.push({
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
        })
        pushed = true
        break
      }
      acc += seg
    }
    if (!pushed) {
      const last = pts[pts.length - 1]!
      out.push({ x: last.x, y: last.y })
    }
  }
  return out
}

function rmseToPoly(
  pts: { x: number; y: number }[],
  verts: { x: number; y: number }[],
): number {
  if (pts.length === 0) return Infinity
  let err = 0
  for (const p of pts) {
    const d = distToPoly(p, verts)
    err += d * d
  }
  return Math.sqrt(err / pts.length)
}

function kindForSides(n: number): ShapeKind {
  if (n === 3) return 'triangle'
  if (n === 5) return 'pentagon'
  if (n === 6) return 'hexagon'
  if (n === 7) return 'heptagon'
  if (n === 8) return 'octagon'
  return 'polygon'
}

function regularPolygon(
  n: number,
  cx: number,
  cy: number,
  r: number,
  rot: number,
): { x: number; y: number }[] {
  const verts: { x: number; y: number }[] = []
  for (let i = 0; i < n; i++) {
    const a = rot + (i * 2 * Math.PI) / n
    verts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
  }
  return verts
}

function windingSign(verts: { x: number; y: number }[]): number {
  let a = 0
  const n = verts.length
  for (let i = 0; i < n; i++) {
    const p = verts[i]!
    const q = verts[(i + 1) % n]!
    a += p.x * q.y - q.x * p.y
  }
  return a >= 0 ? 1 : -1
}

function fitRegular(
  verts: { x: number; y: number }[],
  sampled: { x: number; y: number }[],
  src: PointerPoint[],
  size: number,
): Fit | null {
  const n = verts.length
  if (n < 3 || n > 8) return null
  const c = centroid(verts)
  let r = 0
  for (const v of verts) r += dist(v, c)
  r /= n
  if (r < 12) return null
  let rVar = 0
  for (const v of verts) {
    const d = dist(v, c) - r
    rVar += d * d
  }
  if (Math.sqrt(rVar / n) / r > 0.22) return null

  const sign = windingSign(verts)
  const step = (sign * 2 * Math.PI) / n
  const angles = verts.map((v) => Math.atan2(v.y - c.y, v.x - c.x))
  let rot = angles[0]!
  let shift = 0
  for (let i = 1; i < n; i++) {
    shift += wrapPi(angles[i]! - (angles[0]! + i * step))
  }
  rot += shift / n
  const regular = regularPolygon(n, c.x, c.y, r, rot)
  const error = rmseToPoly(sampled, regular) / size
  if (error > 0.16) return null
  return {
    kind: n === 4 ? 'diamond' : kindForSides(n),
    error,
    points: resampleMeta(src, samplePolygon(regular)),
    closed: true,
    center: c,
  }
}

function fitIrregularPoly(
  verts: { x: number; y: number }[],
  sampled: { x: number; y: number }[],
  src: PointerPoint[],
  size: number,
): Fit | null {
  const n = verts.length
  if (n < 3 || n > 8) return null
  const error = rmseToPoly(sampled, verts) / size
  if (error > 0.18) return null
  const c = centroid(verts)
  return {
    kind: kindForSides(n),
    error,
    points: resampleMeta(src, samplePolygon(verts)),
    closed: true,
    center: c,
  }
}

function fitLine(
  pts: PointerPoint[],
  maxRel: number,
  minLen: number,
): Fit | null {
  const a = pts[0]!
  const b = pts[pts.length - 1]!
  const chord = dist(a, b)
  if (chord < minLen) return null
  const rel = chordDeviation(pts)
  if (rel > maxRel) return null
  const simple = dropTinyEdges(simplify(pts), Math.max(3, chord * 0.04))
  if (simple.length > 3) return null
  if (pathLength(simple) / chord > 1.14) return null
  const end = snapAxis(a, b)
  return {
    kind: 'line',
    error: rel,
    points: resampleMeta(pts, sampleLine(a, end)),
    closed: false,
    center: { x: (a.x + end.x) / 2, y: (a.y + end.y) / 2 },
  }
}

function fitEllipse(pts: PointerPoint[]): Fit | null {
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  const box = bbox(pts)
  const size = Math.max(box.w, box.h)
  if (size < 22) return null
  const aspect = Math.max(box.w, box.h) / Math.max(1, Math.min(box.w, box.h))
  if (aspect > 4.2) return null
  if (dist(first, last) > size * 0.42) return null

  const sampled = resampleArc(pts, 64)
  const c = centroid(sampled)
  let xx = 0
  let xy = 0
  let yy = 0
  for (const p of sampled) {
    const dx = p.x - c.x
    const dy = p.y - c.y
    xx += dx * dx
    xy += dx * dy
    yy += dy * dy
  }
  const theta = 0.5 * Math.atan2(2 * xy, xx - yy)
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  let rx = 0
  let ry = 0
  for (const p of sampled) {
    const dx = p.x - c.x
    const dy = p.y - c.y
    const lx = Math.abs(dx * cos + dy * sin)
    const ly = Math.abs(-dx * sin + dy * cos)
    if (lx > rx) rx = lx
    if (ly > ry) ry = ly
  }
  if (rx < 12 || ry < 10) return null

  let varSum = 0
  const bins = new Array<boolean>(16).fill(false)
  for (const p of sampled) {
    const dx = p.x - c.x
    const dy = p.y - c.y
    const lx = (dx * cos + dy * sin) / rx
    const ly = (-dx * sin + dy * cos) / ry
    const ri = Math.hypot(lx, ly)
    varSum += (ri - 1) * (ri - 1)
    const ang = Math.atan2(ly, lx)
    const i = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 16) % 16
    bins[i] = true
  }
  const rmse = Math.sqrt(varSum / sampled.length)
  if (rmse > 0.2) return null
  if (bins.filter(Boolean).length < 10) return null

  const len = pathLength(pts)
  const peri =
    Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)))
  if (len < peri * 0.55) return null

  const coords: { x: number; y: number }[] = []
  const n = 72
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2
    const lx = Math.cos(t) * rx
    const ly = Math.sin(t) * ry
    coords.push({
      x: c.x + lx * cos - ly * sin,
      y: c.y + lx * sin + ly * cos,
    })
  }
  return {
    kind: 'ellipse',
    error: rmse,
    points: resampleMeta(pts, coords),
    closed: true,
    center: c,
  }
}

function rectFromBox(
  pts: PointerPoint[],
  box: ReturnType<typeof bbox>,
  error: number,
): Fit {
  const x = box.x
  const y = box.y
  const r = box.x + box.w
  const b = box.y + box.h
  const coords = [
    ...sampleLine({ x, y }, { x: r, y }, 16).slice(0, -1),
    ...sampleLine({ x: r, y }, { x: r, y: b }, 16).slice(0, -1),
    ...sampleLine({ x: r, y: b }, { x, y: b }, 16).slice(0, -1),
    ...sampleLine({ x, y: b }, { x, y }, 16),
  ]
  return {
    kind: 'rect',
    error,
    points: resampleMeta(pts, coords),
    closed: true,
    center: { x: x + box.w / 2, y: y + box.h / 2 },
  }
}

function fitAxisRect(
  verts: { x: number; y: number }[],
  pts: PointerPoint[],
  sampled: { x: number; y: number }[],
): Fit | null {
  if (verts.length < 4 || verts.length > 5) return null
  const n = verts.length
  let axis = 0
  for (let i = 0; i < n; i++) {
    if (axisAligned(verts[i]!, verts[(i + 1) % n]!)) axis += 1
  }
  if (axis < 3) return null
  const box = bbox(pts)
  const size = Math.min(box.w, box.h)
  if (box.w < 18 || box.h < 18) return null
  if (Math.max(box.w, box.h) / size > 8) return null
  const error =
    rmseToPoly(sampled, [
      { x: box.x, y: box.y },
      { x: box.x + box.w, y: box.y },
      { x: box.x + box.w, y: box.y + box.h },
      { x: box.x, y: box.y + box.h },
    ]) / size
  if (error > 0.22) return null
  return rectFromBox(pts, box, error)
}

function polygonVertices(pts: PointerPoint[]): PointerPoint[] | null {
  const box = bbox(pts)
  const size = Math.max(box.w, box.h)
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  if (dist(first, last) > size * 0.42) return null
  const simple = mergeColinear(
    dropTinyEdges(
      uniqueLoop(simplify(pts), size),
      Math.max(4, size * 0.055),
    ),
  )
  if (simple.length < 3 || simple.length > 8) return null
  return simple
}

function fitPolygons(pts: PointerPoint[]): Fit[] {
  const verts = polygonVertices(pts)
  if (!verts) return []
  const box = bbox(pts)
  const size = Math.max(box.w, box.h, 1)
  const sampled = resampleArc(pts, 64)
  const out: Fit[] = []
  const axis = fitAxisRect(verts, pts, sampled)
  if (axis) out.push(axis)
  const regular = fitRegular(verts, sampled, pts, size)
  if (regular) out.push(regular)
  const irregular = fitIrregularPoly(verts, sampled, pts, size)
  if (irregular) {
    if (verts.length === 4) {
      if (!axis) {
        irregular.kind = 'rect'
        out.push(irregular)
      }
    } else {
      out.push(irregular)
    }
  }
  return out
}

export function isClosedShapeStroke(points: PointerPoint[]): boolean {
  if (points.length < 10) return false
  const first = points[0]!
  const last = points[points.length - 1]!
  const box = bbox(points)
  const size = Math.max(box.w, box.h)
  if (size < 22) return false
  if (dist(first, last) > Math.max(14, size * 0.2)) return false
  return pathLength(points) >= size * 1.85
}

export function recognizeShape(
  points: PointerPoint[],
  tool: DrawTool,
): RecognizedShape | null {
  if (points.length < 2) return null
  const len = pathLength(points)
  const minLen = tool === 'highlighter' ? 16 : 22
  if (len < minLen) return null

  const lineRel = tool === 'highlighter' ? 0.18 : 0.12
  const candidates: Fit[] = []

  const line = fitLine(points, lineRel, minLen)
  if (line) candidates.push(line)
  const ellipse = fitEllipse(points)
  if (ellipse) candidates.push(ellipse)
  candidates.push(...fitPolygons(points))

  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.error - b.error)
  const best = candidates[0]!
  return {
    kind: best.kind,
    points: best.points,
    closed: best.closed,
    center: best.center,
  }
}

export function snapShape(
  points: PointerPoint[],
  tool: DrawTool,
): PointerPoint[] | null {
  return recognizeShape(points, tool)?.points ?? null
}

export function scaleShapePoints(
  rel: { x: number; y: number }[],
  center: { x: number; y: number },
  scale: number,
  template: PointerPoint,
): PointerPoint[] {
  const s = Math.max(0.18, Math.min(8, scale))
  return rel.map((p, i) => ({
    ...template,
    x: center.x + p.x * s,
    y: center.y + p.y * s,
    timestamp: template.timestamp + i,
    pressure: template.pressure,
  }))
}

export function shapeRelativeCoords(
  points: PointerPoint[],
  center: { x: number; y: number },
): { x: number; y: number }[] {
  return points.map((p) => ({ x: p.x - center.x, y: p.y - center.y }))
}
