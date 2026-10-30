import type {
  BoardChunkRow,
  DriveSyncRow,
  FlashcardRow,
  NotebookMeta,
} from '../types/document'
import type { PageItem } from '../types/note'
import {
  clearNotebookHistory,
  deleteTombstone,
  getAllPageInk,
  getNotebook,
  getNotebookAudio,
  getPdfData,
  getSyncRow,
  getTombstone,
  listBoardChunks,
  listFlashcards,
  listNotebooks,
  listSyncRows,
  listTombstones,
  listTrashed,
  putNotebook,
  putNotebookAudio,
  putSyncRow,
  replaceBoardChunks,
  replaceFlashcards,
  replaceNotebookInk,
  saveRevision,
} from './db'
import {
  downloadBytes,
  downloadJson,
  ensureNotebookFolder,
  ensureRootFolder,
  isDriveTokenLive,
  listChildren,
  listRemoteNotebooks,
  renameFolder,
  trashDriveFile,
  uploadBytesFile,
  uploadJsonFile,
  uploadPdfFile,
  wasDriveConnected,
} from './drive'
import { tombstoneAction } from './tombstonePolicy'

const LAST_SYNC_KEY = 'pdf-notes-last-sync'

/** One Drive sync at a time (library + visibility + Settings share writers). */
let syncChain: Promise<void> = Promise.resolve()

export function getLastSyncAt(): number | null {
  try {
    const raw = localStorage.getItem(LAST_SYNC_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export function markLastSyncNow(): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
}

function contentTime(meta: NotebookMeta): number {
  return meta.contentUpdatedAt ?? meta.updatedAt
}

/** Pure LWW choice once both clocks are known. */
export function decideSyncAction(opts: {
  localTime: number
  remoteContentTime: number
  localDirty: boolean
}): 'push' | 'pull' | 'skip' {
  if (opts.localDirty && opts.localTime >= opts.remoteContentTime) return 'push'
  if (opts.remoteContentTime > opts.localTime) return 'pull'
  return 'skip'
}

/** Soft-deleted and tombstoned ids must not pull/push (no resurrection). */
export function driveSyncSkipsNotebook(opts: {
  tombstoned: boolean
  trashed: boolean
}): boolean {
  return opts.tombstoned || opts.trashed
}

/** Board dirty-set keys: add and delete must use this format only. */
export function boardDirtyKey(cx: number, cy: number): string {
  return `${cx},${cy}`
}

function inkPayload(ink: Map<number, PageItem[]>) {
  return [...ink.entries()].map(([pageIndex, strokes]) => ({
    pageIndex,
    strokes,
  }))
}

async function pushOne(
  meta: NotebookMeta,
  rootId: string,
  skipActiveId?: string | null,
): Promise<boolean> {
  if (skipActiveId && meta.id === skipActiveId) return false
  const pdf = await getPdfData(meta.id)
  if (!pdf) return false
  const ink = await getAllPageInk(meta.id)
  const prev = (await getSyncRow(meta.id)) ?? emptySync(meta.id)
  const folderId = await ensureNotebookFolder(
    rootId,
    meta.id,
    meta.title,
    prev.folderId || undefined,
  )
  if (prev.folderId && prev.folderId === folderId) {
    try {
      await renameFolder(folderId, meta.title)
    } catch {
      /* ignore */
    }
  }
  const children = await listChildren(folderId)
  const find = (name: string) => children.find((f) => f.name === name)?.id
  const metaFileId = await uploadJsonFile(
    'meta.json',
    meta,
    folderId,
    prev.metaFileId || find('meta.json'),
    meta.id,
  )
  const inkFileId = await uploadJsonFile(
    'ink.json',
    inkPayload(ink),
    folderId,
    prev.inkFileId || find('ink.json'),
    meta.id,
  )
  let pdfFileId = prev.pdfFileId || find('document.pdf') || ''
  if (prev.pdfDirty || !pdfFileId) {
    pdfFileId = await uploadPdfFile(
      'document.pdf',
      pdf,
      folderId,
      pdfFileId || undefined,
      meta.id,
    )
  }
  let audioFileId = prev.audioFileId || find('audio.bin') || ''
  const audio = await getNotebookAudio(meta.id)
  if (audio && (prev.audioDirty || !audioFileId)) {
    audioFileId = await uploadBytesFile(
      'audio.bin',
      audio.data,
      audio.mime || 'audio/webm',
      folderId,
      audioFileId || undefined,
      meta.id,
    )
    await uploadJsonFile(
      'audio-cues.json',
      audio.cues,
      folderId,
      find('audio-cues.json'),
      meta.id,
    )
  }
  const boardChunks = await listBoardChunks(meta.id)
  await uploadJsonFile(
    'boardChunks.json',
    boardChunks,
    folderId,
    find('boardChunks.json'),
    meta.id,
  )
  const flashcards = await listFlashcards(meta.id)
  await uploadJsonFile(
    'flashcards.json',
    flashcards,
    folderId,
    find('flashcards.json'),
    meta.id,
  )
  const remoteUpdatedAt = contentTime(meta)
  await putSyncRow({
    notebookId: meta.id,
    folderId,
    pdfFileId,
    metaFileId,
    inkFileId,
    audioFileId,
    remoteUpdatedAt,
    localDirty: false,
    pdfDirty: false,
    audioDirty: false,
  })
  return true
}

function emptySync(notebookId: string): DriveSyncRow {
  return {
    notebookId,
    folderId: '',
    pdfFileId: '',
    metaFileId: '',
    inkFileId: '',
    audioFileId: '',
    remoteUpdatedAt: 0,
    localDirty: true,
    pdfDirty: true,
    audioDirty: false,
  }
}

async function remoteContentTime(
  remoteFolderId: string,
  sync: DriveSyncRow | undefined,
  folderModifiedMs: number,
): Promise<number> {
  const children = await listChildren(remoteFolderId)
  const metaId =
    sync?.metaFileId || children.find((f) => f.name === 'meta.json')?.id
  if (metaId) {
    try {
      const remoteMeta = await downloadJson<NotebookMeta>(metaId)
      return contentTime({ ...remoteMeta, id: remoteMeta.id || '' })
    } catch {
      /* fall through */
    }
  }
  return Math.max(sync?.remoteUpdatedAt || 0, folderModifiedMs)
}

async function pullOne(
  remoteFolderId: string,
  notebookId: string,
  skipActiveId?: string | null,
): Promise<'pulled' | 'skipped'> {
  if (skipActiveId && notebookId === skipActiveId) return 'skipped'
  if (await getTombstone(notebookId)) return 'skipped'
  const trashed = await listTrashed()
  if (trashed.some((t) => t.notebookId === notebookId)) return 'skipped'
  const children = await listChildren(remoteFolderId)
  const metaId = children.find((f) => f.name === 'meta.json')?.id
  const pdfId = children.find((f) => f.name === 'document.pdf')?.id
  const inkId = children.find((f) => f.name === 'ink.json')?.id
  if (!metaId || !pdfId || !inkId) return 'skipped'
  const remoteMeta = await downloadJson<NotebookMeta>(metaId)
  const local = await getNotebook(notebookId)
  const remoteTime = contentTime({ ...remoteMeta, id: notebookId })
  if (local && contentTime(local) >= remoteTime) return 'skipped'

  if (local) {
    await saveRevision(notebookId, 'lww-overwrite')
  }

  const pdf = await downloadBytes(pdfId)
  const inkRows =
    (await downloadJson<{ pageIndex: number; strokes: PageItem[] }[]>(inkId)) ??
    []
  const ink = new Map<number, PageItem[]>()
  for (const row of inkRows) {
    ink.set(row.pageIndex, row.strokes ?? [])
  }
  const meta: NotebookMeta = {
    ...remoteMeta,
    id: notebookId,
    folderId: local?.folderId ?? remoteMeta.folderId ?? null,
  }
  await putNotebook(meta, pdf, { fromRemote: true })
  await replaceNotebookInk(notebookId, ink, { fromRemote: true })
  await clearNotebookHistory(notebookId)
  const boardId = children.find((f) => f.name === 'boardChunks.json')?.id
  if (boardId) {
    try {
      const chunks =
        (await downloadJson<BoardChunkRow[]>(boardId)) ?? []
      await replaceBoardChunks(notebookId, chunks, { fromRemote: true })
    } catch {
      /* optional */
    }
  }
  const flashId = children.find((f) => f.name === 'flashcards.json')?.id
  if (flashId) {
    try {
      const cards =
        (await downloadJson<FlashcardRow[]>(flashId)) ?? []
      await replaceFlashcards(notebookId, cards, { fromRemote: true })
    } catch {
      /* optional */
    }
  }
  const audioId = children.find((f) => f.name === 'audio.bin')?.id
  const syncPrev = await getSyncRow(notebookId)
  if (audioId) {
    try {
      const bytes = await downloadBytes(audioId)
      const cuesRaw = children.find((f) => f.name === 'audio-cues.json')?.id
      let cues: { tMs: number; pageIndex: number; strokeId?: string }[] = []
      if (cuesRaw) {
        cues =
          (await downloadJson<typeof cues>(cuesRaw)) ?? []
      }
      await putNotebookAudio({
        notebookId,
        mime: 'audio/webm',
        data: bytes,
        cues,
        updatedAt: Date.now(),
      })
    } catch {
      /* optional */
    }
  }
  await putSyncRow({
    notebookId,
    folderId: remoteFolderId,
    pdfFileId: pdfId,
    metaFileId: metaId,
    inkFileId: inkId,
    audioFileId: audioId || syncPrev?.audioFileId || '',
    remoteUpdatedAt: remoteTime,
    localDirty: false,
    pdfDirty: false,
    audioDirty: false,
  })
  return 'pulled'
}

async function applyTombstones(
  remotes: Awaited<ReturnType<typeof listRemoteNotebooks>>,
): Promise<void> {
  const stones = await listTombstones()
  for (const stone of stones) {
    const listed = remotes.some(
      (f) => f.appProperties?.notebookId === stone.notebookId,
    )
    if (tombstoneAction({ listedInRemotes: listed }) === 'drop') {
      await deleteTombstone(stone.notebookId)
      continue
    }
    let folderId = stone.folderId
    if (!folderId) {
      folderId =
        remotes.find((f) => f.appProperties?.notebookId === stone.notebookId)
          ?.id ?? ''
    }
    if (!folderId) continue
    try {
      await trashDriveFile(folderId)
    } catch {
      /* keep tombstone until a later list shows the folder gone */
    }
  }
}

export async function syncWithDrive(opts?: {
  skipNotebookId?: string | null
}): Promise<{ pushed: number; pulled: number; overwritten: number }> {
  const run = async () => {
    if (!wasDriveConnected() && !isDriveTokenLive()) {
      throw new Error('Connect Google Drive in Settings.')
    }
    const rootId = await ensureRootFolder()
    const skip = opts?.skipNotebookId ?? null
    let pushed = 0
    let pulled = 0
    let overwritten = 0

    const remotes = await listRemoteNotebooks()
    await applyTombstones(remotes)

    const trashedIds = new Set(
      (await listTrashed()).map((t) => t.notebookId),
    )
    const remotesAfterTrash = await listRemoteNotebooks()
    for (const folder of remotesAfterTrash) {
      const notebookId = folder.appProperties?.notebookId
      if (!notebookId) continue
      const tombstoned = Boolean(await getTombstone(notebookId))
      if (
        driveSyncSkipsNotebook({
          tombstoned,
          trashed: trashedIds.has(notebookId),
        })
      ) {
        continue
      }
      const local = await getNotebook(notebookId)
      const sync = await getSyncRow(notebookId)
      const folderModifiedMs = folder.modifiedTime
        ? Date.parse(folder.modifiedTime)
        : 0
      if (!local) {
        const result = await pullOne(folder.id, notebookId, skip)
        if (result === 'pulled') pulled += 1
        continue
      }
      const localTime = contentTime(local)
      const remoteContent = await remoteContentTime(
        folder.id,
        sync,
        folderModifiedMs,
      )
      const action = decideSyncAction({
        localTime,
        remoteContentTime: remoteContent,
        localDirty: Boolean(sync?.localDirty),
      })
      if (action === 'push') {
        if (await pushOne(local, rootId, skip)) pushed += 1
      } else if (action === 'pull') {
        const wasDirty = Boolean(sync?.localDirty)
        const result = await pullOne(folder.id, notebookId, skip)
        if (result === 'pulled') {
          pulled += 1
          if (wasDirty) overwritten += 1
        }
      }
    }

    const locals = await listNotebooks()
    for (const meta of locals) {
      if (skip && meta.id === skip) continue
      if (trashedIds.has(meta.id)) continue
      const sync = await getSyncRow(meta.id)
      if (sync && !sync.localDirty && sync.folderId) continue
      const already = remotesAfterTrash.some(
        (f) => f.appProperties?.notebookId === meta.id,
      )
      if (already && !sync?.localDirty) continue
      if (await pushOne(meta, rootId, skip)) pushed += 1
    }

    markLastSyncNow()
    return { pushed, pulled, overwritten }
  }

  const next = syncChain.then(run, run)
  syncChain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

export async function pushDirtyNotebooks(
  skipNotebookId?: string | null,
): Promise<void> {
  if (!wasDriveConnected() && !isDriveTokenLive()) return
  const rows = await listSyncRows()
  const dirty = rows.filter((r) => r.localDirty || r.pdfDirty)
  const stones = await listTombstones()
  if (dirty.length === 0 && stones.length === 0) {
    const notebooks = await listNotebooks()
    if (
      notebooks.every((n) =>
        rows.some((r) => r.notebookId === n.id && !r.localDirty),
      )
    ) {
      return
    }
  }
  try {
    await syncWithDrive({ skipNotebookId })
  } catch {
    /* offline or token — stay local */
  }
}
