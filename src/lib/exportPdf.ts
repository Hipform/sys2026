import {
  LineCapStyle,
  PDFDocument,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFPage,
  type RGB,
} from 'pdf-lib'
import { drawPageItem, drawTextBox, ensureImagesLoaded, wrapText } from './pageItems'
import { loadPdfDocument, notePageLayout, notePageMaxCssWidth } from './pdf'
import type { ImageBox, PageItem, PdfMarkup, Stroke, TextBox } from '../types/note'
import { isImageBox, isPdfMarkup, isStroke, isTextBox } from '../types/note'

/** Thrown when the original PDF cannot be copied (e.g. encryption). */
export class RasterFallbackError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RasterFallbackError'
  }
}

function isRasterFallbackError(err: unknown): boolean {
  if (err instanceof RasterFallbackError) return true
  const msg = err instanceof Error ? err.message : String(err)
  return (
    /encrypted|password|is encrypted/i.test(msg) ||
    /Failed to parse PDFDocument/i.test(msg) ||
    /PDFDocument\.load/i.test(msg)
  )
}

export async function exportAnnotatedPdf(
  file: File | ArrayBuffer,
  pageCount: number,
  inkByPage: Map<number, PageItem[]>,
): Promise<{ blob: Blob; vector: boolean }> {
  const bytes =
    file instanceof File ? await file.arrayBuffer() : file.slice(0)
  try {
    const blob = await exportVectorPdf(bytes, pageCount, inkByPage)
    return { blob, vector: true }
  } catch (err) {
    if (!isRasterFallbackError(err)) throw err
    const asFile =
      file instanceof File
        ? file
        : new File([bytes], 'notes.pdf', { type: 'application/pdf' })
    const blob = await exportRasterPdf(asFile, pageCount, inkByPage)
    return { blob, vector: false }
  }
}

async function exportVectorPdf(
  pdfBytes: ArrayBuffer,
  pageCount: number,
  inkByPage: Map<number, PageItem[]>,
): Promise<Blob> {
  let src: PDFDocument
  try {
    src = await PDFDocument.load(pdfBytes)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not open PDF'
    throw new RasterFallbackError(msg)
  }
  const out = await PDFDocument.create()
  const indices = src.getPageIndices()
  const copied = await out.copyPages(src, indices)
  const font = await out.embedFont(StandardFonts.Helvetica)
  const maxCssWidth = notePageMaxCssWidth()

  const n = Math.min(pageCount, copied.length)
  for (let i = 0; i < n; i++) {
    const page = copied[i]!
    out.addPage(page)
    const { width: pdfW, height: pdfH } = page.getSize()
    const layout = notePageLayout(pdfW, pdfH, maxCssWidth)
    const items = inkByPage.get(i + 1) ?? []
    for (const item of items) {
      await drawItemOnPdf(out, page, item, layout.width, layout.height, pdfW, pdfH, font)
    }
  }

  const saved = await out.save()
  const copy = new Uint8Array(saved.byteLength)
  copy.set(saved)
  return new Blob([copy], { type: 'application/pdf' })
}

async function drawItemOnPdf(
  doc: PDFDocument,
  page: PDFPage,
  item: PageItem,
  layoutW: number,
  layoutH: number,
  pdfW: number,
  pdfH: number,
  font: PDFFont,
): Promise<void> {
  const sx = pdfW / Math.max(1, layoutW)
  const sy = pdfH / Math.max(1, layoutH)
  const toPdf = (x: number, y: number) => ({
    x: x * sx,
    y: pdfH - y * sy,
  })

  if (isStroke(item)) {
    if (item.tool === 'eraser') return
    drawStrokeOnPdf(page, item, toPdf, sx)
    return
  }
  if (isTextBox(item)) {
    await drawTextOnPdf(doc, page, item, toPdf, sx, sy, layoutW, font)
    return
  }
  if (isImageBox(item)) {
    try {
      await drawImageOnPdf(doc, page, item, toPdf, sx, sy)
    } catch {
      /* skip a single bad image; do not raster the whole notebook */
    }
    return
  }
  if (isPdfMarkup(item)) {
    drawMarkupOnPdf(page, item, toPdf, sx, sy)
  }
}

function drawMarkupOnPdf(
  page: PDFPage,
  markup: PdfMarkup,
  toPdf: (x: number, y: number) => { x: number; y: number },
  sx: number,
  _sy: number,
): void {
  const color = parseRgb(markup.color)
  for (const r of markup.rects) {
    const tl = toPdf(r.x, r.y)
    const br = toPdf(r.x + r.width, r.y + r.height)
    const x = Math.min(tl.x, br.x)
    const y = Math.min(tl.y, br.y)
    const w = Math.abs(br.x - tl.x)
    const h = Math.abs(br.y - tl.y)
    if (markup.mode === 'highlight') {
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        color,
        opacity: 0.35,
        borderWidth: 0,
      })
    } else {
      page.drawLine({
        start: { x, y },
        end: { x: x + w, y },
        thickness: Math.max(1, 2 * sx),
        color,
      })
    }
  }
}

function drawStrokeOnPdf(
  page: PDFPage,
  stroke: Stroke,
  toPdf: (x: number, y: number) => { x: number; y: number },
  sx: number,
): void {
  const pts = stroke.points
  if (pts.length === 0) return
  const color = parseRgb(stroke.color)
  const opacity = stroke.tool === 'highlighter' ? 0.38 : 1
  const thickness = Math.max(0.4, stroke.width * sx)
  if (pts.length === 1) {
    const p = toPdf(pts[0]!.x, pts[0]!.y)
    page.drawCircle({
      x: p.x,
      y: p.y,
      size: thickness / 2,
      color,
      opacity,
    })
    return
  }
  const start = toPdf(pts[0]!.x, pts[0]!.y)
  let d = `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`
  for (let i = 1; i < pts.length; i++) {
    const p = toPdf(pts[i]!.x, pts[i]!.y)
    d += ` L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`
  }
  page.drawSvgPath(d, {
    borderColor: color,
    borderOpacity: opacity,
    borderWidth: thickness,
    borderLineCap: LineCapStyle.Round,
  })
}

function needsCustomFont(text: string): boolean {
  return /[^\u0000-\u00ff]/.test(text)
}

async function drawTextOnPdf(
  doc: PDFDocument,
  page: PDFPage,
  box: TextBox,
  toPdf: (x: number, y: number) => { x: number; y: number },
  sx: number,
  sy: number,
  _layoutW: number,
  font: PDFFont,
): Promise<void> {
  if (!box.text) return
  if (needsCustomFont(box.text)) {
    const png = rasterTextBox(box)
    if (!png) return
    const img = await doc.embedPng(png)
    const origin = toPdf(box.x, box.y + Math.max(box.height, box.fontSize * 1.35))
    page.drawImage(img, {
      x: origin.x,
      y: origin.y,
      width: Math.max(8, box.width * sx),
      height: Math.max(8, Math.max(box.height, box.fontSize * 1.35) * sy),
    })
    return
  }
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  let lines = box.text.split('\n')
  if (ctx) {
    ctx.font = `${box.fontSize}px ui-sans-serif, system-ui, sans-serif`
    lines = wrapText(ctx, box.text, Math.max(24, box.width))
  }
  const size = Math.max(6, box.fontSize * sx)
  lines.forEach((line, i) => {
    const origin = toPdf(box.x, box.y + i * box.fontSize * 1.35 + box.fontSize)
    page.drawText(line, {
      x: origin.x,
      y: origin.y,
      size,
      font,
      color: parseRgb(box.color),
    })
  })
}

function rasterTextBox(box: TextBox): Uint8Array | null {
  const canvas = document.createElement('canvas')
  const width = Math.max(24, Math.ceil(box.width))
  const height = Math.max(
    Math.ceil(box.fontSize * 1.35),
    Math.ceil(box.height),
  )
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.clearRect(0, 0, width, height)
  drawTextBox(ctx, { ...box, x: 0, y: 0, width, height })
  const data = canvas.toDataURL('image/png')
  const comma = data.indexOf(',')
  const bin = atob(data.slice(comma + 1))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function drawImageOnPdf(
  doc: PDFDocument,
  page: PDFPage,
  box: ImageBox,
  toPdf: (x: number, y: number) => { x: number; y: number },
  sx: number,
  sy: number,
): Promise<void> {
  if (!box.dataUrl) return
  const bytes = dataUrlToBytes(box.dataUrl)
  const jpg = box.dataUrl.startsWith('data:image/png')
    ? await doc.embedPng(bytes)
    : await doc.embedJpg(bytes)
  const origin = toPdf(box.x, box.y + box.height)
  page.drawImage(jpg, {
    x: origin.x,
    y: origin.y,
    width: Math.max(4, box.width * sx),
    height: Math.max(4, box.height * sy),
  })
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',')
  const bin = atob(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function parseRgb(color: string): RGB {
  const hex = color.trim()
  const short = /^#([0-9a-f]{3})$/i.exec(hex)
  const long = /^#([0-9a-f]{6})$/i.exec(hex)
  let r = 30
  let g = 41
  let b = 59
  if (long) {
    r = parseInt(long[1]!.slice(0, 2), 16)
    g = parseInt(long[1]!.slice(2, 4), 16)
    b = parseInt(long[1]!.slice(4, 6), 16)
  } else if (short) {
    r = parseInt(short[1]![0]! + short[1]![0]!, 16)
    g = parseInt(short[1]![1]! + short[1]![1]!, 16)
    b = parseInt(short[1]![2]! + short[1]![2]!, 16)
  }
  return rgb(r / 255, g / 255, b / 255)
}

async function exportRasterPdf(
  file: File,
  pageCount: number,
  inkByPage: Map<number, PageItem[]>,
): Promise<Blob> {
  const { pdf, task } = await loadPdfDocument(file)
  const out = await PDFDocument.create()
  const maxCssWidth = notePageMaxCssWidth()
  try {
    for (let n = 1; n <= pageCount; n++) {
      const page = await pdf.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const { width: layoutW, height: layoutH } = notePageLayout(
        base.width,
        base.height,
        maxCssWidth,
      )
      const scale = Math.min(2.8, 2200 / Math.max(1, base.width))
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.floor(viewport.width))
      canvas.height = Math.max(1, Math.floor(viewport.height))
      const ctx = canvas.getContext('2d', { alpha: false })
      if (!ctx) {
        throw new Error(`Could not create canvas for page ${n}`)
      }
      await page.render({
        canvas,
        viewport,
        background: 'rgb(255,255,255)',
      }).promise

      const items = inkByPage.get(n) ?? []
      if (items.length > 0) {
        await ensureImagesLoaded(items)
        const inkCanvas = document.createElement('canvas')
        inkCanvas.width = canvas.width
        inkCanvas.height = canvas.height
        const inkCtx = inkCanvas.getContext('2d')
        if (inkCtx) {
          inkCtx.setTransform(
            canvas.width / Math.max(1, layoutW),
            0,
            0,
            canvas.height / Math.max(1, layoutH),
            0,
            0,
          )
          for (const item of items) {
            drawPageItem(inkCtx, item)
          }
          ctx.drawImage(inkCanvas, 0, 0)
        }
      }

      const jpeg = await canvasToJpeg(canvas)
      const img = await out.embedJpg(jpeg)
      const p = out.addPage([img.width, img.height])
      p.drawImage(img, {
        x: 0,
        y: 0,
        width: img.width,
        height: img.height,
      })
    }
  } finally {
    await pdf.cleanup()
    void task.destroy()
  }
  const bytes = await out.save()
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Blob([copy], { type: 'application/pdf' })
}

export async function downloadOrShare(blob: Blob, filename: string): Promise<void> {
  const shareFile = new File([blob], filename, { type: blob.type })
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean
  }
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [shareFile] })) {
    try {
      await nav.share({ files: [shareFile], title: filename })
      return
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to encode page'))
          return
        }
        void blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)))
      },
      'image/jpeg',
      0.92,
    )
  })
}
