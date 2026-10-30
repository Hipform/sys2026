import type { PDFDocumentProxy } from 'pdfjs-dist'
import { notePageLayout, notePageMaxCssWidth } from './pdf'
import { inkKey } from '../types/document'
import { putOcrPage } from './db'

export interface PdfTextSpan {
  text: string
  x: number
  y: number
  width: number
  height: number
}

export async function extractPageTextSpans(
  pdf: PDFDocumentProxy,
  pageNumber: number,
): Promise<{ spans: PdfTextSpan[]; fullText: string }> {
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  const layout = notePageLayout(
    viewport.width,
    viewport.height,
    notePageMaxCssWidth(),
  )
  const scaleX = layout.width / viewport.width
  const scaleY = layout.height / viewport.height
  const content = await page.getTextContent()
  const spans: PdfTextSpan[] = []
  const parts: string[] = []
  for (const item of content.items) {
    if (!('str' in item) || !item.str) continue
    const tx = item.transform as number[]
    const x = (tx[4] ?? 0) * scaleX
    const y = layout.height - (tx[5] ?? 0) * scaleY
    const w = ((item.width as number) || 0) * scaleX
    const h = Math.max(10, ((item.height as number) || 12) * scaleY)
    spans.push({
      text: item.str,
      x,
      y: y - h,
      width: Math.max(2, w),
      height: h,
    })
    parts.push(item.str)
  }
  return { spans, fullText: parts.join(' ') }
}

export async function indexPdfPageText(
  notebookId: string,
  pdf: PDFDocumentProxy,
  pageNumber: number,
): Promise<string> {
  const { fullText } = await extractPageTextSpans(pdf, pageNumber)
  await putOcrPage({
    key: inkKey(notebookId, pageNumber),
    notebookId,
    pageIndex: pageNumber,
    text: fullText,
    updatedAt: Date.now(),
    source: 'pdf-text',
  })
  return fullText
}

export async function getPdfOutline(
  pdf: PDFDocumentProxy,
): Promise<{ title: string; page: number }[]> {
  try {
    const outline = await pdf.getOutline()
    if (!outline?.length) return []
    const dests: { title: string; page: number }[] = []
    const walk = async (
      items: { title?: string; dest?: unknown; items?: unknown[] }[],
    ) => {
      for (const item of items) {
        let page = 1
        try {
          const dest =
            typeof item.dest === 'string'
              ? await pdf.getDestination(item.dest)
              : item.dest
          if (Array.isArray(dest) && dest[0]) {
            const idx = await pdf.getPageIndex(dest[0])
            page = idx + 1
          }
        } catch {
          /* skip */
        }
        if (item.title) dests.push({ title: item.title, page })
        if (Array.isArray(item.items) && item.items.length) {
          await walk(item.items as { title?: string; dest?: unknown; items?: unknown[] }[])
        }
      }
    }
    await walk(outline as { title?: string; dest?: unknown; items?: unknown[] }[])
    return dests
  } catch {
    return []
  }
}
