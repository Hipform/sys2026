import type {
  BoardChunkRow,
  FlashcardRow,
  Folder,
  NotebookMeta,
} from '../types/document'
import type { PageItem } from '../types/note'
import {
  getAllPageInk,
  getNotebookAudio,
  getPdfData,
  listBoardChunks,
  listFlashcards,
  listFolders,
  listNotebooks,
  newFolderId,
  newNotebookId,
  putFlashcard,
  putFolder,
  putNotebook,
  putNotebookAudio,
  replaceBoardChunks,
  replaceNotebookInk,
} from './db'
import { base64ToBuffer, bufferToBase64 } from './backupCodec'

export const BACKUP_FORMAT = 'pdf-notes-backup'
export const BACKUP_VERSION = 1

interface BackupNotebook {
  meta: NotebookMeta
  pdfBase64: string
  ink: { pageIndex: number; strokes: PageItem[] }[]
  boardChunks?: BoardChunkRow[]
  flashcards?: FlashcardRow[]
  audioBase64?: string
  audioMime?: string
  audioCues?: { tMs: number; pageIndex: number; strokeId?: string }[]
}

export interface NotesBackup {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: number
  folders: Folder[]
  notebooks: BackupNotebook[]
}

export async function buildBackup(): Promise<NotesBackup> {
  const [folders, notebooks] = await Promise.all([
    listFolders(),
    listNotebooks(),
  ])
  const packed: BackupNotebook[] = []
  for (const meta of notebooks) {
    const pdf = await getPdfData(meta.id)
    if (!pdf) continue
    const inkMap = await getAllPageInk(meta.id)
    const ink: BackupNotebook['ink'] = []
    for (const [pageIndex, strokes] of inkMap) {
      ink.push({ pageIndex, strokes })
    }
    const boardChunks = await listBoardChunks(meta.id)
    const flashcards = await listFlashcards(meta.id)
    const audio = await getNotebookAudio(meta.id)
    const row: BackupNotebook = {
      meta,
      pdfBase64: bufferToBase64(pdf),
      ink,
      boardChunks,
      flashcards,
    }
    if (audio) {
      row.audioBase64 = bufferToBase64(audio.data)
      row.audioMime = audio.mime
      row.audioCues = audio.cues
    }
    packed.push(row)
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    folders,
    notebooks: packed,
  }
}

export async function downloadBackup(): Promise<void> {
  const payload = await buildBackup()
  const blob = new Blob([JSON.stringify(payload)], {
    type: 'application/json',
  })
  const stamp = new Date().toISOString().slice(0, 10)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `pdf-notes-backup-${stamp}.json`
  a.click()
  URL.revokeObjectURL(url)
  markLastBackupNow()
}

const LAST_BACKUP_KEY = 'pdf-notes-last-backup'

export function getLastBackupAt(): number | null {
  try {
    const raw = localStorage.getItem(LAST_BACKUP_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export function markLastBackupNow(): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
}

export async function importBackupFile(file: File): Promise<number> {
  const parsed = JSON.parse(await file.text()) as NotesBackup
  if (!parsed || parsed.format !== BACKUP_FORMAT) {
    throw new Error('This file is not a notes backup.')
  }
  const folderMap = new Map<string, string>()
  for (const folder of parsed.folders ?? []) {
    const id = newFolderId()
    folderMap.set(folder.id, id)
    await putFolder({
      id,
      name: folder.name,
      createdAt: folder.createdAt ?? Date.now(),
    })
  }

  let imported = 0
  for (const row of parsed.notebooks ?? []) {
    const id = newNotebookId()
    const folderId = row.meta.folderId
      ? (folderMap.get(row.meta.folderId) ?? null)
      : null
    const pdf = base64ToBuffer(row.pdfBase64)
    const meta: NotebookMeta = {
      ...row.meta,
      id,
      folderId,
    }
    await putNotebook(meta, pdf)
    const ink = new Map<number, PageItem[]>()
    for (const page of row.ink ?? []) {
      ink.set(page.pageIndex, page.strokes ?? [])
    }
    if (ink.size > 0) {
      await replaceNotebookInk(id, ink)
    }
    if (row.boardChunks?.length) {
      await replaceBoardChunks(
        id,
        row.boardChunks.map((c) => ({ ...c, notebookId: id })),
      )
    }
    for (const card of row.flashcards ?? []) {
      await putFlashcard({
        ...card,
        id: crypto.randomUUID(),
        notebookId: id,
      })
    }
    if (row.audioBase64) {
      await putNotebookAudio({
        notebookId: id,
        mime: row.audioMime || 'audio/webm',
        data: base64ToBuffer(row.audioBase64),
        cues: row.audioCues ?? [],
        updatedAt: Date.now(),
      })
    }
    imported += 1
  }
  return imported
}

export function isNotesBackupName(name: string): boolean {
  return name.toLowerCase().endsWith('.json')
}
