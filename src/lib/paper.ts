import { PDFDocument, rgb, type PDFPage } from 'pdf-lib'
import type { PageItem, PaperTemplate } from '../types/note'
import { clonePageItems } from './pageItems'

const A4_W = 595.28
const A4_H = 841.89
const LINE = rgb(0.76, 0.81, 0.88)
const LAST_PAPER_KEY = 'pdf-notes-last-paper'

export async function createNotebookPdf(
  template: PaperTemplate,
  pageCount: number,
): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create()
  const n = Math.max(1, Math.min(200, Math.floor(pageCount)))
  for (let i = 0; i < n; i++) {
    drawTemplate(doc.addPage([A4_W, A4_H]), template)
  }
  return pdfToBuffer(doc)
}

export async function appendTemplatePage(
  pdfBytes: ArrayBuffer,
  template: PaperTemplate,
): Promise<ArrayBuffer> {
  const doc = await PDFDocument.load(pdfBytes)
  const last = doc.getPage(doc.getPageCount() - 1)
  const { width, height } = last.getSize()
  drawTemplate(doc.addPage([width, height]), template)
  return pdfToBuffer(doc)
}

export async function insertTemplatePageAt(
  pdfBytes: ArrayBuffer,
  atPage: number,
  template: PaperTemplate,
): Promise<ArrayBuffer> {
  const src = await PDFDocument.load(pdfBytes)
  const count = src.getPageCount()
  const insertAt = Math.max(0, Math.min(count, atPage - 1))
  const ref = src.getPage(Math.min(insertAt, Math.max(0, count - 1)))
  const { width, height } = ref.getSize()
  const out = await PDFDocument.create()
  for (let i = 0; i < count; i++) {
    if (i === insertAt) {
      drawTemplate(out.addPage([width, height]), template)
    }
    const [copied] = await out.copyPages(src, [i])
    out.addPage(copied)
  }
  if (insertAt >= count) {
    drawTemplate(out.addPage([width, height]), template)
  }
  return pdfToBuffer(out)
}

export async function removePdfPage(
  pdfBytes: ArrayBuffer,
  pageIndex1: number,
): Promise<ArrayBuffer> {
  const src = await PDFDocument.load(pdfBytes)
  const count = src.getPageCount()
  if (count <= 1) throw new Error('Cannot delete the last page')
  const order = Array.from({ length: count }, (_, i) => i + 1).filter(
    (n) => n !== pageIndex1,
  )
  return copyPagesInOrder(src, order)
}

export async function duplicatePdfPage(
  pdfBytes: ArrayBuffer,
  pageIndex1: number,
): Promise<ArrayBuffer> {
  const src = await PDFDocument.load(pdfBytes)
  const count = src.getPageCount()
  const order: number[] = []
  for (let i = 1; i <= count; i++) {
    order.push(i)
    if (i === pageIndex1) order.push(i)
  }
  return copyPagesInOrder(src, order)
}

export async function movePdfPage(
  pdfBytes: ArrayBuffer,
  fromPage: number,
  toPage: number,
): Promise<ArrayBuffer> {
  const src = await PDFDocument.load(pdfBytes)
  const count = src.getPageCount()
  const from = clampPage(fromPage, count)
  const to = clampPage(toPage, count)
  if (from === to) return pdfToBuffer(src)
  const order = Array.from({ length: count }, (_, i) => i + 1)
  const [taken] = order.splice(from - 1, 1)
  order.splice(to - 1, 0, taken!)
  return copyPagesInOrder(src, order)
}

export function inkAfterDelete(
  ink: Map<number, PageItem[]>,
  deletedPage: number,
): Map<number, PageItem[]> {
  const next = new Map<number, PageItem[]>()
  for (const [page, items] of ink) {
    if (page === deletedPage) continue
    next.set(page > deletedPage ? page - 1 : page, items)
  }
  return next
}

export function inkAfterInsert(
  ink: Map<number, PageItem[]>,
  atPage: number,
): Map<number, PageItem[]> {
  const next = new Map<number, PageItem[]>()
  for (const [page, items] of ink) {
    next.set(page >= atPage ? page + 1 : page, items)
  }
  next.set(atPage, [])
  return next
}

export function inkAfterDuplicate(
  ink: Map<number, PageItem[]>,
  page: number,
): Map<number, PageItem[]> {
  const next = new Map<number, PageItem[]>()
  for (const [p, items] of ink) {
    next.set(p > page ? p + 1 : p, items)
  }
  next.set(page + 1, clonePageItems(ink.get(page) ?? []))
  return next
}

export function inkAfterMove(
  ink: Map<number, PageItem[]>,
  fromPage: number,
  toPage: number,
  pageCount: number,
): Map<number, PageItem[]> {
  const order = Array.from({ length: pageCount }, (_, i) => i + 1)
  const [taken] = order.splice(fromPage - 1, 1)
  order.splice(toPage - 1, 0, taken!)
  const next = new Map<number, PageItem[]>()
  order.forEach((oldPage, idx) => {
    next.set(idx + 1, ink.get(oldPage) ?? [])
  })
  return next
}

export function readLastPaperTemplate(): PaperTemplate {
  try {
    const value = localStorage.getItem(LAST_PAPER_KEY)
    if (
      value === 'blank' ||
      value === 'lined' ||
      value === 'grid' ||
      value === 'dotted'
    ) {
      return value
    }
  } catch {
    /* ignore */
  }
  return 'blank'
}

export function writeLastPaperTemplate(template: PaperTemplate): void {
  try {
    localStorage.setItem(LAST_PAPER_KEY, template)
  } catch {
    /* ignore */
  }
}

export function resolvePaperTemplate(
  stored?: PaperTemplate | null,
): PaperTemplate {
  return stored ?? readLastPaperTemplate()
}

function clampPage(page: number, count: number): number {
  return Math.max(1, Math.min(count, page))
}

async function copyPagesInOrder(
  src: PDFDocument,
  order1: number[],
): Promise<ArrayBuffer> {
  const out = await PDFDocument.create()
  const copied = await out.copyPages(
    src,
    order1.map((n) => n - 1),
  )
  for (const page of copied) out.addPage(page)
  return pdfToBuffer(out)
}

function drawTemplate(page: PDFPage, template: PaperTemplate): void {
  if (template === 'blank') return
  const { width, height } = page.getSize()
  const margin = Math.min(48, width * 0.08, height * 0.06)
  if (template === 'lined') {
    const step = 28
    for (let y = height - margin; y > margin; y -= step) {
      page.drawLine({
        start: { x: margin, y },
        end: { x: width - margin, y },
        thickness: 0.55,
        color: LINE,
      })
    }
    return
  }
  const step = 22
  if (template === 'dotted') {
    for (let x = margin; x <= width - margin; x += step) {
      for (let y = margin; y <= height - margin; y += step) {
        page.drawCircle({
          x,
          y,
          size: 0.9,
          color: LINE,
        })
      }
    }
    return
  }
  for (let x = margin; x <= width - margin; x += step) {
    page.drawLine({
      start: { x, y: margin },
      end: { x, y: height - margin },
      thickness: 0.4,
      color: LINE,
    })
  }
  for (let y = margin; y <= height - margin; y += step) {
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 0.4,
      color: LINE,
    })
  }
}

async function pdfToBuffer(doc: PDFDocument): Promise<ArrayBuffer> {
  const bytes = await doc.save()
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}
