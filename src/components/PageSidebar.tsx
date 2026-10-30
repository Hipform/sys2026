import { useEffect, useRef, useState } from 'react'
import { getAllPageInk } from '../lib/db'
import { loadPdfDocument, renderPageThumbnail } from '../lib/pdf'
import type { PageItem } from '../types/note'

export interface PageSidebarProps {
  file: File | null
  page: number
  pageCount: number
  notebookId?: string | null
  inkEpoch?: number
  variant?: 'rail' | 'drawer'
  outline?: { title: string; page: number }[]
  bookmarks?: { page: number; label: string }[]
  onPageChange: (page: number) => void
  onDeletePage?: (page: number) => void
  onInsertPage?: (page: number) => void
  onDuplicatePage?: (page: number) => void
  onMovePage?: (from: number, to: number) => void
}

export function PageSidebar({
  file,
  page,
  pageCount,
  notebookId,
  inkEpoch = 0,
  variant = 'rail',
  outline = [],
  bookmarks = [],
  onPageChange,
  onDeletePage,
  onInsertPage,
  onDuplicatePage,
  onMovePage,
}: PageSidebarProps) {
  const [thumbs, setThumbs] = useState<Record<number, string>>({})
  const [menu, setMenu] = useState<{ page: number; x: number; y: number } | null>(
    null,
  )
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const suppressClickRef = useRef(false)
  const pressTimerRef = useRef<number | null>(null)
  const pressStartRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    setThumbs({})
    if (!file || pageCount < 1) return
    const pdfFile = file

    async function loadThumbs() {
      const { pdf, task } = await loadPdfDocument(pdfFile)
      const ink = notebookId ? await getAllPageInk(notebookId) : new Map<number, PageItem[]>()
      try {
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return
          const url = await renderPageThumbnail(pdf, i, 88, ink.get(i) ?? [])
          if (cancelled || !url) continue
          setThumbs((prev) => ({ ...prev, [i]: url }))
        }
      } catch {
        // Thumbnails are optional.
      } finally {
        await pdf.cleanup()
        void task.destroy()
      }
    }

    void loadThumbs()
    return () => {
      cancelled = true
    }
  }, [file, pageCount, notebookId, inkEpoch])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  const clearPress = () => {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current)
      pressTimerRef.current = null
    }
    pressStartRef.current = null
  }

  if (pageCount < 1) return null

  const wrapClass =
    variant === 'drawer'
      ? 'h-full w-[120px] overflow-y-auto bg-[#e7eaef] px-2 py-4'
      : 'hidden h-full w-[108px] shrink-0 overflow-y-auto border-r border-black/5 bg-[#e7eaef] px-2 py-14 sm:block'

  return (
    <aside className={wrapClass}>
      {(outline.length > 0 || bookmarks.length > 0) && (
        <div className="mb-3 space-y-1 border-b border-black/10 pb-2">
          {bookmarks.map((b) => (
            <button
              key={`bm-${b.page}-${b.label}`}
              type="button"
              className="block w-full truncate rounded px-1 py-0.5 text-left text-[10px] text-amber-800 hover:bg-white/70"
              onClick={() => onPageChange(b.page)}
            >
              ★ {b.label || `p.${b.page}`}
            </button>
          ))}
          {outline.slice(0, 24).map((o) => (
            <button
              key={`ol-${o.page}-${o.title}`}
              type="button"
              className="block w-full truncate rounded px-1 py-0.5 text-left text-[10px] text-slate-600 hover:bg-white/70"
              onClick={() => onPageChange(o.page)}
            >
              {o.title}
            </button>
          ))}
        </div>
      )}
      <ol className="flex flex-col gap-3">
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
          <li
            key={n}
            draggable
            onDragStart={() => setDragFrom(n)}
            onDragOver={(e) => {
              e.preventDefault()
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragFrom && dragFrom !== n) onMovePage?.(dragFrom, n)
              setDragFrom(null)
            }}
            onDragEnd={() => setDragFrom(null)}
          >
            <button
              type="button"
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false
                  return
                }
                onPageChange(n)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ page: n, x: e.clientX, y: e.clientY })
              }}
              onPointerDown={(e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return
                pressStartRef.current = { x: e.clientX, y: e.clientY }
                pressTimerRef.current = window.setTimeout(() => {
                  pressTimerRef.current = null
                  suppressClickRef.current = true
                  setMenu({ page: n, x: e.clientX, y: e.clientY })
                }, 520)
              }}
              onPointerMove={(e) => {
                const start = pressStartRef.current
                if (!start) return
                if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 12) {
                  clearPress()
                }
              }}
              onPointerUp={clearPress}
              onPointerCancel={clearPress}
              className={`block w-full overflow-hidden rounded-lg bg-white shadow-sm ring-2 transition ${
                n === page
                  ? 'ring-slate-900'
                  : 'ring-transparent hover:ring-slate-300'
              }`}
            >
              {thumbs[n] ? (
                <img src={thumbs[n]} alt={`Page ${n}`} className="w-full" />
              ) : (
                <div className="flex aspect-[3/4] items-center justify-center text-[10px] text-slate-400">
                  {n}
                </div>
              )}
            </button>
            <div className="mt-1 text-center text-[10px] tabular-nums text-slate-500">
              {n}
            </div>
          </li>
        ))}
      </ol>

      {menu && (
        <div
          className="fixed z-50 min-w-[10.5rem] overflow-hidden rounded-xl bg-white py-1 shadow-[0_16px_40px_rgba(15,23,42,0.18)] ring-1 ring-black/10"
          style={{
            left: Math.min(menu.x, window.innerWidth - 190),
            top: Math.min(menu.y, window.innerHeight - 240),
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
            onClick={() => {
              onInsertPage?.(menu.page)
              setMenu(null)
            }}
          >
            Insert before
          </button>
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
            onClick={() => {
              onDuplicatePage?.(menu.page)
              setMenu(null)
            }}
          >
            Duplicate
          </button>
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-40"
            disabled={menu.page <= 1}
            onClick={() => {
              onMovePage?.(menu.page, menu.page - 1)
              setMenu(null)
            }}
          >
            Move up
          </button>
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-40"
            disabled={menu.page >= pageCount}
            onClick={() => {
              onMovePage?.(menu.page, menu.page + 1)
              setMenu(null)
            }}
          >
            Move down
          </button>
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 disabled:opacity-40"
            disabled={pageCount <= 1}
            onClick={() => {
              onDeletePage?.(menu.page)
              setMenu(null)
            }}
          >
            Delete page
          </button>
        </div>
      )}
    </aside>
  )
}
