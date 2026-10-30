import {
  getDocument,
  GlobalWorkerOptions,
  version as pdfjsVersion,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import { drawPageItem, ensureImagesLoaded } from './pageItems'
import type { PageItem } from '../types/note'

// Legacy worker (polyfills Map.getOrInsertComputed) served from /public.
GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`

export { pdfjsVersion }

/**
 * Stable CSS width for ink coordinates (editor, export, thumbs, cover).
 * Must not depend on the live viewport or ink drifts when the window changes.
 */
export const INK_LAYOUT_CSS_WIDTH = 820

/** CSS width used to fit a PDF page for ink + export. */
export function notePageMaxCssWidth(): number {
  return INK_LAYOUT_CSS_WIDTH
}

export function notePageLayout(
  pageWidth: number,
  pageHeight: number,
  maxCssWidth = notePageMaxCssWidth(),
): { fitScale: number; width: number; height: number } {
  const fitScale = maxCssWidth / Math.max(1, pageWidth)
  return {
    fitScale,
    width: Math.floor(pageWidth * fitScale),
    height: Math.floor(pageHeight * fitScale),
  }
}

export function pdfSourceOptions(data: Uint8Array) {
  return {
    data,
    cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
  }
}

export async function loadPdfDocument(
  source: File | ArrayBuffer | Uint8Array,
): Promise<{ pdf: PDFDocumentProxy; task: PDFDocumentLoadingTask }> {
  const bytes =
    source instanceof Uint8Array
      ? source.slice()
      : source instanceof ArrayBuffer
        ? new Uint8Array(source).slice()
        : new Uint8Array(await source.arrayBuffer()).slice()

  const task = getDocument(pdfSourceOptions(bytes))
  const pdf = await task.promise
  return { pdf, task }
}

/** First-page JPEG data URL (~200px wide) for library covers, with ink. */
export async function renderCoverThumbnail(
  data: ArrayBuffer,
  items: PageItem[] = [],
  maxWidth = 200,
): Promise<string | null> {
  const { pdf, task } = await loadPdfDocument(data)
  try {
    const page = await pdf.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = maxWidth / base.width
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(viewport.width))
    canvas.height = Math.max(1, Math.floor(viewport.height))
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return null
    await page.render({
      canvas,
      viewport,
      background: 'rgb(255,255,255)',
    }).promise
    if (items.length > 0) {
      await ensureImagesLoaded(items)
      const fitted = notePageLayout(base.width, base.height)
      ctx.save()
      ctx.setTransform(
        canvas.width / Math.max(1, fitted.width),
        0,
        0,
        canvas.height / Math.max(1, fitted.height),
        0,
        0,
      )
      for (const item of items) {
        drawPageItem(ctx, item)
      }
      ctx.restore()
    }
    return canvas.toDataURL('image/jpeg', 0.78)
  } catch {
    return null
  } finally {
    await pdf.cleanup()
    void task.destroy()
  }
}

export async function renderPageThumbnail(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  maxWidth = 88,
  items: PageItem[] = [],
): Promise<string | null> {
  const page = await pdf.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const scale = maxWidth / base.width
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(viewport.width))
  canvas.height = Math.max(1, Math.floor(viewport.height))
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) return null
  await page.render({
    canvas,
    viewport,
    background: 'rgb(255,255,255)',
  }).promise
  if (items.length > 0) {
    await ensureImagesLoaded(items)
    const fitted = notePageLayout(base.width, base.height)
    ctx.save()
    ctx.setTransform(
      canvas.width / Math.max(1, fitted.width),
      0,
      0,
      canvas.height / Math.max(1, fitted.height),
      0,
      0,
    )
    for (const item of items) {
      drawPageItem(ctx, item)
    }
    ctx.restore()
  }
  return canvas.toDataURL('image/jpeg', 0.65)
}
