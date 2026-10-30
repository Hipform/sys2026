import { openDB, type DBSchema } from 'idb'
import type {
  BoardChunkRow,
  DriveSyncRow,
  FlashcardRow,
  Folder,
  NotebookAudioRow,
  NotebookMeta,
  NotebookPdf,
  NotebookRevision,
  NotebookTombstone,
  OcrPageRow,
  PageHistoryRow,
  PageInk,
  TrashedNotebook,
} from '../types/document'
import {
  REVISION_CAP,
  boardChunkKey,
  historyKey,
  inkKey,
} from '../types/document'
import type { PageItem } from '../types/note'
import { isImageBox, isTextBox } from '../types/note'
import { metaPatchDirtiesContent } from './metaContent'
import { clonePageItems } from './pageItems'
import { serialQueueFor } from './serialQueue'

const DB_NAME = 'pdf-notes'
const DB_VERSION = 6
const HISTORY_CAP = 12

interface NotesDB extends DBSchema {
  notebooks: {
    key: string
    value: NotebookMeta
  }
  pdfs: {
    key: string
    value: NotebookPdf
  }
  ink: {
    key: string
    value: PageInk
  }
  folders: {
    key: string
    value: Folder
  }
  sync: {
    key: string
    value: DriveSyncRow
  }
  history: {
    key: string
    value: PageHistoryRow
  }
  tombstones: {
    key: string
    value: NotebookTombstone
  }
  trash: {
    key: string
    value: TrashedNotebook
  }
  revisions: {
    key: string
    value: NotebookRevision
  }
  ocr: {
    key: string
    value: OcrPageRow
  }
  audio: {
    key: string
    value: NotebookAudioRow
  }
  boardChunks: {
    key: string
    value: BoardChunkRow
  }
  flashcards: {
    key: string
    value: FlashcardRow
  }
}

function getDb() {
  return openDB<NotesDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('notebooks')) {
        db.createObjectStore('notebooks', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('pdfs')) {
        db.createObjectStore('pdfs', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('ink')) {
        db.createObjectStore('ink', { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains('folders')) {
        db.createObjectStore('folders', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('sync')) {
        db.createObjectStore('sync', { keyPath: 'notebookId' })
      }
      if (!db.objectStoreNames.contains('history')) {
        db.createObjectStore('history', { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains('tombstones')) {
        db.createObjectStore('tombstones', { keyPath: 'notebookId' })
      }
      if (!db.objectStoreNames.contains('trash')) {
        db.createObjectStore('trash', { keyPath: 'notebookId' })
      }
      if (!db.objectStoreNames.contains('revisions')) {
        db.createObjectStore('revisions', { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains('ocr')) {
        db.createObjectStore('ocr', { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains('audio')) {
        db.createObjectStore('audio', { keyPath: 'notebookId' })
      }
      if (!db.objectStoreNames.contains('boardChunks')) {
        db.createObjectStore('boardChunks', { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains('flashcards')) {
        db.createObjectStore('flashcards', { keyPath: 'id' })
      }
    },
  })
}

export async function listNotebooks(): Promise<NotebookMeta[]> {
  const db = await getDb()
  const all = await db.getAll('notebooks')
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function listFolders(): Promise<Folder[]> {
  const db = await getDb()
  const all = await db.getAll('folders')
  return all.sort((a, b) => a.createdAt - b.createdAt)
}

export async function putFolder(folder: Folder): Promise<void> {
  const db = await getDb()
  await db.put('folders', folder)
}

export async function deleteFolder(id: string): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['folders', 'notebooks'], 'readwrite')
  await tx.objectStore('folders').delete(id)
  let cursor = await tx.objectStore('notebooks').openCursor()
  while (cursor) {
    if (cursor.value.folderId === id) {
      await cursor.update({ ...cursor.value, folderId: null })
    }
    cursor = await cursor.continue()
  }
  await tx.done
}

export async function getNotebook(id: string): Promise<NotebookMeta | undefined> {
  const db = await getDb()
  return db.get('notebooks', id)
}

export async function getPdfData(id: string): Promise<ArrayBuffer | undefined> {
  const db = await getDb()
  const row = await db.get('pdfs', id)
  return row?.data
}

export async function putNotebook(
  meta: NotebookMeta,
  pdfData: ArrayBuffer,
  opts?: { fromRemote?: boolean },
): Promise<void> {
  const db = await getDb()
  const now = Date.now()
  const next: NotebookMeta = {
    ...meta,
    updatedAt: meta.updatedAt || now,
    contentUpdatedAt: meta.contentUpdatedAt ?? now,
  }
  if (!opts?.fromRemote) {
    next.updatedAt = now
    next.contentUpdatedAt = now
  }
  const tx = db.transaction(['notebooks', 'pdfs', 'sync'], 'readwrite')
  await tx.objectStore('notebooks').put(next)
  await tx.objectStore('pdfs').put({ id: meta.id, data: pdfData })
  if (!opts?.fromRemote) {
    const sync = await tx.objectStore('sync').get(meta.id)
    if (sync) {
      await tx.objectStore('sync').put({
        ...sync,
        localDirty: true,
        pdfDirty: true,
      })
    } else {
      await tx.objectStore('sync').put({
        notebookId: meta.id,
        folderId: '',
        pdfFileId: '',
        metaFileId: '',
        inkFileId: '',
        remoteUpdatedAt: 0,
        localDirty: true,
        pdfDirty: true,
      })
    }
  }
  await tx.done
}

/** Soft-delete into trash. PDF/ink stay until purge. */
export async function deleteNotebook(id: string): Promise<void> {
  const db = await getDb()
  const meta = await db.get('notebooks', id)
  if (!meta) return
  const sync = await db.get('sync', id)
  const tx = db.transaction(['notebooks', 'sync', 'trash'], 'readwrite')
  await tx.objectStore('notebooks').delete(id)
  await tx.objectStore('sync').delete(id)
  await tx.objectStore('trash').put({
    notebookId: id,
    meta,
    trashedAt: Date.now(),
    folderId: sync?.folderId ?? '',
  })
  await tx.done
}

export async function listTrashed(): Promise<TrashedNotebook[]> {
  const db = await getDb()
  const all = await db.getAll('trash')
  return all.sort((a, b) => b.trashedAt - a.trashedAt)
}

export async function restoreNotebook(id: string): Promise<boolean> {
  const db = await getDb()
  const row = await db.get('trash', id)
  if (!row) return false
  const audio = await db.get('audio', id)
  const tx = db.transaction(['notebooks', 'sync', 'trash'], 'readwrite')
  await tx.objectStore('notebooks').put({
    ...row.meta,
    updatedAt: Date.now(),
  })
  await tx.objectStore('sync').put({
    notebookId: id,
    folderId: row.folderId,
    pdfFileId: '',
    metaFileId: '',
    inkFileId: '',
    audioFileId: '',
    remoteUpdatedAt: 0,
    localDirty: true,
    pdfDirty: false,
    audioDirty: Boolean(audio),
  })
  await tx.objectStore('trash').delete(id)
  await tx.done
  return true
}

/** Permanently delete local data and queue Drive trash via tombstone. */
export async function purgeNotebook(id: string): Promise<void> {
  const db = await getDb()
  const trashed = await db.get('trash', id)
  const sync = trashed
    ? { folderId: trashed.folderId }
    : await db.get('sync', id)
  const tx = db.transaction(
    [
      'notebooks',
      'pdfs',
      'ink',
      'sync',
      'history',
      'tombstones',
      'trash',
      'ocr',
      'audio',
      'boardChunks',
      'flashcards',
      'revisions',
    ],
    'readwrite',
  )
  await tx.objectStore('notebooks').delete(id)
  await tx.objectStore('pdfs').delete(id)
  await tx.objectStore('sync').delete(id)
  await tx.objectStore('trash').delete(id)
  await tx.objectStore('audio').delete(id)
  await tx.objectStore('tombstones').put({
    notebookId: id,
    folderId: sync?.folderId ?? '',
    deletedAt: Date.now(),
  })
  for (const storeName of [
    'ink',
    'history',
    'ocr',
    'boardChunks',
    'flashcards',
    'revisions',
  ] as const) {
    const store = tx.objectStore(storeName)
    let cursor = await store.openCursor()
    while (cursor) {
      const val = cursor.value as { notebookId?: string }
      if (val.notebookId === id) await cursor.delete()
      cursor = await cursor.continue()
    }
  }
  await tx.done
}

export async function getTombstone(
  notebookId: string,
): Promise<NotebookTombstone | undefined> {
  const db = await getDb()
  return db.get('tombstones', notebookId)
}

export async function listTombstones(): Promise<NotebookTombstone[]> {
  const db = await getDb()
  return db.getAll('tombstones')
}

export async function deleteTombstone(notebookId: string): Promise<void> {
  const db = await getDb()
  await db.delete('tombstones', notebookId)
}

export async function getPageInk(
  notebookId: string,
  pageIndex: number,
): Promise<PageItem[]> {
  const db = await getDb()
  const row = await db.get('ink', inkKey(notebookId, pageIndex))
  return row?.strokes ?? []
}

export async function updateNotebookMeta(
  patch: Partial<NotebookMeta> & { id: string },
): Promise<void> {
  const db = await getDb()
  const current = await db.get('notebooks', patch.id)
  if (!current) return
  const now = Date.now()
  const next = { ...current, ...patch, updatedAt: now }
  const dirtiesContent = metaPatchDirtiesContent(current, patch)
  if (dirtiesContent) {
    next.contentUpdatedAt = now
  }
  const tx = db.transaction(['notebooks', 'sync'], 'readwrite')
  await tx.objectStore('notebooks').put(next)
  if (dirtiesContent) {
    const sync = await tx.objectStore('sync').get(patch.id)
    if (sync) {
      await tx.objectStore('sync').put({ ...sync, localDirty: true })
    } else {
      await tx.objectStore('sync').put({
        notebookId: patch.id,
        folderId: '',
        pdfFileId: '',
        metaFileId: '',
        inkFileId: '',
        remoteUpdatedAt: 0,
        localDirty: true,
        pdfDirty: false,
      })
    }
  }
  await tx.done
}

export async function getAllPageInk(
  notebookId: string,
): Promise<Map<number, PageItem[]>> {
  const db = await getDb()
  const map = new Map<number, PageItem[]>()
  let cursor = await db.transaction('ink').store.openCursor()
  while (cursor) {
    if (cursor.value.notebookId === notebookId) {
      map.set(cursor.value.pageIndex, cursor.value.strokes)
    }
    cursor = await cursor.continue()
  }
  return map
}

export async function savePageInk(
  notebookId: string,
  pageIndex: number,
  strokes: PageItem[],
): Promise<void> {
  try {
    const db = await getDb()
    const now = Date.now()
    const tx = db.transaction(['ink', 'notebooks', 'sync'], 'readwrite')
    await tx.objectStore('ink').put({
      key: inkKey(notebookId, pageIndex),
      notebookId,
      pageIndex,
      strokes,
    })
    const meta = await tx.objectStore('notebooks').get(notebookId)
    if (meta) {
      await tx.objectStore('notebooks').put({
        ...meta,
        updatedAt: now,
        contentUpdatedAt: now,
      })
    }
    const sync = await tx.objectStore('sync').get(notebookId)
    if (sync) {
      await tx.objectStore('sync').put({ ...sync, localDirty: true })
    } else {
      await tx.objectStore('sync').put({
        notebookId,
        folderId: '',
        pdfFileId: '',
        metaFileId: '',
        inkFileId: '',
        remoteUpdatedAt: 0,
        localDirty: true,
        pdfDirty: false,
      })
    }
    await tx.done
  } catch (err) {
    if (isStorageQuotaError(err)) {
      throw Object.assign(new Error('QUOTA'), { name: 'QuotaExceededError' })
    }
    throw err
  }
}

export async function replaceNotebookInk(
  notebookId: string,
  byPage: Map<number, PageItem[]>,
  opts?: { fromRemote?: boolean },
): Promise<void> {
  const db = await getDb()
  const stores = opts?.fromRemote
    ? (['ink'] as const)
    : (['ink', 'sync', 'notebooks'] as const)
  const tx = db.transaction(stores, 'readwrite')
  const store = tx.objectStore('ink')
  let cursor = await store.openCursor()
  while (cursor) {
    if (cursor.value.notebookId === notebookId) {
      await cursor.delete()
    }
    cursor = await cursor.continue()
  }
  for (const [pageIndex, strokes] of byPage) {
    await store.put({
      key: inkKey(notebookId, pageIndex),
      notebookId,
      pageIndex,
      strokes,
    })
  }
  if (!opts?.fromRemote) {
    const now = Date.now()
    const meta = await tx.objectStore('notebooks').get(notebookId)
    if (meta) {
      await tx.objectStore('notebooks').put({
        ...meta,
        updatedAt: now,
        contentUpdatedAt: now,
      })
    }
    const sync = await tx.objectStore('sync').get(notebookId)
    if (sync) {
      await tx.objectStore('sync').put({ ...sync, localDirty: true })
    }
  }
  await tx.done
}

export async function getSyncRow(
  notebookId: string,
): Promise<DriveSyncRow | undefined> {
  const db = await getDb()
  return db.get('sync', notebookId)
}

export async function putSyncRow(row: DriveSyncRow): Promise<void> {
  const db = await getDb()
  await db.put('sync', row)
}

export async function listSyncRows(): Promise<DriveSyncRow[]> {
  const db = await getDb()
  return db.getAll('sync')
}

export async function getPageHistory(
  notebookId: string,
  pageIndex: number,
): Promise<PageHistoryRow | undefined> {
  const db = await getDb()
  return db.get('history', historyKey(notebookId, pageIndex))
}

export async function savePageHistory(
  notebookId: string,
  pageIndex: number,
  undo: PageItem[][],
  redo: PageItem[][],
): Promise<void> {
  await serialQueueFor(`history:${notebookId}`).enqueue(async () => {
    const images: Record<string, string> = {}
    const compactStacks = (stacks: PageItem[][]) =>
      stacks.slice(-HISTORY_CAP).map((stack) => compactSnapshot(stack, images))
    const nextUndo = compactStacks(undo)
    const nextRedo = compactStacks(redo)
    const liveIds = imageIdsInStacks(nextUndo, nextRedo)
    const pruned: Record<string, string> = {}
    for (const id of liveIds) {
      if (images[id]) pruned[id] = images[id]!
    }
    const row: PageHistoryRow = {
      key: historyKey(notebookId, pageIndex),
      notebookId,
      pageIndex,
      images: pruned,
      undo: nextUndo,
      redo: nextRedo,
    }
    const db = await getDb()
    await db.put('history', row)
  })
}

function imageIdsInStacks(
  ...stacks: PageItem[][][]
): Set<string> {
  const ids = new Set<string>()
  for (const stackList of stacks) {
    for (const stack of stackList) {
      for (const item of stack) {
        if (isImageBox(item)) ids.add(item.id)
      }
    }
  }
  return ids
}

export function hydrateHistoryRow(row: PageHistoryRow): {
  undo: PageItem[][]
  redo: PageItem[][]
} {
  return {
    undo: row.undo.map((stack) => hydrateSnapshot(stack, row.images)),
    redo: row.redo.map((stack) => hydrateSnapshot(stack, row.images)),
  }
}

export async function remapNotebookHistory(
  notebookId: string,
  mapPage: (oldPage: number) => number | null,
): Promise<void> {
  await serialQueueFor(`history:${notebookId}`).enqueue(async () => {
    const db = await getDb()
    const tx = db.transaction('history', 'readwrite')
    const store = tx.objectStore('history')
    const kept: PageHistoryRow[] = []
    let cursor = await store.openCursor()
    while (cursor) {
      if (cursor.value.notebookId === notebookId) {
        const nextPage = mapPage(cursor.value.pageIndex)
        if (nextPage !== null) {
          kept.push({
            ...cursor.value,
            pageIndex: nextPage,
            key: historyKey(notebookId, nextPage),
          })
        }
        await cursor.delete()
      }
      cursor = await cursor.continue()
    }
    for (const row of kept) {
      await store.put(row)
    }
    await tx.done
  })
}

export async function clearNotebookHistory(notebookId: string): Promise<void> {
  await serialQueueFor(`history:${notebookId}`).enqueue(async () => {
    const db = await getDb()
    const tx = db.transaction('history', 'readwrite')
    const store = tx.objectStore('history')
    let cursor = await store.openCursor()
    while (cursor) {
      if (cursor.value.notebookId === notebookId) {
        await cursor.delete()
      }
      cursor = await cursor.continue()
    }
    await tx.done
  })
}

function compactSnapshot(
  items: PageItem[],
  images: Record<string, string>,
): PageItem[] {
  return clonePageItems(items).map((item) => {
    if (!isImageBox(item)) return item
    if (item.dataUrl) images[item.id] = item.dataUrl
    return { ...item, dataUrl: '' }
  })
}

function hydrateSnapshot(
  items: PageItem[],
  images: Record<string, string>,
): PageItem[] {
  return clonePageItems(items).map((item) => {
    if (!isImageBox(item)) return item
    return { ...item, dataUrl: item.dataUrl || images[item.id] || '' }
  })
}

export async function saveRevision(
  notebookId: string,
  reason: NotebookRevision['reason'],
): Promise<void> {
  const meta = await getNotebook(notebookId)
  if (!meta) return
  const ink = await getAllPageInk(notebookId)
  const inkByPage = [...ink.entries()].map(([pageIndex, strokes]) => ({
    pageIndex,
    strokes,
  }))
  const savedAt = Date.now()
  const row: NotebookRevision = {
    key: `${notebookId}:${savedAt}`,
    notebookId,
    savedAt,
    meta: { ...meta },
    inkByPage,
    reason,
  }
  const db = await getDb()
  const existing = (await db.getAll('revisions')).filter(
    (r) => r.notebookId === notebookId,
  )
  existing.sort((a, b) => a.savedAt - b.savedAt)
  const tx = db.transaction('revisions', 'readwrite')
  while (existing.length >= REVISION_CAP) {
    const oldest = existing.shift()
    if (oldest) await tx.store.delete(oldest.key)
  }
  await tx.store.put(row)
  await tx.done
}

export async function listRevisions(
  notebookId: string,
): Promise<NotebookRevision[]> {
  const db = await getDb()
  const all = await db.getAll('revisions')
  return all
    .filter((r) => r.notebookId === notebookId)
    .sort((a, b) => b.savedAt - a.savedAt)
}

export async function restoreRevision(key: string): Promise<boolean> {
  const db = await getDb()
  const rev = await db.get('revisions', key)
  if (!rev) return false
  const pdf = await getPdfData(rev.notebookId)
  if (!pdf) return false
  const byPage = new Map<number, PageItem[]>()
  for (const row of rev.inkByPage) byPage.set(row.pageIndex, row.strokes)
  await putNotebook({ ...rev.meta, updatedAt: Date.now() }, pdf)
  await replaceNotebookInk(rev.notebookId, byPage)
  return true
}

export async function putOcrPage(row: OcrPageRow): Promise<void> {
  const db = await getDb()
  await db.put('ocr', row)
}

export async function getOcrPage(
  notebookId: string,
  pageIndex: number,
): Promise<OcrPageRow | undefined> {
  const db = await getDb()
  return db.get('ocr', inkKey(notebookId, pageIndex))
}

export async function listOcrForNotebook(
  notebookId: string,
): Promise<OcrPageRow[]> {
  const db = await getDb()
  const all = await db.getAll('ocr')
  return all.filter((r) => r.notebookId === notebookId)
}

export async function searchNotebookText(
  query: string,
): Promise<{ notebookId: string; pageIndex: number; snippet: string }[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: { notebookId: string; pageIndex: number; snippet: string }[] = []
  const notebooks = await listNotebooks()
  for (const nb of notebooks) {
    if (nb.title.toLowerCase().includes(q)) {
      hits.push({
        notebookId: nb.id,
        pageIndex: nb.lastPage ?? 1,
        snippet: nb.title,
      })
    }
  }
  const ocrRows = await (await getDb()).getAll('ocr')
  for (const row of ocrRows) {
    if (!row.text.toLowerCase().includes(q)) continue
    const idx = row.text.toLowerCase().indexOf(q)
    hits.push({
      notebookId: row.notebookId,
      pageIndex: row.pageIndex,
      snippet: row.text.slice(Math.max(0, idx - 40), idx + q.length + 40),
    })
  }
  for (const nb of notebooks) {
    const ink = await getAllPageInk(nb.id)
    for (const [pageIndex, strokes] of ink) {
      const text = strokes
        .filter(isTextBox)
        .map((t) => t.text)
        .join('\n')
      if (!text.toLowerCase().includes(q)) continue
      hits.push({ notebookId: nb.id, pageIndex, snippet: text.slice(0, 80) })
    }
  }
  return hits
}

export async function putNotebookAudio(row: NotebookAudioRow): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['audio', 'sync'], 'readwrite')
  await tx.objectStore('audio').put(row)
  const sync = await tx.objectStore('sync').get(row.notebookId)
  if (sync) {
    await tx.objectStore('sync').put({ ...sync, audioDirty: true, localDirty: true })
  } else {
    await tx.objectStore('sync').put({
      notebookId: row.notebookId,
      folderId: '',
      pdfFileId: '',
      metaFileId: '',
      inkFileId: '',
      remoteUpdatedAt: 0,
      localDirty: true,
      pdfDirty: false,
      audioDirty: true,
    })
  }
  await tx.done
}

export async function getNotebookAudio(
  notebookId: string,
): Promise<NotebookAudioRow | undefined> {
  const db = await getDb()
  return db.get('audio', notebookId)
}

export async function deleteNotebookAudio(notebookId: string): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['audio', 'sync'], 'readwrite')
  await tx.objectStore('audio').delete(notebookId)
  const sync = await tx.objectStore('sync').get(notebookId)
  if (sync) {
    await tx.objectStore('sync').put({
      ...sync,
      audioDirty: true,
      localDirty: true,
    })
  } else {
    await tx.objectStore('sync').put({
      notebookId,
      folderId: '',
      pdfFileId: '',
      metaFileId: '',
      inkFileId: '',
      remoteUpdatedAt: 0,
      localDirty: true,
      pdfDirty: false,
      audioDirty: true,
    })
  }
  await tx.done
}

export async function putBoardChunk(row: BoardChunkRow): Promise<void> {
  const db = await getDb()
  const now = Date.now()
  const tx = db.transaction(['boardChunks', 'notebooks', 'sync'], 'readwrite')
  await tx.objectStore('boardChunks').put({
    ...row,
    key: boardChunkKey(row.notebookId, row.cx, row.cy),
  })
  const meta = await tx.objectStore('notebooks').get(row.notebookId)
  if (meta) {
    await tx.objectStore('notebooks').put({
      ...meta,
      updatedAt: now,
      contentUpdatedAt: now,
    })
  }
  const sync = await tx.objectStore('sync').get(row.notebookId)
  if (sync) {
    await tx.objectStore('sync').put({ ...sync, localDirty: true })
  } else {
    await tx.objectStore('sync').put({
      notebookId: row.notebookId,
      folderId: '',
      pdfFileId: '',
      metaFileId: '',
      inkFileId: '',
      remoteUpdatedAt: 0,
      localDirty: true,
      pdfDirty: false,
    })
  }
  await tx.done
}

export async function listBoardChunks(
  notebookId: string,
): Promise<BoardChunkRow[]> {
  const db = await getDb()
  const all = await db.getAll('boardChunks')
  return all.filter((r) => r.notebookId === notebookId)
}

export async function replaceBoardChunks(
  notebookId: string,
  chunks: BoardChunkRow[],
  opts?: { fromRemote?: boolean },
): Promise<void> {
  const db = await getDb()
  const stores = opts?.fromRemote
    ? (['boardChunks'] as const)
    : (['boardChunks', 'sync', 'notebooks'] as const)
  const tx = db.transaction(stores, 'readwrite')
  const store = tx.objectStore('boardChunks')
  let cursor = await store.openCursor()
  while (cursor) {
    if (cursor.value.notebookId === notebookId) await cursor.delete()
    cursor = await cursor.continue()
  }
  for (const chunk of chunks) {
    await store.put({
      ...chunk,
      notebookId,
      key: boardChunkKey(notebookId, chunk.cx, chunk.cy),
    })
  }
  if (!opts?.fromRemote) {
    const now = Date.now()
    const meta = await tx.objectStore('notebooks').get(notebookId)
    if (meta) {
      await tx.objectStore('notebooks').put({
        ...meta,
        updatedAt: now,
        contentUpdatedAt: now,
      })
    }
    const sync = await tx.objectStore('sync').get(notebookId)
    if (sync) {
      await tx.objectStore('sync').put({ ...sync, localDirty: true })
    }
  }
  await tx.done
}

async function markNotebookLocalDirty(notebookId: string): Promise<void> {
  const db = await getDb()
  const now = Date.now()
  const tx = db.transaction(['notebooks', 'sync'], 'readwrite')
  const meta = await tx.objectStore('notebooks').get(notebookId)
  if (meta) {
    await tx.objectStore('notebooks').put({
      ...meta,
      updatedAt: now,
      contentUpdatedAt: now,
    })
  }
  const sync = await tx.objectStore('sync').get(notebookId)
  if (sync) {
    await tx.objectStore('sync').put({ ...sync, localDirty: true })
  } else {
    await tx.objectStore('sync').put({
      notebookId,
      folderId: '',
      pdfFileId: '',
      metaFileId: '',
      inkFileId: '',
      remoteUpdatedAt: 0,
      localDirty: true,
      pdfDirty: false,
    })
  }
  await tx.done
}

export async function putFlashcard(row: FlashcardRow): Promise<void> {
  const db = await getDb()
  await db.put('flashcards', row)
  await markNotebookLocalDirty(row.notebookId)
}

export async function listFlashcards(
  notebookId: string,
): Promise<FlashcardRow[]> {
  const db = await getDb()
  const all = await db.getAll('flashcards')
  return all
    .filter((r) => r.notebookId === notebookId)
    .sort((a, b) => a.createdAt - b.createdAt)
}

export async function deleteFlashcard(id: string): Promise<void> {
  const db = await getDb()
  const existing = await db.get('flashcards', id)
  await db.delete('flashcards', id)
  if (existing) await markNotebookLocalDirty(existing.notebookId)
}

export async function replaceFlashcards(
  notebookId: string,
  cards: FlashcardRow[],
  opts?: { fromRemote?: boolean },
): Promise<void> {
  const db = await getDb()
  const stores = opts?.fromRemote
    ? (['flashcards'] as const)
    : (['flashcards', 'sync', 'notebooks'] as const)
  const tx = db.transaction(stores, 'readwrite')
  const store = tx.objectStore('flashcards')
  let cursor = await store.openCursor()
  while (cursor) {
    if (cursor.value.notebookId === notebookId) await cursor.delete()
    cursor = await cursor.continue()
  }
  for (const card of cards) {
    await store.put({ ...card, notebookId })
  }
  if (!opts?.fromRemote) {
    const now = Date.now()
    const meta = await tx.objectStore('notebooks').get(notebookId)
    if (meta) {
      await tx.objectStore('notebooks').put({
        ...meta,
        updatedAt: now,
        contentUpdatedAt: now,
      })
    }
    const sync = await tx.objectStore('sync').get(notebookId)
    if (sync) {
      await tx.objectStore('sync').put({ ...sync, localDirty: true })
    }
  }
  await tx.done
}

export function isStorageQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = 'name' in err ? String((err as { name: unknown }).name) : ''
  const message =
    'message' in err ? String((err as { message: unknown }).message) : ''
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    message === 'QUOTA' ||
    /quota/i.test(message)
  )
}

export function newNotebookId(): string {
  return crypto.randomUUID()
}

export function newFolderId(): string {
  return crypto.randomUUID()
}

export { HISTORY_CAP }
