import type {
  BoardChunkRow,
  FlashcardRow,
  NotebookMeta,
} from '../types/document'
import type { PageItem } from '../types/note'
import {
  getAllPageInk,
  getNotebook,
  getNotebookAudio,
  getPdfData,
  listBoardChunks,
  listFlashcards,
  newNotebookId,
  putNotebook,
  putNotebookAudio,
  putFlashcard,
  replaceBoardChunks,
  replaceNotebookInk,
} from './db'
import { bufferToBase64, base64ToBuffer } from './backupCodec'

export const SHARE_FORMAT = 'pdf-notes-notebook'
export const SHARE_VERSION = 1

export interface SharedNotebook {
  format: typeof SHARE_FORMAT
  version: number
  exportedAt: number
  meta: NotebookMeta
  pdfBase64: string
  ink: { pageIndex: number; strokes: PageItem[] }[]
  boardChunks?: BoardChunkRow[]
  flashcards?: FlashcardRow[]
  audioBase64?: string
  audioMime?: string
  audioCues?: { tMs: number; pageIndex: number; strokeId?: string }[]
}

export async function buildSharedNotebook(
  notebookId: string,
): Promise<SharedNotebook> {
  const meta = await getNotebook(notebookId)
  const pdf = await getPdfData(notebookId)
  if (!meta || !pdf) throw new Error('Notebook not found.')
  const inkMap = await getAllPageInk(notebookId)
  const ink: SharedNotebook['ink'] = []
  for (const [pageIndex, strokes] of inkMap) {
    ink.push({ pageIndex, strokes })
  }
  const boardChunks = await listBoardChunks(notebookId)
  const flashcards = await listFlashcards(notebookId)
  const audio = await getNotebookAudio(notebookId)
  const payload: SharedNotebook = {
    format: SHARE_FORMAT,
    version: SHARE_VERSION,
    exportedAt: Date.now(),
    meta,
    pdfBase64: bufferToBase64(pdf),
    ink,
    boardChunks,
    flashcards,
  }
  if (audio) {
    payload.audioBase64 = bufferToBase64(audio.data)
    payload.audioMime = audio.mime
    payload.audioCues = audio.cues
  }
  return payload
}

export async function downloadSharedNotebook(notebookId: string): Promise<void> {
  const payload = await buildSharedNotebook(notebookId)
  const blob = new Blob([JSON.stringify(payload)], {
    type: 'application/json',
  })
  const safe = (payload.meta.title || 'notebook').replace(/[^\w\-]+/g, '_')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safe}.pdfnotes.json`
  a.click()
  URL.revokeObjectURL(url)
}

export async function importSharedNotebook(file: File): Promise<string> {
  const parsed = JSON.parse(await file.text()) as SharedNotebook
  if (!parsed || parsed.format !== SHARE_FORMAT) {
    throw new Error('This file is not a shared notebook package.')
  }
  const id = newNotebookId()
  const pdf = base64ToBuffer(parsed.pdfBase64)
  const meta: NotebookMeta = {
    ...parsed.meta,
    id,
    folderId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    contentUpdatedAt: Date.now(),
  }
  await putNotebook(meta, pdf)
  const byPage = new Map<number, PageItem[]>()
  for (const row of parsed.ink ?? []) {
    byPage.set(row.pageIndex, row.strokes ?? [])
  }
  await replaceNotebookInk(id, byPage)
  if (parsed.boardChunks?.length) {
    await replaceBoardChunks(
      id,
      parsed.boardChunks.map((c) => ({ ...c, notebookId: id })),
    )
  }
  for (const card of parsed.flashcards ?? []) {
    await putFlashcard({
      ...card,
      id: crypto.randomUUID(),
      notebookId: id,
    })
  }
  if (parsed.audioBase64) {
    await putNotebookAudio({
      notebookId: id,
      mime: parsed.audioMime || 'audio/webm',
      data: base64ToBuffer(parsed.audioBase64),
      cues: parsed.audioCues ?? [],
      updatedAt: Date.now(),
    })
  }
  return id
}
