export type DrawTool =
  | 'pen'
  | 'pencil'
  | 'mechanical'
  | 'fountain'
  | 'brush'
  | 'pastel'
  | 'crayon'
  | 'highlighter'
  | 'eraser'
  | 'lasso'
  | 'text'

export type PaperTemplate = 'blank' | 'lined' | 'grid' | 'dotted'

export const INK_TOOLS = [
  'pen',
  'pencil',
  'mechanical',
  'fountain',
  'brush',
  'pastel',
  'crayon',
] as const satisfies readonly DrawTool[]

export const TOOL_LABELS: Record<DrawTool, string> = {
  pen: 'Ballpoint',
  pencil: 'Pencil',
  mechanical: 'Mechanical',
  fountain: 'Fountain',
  brush: 'Brush',
  pastel: 'Pastel',
  crayon: 'Crayon',
  highlighter: 'Highlighter',
  eraser: 'Eraser',
  lasso: 'Lasso',
  text: 'Text',
}

/** Single pointer sample in page (unzoomed CSS) coordinates. */
export interface PointerPoint {
  x: number
  y: number
  /** Normalized pressure in [0, 1]; fallback 0.5 when unsupported. */
  pressure: number
  timestamp: number
  pointerType: string
  tiltX?: number
  tiltY?: number
}

export interface Stroke {
  id: string
  tool: DrawTool
  color: string
  /** Base stroke width in page CSS pixels (before pressure scaling). */
  width: number
  points: PointerPoint[]
  layerId?: string
}

export interface TextBox {
  id: string
  type: 'text'
  x: number
  y: number
  width: number
  height: number
  text: string
  color: string
  fontSize: number
  layerId?: string
}

export interface ImageBox {
  id: string
  type: 'image'
  x: number
  y: number
  width: number
  height: number
  dataUrl: string
  layerId?: string
  kind?: 'image' | 'sticker'
}

/** Highlight/underline over PDF source text (page CSS coords). */
export interface PdfMarkup {
  id: string
  type: 'pdf-markup'
  mode: 'highlight' | 'underline'
  color: string
  rects: { x: number; y: number; width: number; height: number }[]
  text?: string
  layerId?: string
}

export type PageItem = Stroke | TextBox | ImageBox | PdfMarkup

export function isTextBox(item: PageItem): item is TextBox {
  return 'type' in item && item.type === 'text'
}

export function isImageBox(item: PageItem): item is ImageBox {
  return 'type' in item && item.type === 'image'
}

export function isPdfMarkup(item: PageItem): item is PdfMarkup {
  return 'type' in item && item.type === 'pdf-markup'
}

export function isStroke(item: PageItem): item is Stroke {
  return !isTextBox(item) && !isImageBox(item) && !isPdfMarkup(item)
}

export interface DrawSettings {
  tool: DrawTool
  color: string
  width: number
}

export interface ToolPreset {
  color: string
  width: number
}

export interface PageInfo {
  width: number
  height: number
  pageCount: number
}

export const PEN_COLORS = [
  '#1e293b',
  '#dc2626',
  '#2563eb',
  '#16a34a',
  '#ea580c',
] as const

export const HIGHLIGHTER_COLORS = [
  '#facc15',
  '#4ade80',
  '#fb7185',
  '#38bdf8',
  '#c084fc',
] as const

export const PEN_WIDTHS = [2, 4, 8] as const
export const HIGHLIGHTER_WIDTHS = [12, 18, 24] as const

export const PEN_WIDTH_RANGE = { min: 0.5, max: 40, step: 0.5 } as const
export const MECHANICAL_WIDTH_RANGE = { min: 0.3, max: 8, step: 0.1 } as const
export const BRUSH_WIDTH_RANGE = { min: 2, max: 64, step: 0.5 } as const
export const HIGHLIGHTER_WIDTH_RANGE = { min: 4, max: 72, step: 0.5 } as const
export const ERASER_WIDTH_RANGE = { min: 2, max: 80, step: 0.5 } as const

export const DEFAULT_TOOL_PRESETS: Record<DrawTool, ToolPreset> = {
  pen: { color: '#1e293b', width: 4 },
  pencil: { color: '#5b6570', width: 3 },
  mechanical: { color: '#5b6570', width: 1 },
  fountain: { color: '#1e3a5f', width: 3.5 },
  brush: { color: '#1e293b', width: 10 },
  pastel: { color: '#f9a8d4', width: 14 },
  crayon: { color: '#ea580c', width: 12 },
  highlighter: { color: '#facc15', width: 18 },
  eraser: { color: '#1e293b', width: 16 },
  lasso: { color: '#2563eb', width: 1 },
  text: { color: '#1e293b', width: 18 },
}

export const DEFAULT_DRAW_SETTINGS: DrawSettings = {
  tool: 'pen',
  ...DEFAULT_TOOL_PRESETS.pen,
}

export const DEFAULT_HIGHLIGHTER: DrawSettings = {
  tool: 'highlighter',
  ...DEFAULT_TOOL_PRESETS.highlighter,
}

export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2.5
export const ZOOM_STEP = 0.25

export function isInkTool(tool: DrawTool): boolean {
  return (
    tool !== 'highlighter' &&
    tool !== 'eraser' &&
    tool !== 'lasso' &&
    tool !== 'text'
  )
}

export function isDrawingTool(tool: DrawTool): boolean {
  return tool !== 'lasso' && tool !== 'text'
}

export function colorsForTool(tool: DrawTool): readonly string[] {
  return tool === 'highlighter' ? HIGHLIGHTER_COLORS : PEN_COLORS
}

export function widthsForTool(tool: DrawTool): readonly number[] {
  return tool === 'highlighter' ? HIGHLIGHTER_WIDTHS : PEN_WIDTHS
}

export function widthRangeForTool(tool: DrawTool): {
  min: number
  max: number
  step: number
} {
  if (tool === 'text') return { min: 12, max: 48, step: 1 }
  if (tool === 'highlighter' || tool === 'pastel' || tool === 'crayon') {
    return HIGHLIGHTER_WIDTH_RANGE
  }
  if (tool === 'eraser') return ERASER_WIDTH_RANGE
  if (tool === 'mechanical') return MECHANICAL_WIDTH_RANGE
  if (tool === 'brush') return BRUSH_WIDTH_RANGE
  return PEN_WIDTH_RANGE
}

export function clampWidth(tool: DrawTool, width: number): number {
  const { min, max } = widthRangeForTool(tool)
  if (!Number.isFinite(width)) return min
  return Math.min(max, Math.max(min, width))
}

export function cloneToolPresets(): Record<DrawTool, ToolPreset> {
  return {
    pen: { ...DEFAULT_TOOL_PRESETS.pen },
    pencil: { ...DEFAULT_TOOL_PRESETS.pencil },
    mechanical: { ...DEFAULT_TOOL_PRESETS.mechanical },
    fountain: { ...DEFAULT_TOOL_PRESETS.fountain },
    brush: { ...DEFAULT_TOOL_PRESETS.brush },
    pastel: { ...DEFAULT_TOOL_PRESETS.pastel },
    crayon: { ...DEFAULT_TOOL_PRESETS.crayon },
    highlighter: { ...DEFAULT_TOOL_PRESETS.highlighter },
    eraser: { ...DEFAULT_TOOL_PRESETS.eraser },
    lasso: { ...DEFAULT_TOOL_PRESETS.lasso },
    text: { ...DEFAULT_TOOL_PRESETS.text },
  }
}

/** `input type="color"` needs #rrggbb. */
export function toHexColor(color: string, fallback = '#1e293b'): string {
  const value = color.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(value)) return value
  if (/^#[0-9a-f]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
  }
  return fallback
}
