import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import {
  configureInkLayer,
  drawStroke,
  samplePointerEvents,
  strokeBounds,
} from '../lib/ink'
import {
  RESIZE_HANDLES,
  clonePageItems,
  drawPageItem,
  duplicatePageItem,
  handleCenter,
  hitResizeHandle,
  hitTextBox,
  itemHitsEraser,
  itemInLasso,
  measureTextHeight,
  movePageItem,
  newImageBox,
  newTextBox,
  pointInRect,
  resizeCursor,
  resizeScale,
  rotatePageItem,
  scalePageItem,
  unionBounds,
  type ResizeHandle,
} from '../lib/pageItems'
import {
  isClosedShapeStroke,
  recognizeShape,
  scaleShapePoints,
  shapeRelativeCoords,
  snapShape,
} from '../lib/shapes'
import { StrokeStabilizer } from '../lib/smooth'
import {
  HISTORY_CAP,
  getPageHistory,
  hydrateHistoryRow,
  savePageHistory,
} from '../lib/db'
import { loadPdfDocument, notePageLayout, pdfjsVersion } from '../lib/pdf'
import type {
  DrawSettings,
  DrawTool,
  PageInfo,
  PageItem,
  PointerPoint,
  Stroke,
  TextBox,
} from '../types/note'
import { ZOOM_MAX, ZOOM_MIN, isDrawingTool } from '../types/note'

export interface NoteCanvasHandle {
  undo: () => void
  redo: () => void
  clear: () => void
  deleteSelection: () => void
  duplicateSelection: () => void
  selectAll: () => void
  copySelection: () => void
  pasteClipboard: () => void
  rotateSelection: () => void
  clearSelection: () => void
  flushHistory: () => Promise<void>
  resetHistory: () => void
}

export type PendingImage = {
  dataUrl: string
  width: number
  height: number
  kind?: 'image' | 'sticker'
}

export interface NoteCanvasProps {
  file: File | null
  documentId: string | null
  page: number
  pageCount: number
  zoom: number
  settings: DrawSettings
  initialStrokes: PageItem[]
  inkEpoch: number
  pencilOnly: boolean
  stabilize: boolean
  shapeSnap: boolean
  onPageInfo: (info: PageInfo) => void
  onStrokesChange: (items: PageItem[]) => void
  onZoomChange: (zoom: number) => void
  onPageChange: (page: number) => void
  onInkActivity?: () => void
  onShowChrome?: () => void
  onSelectionChange?: (count: number) => void
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void
  pendingImage?: PendingImage | null
  onPendingImageConsumed?: () => void
}

interface LiveStroke {
  id: string
  tool: DrawTool
  color: string
  width: number
  points: PointerPoint[]
  pointerId: number
  layerId?: string
}

interface Gesture {
  startDist: number
  startZoom: number
  startPanX: number
  startPanY: number
  startMidX: number
  startMidY: number
}

interface OneFingerGesture {
  pointerId: number
  startX: number
  startY: number
  startTime: number
  mode: 'undecided' | 'slide' | 'ignore'
}

type PageHistory = { undo: PageItem[][]; redo: PageItem[][] }

const SLIDE_GAP = 28
const LOCK_PX = 14
const SLIDE_MS = 200
const RASTER_MS = 180
const DOUBLE_TAP_MS = 300
const TAP_MOVE = 12
const SHAPE_HOLD_MS = 320
const SHAPE_HOLD_MOVE = 14
const INK_GUARD_MS = 700

export const NoteCanvas = forwardRef<NoteCanvasHandle, NoteCanvasProps>(
  function NoteCanvas(
    {
      file,
      documentId,
      page,
      pageCount,
      zoom,
      settings,
      initialStrokes,
      inkEpoch,
      pencilOnly,
      stabilize,
      shapeSnap,
      onPageInfo,
      onStrokesChange,
      onZoomChange,
      onPageChange,
      onInkActivity,
      onShowChrome,
      onSelectionChange,
      onHistoryChange,
      pendingImage,
      onPendingImageConsumed,
    },
    ref,
  ) {
    const stageRef = useRef<HTMLDivElement>(null)
    const pdfCanvasRef = useRef<HTMLCanvasElement>(null)
    const inkCanvasRef = useRef<HTMLCanvasElement>(null)
    const liveCanvasRef = useRef<HTMLCanvasElement>(null)
    const prevCanvasRef = useRef<HTMLCanvasElement>(null)
    const nextCanvasRef = useRef<HTMLCanvasElement>(null)
    const inkRectRef = useRef<DOMRect | null>(null)
    const rafRef = useRef<number | null>(null)
    const liveBoundsRef = useRef<{
      x: number
      y: number
      w: number
      h: number
    } | null>(null)
    const docRef = useRef<PDFDocumentProxy | null>(null)
    const itemsRef = useRef<PageItem[]>([])
    const historyByPageRef = useRef(new Map<number, PageHistory>())
    const historyTimerRef = useRef<number | null>(null)
    const documentIdRef = useRef(documentId)
    documentIdRef.current = documentId
    const liveRef = useRef<LiveStroke | null>(null)
    const predictedRef = useRef<PointerPoint[]>([])
    const penDownIdRef = useRef<number | null>(null)
    const settingsRef = useRef(settings)
    settingsRef.current = settings
    const zoomRef = useRef(zoom)
    zoomRef.current = zoom
    const pageRef = useRef(page)
    pageRef.current = page
    const pageCountRef = useRef(pageCount)
    pageCountRef.current = pageCount
    const pencilOnlyRef = useRef(pencilOnly)
    pencilOnlyRef.current = pencilOnly
    const stabilizeRef = useRef(stabilize)
    stabilizeRef.current = stabilize
    const shapeSnapRef = useRef(shapeSnap)
    shapeSnapRef.current = shapeSnap
    const filterRef = useRef<StrokeStabilizer | null>(null)
    const shapeHoldRef = useRef<{ t: number; x: number; y: number } | null>(
      null,
    )
    const shapeEditRef = useRef<{
      rel: { x: number; y: number }[]
      cx: number
      cy: number
      r0: number
      template: PointerPoint
    } | null>(null)
    const shapeHoldTimerRef = useRef<number | null>(null)
    const panRef = useRef({ x: 0, y: 0 })
    const layoutRef = useRef({ width: 0, height: 0, fitScale: 1 })
    const rasterZoomRef = useRef(1)
    const touchesRef = useRef<Map<number, { x: number; y: number }>>(new Map())
    const gestureRef = useRef<Gesture | null>(null)
    const oneFingerRef = useRef<OneFingerGesture | null>(null)
    const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null)
    const slideTimerRef = useRef<number | null>(null)
    const selectionRef = useRef<Set<string>>(new Set())
    const lassoPtsRef = useRef<{ x: number; y: number }[] | null>(null)
    const lassoPointerIdRef = useRef<number | null>(null)
    const moveRef = useRef<{
      pointerId: number
      startX: number
      startY: number
      snapshot: PageItem[]
    } | null>(null)
    const resizeRef = useRef<{
      pointerId: number
      handle: ResizeHandle
      box: { x: number; y: number; w: number; h: number }
      snapshot: PageItem[]
    } | null>(null)
    const mousePanRef = useRef<{
      pointerId: number
      startX: number
      startY: number
      panX: number
      panY: number
    } | null>(null)
    const spaceDownRef = useRef(false)
    const textPointerRef = useRef<{
      pointerId: number
      startX: number
      startY: number
      hit: TextBox | null
    } | null>(null)
    const editingIdRef = useRef<string | null>(null)
    const onPageInfoRef = useRef(onPageInfo)
    onPageInfoRef.current = onPageInfo
    const onStrokesChangeRef = useRef(onStrokesChange)
    onStrokesChangeRef.current = onStrokesChange
    const onZoomChangeRef = useRef(onZoomChange)
    onZoomChangeRef.current = onZoomChange
    const onPageChangeRef = useRef(onPageChange)
    onPageChangeRef.current = onPageChange
    const onInkActivityRef = useRef(onInkActivity)
    onInkActivityRef.current = onInkActivity
    const onShowChromeRef = useRef(onShowChrome)
    onShowChromeRef.current = onShowChrome
    const onSelectionChangeRef = useRef(onSelectionChange)
    onSelectionChangeRef.current = onSelectionChange
    const onHistoryChangeRef = useRef(onHistoryChange)
    onHistoryChangeRef.current = onHistoryChange
    const pendingImageRef = useRef(pendingImage)
    pendingImageRef.current = pendingImage
    const onPendingImageConsumedRef = useRef(onPendingImageConsumed)
    onPendingImageConsumedRef.current = onPendingImageConsumed
    const initialStrokesRef = useRef(initialStrokes)
    initialStrokesRef.current = initialStrokes
    const clipboardRef = useRef<PageItem[] | null>(null)
    const pasteNudgeRef = useRef(24)
    const inkGuardUntilRef = useRef(0)

    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [layout, setLayout] = useState({ width: 0, height: 0, fitScale: 1 })
    const [pan, setPan] = useState({ x: 48, y: 72 })
    const [rasterZoom, setRasterZoom] = useState(1)
    const [slideX, setSlideX] = useState(0)
    const [slideSmooth, setSlideSmooth] = useState(false)
    const [editingText, setEditingText] = useState<TextBox | null>(null)

    panRef.current = pan
    rasterZoomRef.current = rasterZoom
    editingIdRef.current = editingText?.id ?? null

    const emitItems = useCallback(() => {
      onStrokesChangeRef.current(clonePageItems(itemsRef.current))
    }, [])

    const emitSelection = useCallback(() => {
      onSelectionChangeRef.current?.(selectionRef.current.size)
    }, [])

    const historyFor = useCallback((pageNumber: number): PageHistory => {
      let h = historyByPageRef.current.get(pageNumber)
      if (!h) {
        h = { undo: [], redo: [] }
        historyByPageRef.current.set(pageNumber, h)
      }
      return h
    }, [])

    const emitHistory = useCallback(() => {
      const h = historyFor(pageRef.current)
      onHistoryChangeRef.current?.({
        canUndo: h.undo.length > 0,
        canRedo: h.redo.length > 0,
      })
    }, [historyFor])

    const schedulePersistHistory = useCallback(() => {
      const id = documentIdRef.current
      if (!id) return
      const pageNumber = pageRef.current
      if (historyTimerRef.current !== null) {
        window.clearTimeout(historyTimerRef.current)
      }
      historyTimerRef.current = window.setTimeout(() => {
        historyTimerRef.current = null
        if (documentIdRef.current !== id) return
        const h = historyByPageRef.current.get(pageNumber)
        if (!h) return
        void savePageHistory(id, pageNumber, h.undo, h.redo)
      }, 280)
    }, [])

    const flushPersistHistory = useCallback(
      async (pageNumber: number) => {
        const id = documentIdRef.current
        if (!id) return
        if (historyTimerRef.current !== null) {
          window.clearTimeout(historyTimerRef.current)
          historyTimerRef.current = null
        }
        const h = historyByPageRef.current.get(pageNumber)
        if (!h) return
        await savePageHistory(id, pageNumber, h.undo, h.redo)
      },
      [],
    )

    const pushHistory = useCallback(() => {
      const h = historyFor(pageRef.current)
      h.undo.push(clonePageItems(itemsRef.current))
      if (h.undo.length > HISTORY_CAP) h.undo.shift()
      h.redo = []
      emitHistory()
      schedulePersistHistory()
    }, [emitHistory, historyFor, schedulePersistHistory])

    const cancelLiveRaf = useCallback(() => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }, [])

    const paintOverlay = useCallback(() => {
      const canvas = liveCanvasRef.current
      const { width: lw, height: lh } = layoutRef.current
      if (!canvas || lw <= 0 || lh <= 0) return
      const ctx = configureInkLayer(canvas, lw, lh, rasterZoomRef.current)
      if (!ctx) return
      ctx.clearRect(0, 0, lw, lh)
      liveBoundsRef.current = null

      const lasso = lassoPtsRef.current
      if (lasso && lasso.length > 0) {
        ctx.save()
        ctx.strokeStyle = '#2563eb'
        ctx.lineWidth = 1.5
        ctx.setLineDash([7, 5])
        ctx.beginPath()
        ctx.moveTo(lasso[0]!.x, lasso[0]!.y)
        for (let i = 1; i < lasso.length; i++) {
          ctx.lineTo(lasso[i]!.x, lasso[i]!.y)
        }
        ctx.stroke()
        ctx.restore()
      }

      const selected = itemsRef.current.filter((item) =>
        selectionRef.current.has(item.id),
      )
      const box = unionBounds(selected, 10)
      if (box) {
        ctx.save()
        ctx.strokeStyle = '#2563eb'
        ctx.lineWidth = 1.25
        ctx.setLineDash([5, 4])
        ctx.strokeRect(box.x, box.y, box.w, box.h)
        ctx.setLineDash([])
        const hs = Math.max(10, 18 / Math.max(0.4, zoomRef.current))
        ctx.fillStyle = '#ffffff'
        ctx.strokeStyle = '#2563eb'
        ctx.lineWidth = 1.5
        for (const handle of RESIZE_HANDLES) {
          const c = handleCenter(box, handle)
          ctx.fillRect(c.x - hs / 2, c.y - hs / 2, hs, hs)
          ctx.strokeRect(c.x - hs / 2, c.y - hs / 2, hs, hs)
        }
        ctx.restore()
      }
    }, [])

    const redrawCommitted = useCallback(() => {
      const canvas = inkCanvasRef.current
      const { width: lw, height: lh } = layoutRef.current
      if (!canvas || lw <= 0 || lh <= 0) return
      const ctx = configureInkLayer(canvas, lw, lh, rasterZoomRef.current)
      if (!ctx) return
      ctx.clearRect(0, 0, lw, lh)
      for (const item of itemsRef.current) {
        drawPageItem(ctx, item, editingIdRef.current, () => {
          queueMicrotask(() => {
            const again = inkCanvasRef.current
            if (!again) return
            const { width, height } = layoutRef.current
            if (width <= 0 || height <= 0) return
            const next = configureInkLayer(
              again,
              width,
              height,
              rasterZoomRef.current,
            )
            if (!next) return
            next.clearRect(0, 0, width, height)
            for (const pageItem of itemsRef.current) {
              drawPageItem(next, pageItem, editingIdRef.current)
            }
            if (!liveRef.current) paintOverlay()
          })
        })
      }
      if (!liveRef.current) paintOverlay()
    }, [paintOverlay])

    const drawLiveFrame = useCallback(() => {
      rafRef.current = null
      const liveStroke = liveRef.current
      const canvas = liveCanvasRef.current
      const { width: lw, height: lh } = layoutRef.current
      if (!canvas || lw <= 0 || lh <= 0) return
      if (!liveStroke) {
        paintOverlay()
        return
      }
      const rz = rasterZoomRef.current
      const ctx = configureInkLayer(canvas, lw, lh, rz)
      if (!ctx) return

      if (liveStroke.tool === 'eraser') {
        ctx.clearRect(0, 0, lw, lh)
        const pts = liveStroke.points
        if (pts.length > 0) {
          ctx.save()
          ctx.strokeStyle = 'rgba(100,116,139,0.4)'
          ctx.lineWidth = Math.max(2, liveStroke.width * 2)
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.beginPath()
          ctx.moveTo(pts[0]!.x, pts[0]!.y)
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i]!.x, pts[i]!.y)
          }
          ctx.stroke()
          const last = pts[pts.length - 1]!
          ctx.beginPath()
          ctx.arc(last.x, last.y, liveStroke.width, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(100,116,139,0.28)'
          ctx.strokeStyle = 'rgba(71,85,105,0.75)'
          ctx.lineWidth = 1.25
          ctx.fill()
          ctx.stroke()
          ctx.restore()
        }
        return
      }

      const prev = liveBoundsRef.current
      if (shapeEditRef.current || !prev) ctx.clearRect(0, 0, lw, lh)
      else ctx.clearRect(prev.x, prev.y, prev.w, prev.h)
      drawStroke(ctx, liveStroke, predictedRef.current, { live: true })
      liveBoundsRef.current = strokeBounds(liveStroke, predictedRef.current, 48)
    }, [paintOverlay])

    const scheduleLive = useCallback(() => {
      if (rafRef.current !== null) return
      rafRef.current = requestAnimationFrame(drawLiveFrame)
    }, [drawLiveFrame])

    const clearShapeHoldTimer = useCallback(() => {
      if (shapeHoldTimerRef.current !== null) {
        window.clearTimeout(shapeHoldTimerRef.current)
        shapeHoldTimerRef.current = null
      }
    }, [])

    const tryEnterShapeEdit = useCallback(() => {
      const live = liveRef.current
      if (!live || live.tool === 'eraser' || shapeEditRef.current) return
      if (!shapeSnapRef.current) return
      if (!isClosedShapeStroke(live.points)) return
      const last = live.points[live.points.length - 1]!
      const hold = shapeHoldRef.current
      if (
        hold &&
        Math.hypot(last.x - hold.x, last.y - hold.y) > SHAPE_HOLD_MOVE * 1.6
      ) {
        return
      }
      const fit = recognizeShape(live.points, live.tool)
      if (!fit?.closed) {
        shapeHoldRef.current = null
        return
      }
      const r0 = Math.max(
        18,
        Math.hypot(last.x - fit.center.x, last.y - fit.center.y),
      )
      shapeEditRef.current = {
        rel: shapeRelativeCoords(fit.points, fit.center),
        cx: fit.center.x,
        cy: fit.center.y,
        r0,
        template: last,
      }
      live.points = fit.points
      predictedRef.current = []
      filterRef.current = null
      shapeHoldRef.current = null
      scheduleLive()
    }, [scheduleLive])

    const discardLive = useCallback(() => {
      const wasEraser = liveRef.current?.tool === 'eraser'
      cancelLiveRaf()
      liveRef.current = null
      predictedRef.current = []
      lassoPtsRef.current = null
      moveRef.current = null
      resizeRef.current = null
      filterRef.current = null
      shapeHoldRef.current = null
      shapeEditRef.current = null
      if (shapeHoldTimerRef.current !== null) {
        window.clearTimeout(shapeHoldTimerRef.current)
        shapeHoldTimerRef.current = null
      }
      if (wasEraser) redrawCommitted()
      else paintOverlay()
    }, [cancelLiveRaf, paintOverlay, redrawCommitted])

    const clearSelection = useCallback(() => {
      if (selectionRef.current.size === 0) return
      selectionRef.current = new Set()
      emitSelection()
      paintOverlay()
    }, [emitSelection, paintOverlay])

    const applySnapshot = useCallback(
      (next: PageItem[]) => {
        itemsRef.current = next
        selectionRef.current = new Set()
        emitSelection()
        redrawCommitted()
        emitItems()
        emitHistory()
        schedulePersistHistory()
      },
      [emitHistory, emitItems, emitSelection, redrawCommitted, schedulePersistHistory],
    )

    const selectedItems = useCallback(
      () => itemsRef.current.filter((item) => selectionRef.current.has(item.id)),
      [],
    )

    useImperativeHandle(
      ref,
      () => ({
        undo() {
          const h = historyFor(pageRef.current)
          const prev = h.undo.pop()
          if (!prev) return
          discardLive()
          h.redo.push(clonePageItems(itemsRef.current))
          applySnapshot(prev)
        },
        redo() {
          const h = historyFor(pageRef.current)
          const next = h.redo.pop()
          if (!next) return
          discardLive()
          h.undo.push(clonePageItems(itemsRef.current))
          applySnapshot(next)
        },
        clear() {
          if (itemsRef.current.length === 0) return
          discardLive()
          pushHistory()
          applySnapshot([])
        },
        deleteSelection() {
          const ids = selectionRef.current
          if (ids.size === 0) return
          pushHistory()
          itemsRef.current = itemsRef.current.filter((item) => !ids.has(item.id))
          selectionRef.current = new Set()
          emitSelection()
          redrawCommitted()
          emitItems()
        },
        duplicateSelection() {
          const picked = selectedItems()
          if (picked.length === 0) return
          pushHistory()
          const copies = picked.map((item) => duplicatePageItem(item))
          itemsRef.current = [...itemsRef.current, ...copies]
          selectionRef.current = new Set(copies.map((item) => item.id))
          emitSelection()
          redrawCommitted()
          emitItems()
        },
        selectAll() {
          selectionRef.current = new Set(
            itemsRef.current.map((item) => item.id),
          )
          emitSelection()
          paintOverlay()
        },
        copySelection() {
          const picked = selectedItems()
          if (picked.length === 0) return
          clipboardRef.current = clonePageItems(picked)
          pasteNudgeRef.current = 24
        },
        pasteClipboard() {
          const clip = clipboardRef.current
          if (!clip || clip.length === 0) return
          pushHistory()
          const nudge = pasteNudgeRef.current
          const copies = clip.map((item) => duplicatePageItem(item, nudge, nudge))
          pasteNudgeRef.current = nudge + 16
          itemsRef.current = [...itemsRef.current, ...copies]
          selectionRef.current = new Set(copies.map((item) => item.id))
          emitSelection()
          redrawCommitted()
          emitItems()
        },
        rotateSelection() {
          const picked = selectedItems()
          if (picked.length === 0) return
          const box = unionBounds(picked, 0)
          if (!box) return
          const cx = box.x + box.w / 2
          const cy = box.y + box.h / 2
          const ids = selectionRef.current
          pushHistory()
          itemsRef.current = itemsRef.current.map((item) =>
            ids.has(item.id)
              ? rotatePageItem(item, cx, cy, Math.PI / 2)
              : item,
          )
          redrawCommitted()
          emitItems()
        },
        clearSelection() {
          clearSelection()
        },
        async flushHistory() {
          if (historyTimerRef.current !== null) {
            window.clearTimeout(historyTimerRef.current)
            historyTimerRef.current = null
          }
          const pages = [...historyByPageRef.current.keys()]
          if (pages.length === 0) {
            await flushPersistHistory(pageRef.current)
            return
          }
          for (const pageNumber of pages) {
            await flushPersistHistory(pageNumber)
          }
        },
        resetHistory() {
          if (historyTimerRef.current !== null) {
            window.clearTimeout(historyTimerRef.current)
            historyTimerRef.current = null
          }
          historyByPageRef.current = new Map()
          emitHistory()
        },
      }),
      [
        applySnapshot,
        clearSelection,
        discardLive,
        emitHistory,
        emitItems,
        emitSelection,
        flushPersistHistory,
        historyFor,
        paintOverlay,
        pushHistory,
        redrawCommitted,
        selectedItems,
      ],
    )

    useEffect(() => {
      const id = documentId
      historyByPageRef.current = new Map()
      selectionRef.current = new Set()
      onSelectionChangeRef.current?.(0)
      setEditingText(null)
      return () => {
        if (!id) return
        const pageNumber = pageRef.current
        const h = historyByPageRef.current.get(pageNumber)
        if (h) void savePageHistory(id, pageNumber, h.undo, h.redo)
      }
    }, [documentId])

    useEffect(() => {
      itemsRef.current = clonePageItems(initialStrokesRef.current)
      liveRef.current = null
      predictedRef.current = []
      lassoPtsRef.current = null
      moveRef.current = null
      resizeRef.current = null
      filterRef.current = null
      shapeHoldRef.current = null
      shapeEditRef.current = null
      if (shapeHoldTimerRef.current !== null) {
        window.clearTimeout(shapeHoldTimerRef.current)
        shapeHoldTimerRef.current = null
      }
      selectionRef.current = new Set()
      onSelectionChangeRef.current?.(0)
      setEditingText(null)
      cancelLiveRaf()
      redrawCommitted()
      let cancelled = false
      const id = documentId
      if (id) {
        void getPageHistory(id, page).then((row) => {
          if (cancelled) return
          if (row) {
            historyByPageRef.current.set(page, hydrateHistoryRow(row))
          } else if (!historyByPageRef.current.has(page)) {
            historyByPageRef.current.set(page, { undo: [], redo: [] })
          }
          emitHistory()
        })
      } else {
        emitHistory()
      }
      return () => {
        cancelled = true
      }
    }, [
      documentId,
      page,
      inkEpoch,
      cancelLiveRaf,
      emitHistory,
      redrawCommitted,
    ])

    useEffect(() => {
      const onHide = () => {
        void flushPersistHistory(pageRef.current)
      }
      document.addEventListener('visibilitychange', onHide)
      window.addEventListener('pagehide', onHide)
      return () => {
        document.removeEventListener('visibilitychange', onHide)
        window.removeEventListener('pagehide', onHide)
      }
    }, [flushPersistHistory])

    useEffect(() => {
      const t = window.setTimeout(() => {
        setRasterZoom(zoom)
      }, RASTER_MS)
      return () => window.clearTimeout(t)
    }, [zoom])

    useEffect(() => {
      let cancelled = false
      let task: Awaited<ReturnType<typeof loadPdfDocument>>['task'] | null =
        null
      let loaded: PDFDocumentProxy | null = null

      async function load() {
        docRef.current = null
        setLayout({ width: 0, height: 0, fitScale: 1 })
        layoutRef.current = { width: 0, height: 0, fitScale: 1 }

        if (!file) {
          setError(null)
          setLoading(false)
          onPageInfoRef.current({ width: 0, height: 0, pageCount: 0 })
          return
        }

        setLoading(true)
        setError(null)
        try {
          const result = await loadPdfDocument(file)
          if (cancelled) {
            await result.pdf.cleanup()
            void result.task.destroy()
            return
          }
          task = result.task
          loaded = result.pdf
          docRef.current = result.pdf
          onPageInfoRef.current({
            width: 0,
            height: 0,
            pageCount: result.pdf.numPages,
          })
        } catch (err) {
          if (!cancelled) {
            const message =
              err instanceof Error ? err.message : 'Failed to load PDF'
            setError(`${message} (pdf.js ${pdfjsVersion})`)
            onPageInfoRef.current({ width: 0, height: 0, pageCount: 0 })
          }
        } finally {
          if (!cancelled) setLoading(false)
        }
      }

      void load()
      return () => {
        cancelled = true
        void task?.destroy()
        if (loaded) void loaded.cleanup()
        docRef.current = null
      }
    }, [file])

    useEffect(() => {
      const pdf = docRef.current
      const target = pdfCanvasRef.current
      if (!pdf || !target || !file || page < 1 || page > pdf.numPages) return

      const doc = pdf
      const canvas = target
      let cancelled = false
      let renderTask: RenderTask | null = null

      async function renderPage() {
        try {
          const pdfPage = await doc.getPage(page)
          if (cancelled) return

          const baseViewport = pdfPage.getViewport({ scale: 1 })
          const fitted = notePageLayout(baseViewport.width, baseViewport.height)
          layoutRef.current = fitted
          setLayout(fitted)

          const rz = rasterZoomRef.current
          const viewport = pdfPage.getViewport({
            scale: fitted.fitScale * rz,
          })
          const dpr = window.devicePixelRatio || 1
          canvas.width = Math.max(1, Math.floor(fitted.width * rz * dpr))
          canvas.height = Math.max(1, Math.floor(fitted.height * rz * dpr))
          canvas.style.width = `${fitted.width}px`
          canvas.style.height = `${fitted.height}px`

          const ctx = canvas.getContext('2d', { alpha: false })
          if (!ctx) return
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, canvas.width, canvas.height)

          renderTask = pdfPage.render({
            canvas,
            viewport,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
            background: 'rgb(255,255,255)',
          })
          await renderTask.promise
          if (cancelled) return

          onPageInfoRef.current({
            width: fitted.width,
            height: fitted.height,
            pageCount: doc.numPages,
          })
          redrawCommitted()
        } catch (err) {
          if (cancelled) return
          const name =
            err && typeof err === 'object' && 'name' in err
              ? String((err as { name: string }).name)
              : ''
          if (name === 'RenderingCancelledException') return
          setError(err instanceof Error ? err.message : 'Failed to render page')
        }
      }

      void renderPage()
      return () => {
        cancelled = true
        renderTask?.cancel()
      }
    }, [file, page, loading, rasterZoom, redrawCommitted])

    useEffect(() => {
      const pdf = docRef.current
      if (!pdf || loading || layout.width <= 0) return
      let cancelled = false

      async function paintNeighbor(
        pageNumber: number,
        canvas: HTMLCanvasElement | null,
      ) {
        if (!canvas || !pdf) return
        if (pageNumber < 1 || pageNumber > pdf.numPages) {
          canvas.width = 1
          canvas.height = 1
          return
        }
        const pdfPage = await pdf.getPage(pageNumber)
        if (cancelled) return
        const base = pdfPage.getViewport({ scale: 1 })
        const fitted = notePageLayout(base.width, base.height)
        const dpr = window.devicePixelRatio || 1
        const viewport = pdfPage.getViewport({ scale: fitted.fitScale })
        canvas.width = Math.max(1, Math.floor(fitted.width * dpr))
        canvas.height = Math.max(1, Math.floor(fitted.height * dpr))
        canvas.style.width = `${fitted.width}px`
        canvas.style.height = `${fitted.height}px`
        const ctx = canvas.getContext('2d', { alpha: false })
        if (!ctx) return
        await pdfPage.render({
          canvas,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          background: 'rgb(255,255,255)',
        }).promise
      }

      void Promise.all([
        paintNeighbor(page - 1, prevCanvasRef.current),
        paintNeighbor(page + 1, nextCanvasRef.current),
      ]).catch(() => {
        /* neighbor preview is optional */
      })

      return () => {
        cancelled = true
      }
    }, [file, page, loading, layout.width, layout.height])

    useEffect(() => {
      setPan({ x: 48, y: 72 })
      setSlideX(0)
      setSlideSmooth(false)
    }, [documentId])

    useEffect(() => {
      setSlideX(0)
      setSlideSmooth(false)
    }, [page])

    useEffect(() => {
      redrawCommitted()
    }, [layout, rasterZoom, redrawCommitted, editingText])

    useEffect(() => {
      const stage = stageRef.current
      if (!stage || layout.width <= 0) return

      const stagePoint = (e: PointerEvent) => {
        const rect = stage.getBoundingClientRect()
        return { x: e.clientX - rect.left, y: e.clientY - rect.top }
      }

      const cacheInkRect = () => {
        const r = inkCanvasRef.current?.getBoundingClientRect() ?? null
        inkRectRef.current = r
        return r
      }

      const onPaper = (e: PointerEvent) => {
        const rect = cacheInkRect()
        if (!rect) return false
        return (
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        )
      }

      const pagePoint = (e: PointerEvent, rect: DOMRect) => {
        const { width: lw, height: lh } = layoutRef.current
        return {
          x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * lw,
          y: ((e.clientY - rect.top) / Math.max(1, rect.height)) * lh,
        }
      }

      const paperStride = () =>
        layoutRef.current.width * zoomRef.current + SLIDE_GAP

      const startPinch = () => {
        const pts = [...touchesRef.current.values()]
        if (pts.length < 2) return
        const a = pts[0]!
        const b = pts[1]!
        discardLive()
        oneFingerRef.current = null
        setSlideSmooth(false)
        setSlideX(0)
        gestureRef.current = {
          startDist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
          startZoom: zoomRef.current,
          startPanX: panRef.current.x,
          startPanY: panRef.current.y,
          startMidX: (a.x + b.x) / 2,
          startMidY: (a.y + b.y) / 2,
        }
      }

      const updatePinch = () => {
        const g = gestureRef.current
        const pts = [...touchesRef.current.values()]
        if (!g || pts.length < 2) return
        const a = pts[0]!
        const b = pts[1]!
        const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
        const midX = (a.x + b.x) / 2
        const midY = (a.y + b.y) / 2
        const nextZoom = Math.min(
          ZOOM_MAX,
          Math.max(ZOOM_MIN, g.startZoom * (dist / g.startDist)),
        )
        const layoutX = (g.startMidX - g.startPanX) / g.startZoom
        const layoutY = (g.startMidY - g.startPanY) / g.startZoom
        setPan({
          x: midX - layoutX * nextZoom,
          y: midY - layoutY * nextZoom,
        })
        if (Math.abs(nextZoom - zoomRef.current) > 0.01) {
          onZoomChangeRef.current(Math.round(nextZoom * 100) / 100)
        }
      }

      const finishSlide = (dx: number) => {
        const stride = paperStride()
        const current = pageRef.current
        const count = pageCountRef.current
        const threshold = Math.max(72, stride * 0.22)
        let target = 0
        let nextPage: number | null = null
        if (dx < -threshold && current < count) {
          target = -stride
          nextPage = current + 1
        } else if (dx > threshold && current > 1) {
          target = stride
          nextPage = current - 1
        }
        setSlideSmooth(true)
        setSlideX(target)
        if (slideTimerRef.current !== null) {
          window.clearTimeout(slideTimerRef.current)
        }
        slideTimerRef.current = window.setTimeout(() => {
          slideTimerRef.current = null
          setSlideSmooth(false)
          setSlideX(0)
          if (nextPage !== null) {
            onPageChangeRef.current(nextPage)
          }
        }, SLIDE_MS)
      }

      const applySlide = (dx: number) => {
        const current = pageRef.current
        const count = pageCountRef.current
        let next = dx
        if ((current <= 1 && dx > 0) || (current >= count && dx < 0)) {
          next = dx * 0.32
        }
        setSlideSmooth(false)
        setSlideX(next)
      }

      const maybeDoubleTap = (p: { x: number; y: number }) => {
        const prev = lastTapRef.current
        const now = performance.now()
        if (
          prev &&
          now - prev.t < DOUBLE_TAP_MS &&
          Math.hypot(p.x - prev.x, p.y - prev.y) < 48
        ) {
          lastTapRef.current = null
          const nextZoom = zoomRef.current <= 1.15 ? 2 : 1
          const layoutX = (p.x - panRef.current.x) / zoomRef.current
          const layoutY = (p.y - panRef.current.y) / zoomRef.current
          setPan({
            x: p.x - layoutX * nextZoom,
            y: p.y - layoutY * nextZoom,
          })
          onZoomChangeRef.current(nextZoom)
          return true
        }
        lastTapRef.current = { t: now, x: p.x, y: p.y }
        return false
      }

      const startInk = (e: PointerEvent) => {
        const rect = cacheInkRect()
        const { width: lw, height: lh } = layoutRef.current
        if (!rect || lw <= 0 || lh <= 0) return
        const { committed } = samplePointerEvents(e, rect, lw, lh)
        const point = committed[0]
        if (!point) return
        const s = settingsRef.current
        const useFilter = stabilizeRef.current && s.tool !== 'eraser'
        const filter = useFilter ? new StrokeStabilizer() : null
        filterRef.current = filter
        const first = filter ? filter.reset(point) : point
        const extras = committed.slice(1)
        const points: PointerPoint[] = [first]
        if (filter) {
          for (const p of extras) {
            const q = filter.push(p)
            if (q) points.push(q)
          }
        } else {
          points.push(...extras)
        }
        liveRef.current = {
          id: `stroke-${Date.now()}-${e.pointerId}`,
          tool: s.tool,
          color: s.color,
          width: s.width,
          points,
          pointerId: e.pointerId,
          layerId: 'default',
        }
        predictedRef.current = []
        liveBoundsRef.current = null
        shapeHoldRef.current = null
        shapeEditRef.current = null
        clearShapeHoldTimer()
        onInkActivityRef.current?.()
        scheduleLive()
      }

      const abortFinger = () => {
        oneFingerRef.current = null
        setSlideSmooth(false)
        setSlideX(0)
      }

      const canDrawWith = (e: PointerEvent) => {
        if (e.pointerType === 'pen' || e.pointerType === 'mouse') return true
        if (e.pointerType === 'touch') return !pencilOnlyRef.current
        return false
      }

      const onPointerDown = (e: PointerEvent) => {
        if ((e.target as HTMLElement | null)?.closest?.('textarea')) return
        e.preventDefault()

        if (e.pointerType === 'pen') {
          abortFinger()
          touchesRef.current.clear()
          gestureRef.current = null
        }

        if (
          penDownIdRef.current !== null &&
          e.pointerType === 'touch' &&
          e.pointerId !== penDownIdRef.current
        ) {
          return
        }

        if (e.pointerType === 'touch') {
          const p = stagePoint(e)
          touchesRef.current.set(e.pointerId, p)
          if (touchesRef.current.size >= 2) {
            startPinch()
            return
          }
          const fingerDraws = canDrawWith(e) && onPaper(e)
          if (!fingerDraws) {
            stage.setPointerCapture(e.pointerId)
            const guarded = performance.now() < inkGuardUntilRef.current
            oneFingerRef.current = {
              pointerId: e.pointerId,
              startX: p.x,
              startY: p.y,
              startTime: performance.now(),
              mode: guarded ? 'ignore' : 'undecided',
            }
            return
          }
        }

        if (gestureRef.current) return

        const wantsPan =
          e.button === 1 ||
          (e.pointerType === 'mouse' && spaceDownRef.current)
        if (wantsPan) {
          const p = stagePoint(e)
          stage.setPointerCapture(e.pointerId)
          mousePanRef.current = {
            pointerId: e.pointerId,
            startX: p.x,
            startY: p.y,
            panX: panRef.current.x,
            panY: panRef.current.y,
          }
          return
        }

        if (!canDrawWith(e)) return
        if (!onPaper(e) && e.pointerType !== 'pen') {
          if (e.pointerType === 'mouse') onShowChromeRef.current?.()
          return
        }

        const rect = cacheInkRect()
        if (!rect) return
        const pt = pagePoint(e, rect)
        const tool = settingsRef.current.tool

        stage.setPointerCapture(e.pointerId)
        if (e.pointerType === 'pen') penDownIdRef.current = e.pointerId

        const pending = pendingImageRef.current
        if (pending) {
          const box = newImageBox({
            x: pt.x - pending.width / 2,
            y: pt.y - pending.height / 2,
            width: pending.width,
            height: pending.height,
            dataUrl: pending.dataUrl,
            kind: pending.kind ?? 'image',
            layerId: 'default',
          })
          pendingImageRef.current = null
          onPendingImageConsumedRef.current?.()
          pushHistory()
          itemsRef.current = [...itemsRef.current, box]
          selectionRef.current = new Set([box.id])
          emitSelection()
          redrawCommitted()
          emitItems()
          inkGuardUntilRef.current = performance.now() + INK_GUARD_MS
          return
        }

        if (tool === 'lasso') {
          const selected = selectedItems()
          const box = unionBounds(selected, 10)
          if (box) {
            const hitSize = Math.max(14, 26 / Math.max(0.4, zoomRef.current))
            const handle = hitResizeHandle(box, pt.x, pt.y, hitSize)
            if (handle) {
              resizeRef.current = {
                pointerId: e.pointerId,
                handle,
                box,
                snapshot: clonePageItems(itemsRef.current),
              }
              return
            }
            if (pointInRect(pt.x, pt.y, box)) {
              moveRef.current = {
                pointerId: e.pointerId,
                startX: pt.x,
                startY: pt.y,
                snapshot: clonePageItems(itemsRef.current),
              }
              return
            }
          }
          lassoPtsRef.current = [pt]
          lassoPointerIdRef.current = e.pointerId
          selectionRef.current = new Set()
          emitSelection()
          paintOverlay()
          return
        }

        if (tool === 'text') {
          textPointerRef.current = {
            pointerId: e.pointerId,
            startX: pt.x,
            startY: pt.y,
            hit: hitTextBox(itemsRef.current, pt.x, pt.y),
          }
          return
        }

        if (!isDrawingTool(tool)) return
        clearSelection()
        startInk(e)
      }

      const onPointerMove = (e: PointerEvent) => {
        if (mousePanRef.current?.pointerId === e.pointerId) {
          e.preventDefault()
          const p = stagePoint(e)
          const panSess = mousePanRef.current
          setPan({
            x: panSess.panX + (p.x - panSess.startX),
            y: panSess.panY + (p.y - panSess.startY),
          })
          return
        }

        if (e.pointerType === 'touch' && touchesRef.current.has(e.pointerId)) {
          const p = stagePoint(e)
          touchesRef.current.set(e.pointerId, p)
          if (gestureRef.current && touchesRef.current.size >= 2) {
            e.preventDefault()
            updatePinch()
            return
          }
          const one = oneFingerRef.current
          if (one && one.pointerId === e.pointerId) {
            e.preventDefault()
            const dx = p.x - one.startX
            const dy = p.y - one.startY
            if (one.mode === 'undecided') {
              const dist = Math.hypot(dx, dy)
              if (dist > LOCK_PX) {
                one.mode =
                  Math.abs(dx) > Math.abs(dy) * 1.15 ? 'slide' : 'ignore'
              }
            }
            if (one.mode === 'slide') applySlide(dx)
            return
          }
        }

        const rect = inkRectRef.current ?? cacheInkRect()
        if (!rect) return
        const pt = pagePoint(e, rect)

        if (resizeRef.current?.pointerId === e.pointerId) {
          e.preventDefault()
          const sess = resizeRef.current
          const t = resizeScale(sess.box, sess.handle, pt.x, pt.y)
          const ids = selectionRef.current
          itemsRef.current = sess.snapshot.map((item) =>
            ids.has(item.id)
              ? scalePageItem(item, t.originX, t.originY, t.sx, t.sy)
              : item,
          )
          stage.style.cursor = resizeCursor(sess.handle)
          redrawCommitted()
          return
        }

        if (moveRef.current?.pointerId === e.pointerId) {
          e.preventDefault()
          const sess = moveRef.current
          const dx = pt.x - sess.startX
          const dy = pt.y - sess.startY
          const ids = selectionRef.current
          itemsRef.current = sess.snapshot.map((item) =>
            ids.has(item.id) ? movePageItem(item, dx, dy) : item,
          )
          stage.style.cursor = 'move'
          redrawCommitted()
          return
        }

        if (
          !liveRef.current &&
          !lassoPtsRef.current &&
          settingsRef.current.tool === 'lasso'
        ) {
          const box = unionBounds(selectedItems(), 10)
          if (box) {
            const hitSize = Math.max(14, 26 / Math.max(0.4, zoomRef.current))
            const handle = hitResizeHandle(box, pt.x, pt.y, hitSize)
            if (handle) stage.style.cursor = resizeCursor(handle)
            else if (pointInRect(pt.x, pt.y, box)) stage.style.cursor = 'move'
            else stage.style.cursor = ''
          } else {
            stage.style.cursor = ''
          }
        }

        if (
          lassoPtsRef.current &&
          lassoPointerIdRef.current === e.pointerId &&
          liveRef.current === null
        ) {
          lassoPtsRef.current.push(pt)
          paintOverlay()
          return
        }

        if (textPointerRef.current?.pointerId === e.pointerId) {
          return
        }

        const live = liveRef.current
        if (!live || live.pointerId !== e.pointerId) return
        e.preventDefault()
        const { width: lw, height: lh } = layoutRef.current
        if (lw <= 0 || lh <= 0) return

        const editing = shapeEditRef.current
        if (editing) {
          const { committed } = samplePointerEvents(e, rect, lw, lh)
          const tip = committed[committed.length - 1]
          const x = tip?.x ?? pt.x
          const y = tip?.y ?? pt.y
          const r = Math.hypot(x - editing.cx, y - editing.cy)
          live.points = scaleShapePoints(
            editing.rel,
            { x: editing.cx, y: editing.cy },
            r / editing.r0,
            {
              ...editing.template,
              x,
              y,
              timestamp: tip?.timestamp ?? performance.now(),
            },
          )
          predictedRef.current = []
          scheduleLive()
          return
        }

        const { committed, predicted } = samplePointerEvents(e, rect, lw, lh)
        if (committed.length > 0) {
          const filter = filterRef.current
          if (filter) {
            for (const p of committed) {
              const q = filter.push(p)
              if (q) live.points.push(q)
            }
          } else {
            live.points.push(...committed)
          }
        }
        predictedRef.current = predicted

        if (
          shapeSnapRef.current &&
          live.tool !== 'eraser' &&
          isClosedShapeStroke(live.points)
        ) {
          const last = live.points[live.points.length - 1]!
          const hold = shapeHoldRef.current
          const now = performance.now()
          if (
            !hold ||
            Math.hypot(last.x - hold.x, last.y - hold.y) > SHAPE_HOLD_MOVE
          ) {
            shapeHoldRef.current = { t: now, x: last.x, y: last.y }
            clearShapeHoldTimer()
            shapeHoldTimerRef.current = window.setTimeout(() => {
              shapeHoldTimerRef.current = null
              tryEnterShapeEdit()
            }, SHAPE_HOLD_MS)
          }
        } else {
          shapeHoldRef.current = null
          clearShapeHoldTimer()
        }

        scheduleLive()
      }

      const finish = (e: PointerEvent) => {
        if (mousePanRef.current?.pointerId === e.pointerId) {
          mousePanRef.current = null
        }

        if (e.pointerType === 'touch') {
          const one = oneFingerRef.current
          if (one && one.pointerId === e.pointerId) {
            const p = stagePoint(e)
            const dx = p.x - one.startX
            const dist = Math.hypot(dx, p.y - one.startY)
            if (one.mode === 'slide') {
              finishSlide(dx)
            } else if (one.mode === 'undecided' || dist < TAP_MOVE) {
              if (!maybeDoubleTap(p)) onShowChromeRef.current?.()
            }
            oneFingerRef.current = null
          }
          touchesRef.current.delete(e.pointerId)
          if (touchesRef.current.size < 2) gestureRef.current = null
        }

        if (resizeRef.current?.pointerId === e.pointerId) {
          const sess = resizeRef.current
          resizeRef.current = null
          stage.style.cursor = ''
          const rect = inkRectRef.current
          if (rect) {
            const pt = pagePoint(e, rect)
            const t = resizeScale(sess.box, sess.handle, pt.x, pt.y)
            if (Math.abs(t.sx - 1) > 0.01 || Math.abs(t.sy - 1) > 0.01) {
              const ids = selectionRef.current
              const resized = sess.snapshot.map((item) =>
                ids.has(item.id)
                  ? scalePageItem(item, t.originX, t.originY, t.sx, t.sy)
                  : item,
              )
              itemsRef.current = sess.snapshot
              pushHistory()
              itemsRef.current = resized
              emitItems()
              redrawCommitted()
            } else {
              itemsRef.current = sess.snapshot
              redrawCommitted()
            }
          }
        }

        if (moveRef.current?.pointerId === e.pointerId) {
          const sess = moveRef.current
          moveRef.current = null
          stage.style.cursor = ''
          const rect = inkRectRef.current
          if (rect) {
            const pt = pagePoint(e, rect)
            if (Math.hypot(pt.x - sess.startX, pt.y - sess.startY) > 1) {
              const ids = selectionRef.current
              const moved = sess.snapshot.map((item) =>
                ids.has(item.id)
                  ? movePageItem(item, pt.x - sess.startX, pt.y - sess.startY)
                  : item,
              )
              itemsRef.current = sess.snapshot
              pushHistory()
              itemsRef.current = moved
              emitItems()
              redrawCommitted()
            }
          }
        }

        if (
          lassoPtsRef.current &&
          lassoPointerIdRef.current === e.pointerId &&
          liveRef.current === null
        ) {
          const poly = lassoPtsRef.current
          lassoPtsRef.current = null
          lassoPointerIdRef.current = null
          if (poly.length >= 3) {
            const next = new Set<string>()
            for (const item of itemsRef.current) {
              if (itemInLasso(item, poly)) next.add(item.id)
            }
            selectionRef.current = next
          } else {
            selectionRef.current = new Set()
          }
          emitSelection()
          paintOverlay()
        }

        if (textPointerRef.current?.pointerId === e.pointerId) {
          const sess = textPointerRef.current
          textPointerRef.current = null
          const rect = inkRectRef.current
          if (rect) {
            const pt = pagePoint(e, rect)
            const dist = Math.hypot(pt.x - sess.startX, pt.y - sess.startY)
            if (dist < TAP_MOVE) {
              if (sess.hit) {
                setEditingText({ ...sess.hit })
              } else {
                const s = settingsRef.current
                const box = newTextBox({
                  x: pt.x,
                  y: pt.y,
                  width: 240,
                  height: s.width * 1.6,
                  text: '',
                  color: s.color,
                  fontSize: s.width,
                })
                pushHistory()
                itemsRef.current = [...itemsRef.current, box]
                emitItems()
                setEditingText(box)
                redrawCommitted()
              }
            } else if (sess.hit) {
              pushHistory()
              itemsRef.current = itemsRef.current.map((item) =>
                item.id === sess.hit!.id
                  ? movePageItem(item, pt.x - sess.startX, pt.y - sess.startY)
                  : item,
              )
              emitItems()
              redrawCommitted()
            }
          }
        }

        const live = liveRef.current
        if (!live || live.pointerId !== e.pointerId) return
        e.preventDefault()
        if (penDownIdRef.current === e.pointerId) penDownIdRef.current = null

        cancelLiveRaf()
        const editing = shapeEditRef.current
        if (!editing) {
          const rect = cacheInkRect()
          const { width: lwEnd, height: lhEnd } = layoutRef.current
          if (rect && lwEnd > 0 && lhEnd > 0) {
            const { committed } = samplePointerEvents(e, rect, lwEnd, lhEnd)
            const filter = filterRef.current
            if (committed.length > 0) {
              if (filter) {
                const lastIdx = committed.length - 1
                for (let i = 0; i < committed.length; i++) {
                  const q = filter.push(committed[i]!, i === lastIdx)
                  if (q) live.points.push(q)
                }
              } else {
                live.points.push(...committed)
              }
            }
          }
        }

        let points = live.points
        const snapped = editing
          ? points
          : live.tool !== 'eraser' && shapeSnapRef.current
            ? snapShape(points, live.tool)
            : null
        if (snapped) points = snapped

        filterRef.current = null
        shapeHoldRef.current = null
        shapeEditRef.current = null
        clearShapeHoldTimer()
        liveRef.current = null
        predictedRef.current = []
        inkRectRef.current = null
        inkGuardUntilRef.current = performance.now() + INK_GUARD_MS

        if (live.tool === 'eraser') {
          const next = itemsRef.current.filter(
            (item) => !itemHitsEraser(item, points, live.width),
          )
          if (next.length !== itemsRef.current.length) {
            pushHistory()
            itemsRef.current = next
            selectionRef.current = new Set()
            emitSelection()
            emitItems()
          }
          redrawCommitted()
          return
        }

        const stroke: Stroke = {
          id: live.id,
          tool: live.tool,
          color: live.color,
          width: live.width,
          points,
          layerId: live.layerId ?? 'default',
        }
        pushHistory()
        itemsRef.current = [...itemsRef.current, stroke]

        if (snapped) {
          redrawCommitted()
        } else {
          const inkCanvas = inkCanvasRef.current
          const { width: lw, height: lh } = layoutRef.current
          if (inkCanvas && lw > 0 && lh > 0) {
            const ctx = configureInkLayer(
              inkCanvas,
              lw,
              lh,
              rasterZoomRef.current,
            )
            if (ctx) drawStroke(ctx, stroke)
          }
          paintOverlay()
        }
        emitItems()
      }

      const onWheel = (e: WheelEvent) => {
        e.preventDefault()
        const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
        const nextZoom = Math.min(
          ZOOM_MAX,
          Math.max(ZOOM_MIN, zoomRef.current * factor),
        )
        const rect = stage.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        const layoutX = (mx - panRef.current.x) / zoomRef.current
        const layoutY = (my - panRef.current.y) / zoomRef.current
        setPan({
          x: mx - layoutX * nextZoom,
          y: my - layoutY * nextZoom,
        })
        onZoomChangeRef.current(Math.round(nextZoom * 100) / 100)
      }

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.code === 'Space' && !e.repeat) {
          const t = e.target as HTMLElement | null
          if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
          e.preventDefault()
          spaceDownRef.current = true
        }
      }
      const onKeyUp = (e: KeyboardEvent) => {
        if (e.code === 'Space') spaceDownRef.current = false
      }

      const blockNativeDrag = (ev: Event) => {
        ev.preventDefault()
      }

      stage.addEventListener('pointerdown', onPointerDown, { passive: false })
      stage.addEventListener('pointermove', onPointerMove, { passive: false })
      stage.addEventListener('pointerup', finish)
      stage.addEventListener('pointercancel', finish)
      stage.addEventListener('wheel', onWheel, { passive: false })
      stage.addEventListener('dragstart', blockNativeDrag)
      stage.addEventListener('touchstart', blockNativeDrag, { passive: false })
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)
      return () => {
        stage.removeEventListener('pointerdown', onPointerDown)
        stage.removeEventListener('pointermove', onPointerMove)
        stage.removeEventListener('pointerup', finish)
        stage.removeEventListener('pointercancel', finish)
        stage.removeEventListener('wheel', onWheel)
        stage.removeEventListener('dragstart', blockNativeDrag)
        stage.removeEventListener('touchstart', blockNativeDrag)
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('keyup', onKeyUp)
      }
    }, [
      layout.width,
      layout.height,
      emitItems,
      emitSelection,
      discardLive,
      scheduleLive,
      cancelLiveRaf,
      redrawCommitted,
      paintOverlay,
      pushHistory,
      clearSelection,
      selectedItems,
      clearShapeHoldTimer,
      tryEnterShapeEdit,
    ])

    useEffect(() => {
      return () => {
        cancelLiveRaf()
        if (slideTimerRef.current !== null) {
          window.clearTimeout(slideTimerRef.current)
        }
        if (shapeHoldTimerRef.current !== null) {
          window.clearTimeout(shapeHoldTimerRef.current)
        }
      }
    }, [cancelLiveRaf])

    const commitEditing = (box: TextBox) => {
      const text = box.text.trimEnd()
      pushHistory()
      if (!text) {
        itemsRef.current = itemsRef.current.filter((item) => item.id !== box.id)
      } else {
        const ctx = inkCanvasRef.current?.getContext('2d')
        const height = ctx
          ? measureTextHeight(ctx, { ...box, text })
          : box.fontSize * 1.35
        itemsRef.current = itemsRef.current.map((item) =>
          item.id === box.id ? { ...box, text, height } : item,
        )
      }
      setEditingText(null)
      emitItems()
      redrawCommitted()
    }

    if (!file) return null

    const paperW = layout.width * zoom
    const prevX = pan.x - paperW - SLIDE_GAP
    const nextX = pan.x + paperW + SLIDE_GAP

    return (
      <div
        ref={stageRef}
        className={`relative h-full min-h-0 w-full touch-none overflow-hidden ${
          pendingImage ? 'cursor-crosshair' : ''
        }`}
      >
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-slate-500">
            Loading PDF…
          </div>
        )}
        {error && (
          <div className="absolute left-4 right-4 top-16 z-10 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
            {error}
          </div>
        )}
        <div
          className="absolute inset-0 will-change-transform"
          style={{
            transform: `translateX(${slideX}px)`,
            transition: slideSmooth
              ? `transform ${SLIDE_MS}ms ease-out`
              : 'none',
          }}
        >
          {page > 1 && layout.width > 0 && (
            <canvas
              ref={prevCanvasRef}
              draggable={false}
              className="pointer-events-none absolute origin-top-left rounded-sm bg-white shadow-[0_18px_50px_rgba(15,23,42,0.12)]"
              style={{
                transform: `translate(${prevX}px, ${pan.y}px) scale(${zoom})`,
              }}
              aria-hidden
            />
          )}
          {page < pageCount && layout.width > 0 && (
            <canvas
              ref={nextCanvasRef}
              draggable={false}
              className="pointer-events-none absolute origin-top-left rounded-sm bg-white shadow-[0_18px_50px_rgba(15,23,42,0.12)]"
              style={{
                transform: `translate(${nextX}px, ${pan.y}px) scale(${zoom})`,
              }}
              aria-hidden
            />
          )}
          <div
            className="absolute z-10 origin-top-left will-change-transform"
            style={{
              width: layout.width || undefined,
              height: layout.height || undefined,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
          >
            <canvas
              ref={pdfCanvasRef}
              draggable={false}
              className="block rounded-sm bg-white shadow-[0_18px_50px_rgba(15,23,42,0.18)]"
              aria-label={`PDF page ${page}`}
            />
            {layout.width > 0 && layout.height > 0 && (
              <>
                <canvas
                  ref={inkCanvasRef}
                  draggable={false}
                  className="ink-canvas pointer-events-none absolute left-0 top-0"
                  style={{
                    width: layout.width,
                    height: layout.height,
                  }}
                  aria-label="Ink overlay"
                />
                <canvas
                  ref={liveCanvasRef}
                  draggable={false}
                  className="ink-canvas pointer-events-none absolute left-0 top-0"
                  style={{
                    width: layout.width,
                    height: layout.height,
                    touchAction: 'none',
                  }}
                  aria-hidden
                />
                {editingText && (
                  <textarea
                    autoFocus
                    value={editingText.text}
                    onChange={(ev) =>
                      setEditingText({ ...editingText, text: ev.target.value })
                    }
                    onBlur={() => commitEditing(editingText)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Escape') {
                        ev.currentTarget.blur()
                      }
                    }}
                    className="absolute resize overflow-hidden bg-white/80 p-0.5 outline-none ring-1 ring-blue-500"
                    style={{
                      left: editingText.x,
                      top: editingText.y,
                      width: editingText.width,
                      minHeight: Math.max(
                        editingText.height,
                        editingText.fontSize * 1.5,
                      ),
                      color: editingText.color,
                      fontSize: editingText.fontSize,
                      lineHeight: 1.35,
                      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                    }}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    )
  },
)
