import { drawStroke } from './ink'
import type {
  ImageBox,
  PageItem,
  PdfMarkup,
  PointerPoint,
  Stroke,
  TextBox,
} from '../types/note'
import { isImageBox, isPdfMarkup, isTextBox } from '../types/note'

const imageCache = new Map<string, HTMLImageElement>()

export function clonePageItems(items: PageItem[]): PageItem[] {
  return items.map(clonePageItem)
}

export function clonePageItem(item: PageItem): PageItem {
  if (isTextBox(item) || isImageBox(item)) return { ...item }
  if (isPdfMarkup(item)) {
    return { ...item, rects: item.rects.map((r) => ({ ...r })) }
  }
  return {
    ...item,
    points: item.points.map((p) => ({ ...p })),
  }
}

export function drawPageItem(
  ctx: CanvasRenderingContext2D,
  item: PageItem,
  skipTextId?: string | null,
  onImageLoad?: () => void,
): void {
  if (isTextBox(item)) {
    if (skipTextId && item.id === skipTextId) return
    drawTextBox(ctx, item)
    return
  }
  if (isImageBox(item)) {
    drawImageBox(ctx, item, onImageLoad)
    return
  }
  if (isPdfMarkup(item)) {
    drawPdfMarkup(ctx, item)
    return
  }
  drawStroke(ctx, item)
}

export function drawPdfMarkup(
  ctx: CanvasRenderingContext2D,
  markup: PdfMarkup,
): void {
  ctx.save()
  ctx.globalCompositeOperation = 'multiply'
  for (const r of markup.rects) {
    if (markup.mode === 'highlight') {
      ctx.globalAlpha = 0.35
      ctx.fillStyle = markup.color
      ctx.fillRect(r.x, r.y, r.width, r.height)
    } else {
      ctx.globalAlpha = 1
      ctx.strokeStyle = markup.color
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(r.x, r.y + r.height - 1)
      ctx.lineTo(r.x + r.width, r.y + r.height - 1)
      ctx.stroke()
    }
  }
  ctx.restore()
}

export function drawTextBox(ctx: CanvasRenderingContext2D, box: TextBox): void {
  const text = box.text
  if (!text) return
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.fillStyle = box.color
  ctx.font = `${box.fontSize}px ui-sans-serif, system-ui, sans-serif`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  const lineHeight = box.fontSize * 1.35
  const lines = wrapText(ctx, text, Math.max(24, box.width))
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i]!, box.x, box.y + i * lineHeight)
  }
  ctx.restore()
}

export function drawImageBox(
  ctx: CanvasRenderingContext2D,
  box: ImageBox,
  onLoad?: () => void,
): void {
  const img = getCachedImage(box.dataUrl, onLoad)
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, box.x, box.y, box.width, box.height)
  } else {
    ctx.fillStyle = '#e2e8f0'
    ctx.fillRect(box.x, box.y, box.width, box.height)
  }
  ctx.restore()
}

function getCachedImage(
  dataUrl: string,
  onLoad?: () => void,
): HTMLImageElement | null {
  const cached = imageCache.get(dataUrl)
  if (cached) {
    if (!cached.complete && onLoad) {
      cached.addEventListener('load', onLoad, { once: true })
    }
    return cached
  }
  if (typeof Image === 'undefined') return null
  const img = new Image()
  if (onLoad) img.addEventListener('load', onLoad, { once: true })
  img.src = dataUrl
  imageCache.set(dataUrl, img)
  return img
}

export async function ensureImagesLoaded(items: PageItem[]): Promise<void> {
  const urls = items.filter(isImageBox).map((item) => item.dataUrl)
  await Promise.all(urls.map((url) => loadImageElement(url)))
}

function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(dataUrl)
  if (cached?.complete && cached.naturalWidth > 0) {
    return Promise.resolve(cached)
  }
  return new Promise((resolve, reject) => {
    const img = cached ?? new Image()
    img.onload = () => {
      imageCache.set(dataUrl, img)
      resolve(img)
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    if (!cached) {
      img.src = dataUrl
      imageCache.set(dataUrl, img)
    }
  })
}

export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
): string[] {
  const paragraphs = text.replace(/\r/g, '').split('\n')
  const lines: string[] = []
  for (const para of paragraphs) {
    if (para === '') {
      lines.push('')
      continue
    }
    let current = ''
    for (const word of para.split(/(\s+)/)) {
      const next = current + word
      if (current && ctx.measureText(next).width > width) {
        lines.push(current)
        current = word.trimStart()
      } else {
        current = next
      }
    }
    lines.push(current)
  }
  return lines.length > 0 ? lines : ['']
}

export function measureTextHeight(
  ctx: CanvasRenderingContext2D,
  box: Pick<TextBox, 'text' | 'width' | 'fontSize'>,
): number {
  ctx.save()
  ctx.font = `${box.fontSize}px ui-sans-serif, system-ui, sans-serif`
  const lines = wrapText(ctx, box.text || ' ', Math.max(24, box.width))
  ctx.restore()
  return Math.max(box.fontSize * 1.35, lines.length * box.fontSize * 1.35)
}

export function itemBounds(item: PageItem): {
  x: number
  y: number
  w: number
  h: number
} {
  if (isTextBox(item) || isImageBox(item)) {
    return {
      x: item.x,
      y: item.y,
      w: Math.max(24, item.width),
      h: isTextBox(item)
        ? Math.max(item.fontSize * 1.35, item.height)
        : Math.max(16, item.height),
    }
  }
  if (isPdfMarkup(item)) {
    if (item.rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const r of item.rects) {
      minX = Math.min(minX, r.x)
      minY = Math.min(minY, r.y)
      maxX = Math.max(maxX, r.x + r.width)
      maxY = Math.max(maxY, r.y + r.height)
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }
  return strokeItemBounds(item)
}

function strokeItemBounds(stroke: Stroke): {
  x: number
  y: number
  w: number
  h: number
} {
  if (stroke.points.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = stroke.points[0]!.x
  let minY = stroke.points[0]!.y
  let maxX = minX
  let maxY = minY
  for (const p of stroke.points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const pad = stroke.width * 1.5
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  }
}

export function unionBounds(
  items: PageItem[],
  pad = 8,
): { x: number; y: number; w: number; h: number } | null {
  if (items.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const item of items) {
    const b = itemBounds(item)
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  }
}

export function pointInRect(
  x: number,
  y: number,
  r: { x: number; y: number; w: number; h: number },
): boolean {
  return x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h
}

export function movePageItem(item: PageItem, dx: number, dy: number): PageItem {
  if (isTextBox(item) || isImageBox(item)) {
    return { ...item, x: item.x + dx, y: item.y + dy }
  }
  if (isPdfMarkup(item)) {
    return {
      ...item,
      rects: item.rects.map((r) => ({
        ...r,
        x: r.x + dx,
        y: r.y + dy,
      })),
    }
  }
  return {
    ...item,
    points: item.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
  }
}

export function duplicatePageItem(item: PageItem, dx = 18, dy = 18): PageItem {
  const moved = movePageItem(item, dx, dy)
  const kind = isTextBox(moved) ? 'text' : isImageBox(moved) ? 'image' : 'stroke'
  return {
    ...moved,
    id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  }
}

export function itemCentroid(item: PageItem): { x: number; y: number } {
  if (isTextBox(item) || isImageBox(item) || isPdfMarkup(item)) {
    const b = itemBounds(item)
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  }
  if (item.points.length === 0) return { x: 0, y: 0 }
  let sx = 0
  let sy = 0
  for (const p of item.points) {
    sx += p.x
    sy += p.y
  }
  return { x: sx / item.points.length, y: sy / item.points.length }
}

export function pointInPolygon(
  x: number,
  y: number,
  poly: Pick<PointerPoint, 'x' | 'y'>[],
): boolean {
  if (poly.length < 3) return false
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x
    const yi = poly[i]!.y
    const xj = poly[j]!.x
    const yj = poly[j]!.y
    const hit =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi
    if (hit) inside = !inside
  }
  return inside
}

export function itemInLasso(
  item: PageItem,
  poly: Pick<PointerPoint, 'x' | 'y'>[],
): boolean {
  const c = itemCentroid(item)
  if (pointInPolygon(c.x, c.y, poly)) return true
  if (isTextBox(item) || isImageBox(item) || isPdfMarkup(item)) return false
  if (item.points.length === 0) return false
  let hit = 0
  for (const p of item.points) {
    if (pointInPolygon(p.x, p.y, poly)) hit += 1
  }
  return hit * 2 >= item.points.length
}

export function hitTextBox(
  items: PageItem[],
  x: number,
  y: number,
): TextBox | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!
    if (!isTextBox(item)) continue
    if (pointInRect(x, y, itemBounds(item))) return item
  }
  return null
}

export function newTextBox(partial: Omit<TextBox, 'id' | 'type'>): TextBox {
  return {
    id: `text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'text',
    ...partial,
  }
}

export function newImageBox(partial: Omit<ImageBox, 'id' | 'type'>): ImageBox {
  return {
    id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'image',
    ...partial,
  }
}

export async function readImageAsBox(
  file: File,
): Promise<Omit<ImageBox, 'id' | 'type' | 'x' | 'y'>> {
  const dataUrl = await fileToJpegDataUrl(file, 1920, 0.82)
  const size = await measureDataUrl(dataUrl)
  const maxCss = 280
  const scale = Math.min(1, maxCss / Math.max(size.width, size.height, 1))
  return {
    dataUrl,
    width: Math.max(24, size.width * scale),
    height: Math.max(24, size.height * scale),
  }
}

function fileToJpegDataUrl(
  file: File,
  maxEdge: number,
  quality: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height, 1))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Could not read image'))
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read image'))
    }
    img.src = url
  })
}

function measureDataUrl(
  dataUrl: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Could not measure image'))
    img.src = dataUrl
  })
}

export function rotatePageItem(
  item: PageItem,
  cx: number,
  cy: number,
  radians: number,
): PageItem {
  if (isPdfMarkup(item)) return item
  if (isTextBox(item) || isImageBox(item)) {
    const b = itemBounds(item)
    const corners = [
      rotateXY(b.x, b.y, cx, cy, radians),
      rotateXY(b.x + b.w, b.y, cx, cy, radians),
      rotateXY(b.x + b.w, b.y + b.h, cx, cy, radians),
      rotateXY(b.x, b.y + b.h, cx, cy, radians),
    ]
    const xs = corners.map((p) => p.x)
    const ys = corners.map((p) => p.y)
    const nx = Math.min(...xs)
    const ny = Math.min(...ys)
    return {
      ...item,
      x: nx,
      y: ny,
      width: Math.max(...xs) - nx,
      height: Math.max(...ys) - ny,
    }
  }
  return {
    ...item,
    points: item.points.map((p) => {
      const r = rotateXY(p.x, p.y, cx, cy, radians)
      return { ...p, x: r.x, y: r.y }
    }),
  }
}

function rotateXY(
  x: number,
  y: number,
  cx: number,
  cy: number,
  radians: number,
): { x: number; y: number } {
  const dx = x - cx
  const dy = y - cy
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c }
}

export function itemHitsEraser(
  item: PageItem,
  path: Pick<PointerPoint, 'x' | 'y'>[],
  radius: number,
): boolean {
  if (path.length === 0) return false
  const r = Math.max(1, radius)
  if (isTextBox(item) || isImageBox(item) || isPdfMarkup(item)) {
    const b = itemBounds(item)
    for (const p of path) {
      const cx = Math.max(b.x, Math.min(p.x, b.x + b.w))
      const cy = Math.max(b.y, Math.min(p.y, b.y + b.h))
      if (Math.hypot(p.x - cx, p.y - cy) <= r) return true
    }
    return false
  }
  const pts = item.points
  if (pts.length === 0) return false
  const hitR = r + item.width / 2
  for (let i = 0; i < path.length; i++) {
    const a = path[i]!
    const b = path[i + 1] ?? a
    for (let j = 0; j < pts.length; j++) {
      const c = pts[j]!
      const d = pts[j + 1] ?? c
      if (segmentsNear(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y, hitR)) {
        return true
      }
    }
  }
  return false
}

function segmentsNear(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  maxDist: number,
): boolean {
  return (
    distToSegment(ax, ay, cx, cy, dx, dy) <= maxDist ||
    distToSegment(bx, by, cx, cy, dx, dy) <= maxDist ||
    distToSegment(cx, cy, ax, ay, bx, by) <= maxDist ||
    distToSegment(dx, dy, ax, ay, bx, by) <= maxDist
  )
}

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax
  const aby = by - ay
  const len2 = abx * abx + aby * aby
  let t = 0
  if (len2 > 1e-8) {
    t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2))
  }
  return Math.hypot(px - (ax + t * abx), py - (ay + t * aby))
}

export type Bounds = { x: number; y: number; w: number; h: number }

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const RESIZE_HANDLES: ResizeHandle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
]

export function handleCenter(
  box: Bounds,
  handle: ResizeHandle,
): { x: number; y: number } {
  const mx = box.x + box.w / 2
  const my = box.y + box.h / 2
  const r = box.x + box.w
  const b = box.y + box.h
  switch (handle) {
    case 'nw':
      return { x: box.x, y: box.y }
    case 'n':
      return { x: mx, y: box.y }
    case 'ne':
      return { x: r, y: box.y }
    case 'e':
      return { x: r, y: my }
    case 'se':
      return { x: r, y: b }
    case 's':
      return { x: mx, y: b }
    case 'sw':
      return { x: box.x, y: b }
    case 'w':
      return { x: box.x, y: my }
  }
}

export function hitResizeHandle(
  box: Bounds,
  x: number,
  y: number,
  size: number,
): ResizeHandle | null {
  const half = size / 2
  const order: ResizeHandle[] = [
    'nw',
    'ne',
    'se',
    'sw',
    'n',
    'e',
    's',
    'w',
  ]
  for (const handle of order) {
    const c = handleCenter(box, handle)
    if (Math.abs(x - c.x) <= half && Math.abs(y - c.y) <= half) return handle
  }
  return null
}

export function resizeCursor(handle: ResizeHandle): string {
  switch (handle) {
    case 'n':
    case 's':
      return 'ns-resize'
    case 'e':
    case 'w':
      return 'ew-resize'
    case 'ne':
    case 'sw':
      return 'nesw-resize'
    default:
      return 'nwse-resize'
  }
}

/** Scale factors from dragging a handle. Origin is the opposite edge/corner. */
export function resizeScale(
  box: Bounds,
  handle: ResizeHandle,
  px: number,
  py: number,
): { originX: number; originY: number; sx: number; sy: number } {
  const min = 0.08
  const w = Math.max(1, box.w)
  const h = Math.max(1, box.h)
  const right = box.x + box.w
  const bottom = box.y + box.h
  let originX = box.x
  let originY = box.y
  let sx = 1
  let sy = 1

  switch (handle) {
    case 'se':
      sx = (px - originX) / w
      sy = (py - originY) / h
      break
    case 'nw':
      originX = right
      originY = bottom
      sx = (originX - px) / w
      sy = (originY - py) / h
      break
    case 'ne':
      originY = bottom
      sx = (px - originX) / w
      sy = (originY - py) / h
      break
    case 'sw':
      originX = right
      sx = (originX - px) / w
      sy = (py - originY) / h
      break
    case 'e':
      sx = (px - originX) / w
      break
    case 'w':
      originX = right
      sx = (originX - px) / w
      break
    case 's':
      sy = (py - originY) / h
      break
    case 'n':
      originY = bottom
      sy = (originY - py) / h
      break
  }

  return {
    originX,
    originY,
    sx: Math.max(min, sx),
    sy: Math.max(min, sy),
  }
}

export function scalePageItem(
  item: PageItem,
  originX: number,
  originY: number,
  sx: number,
  sy: number,
): PageItem {
  const strokeScale = Math.max(0.08, Math.sqrt(Math.abs(sx * sy)))
  if (isTextBox(item)) {
    return {
      ...item,
      x: originX + (item.x - originX) * sx,
      y: originY + (item.y - originY) * sy,
      width: Math.max(16, item.width * Math.abs(sx)),
      height: Math.max(12, item.height * Math.abs(sy)),
      fontSize: Math.max(8, item.fontSize * strokeScale),
    }
  }
  if (isImageBox(item)) {
    return {
      ...item,
      x: originX + (item.x - originX) * sx,
      y: originY + (item.y - originY) * sy,
      width: Math.max(16, item.width * Math.abs(sx)),
      height: Math.max(16, item.height * Math.abs(sy)),
    }
  }
  if (isPdfMarkup(item)) {
    return {
      ...item,
      rects: item.rects.map((r) => ({
        x: originX + (r.x - originX) * sx,
        y: originY + (r.y - originY) * sy,
        width: Math.max(2, r.width * Math.abs(sx)),
        height: Math.max(2, r.height * Math.abs(sy)),
      })),
    }
  }
  return {
    ...item,
    width: Math.max(0.35, item.width * strokeScale),
    points: item.points.map((p) => ({
      ...p,
      x: originX + (p.x - originX) * sx,
      y: originY + (p.y - originY) * sy,
    })),
  }
}
