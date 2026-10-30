import type { PageItem, PaperTemplate } from './note'

export interface Folder {
  id: string
  name: string
  createdAt: number
}

export type NotebookKind = 'pdf' | 'board'

export interface NotebookBookmark {
  page: number
  label: string
}

export interface NotebookMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  pageCount: number
  /** Library thumb only; must not move contentUpdatedAt. */
  coverDataUrl: string | null
  lastPage?: number
  folderId?: string | null
  paperTemplate?: PaperTemplate
  /** Drive LWW clock for title/folder/ink/pdf, not cover chrome. */
  contentUpdatedAt?: number
  kind?: NotebookKind
  bookmarks?: NotebookBookmark[]
  tags?: string[]
  favorite?: boolean
  sortOrder?: number
  /** Session lock gate; not full encryption. */
  pinHash?: string | null
  paperLineGap?: number
  paperMargin?: number
}

export interface NotebookPdf {
  id: string
  data: ArrayBuffer
}

export interface PageInk {
  key: string
  notebookId: string
  pageIndex: number
  /** Strokes, text boxes, and images. */
  strokes: PageItem[]
}

export function inkKey(notebookId: string, pageIndex: number): string {
  return `${notebookId}:${pageIndex}`
}

export function historyKey(notebookId: string, pageIndex: number): string {
  return `${notebookId}:${pageIndex}`
}

export function boardChunkKey(
  notebookId: string,
  cx: number,
  cy: number,
): string {
  return `${notebookId}:${cx}:${cy}`
}

export interface DriveSyncRow {
  notebookId: string
  folderId: string
  pdfFileId: string
  metaFileId: string
  inkFileId: string
  audioFileId?: string
  remoteUpdatedAt: number
  localDirty: boolean
  pdfDirty: boolean
  audioDirty?: boolean
}

/** Local delete while Drive still has a copy. Sync trashes remote, then drops this. */
export interface NotebookTombstone {
  notebookId: string
  folderId: string
  deletedAt: number
}

/** Soft-deleted notebook kept for restore. */
export interface TrashedNotebook {
  notebookId: string
  meta: NotebookMeta
  trashedAt: number
  folderId: string
}

export interface NotebookRevision {
  key: string
  notebookId: string
  savedAt: number
  meta: NotebookMeta
  inkByPage: { pageIndex: number; strokes: PageItem[] }[]
  reason: 'lww-overwrite' | 'manual'
}

export interface PageHistoryRow {
  key: string
  notebookId: string
  pageIndex: number
  /** Image bitmaps keyed by item id, shared across snapshots. */
  images: Record<string, string>
  undo: PageItem[][]
  redo: PageItem[][]
}

export interface OcrPageRow {
  key: string
  notebookId: string
  pageIndex: number
  text: string
  updatedAt: number
  source: 'pdf-text' | 'ink-text' | 'ocr'
}

export interface AudioCue {
  tMs: number
  pageIndex: number
  strokeId?: string
}

export interface NotebookAudioRow {
  notebookId: string
  mime: string
  data: ArrayBuffer
  cues: AudioCue[]
  updatedAt: number
}

export interface BoardChunkRow {
  key: string
  notebookId: string
  cx: number
  cy: number
  strokes: PageItem[]
}

export interface FlashcardRow {
  id: string
  notebookId: string
  pageIndex: number
  front: string
  back: string
  createdAt: number
}

export const REVISION_CAP = 10
