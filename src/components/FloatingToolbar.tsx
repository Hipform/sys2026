import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  Bookmark,
  ChevronDown,
  Copy,
  Download,
  Eraser,
  FilePlus,
  Highlighter,
  ImagePlus,
  Lasso,
  LayoutList,
  Maximize2,
  Mic,
  MicOff,
  Paintbrush,
  Pen,
  Pencil,
  PenLine,
  PenTool,
  Play,
  Presentation,
  Redo2,
  RotateCw,
  Settings,
  Share2,
  SprayCan,
  SquareStack,
  Sticker,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { DrawSettings, DrawTool } from '../types/note'
import {
  INK_TOOLS,
  TOOL_LABELS,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  clampWidth,
  colorsForTool,
  isInkTool,
  toHexColor,
  widthRangeForTool,
} from '../types/note'

export interface FloatingToolbarProps {
  title: string
  page: number
  pageCount: number
  zoom: number
  settings: DrawSettings
  hidden: boolean
  exporting?: boolean
  selectionCount?: number
  onBack: () => void
  onZoomChange: (zoom: number) => void
  onSettingsChange: (patch: Partial<DrawSettings>) => void
  onToolChange: (tool: DrawTool) => void
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
  onExport: () => void
  onReveal: () => void
  onAddPage?: () => void
  onDeleteSelection?: () => void
  onDuplicateSelection?: () => void
  onRotateSelection?: () => void
  onTitleChange?: (title: string) => void
  onJumpPage?: (page: number) => void
  onOpenPages?: () => void
  onInsertImage?: (file: File) => void
  onOpenSettings?: () => void
  onShareNotebook?: () => void
  onToggleRecord?: () => void
  recording?: boolean
  onPlayAudio?: () => void
  onHighlightPdfText?: () => void
  onPresent?: () => void
  onInsertSticker?: () => void
  onOpenFlashcards?: () => void
  onToggleBookmark?: () => void
  canUndo?: boolean
  canRedo?: boolean
  placingImage?: boolean
}

export function FloatingToolbar({
  title,
  page,
  pageCount,
  zoom,
  settings,
  hidden,
  exporting,
  selectionCount = 0,
  onBack,
  onZoomChange,
  onSettingsChange,
  onToolChange,
  onUndo,
  onRedo,
  onClear,
  onExport,
  onReveal,
  onAddPage,
  onDeleteSelection,
  onDuplicateSelection,
  onRotateSelection,
  onTitleChange,
  onJumpPage,
  onOpenPages,
  onInsertImage,
  onOpenSettings,
  onShareNotebook,
  onToggleRecord,
  recording,
  onPlayAudio,
  onHighlightPdfText,
  onPresent,
  onInsertSticker,
  onOpenFlashcards,
  onToggleBookmark,
  canUndo = true,
  canRedo = true,
  placingImage,
}: FloatingToolbarProps) {
  const colors = colorsForTool(settings.tool)
  const widthRange = widthRangeForTool(settings.tool)
  const showColor = settings.tool !== 'eraser' && settings.tool !== 'lasso'
  const showWidth = settings.tool !== 'lasso'
  const [confirmClear, setConfirmClear] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [jumpOpen, setJumpOpen] = useState(false)
  const [jumpValue, setJumpValue] = useState(String(page))
  const [lastInk, setLastInk] = useState<DrawTool>('pen')
  const longPressRef = useRef<number | null>(null)
  const paletteRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const inkActive = isInkTool(settings.tool)
  const paletteTool = inkActive ? settings.tool : lastInk

  useEffect(() => {
    if (isInkTool(settings.tool)) setLastInk(settings.tool)
  }, [settings.tool])

  useEffect(() => {
    if (hidden) setPaletteOpen(false)
  }, [hidden])

  useEffect(() => {
    if (!paletteOpen) return
    const close = (e: PointerEvent) => {
      if (paletteRef.current?.contains(e.target as Node)) return
      setPaletteOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [paletteOpen])

  useEffect(() => {
    if (!confirmClear) return
    const t = window.setTimeout(() => setConfirmClear(false), 3500)
    return () => window.clearTimeout(t)
  }, [confirmClear])

  const bumpZoom = (delta: number) => {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom + delta))
    onZoomChange(Math.round(next * 100) / 100)
  }

  const startClearPress = () => {
    if (longPressRef.current !== null) window.clearTimeout(longPressRef.current)
    longPressRef.current = window.setTimeout(() => {
      longPressRef.current = null
      setConfirmClear(false)
      onClear()
    }, 550)
  }

  const endClearPress = (clicked: boolean) => {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current)
      longPressRef.current = null
      if (clicked) {
        if (confirmClear) {
          setConfirmClear(false)
          onClear()
        } else {
          setConfirmClear(true)
        }
      }
    }
  }

  const chrome = hidden
    ? 'pointer-events-none opacity-0'
    : 'pointer-events-auto opacity-100'

  return (
    <div
      className={`absolute inset-x-0 top-3 z-30 flex items-start justify-between gap-2 px-3 transition-opacity duration-300 ${chrome}`}
      onPointerEnter={(e) => {
        if (!hidden && e.pointerType !== 'pen') onReveal()
      }}
    >
      <div className="flex items-center rounded-full bg-white/95 p-1 shadow-[0_8px_28px_rgba(15,23,42,0.16)] ring-1 ring-black/8">
        <IconButton label="Back to library" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </IconButton>
        {onTitleChange ? (
          <input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            aria-label="Notebook title"
            className="mr-1 max-w-[8.5rem] truncate bg-transparent px-1 text-xs font-medium text-slate-700 outline-none"
          />
        ) : (
          <span className="hidden max-w-[7rem] truncate px-1.5 text-xs font-medium text-slate-600 sm:inline">
            {title}
          </span>
        )}
      </div>

      <div className="flex min-w-0 max-w-[min(100%,52rem)] flex-wrap items-center justify-center gap-1 rounded-full bg-white/95 px-1.5 py-1 shadow-[0_8px_28px_rgba(15,23,42,0.16)] ring-1 ring-black/8">
        <div className="relative" ref={paletteRef}>
          <button
            type="button"
            title={TOOL_LABELS[paletteTool]}
            aria-label={TOOL_LABELS[paletteTool]}
            aria-expanded={paletteOpen}
            onClick={() => setPaletteOpen((open) => !open)}
            className={`inline-flex h-8 items-center gap-0.5 rounded-full px-1.5 ${
              inkActive
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <ToolGlyph tool={paletteTool} />
            <ChevronDown className="h-3 w-3 opacity-70" />
          </button>
          {paletteOpen && (
            <div className="absolute left-1/2 top-full z-40 mt-2 w-[15.5rem] -translate-x-1/2 rounded-2xl bg-white p-1.5 shadow-[0_16px_40px_rgba(15,23,42,0.18)] ring-1 ring-black/10">
              <div className="grid grid-cols-2 gap-0.5">
                {INK_TOOLS.map((tool) => (
                  <button
                    key={tool}
                    type="button"
                    onClick={() => {
                      onToolChange(tool)
                      setPaletteOpen(false)
                    }}
                    className={`flex items-center gap-2 rounded-xl px-2 py-2 text-left text-xs font-medium ${
                      settings.tool === tool
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <ToolGlyph tool={tool} />
                    {TOOL_LABELS[tool]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <IconButton
          label={TOOL_LABELS.highlighter}
          active={settings.tool === 'highlighter'}
          onClick={() => onToolChange('highlighter')}
        >
          <Highlighter className="h-4 w-4" />
        </IconButton>
        <IconButton
          label={TOOL_LABELS.lasso}
          active={settings.tool === 'lasso'}
          onClick={() => onToolChange('lasso')}
        >
          <Lasso className="h-4 w-4" />
        </IconButton>
        <IconButton
          label={TOOL_LABELS.text}
          active={settings.tool === 'text'}
          onClick={() => onToolChange('text')}
        >
          <Type className="h-4 w-4" />
        </IconButton>
        <IconButton
          label={TOOL_LABELS.eraser}
          active={settings.tool === 'eraser'}
          onClick={() => onToolChange('eraser')}
        >
          <Eraser className="h-4 w-4" />
        </IconButton>
        {onInsertImage && (
          <>
            <IconButton
              label={placingImage ? 'Tap the page to place the image' : 'Insert image'}
              active={placingImage}
              onClick={() => imageInputRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4" />
            </IconButton>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) onInsertImage(file)
              }}
            />
          </>
        )}

        {selectionCount > 0 && (
          <>
            <IconButton
              label="Duplicate selection"
              onClick={() => onDuplicateSelection?.()}
            >
              <Copy className="h-4 w-4" />
            </IconButton>
            <IconButton
              label="Rotate selection 90°"
              onClick={() => onRotateSelection?.()}
            >
              <RotateCw className="h-4 w-4" />
            </IconButton>
            <IconButton
              label="Delete selection"
              onClick={() => onDeleteSelection?.()}
            >
              <Trash2 className="h-4 w-4 text-red-600" />
            </IconButton>
          </>
        )}

        <Divider />

        {showColor && (
          <div className="flex items-center gap-1" role="group" aria-label="Color">
            {colors.map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                aria-label={`Color ${color}`}
                onClick={() => onSettingsChange({ color })}
                className={`h-5 w-5 rounded-full ring-offset-1 transition ${
                  settings.color === color
                    ? 'ring-2 ring-slate-900'
                    : 'ring-1 ring-black/15 hover:scale-110'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
            <label
              className={`relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-full ring-offset-1 ${
                colors.some((c) => c === settings.color)
                  ? 'ring-1 ring-black/20'
                  : 'ring-2 ring-slate-900'
              }`}
              title="Custom color"
            >
              <span
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'conic-gradient(#ef4444, #eab308, #22c55e, #3b82f6, #a855f7, #ef4444)',
                }}
              />
              <span
                className="pointer-events-none absolute inset-[5px] rounded-full ring-1 ring-white/80"
                style={{ backgroundColor: settings.color }}
              />
              <input
                type="color"
                value={toHexColor(settings.color)}
                aria-label="Custom color"
                className="absolute inset-0 cursor-pointer opacity-0"
                onChange={(e) => onSettingsChange({ color: e.target.value })}
              />
            </label>
          </div>
        )}

        {showWidth && (
          <div className="flex items-center gap-1.5 px-0.5" aria-label="Width">
            <span
              className="block rounded-full bg-slate-800"
              style={{
                width: Math.min(16, 3 + settings.width * 0.35),
                height: Math.min(16, 3 + settings.width * 0.35),
              }}
              aria-hidden
            />
            <input
              type="range"
              min={widthRange.min}
              max={widthRange.max}
              step={widthRange.step}
              value={clampWidth(settings.tool, settings.width)}
              aria-label={settings.tool === 'text' ? 'Font size' : 'Stroke width'}
              className="h-5 w-[5.5rem] cursor-pointer accent-slate-900 sm:w-28"
              onChange={(e) =>
                onSettingsChange({
                  width: clampWidth(settings.tool, Number(e.target.value)),
                })
              }
            />
          </div>
        )}

        <Divider />

        <IconButton
          label="Zoom out"
          disabled={zoom <= ZOOM_MIN}
          onClick={() => bumpZoom(-ZOOM_STEP)}
        >
          <ZoomOut className="h-4 w-4" />
        </IconButton>
        <button
          type="button"
          title="Reset zoom"
          aria-label="Reset zoom"
          className="min-w-[2.5rem] rounded-full px-1 py-1 text-[11px] tabular-nums text-slate-600 hover:bg-slate-100"
          onClick={() => onZoomChange(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <IconButton
          label="Zoom in"
          disabled={zoom >= ZOOM_MAX}
          onClick={() => bumpZoom(ZOOM_STEP)}
        >
          <ZoomIn className="h-4 w-4" />
        </IconButton>

        <Divider />

        {onOpenSettings && (
          <IconButton label="Settings" onClick={onOpenSettings}>
            <Settings className="h-4 w-4" />
          </IconButton>
        )}

        <IconButton label="Undo" disabled={!canUndo} onClick={onUndo}>
          <Undo2 className="h-4 w-4" />
        </IconButton>
        <IconButton label="Redo" disabled={!canRedo} onClick={onRedo}>
          <Redo2 className="h-4 w-4" />
        </IconButton>
        <button
          type="button"
          title={
            confirmClear
              ? 'Tap again to clear this page'
              : 'Clear page ink — tap to confirm, hold to clear'
          }
          aria-label={confirmClear ? 'Confirm clear page ink' : 'Clear page ink'}
          className={`inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 ${
            confirmClear
              ? 'bg-red-600 text-white'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            startClearPress()
          }}
          onPointerUp={() => endClearPress(true)}
          onPointerCancel={() => endClearPress(false)}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-1 rounded-full bg-white/95 p-1 shadow-[0_8px_28px_rgba(15,23,42,0.16)] ring-1 ring-black/8">
        {onOpenPages && (
          <span className="sm:hidden">
            <IconButton label="Pages" onClick={onOpenPages}>
              <LayoutList className="h-4 w-4" />
            </IconButton>
          </span>
        )}
        <div className="relative">
          <button
            type="button"
            title="Go to page"
            aria-label="Go to page"
            className="min-w-[3rem] rounded-full px-2 py-1 text-center text-[11px] tabular-nums text-slate-600 hover:bg-slate-100"
            onClick={() => {
              setJumpValue(String(page))
              setJumpOpen((open) => !open)
            }}
          >
            {pageCount > 0 ? `${page}/${pageCount}` : '—'}
          </button>
          {jumpOpen && onJumpPage && (
            <form
              className="absolute right-0 top-full z-40 mt-2 flex w-36 gap-1 rounded-xl bg-white p-2 shadow-[0_16px_40px_rgba(15,23,42,0.18)] ring-1 ring-black/10"
              onSubmit={(e) => {
                e.preventDefault()
                const n = Math.max(
                  1,
                  Math.min(pageCount, Math.floor(Number(jumpValue) || page)),
                )
                onJumpPage(n)
                setJumpOpen(false)
              }}
            >
              <input
                autoFocus
                type="number"
                min={1}
                max={pageCount}
                value={jumpValue}
                onChange={(e) => setJumpValue(e.target.value)}
                className="w-full rounded-lg bg-slate-50 px-2 py-1 text-sm outline-none ring-1 ring-slate-200"
                aria-label="Page number"
              />
              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-2 text-xs text-white"
              >
                Go
              </button>
            </form>
          )}
        </div>
        {onAddPage && (
          <IconButton label="Add page" onClick={onAddPage}>
            <FilePlus className="h-4 w-4" />
          </IconButton>
        )}
        {onToggleBookmark && (
          <IconButton label="Bookmark page" onClick={onToggleBookmark}>
            <Bookmark className="h-4 w-4" />
          </IconButton>
        )}
        {onShareNotebook && (
          <IconButton label="Share notebook" onClick={onShareNotebook}>
            <Share2 className="h-4 w-4" />
          </IconButton>
        )}
        {onToggleRecord && (
          <IconButton
            label={recording ? 'Stop recording' : 'Start recording'}
            active={recording}
            onClick={onToggleRecord}
          >
            {recording ? (
              <MicOff className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </IconButton>
        )}
        {onPlayAudio && (
          <IconButton label="Play audio" onClick={onPlayAudio}>
            <Play className="h-4 w-4" />
          </IconButton>
        )}
        {onHighlightPdfText && (
          <IconButton label="Highlight PDF text" onClick={onHighlightPdfText}>
            <SquareStack className="h-4 w-4" />
          </IconButton>
        )}
        {onPresent && (
          <IconButton label="Presentation mode" onClick={onPresent}>
            <Presentation className="h-4 w-4" />
          </IconButton>
        )}
        {onInsertSticker && (
          <IconButton label="Insert sticker" onClick={onInsertSticker}>
            <Sticker className="h-4 w-4" />
          </IconButton>
        )}
        {onOpenFlashcards && (
          <IconButton label="Flashcards" onClick={onOpenFlashcards}>
            <Maximize2 className="h-4 w-4" />
          </IconButton>
        )}
        <IconButton
          label={exporting ? 'Exporting…' : 'Export annotated PDF'}
          disabled={exporting}
          onClick={onExport}
        >
          <Download className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  )
}

function Divider() {
  return <div className="mx-0.5 hidden h-5 w-px bg-slate-200 sm:block" />
}

function ToolGlyph({ tool }: { tool: DrawTool }) {
  const cls = 'h-4 w-4 shrink-0'
  switch (tool) {
    case 'pencil':
      return <Pencil className={cls} />
    case 'mechanical':
      return <Pen className={cls} />
    case 'fountain':
      return <PenTool className={cls} />
    case 'brush':
      return <Paintbrush className={cls} />
    case 'pastel':
      return <SprayCan className={cls} />
    case 'crayon':
      return <PenLine className={cls} />
    case 'highlighter':
      return <Highlighter className={cls} />
    case 'eraser':
      return <Eraser className={cls} />
    case 'lasso':
      return <Lasso className={cls} />
    case 'text':
      return <Type className={cls} />
    default:
      return <PenLine className={cls} />
  }
}

function IconButton({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full disabled:opacity-35 ${
        active
          ? 'bg-slate-900 text-white'
          : 'text-slate-700 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  )
}
