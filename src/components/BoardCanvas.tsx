import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import type { PageItem, Stroke } from '../types/note'
import { drawPageItem } from '../lib/pageItems'
import { pointerPointFromEvent } from '../lib/ink'
import { listBoardChunks, putBoardChunk } from '../lib/db'
import { boardChunkKey } from '../types/document'

const CHUNK = 1024

export type BoardCanvasHandle = {
  flush: () => Promise<void>
}

type Props = {
  notebookId: string
  color?: string
  width?: number
}

function chunkOf(x: number, y: number) {
  return {
    cx: Math.floor(x / CHUNK),
    cy: Math.floor(y / CHUNK),
  }
}

export const BoardCanvas = forwardRef<BoardCanvasHandle, Props>(
  function BoardCanvas({ notebookId, color = '#1e293b', width = 4 }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const itemsRef = useRef<PageItem[]>([])
    const panRef = useRef({ x: 0, y: 0, scale: 1 })
    const liveRef = useRef<Stroke | null>(null)
    const dirtyChunks = useRef(new Set<string>())
    const dirtyKey = (cx: number, cy: number) => `${cx},${cy}`

    const redraw = useCallback(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#f8fafc'
      ctx.fillRect(0, 0, w, h)
      const { x: panX, y: panY, scale } = panRef.current
      ctx.save()
      ctx.translate(panX, panY)
      ctx.scale(scale, scale)
      for (const item of itemsRef.current) drawPageItem(ctx, item)
      if (liveRef.current) drawPageItem(ctx, liveRef.current)
      ctx.restore()
    }, [])

    const persistChunk = useCallback(
      async (cx: number, cy: number) => {
        const key = boardChunkKey(notebookId, cx, cy)
        const strokes = itemsRef.current.filter((item) => {
          if (!('points' in item) || !item.points?.length) return false
          const p = item.points[0]!
          const c = chunkOf(p.x, p.y)
          return c.cx === cx && c.cy === cy
        })
        await putBoardChunk({
          key,
          notebookId,
          cx,
          cy,
          strokes,
        })
        dirtyChunks.current.delete(dirtyKey(cx, cy))
      },
      [notebookId],
    )

    const flush = useCallback(async () => {
      for (const key of [...dirtyChunks.current]) {
        const [cx, cy] = key.split(',').map(Number)
        await persistChunk(cx!, cy!)
      }
    }, [persistChunk])

    useImperativeHandle(ref, () => ({ flush }), [flush])

    useEffect(() => {
      let cancelled = false
      void listBoardChunks(notebookId).then((chunks) => {
        if (cancelled) return
        itemsRef.current = chunks.flatMap((c) => c.strokes)
        redraw()
      })
      return () => {
        cancelled = true
      }
    }, [notebookId, redraw])

    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const onResize = () => redraw()
      window.addEventListener('resize', onResize)
      redraw()

      let pointers = new Map<number, { x: number; y: number }>()
      let drawing = false

      const world = (e: PointerEvent) => {
        const rect = canvas.getBoundingClientRect()
        const { x: panX, y: panY, scale } = panRef.current
        return {
          x: (e.clientX - rect.left - panX) / scale,
          y: (e.clientY - rect.top - panY) / scale,
        }
      }

      const onDown = (e: PointerEvent) => {
        canvas.setPointerCapture(e.pointerId)
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (e.pointerType === 'touch' && pointers.size >= 2) {
          drawing = false
          liveRef.current = null
          return
        }
        if (e.pointerType === 'touch' && !e.isPrimary) return
        drawing = true
        const p = world(e)
        const pt = pointerPointFromEvent(e, p.x, p.y)
        liveRef.current = {
          id: `stroke-${Date.now()}`,
          tool: 'pen',
          color,
          width,
          points: [pt],
        }
        redraw()
      }

      const onMove = (e: PointerEvent) => {
        const prev = pointers.get(e.pointerId)
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (pointers.size >= 2) {
          const pts = [...pointers.values()]
          if (pts.length >= 2 && prev) {
            panRef.current.x += e.movementX
            panRef.current.y += e.movementY
            redraw()
          }
          return
        }
        if (!drawing || !liveRef.current) {
          if (e.buttons === 4 || (e.pointerType === 'touch' && !drawing)) {
            panRef.current.x += e.movementX
            panRef.current.y += e.movementY
            redraw()
          }
          return
        }
        const p = world(e)
        liveRef.current.points.push(pointerPointFromEvent(e, p.x, p.y))
        redraw()
      }

      const onUp = (e: PointerEvent) => {
        pointers.delete(e.pointerId)
        if (!drawing || !liveRef.current) return
        drawing = false
        const stroke = liveRef.current
        liveRef.current = null
        if (stroke.points.length > 0) {
          itemsRef.current = [...itemsRef.current, stroke]
          const c = chunkOf(stroke.points[0]!.x, stroke.points[0]!.y)
          dirtyChunks.current.add(dirtyKey(c.cx, c.cy))
          void persistChunk(c.cx, c.cy)
        }
        redraw()
      }

      const onWheel = (e: WheelEvent) => {
        e.preventDefault()
        const factor = e.deltaY > 0 ? 0.9 : 1.1
        panRef.current.scale = Math.min(
          4,
          Math.max(0.25, panRef.current.scale * factor),
        )
        redraw()
      }

      canvas.addEventListener('pointerdown', onDown)
      canvas.addEventListener('pointermove', onMove)
      canvas.addEventListener('pointerup', onUp)
      canvas.addEventListener('pointercancel', onUp)
      canvas.addEventListener('wheel', onWheel, { passive: false })
      return () => {
        window.removeEventListener('resize', onResize)
        canvas.removeEventListener('pointerdown', onDown)
        canvas.removeEventListener('pointermove', onMove)
        canvas.removeEventListener('pointerup', onUp)
        canvas.removeEventListener('pointercancel', onUp)
        canvas.removeEventListener('wheel', onWheel)
      }
    }, [color, width, notebookId, persistChunk, redraw])

    return (
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none"
        aria-label="Board canvas"
      />
    )
  },
)
