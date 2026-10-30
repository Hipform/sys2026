import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BoardCanvas,
  type BoardCanvasHandle,
} from './components/BoardCanvas'
import { FloatingToolbar } from './components/FloatingToolbar'
import {
  NoteCanvas,
  type NoteCanvasHandle,
  type PendingImage,
} from './components/NoteCanvas'
import { PageSidebar } from './components/PageSidebar'
import {
  playNotebookAudio,
  startNotebookRecording,
} from './lib/audioNotes'
import { downloadBackup, getLastBackupAt, importBackupFile } from './lib/backup'
import {
  deleteFolder,
  deleteNotebook,
  getAllPageInk,
  getNotebook,
  getPageInk,
  getPdfData,
  isStorageQuotaError,
  listFlashcards,
  listFolders,
  listNotebooks,
  listRevisions,
  listSyncRows,
  listTrashed,
  newFolderId,
  newNotebookId,
  purgeNotebook,
  putFlashcard,
  putFolder,
  putNotebook,
  remapNotebookHistory,
  replaceNotebookInk,
  restoreNotebook,
  restoreRevision,
  savePageInk,
  searchNotebookText,
  updateNotebookMeta,
} from './lib/db'
import { downloadOrShare, exportAnnotatedPdf } from './lib/exportPdf'
import {
  connectDrive,
  disconnectDrive,
  getStoredDriveEmail,
  isDriveConfigured,
  wasDriveConnected,
} from './lib/drive'
import { readImageAsBox } from './lib/pageItems'
import {
  appendTemplatePage,
  createNotebookPdf,
  duplicatePdfPage,
  inkAfterDelete,
  inkAfterDuplicate,
  inkAfterInsert,
  inkAfterMove,
  insertTemplatePageAt,
  movePdfPage,
  readLastPaperTemplate,
  removePdfPage,
  resolvePaperTemplate,
  writeLastPaperTemplate,
} from './lib/paper'
import { hashPin, verifyPin } from './lib/pin'
import { loadPdfDocument, renderCoverThumbnail } from './lib/pdf'
import {
  extractPageTextSpans,
  getPdfOutline,
  indexPdfPageText,
} from './lib/pdfText'
import {
  downloadSharedNotebook,
  importSharedNotebook,
} from './lib/shareNotebook'
import { getLastSyncAt, pushDirtyNotebooks, syncWithDrive } from './lib/sync'
import { onNativeStylusAction } from './lib/native'
import { applyTheme, getTheme, setTheme, type ThemeMode } from './lib/theme'
import { LibraryPage } from './pages/LibraryPage'
import { SettingsPage } from './pages/SettingsPage'
import type {
  FlashcardRow,
  Folder,
  NotebookMeta,
  NotebookRevision,
  TrashedNotebook,
} from './types/document'
import {
  DEFAULT_DRAW_SETTINGS,
  clampWidth,
  cloneToolPresets,
  isTextBox,
  type DrawSettings,
  type DrawTool,
  type PageInfo,
  type PageItem,
  type PaperTemplate,
  type PdfMarkup,
  type ToolPreset,
} from './types/note'

const PIN_KEY = 'pdf-notes-pin-hash'
const STICKER_STAR =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><polygon fill="#f59e0b" points="32,4 40,24 62,24 44,38 52,58 32,46 12,58 20,38 2,24 24,24"/></svg>`,
  )

type AppView = 'library' | 'editor' | 'board' | 'trash' | 'flashcards'

const SAVE_DEBOUNCE_MS = 400
const CHROME_HIDE_MS = 1200
const PRESETS_KEY = 'pdf-notes-tool-presets'
const TOOL_KEY = 'pdf-notes-tool'

function loadPresets(): Record<DrawTool, ToolPreset> {
  const base = cloneToolPresets()
  try {
    const raw = localStorage.getItem(PRESETS_KEY)
    if (!raw) return base
    const parsed = JSON.parse(raw) as Partial<Record<DrawTool, ToolPreset>>
    for (const key of Object.keys(base) as DrawTool[]) {
      const p = parsed[key]
      if (!p) continue
      if (typeof p.color === 'string') base[key].color = p.color
      if (typeof p.width === 'number') {
        base[key].width = clampWidth(key, p.width)
      }
    }
  } catch {
    /* ignore */
  }
  return base
}

function loadSettings(presets: Record<DrawTool, ToolPreset>): DrawSettings {
  let tool: DrawTool = DEFAULT_DRAW_SETTINGS.tool
  try {
    const stored = localStorage.getItem(TOOL_KEY)
    if (stored && stored in presets) tool = stored as DrawTool
  } catch {
    /* ignore */
  }
  return {
    tool,
    color: presets[tool].color,
    width: clampWidth(tool, presets[tool].width),
  }
}

function App() {
  const initialPresets = loadPresets()
  const [view, setView] = useState<AppView>('library')
  const [notebooks, setNotebooks] = useState<NotebookMeta[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [trashed, setTrashed] = useState<TrashedNotebook[]>([])
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [pagesOpen, setPagesOpen] = useState(false)
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [theme, setThemeState] = useState<ThemeMode>(() => getTheme())
  const [pinHash, setPinHash] = useState<string | null>(() => {
    try {
      return localStorage.getItem(PIN_KEY)
    } catch {
      return null
    }
  })
  const [pinUnlocked, setPinUnlocked] = useState(false)
  const [pinDraft, setPinDraft] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [contentSearchHits, setContentSearchHits] = useState<
    { notebookId: string; pageIndex: number; snippet: string }[]
  >([])
  const [flashcards, setFlashcards] = useState<FlashcardRow[]>([])
  const [revisions, setRevisions] = useState<NotebookRevision[]>([])
  const [bookmarks, setBookmarks] = useState<
    NonNullable<NotebookMeta['bookmarks']>
  >([])
  const [pdfOutline, setPdfOutline] = useState<
    { title: string; page: number }[]
  >([])
  const [driveEmail, setDriveEmail] = useState<string | null>(() =>
    getStoredDriveEmail(),
  )
  const [driveSyncing, setDriveSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(() =>
    getLastSyncAt(),
  )
  const [lastBackupAt, setLastBackupAt] = useState<number | null>(() =>
    getLastBackupAt(),
  )
  const [dirtyIds, setDirtyIds] = useState<string[]>([])
  const nagShownRef = useRef(false)
  const coverTimerRef = useRef<number | null>(null)
  const recordingRef = useRef<{
    stop: () => Promise<void>
    addCue: (pageIndex: number, strokeId?: string) => void
  } | null>(null)
  const editorShellRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<BoardCanvasHandle>(null)

  const [activeId, setActiveId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [pageInfo, setPageInfo] = useState<PageInfo>({
    width: 0,
    height: 0,
    pageCount: 0,
  })
  const [settings, setSettings] = useState<DrawSettings>(() =>
    loadSettings(initialPresets),
  )
  const [toolPresets, setToolPresets] = useState(initialPresets)
  const toolPresetsRef = useRef(toolPresets)
  toolPresetsRef.current = toolPresets
  const [pageItems, setPageItems] = useState<PageItem[]>([])
  const [inkEpoch, setInkEpoch] = useState(0)
  const [thumbEpoch, setThumbEpoch] = useState(0)
  const [chromeHidden, setChromeHidden] = useState(false)
  const [selectionCount, setSelectionCount] = useState(0)
  const [pencilOnly, setPencilOnly] = useState(() => {
    try {
      return localStorage.getItem('pdf-notes-pencil-only') !== '0'
    } catch {
      return true
    }
  })
  const [stabilize, setStabilize] = useState(() => {
    try {
      return localStorage.getItem('pdf-notes-stabilize') !== '0'
    } catch {
      return true
    }
  })
  const [shapeSnap, setShapeSnap] = useState(() => {
    try {
      return localStorage.getItem('pdf-notes-shape-snap') === '1'
    } catch {
      return false
    }
  })
  const paperTemplateRef = useRef<PaperTemplate>('blank')

  const canvasRef = useRef<NoteCanvasHandle>(null)
  const pageRef = useRef(page)
  pageRef.current = page
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const pendingSaveRef = useRef<{ page: number; strokes: PageItem[] } | null>(
    null,
  )
  const saveTimerRef = useRef<number | null>(null)
  const chromeTimerRef = useRef<number | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const titleRef = useRef(title)
  titleRef.current = title
  const titleTimerRef = useRef<number | null>(null)
  const surgeryRef = useRef(false)

  const showToast = useCallback((message: string) => {
    setToast(message)
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 4200)
    return () => window.clearTimeout(t)
  }, [toast])

  const refreshLibrary = useCallback(async () => {
    const [nextNotebooks, nextFolders, syncRows, nextTrash] = await Promise.all([
      listNotebooks(),
      listFolders(),
      listSyncRows(),
      listTrashed(),
    ])
    setNotebooks(nextNotebooks)
    setFolders(nextFolders)
    setTrashed(nextTrash)
    setDirtyIds(
      syncRows.filter((row) => row.localDirty || row.pdfDirty).map((row) => row.notebookId),
    )
  }, [])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const showChrome = useCallback(() => {
    setChromeHidden(false)
    if (chromeTimerRef.current !== null) {
      window.clearTimeout(chromeTimerRef.current)
      chromeTimerRef.current = null
    }
  }, [])

  const handleInkActivity = useCallback(() => {
    const session = recordingRef.current
    if (session) session.addCue(pageRef.current)
    if (chromeTimerRef.current !== null) {
      window.clearTimeout(chromeTimerRef.current)
    }
    chromeTimerRef.current = window.setTimeout(() => {
      chromeTimerRef.current = null
      setChromeHidden(true)
    }, CHROME_HIDE_MS)
  }, [])

  useEffect(() => {
    void refreshLibrary()
  }, [refreshLibrary])

  useEffect(() => {
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(toolPresets))
      localStorage.setItem(TOOL_KEY, settings.tool)
    } catch {
      /* ignore */
    }
  }, [toolPresets, settings.tool])

  useEffect(() => {
    return () => {
      if (chromeTimerRef.current !== null) {
        window.clearTimeout(chromeTimerRef.current)
      }
    }
  }, [])

  const flushSave = useCallback(async () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const pending = pendingSaveRef.current
    const id = activeIdRef.current
    if (!pending || !id) return
    pendingSaveRef.current = null
    try {
      await savePageInk(id, pending.page, pending.strokes)
      setThumbEpoch((n) => n + 1)
      if (pending.page === 1) {
        if (coverTimerRef.current !== null) {
          window.clearTimeout(coverTimerRef.current)
        }
        const savedId = id
        coverTimerRef.current = window.setTimeout(() => {
          coverTimerRef.current = null
          void (async () => {
            const data = await getPdfData(savedId)
            if (!data) return
            const items = await getPageInk(savedId, 1)
            const coverDataUrl = await renderCoverThumbnail(data, items)
            await updateNotebookMeta({ id: savedId, coverDataUrl })
          })()
        }, 700)
      }
    } catch (err) {
      pendingSaveRef.current = pending
      showToast(
        isStorageQuotaError(err)
          ? 'Storage is full. Export a backup, then free space on this device.'
          : 'Could not save ink. Try again.',
      )
    }
  }, [showToast])

  const scheduleSave = useCallback(
    (strokes: PageItem[]) => {
      if (surgeryRef.current) return
      pendingSaveRef.current = { page: pageRef.current, strokes }
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
      }
      saveTimerRef.current = window.setTimeout(() => {
        void flushSave()
      }, SAVE_DEBOUNCE_MS)
    },
    [flushSave],
  )

  useEffect(() => {
    const persistOnHide = () => {
      void (async () => {
        await flushSave()
        await canvasRef.current?.flushHistory()
        const skip =
          viewRef.current === 'editor' ? activeIdRef.current : null
        await pushDirtyNotebooks(skip)
        setLastSyncAt(getLastSyncAt())
        if (viewRef.current === 'library') {
          await refreshLibrary()
        }
      })()
    }
    const onVisibility = () => {
      if (!document.hidden) return
      persistOnHide()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', persistOnHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', persistOnHide)
    }
  }, [flushSave, refreshLibrary])

  useEffect(() => {
    if (view !== 'library' || nagShownRef.current) return
    if (notebooks.length === 0) return
    const week = 7 * 24 * 60 * 60 * 1000
    const lastProtect = Math.max(lastBackupAt ?? 0, lastSyncAt ?? 0)
    const newestNote = Math.max(...notebooks.map((n) => n.updatedAt))
    if (lastProtect > 0 && Date.now() - lastProtect < week) return
    if (lastProtect === 0 && Date.now() - newestNote < week) return
    nagShownRef.current = true
    showToast(
      'Back up or connect Drive — nothing has been copied off this device in over a week.',
    )
  }, [view, notebooks, lastBackupAt, lastSyncAt, showToast])

  const runDriveSync = useCallback(async () => {
    setDriveSyncing(true)
    try {
      const result = await syncWithDrive({
        skipNotebookId: viewRef.current === 'editor' ? activeIdRef.current : null,
      })
      setLastSyncAt(getLastSyncAt())
      await refreshLibrary()
      if (result.overwritten) {
        showToast(
          'A newer copy on Drive replaced notes on this device. Revisions are available in Settings.',
        )
      } else if (result.pulled || result.pushed) {
        showToast(
          `Drive sync: ${result.pushed} uploaded, ${result.pulled} downloaded.`,
        )
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Drive sync failed.')
    } finally {
      setDriveSyncing(false)
    }
  }, [refreshLibrary, showToast])

  useEffect(() => {
    if (view !== 'library') return
    if (!wasDriveConnected() || !isDriveConfigured()) return
    let cancelled = false
    void connectDrive({ silent: true })
      .then((session) => {
        if (cancelled) return
        setDriveEmail(session.email)
        return runDriveSync()
      })
      .catch(() => {
        if (!cancelled) setDriveEmail(getStoredDriveEmail())
      })
    return () => {
      cancelled = true
    }
  }, [view, runDriveSync])

  useEffect(() => {
    return () => {
      if (coverTimerRef.current !== null) {
        window.clearTimeout(coverTimerRef.current)
      }
    }
  }, [])

  const importPdfFile = useCallback(
    async (next: File, folderId?: string | null) => {
      const buffer = await next.arrayBuffer()
      const { pdf, task } = await loadPdfDocument(buffer)
      const pageCount = pdf.numPages
      await pdf.cleanup()
      void task.destroy()
      const coverDataUrl = await renderCoverThumbnail(buffer)
      const id = newNotebookId()
      const now = Date.now()
      await putNotebook(
        {
          id,
          title: next.name.replace(/\.pdf$/i, '') || 'Untitled',
          createdAt: now,
          updatedAt: now,
          pageCount,
          coverDataUrl,
          lastPage: 1,
          folderId: folderId ?? null,
          paperTemplate: readLastPaperTemplate(),
        },
        buffer,
      )
    },
    [],
  )

  const handleImportFiles = useCallback(
    async (files: File[], folderId?: string | null) => {
      const pdfs = files.filter(
        (f) =>
          f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
      )
      if (pdfs.length === 0) return
      setImporting(true)
      try {
        for (const f of pdfs) {
          await importPdfFile(f, folderId)
        }
        await refreshLibrary()
      } finally {
        setImporting(false)
      }
    },
    [importPdfFile, refreshLibrary],
  )

  const handleCreateNotebook = useCallback(
    async (opts: {
      title: string
      template: PaperTemplate
      pageCount: number
      folderId?: string | null
    }) => {
      setImporting(true)
      try {
        const buffer = await createNotebookPdf(opts.template, opts.pageCount)
        const coverDataUrl = await renderCoverThumbnail(buffer)
        const id = newNotebookId()
        const now = Date.now()
        await putNotebook(
          {
            id,
            title: opts.title.trim() || 'Untitled',
            createdAt: now,
            updatedAt: now,
            pageCount: opts.pageCount,
            coverDataUrl,
            lastPage: 1,
            folderId: opts.folderId ?? null,
            paperTemplate: opts.template,
          },
          buffer,
        )
        writeLastPaperTemplate(opts.template)
        await refreshLibrary()
      } finally {
        setImporting(false)
      }
    },
    [refreshLibrary],
  )

  const openNotebook = useCallback(async (id: string) => {
    const data = await getPdfData(id)
    const meta = await getNotebook(id)
    if (!data || !meta) return
    if (meta.kind === 'board') {
      setActiveId(id)
      setTitle(meta.title)
      setFile(null)
      setBookmarks(meta.bookmarks ?? [])
      setView('board')
      history.pushState({ pdfNotes: 'board' }, '')
      return
    }
    const copy = data.slice(0)
    const opened = new File([copy], `${meta.title}.pdf`, {
      type: 'application/pdf',
    })
    const startPage = Math.min(
      Math.max(1, meta.lastPage ?? 1),
      Math.max(1, meta.pageCount),
    )
    const items = await getPageInk(id, startPage)
    paperTemplateRef.current = resolvePaperTemplate(meta.paperTemplate)
    setActiveId(id)
    setTitle(meta.title)
    setFile(opened)
    setPage(startPage)
    setZoom(1)
    setChromeHidden(false)
    setSelectionCount(0)
    setPagesOpen(false)
    setPendingImage(null)
    setPageItems(items)
    setBookmarks(meta.bookmarks ?? [])
    setInkEpoch((n) => n + 1)
    setPageInfo({ width: 0, height: 0, pageCount: meta.pageCount })
    setPdfOutline([])
    setView('editor')
    history.pushState({ pdfNotes: 'editor' }, '')
    try {
      const { pdf, task } = await loadPdfDocument(copy.slice(0))
      await indexPdfPageText(id, pdf, startPage)
      setPdfOutline(await getPdfOutline(pdf))
      await pdf.cleanup()
      void task.destroy()
    } catch {
      /* indexing is best-effort */
    }
  }, [])

  const handleDelete = useCallback(
    async (id: string) => {
      if (
        !window.confirm(
          'Move this notebook to Recently deleted? You can restore it later from Settings.',
        )
      ) {
        return
      }
      await deleteNotebook(id)
      await refreshLibrary()
    },
    [refreshLibrary],
  )

  const handleRestoreTrash = useCallback(
    async (id: string) => {
      await restoreNotebook(id)
      await refreshLibrary()
      showToast('Notebook restored.')
    },
    [refreshLibrary, showToast],
  )

  const handlePurgeTrash = useCallback(
    async (id: string) => {
      await purgeNotebook(id)
      await refreshLibrary()
      void pushDirtyNotebooks()
      showToast('Notebook deleted forever.')
    },
    [refreshLibrary, showToast],
  )

  const handleShareNotebook = useCallback(
    async (id: string) => {
      try {
        await downloadSharedNotebook(id)
        showToast('Share file downloaded.')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Share failed.')
      }
    },
    [showToast],
  )

  const handleImportShare = useCallback(
    async (file: File) => {
      try {
        await importSharedNotebook(file)
        await refreshLibrary()
        showToast('Shared notebook imported.')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Import failed.')
      }
    },
    [refreshLibrary, showToast],
  )

  const handleCreateBoard = useCallback(async () => {
    setImporting(true)
    try {
      const buffer = await createNotebookPdf('blank', 1)
      const coverDataUrl = await renderCoverThumbnail(buffer)
      const id = newNotebookId()
      const now = Date.now()
      await putNotebook(
        {
          id,
          title: 'Untitled board',
          createdAt: now,
          updatedAt: now,
          pageCount: 1,
          coverDataUrl,
          lastPage: 1,
          folderId: null,
          paperTemplate: 'blank',
          kind: 'board',
        },
        buffer,
      )
      await refreshLibrary()
      await openNotebook(id)
    } finally {
      setImporting(false)
    }
  }, [openNotebook, refreshLibrary])

  const handleToggleFavorite = useCallback(
    async (id: string) => {
      const meta = await getNotebook(id)
      if (!meta) return
      await updateNotebookMeta({ id, favorite: !meta.favorite })
      await refreshLibrary()
    },
    [refreshLibrary],
  )

  const handleThemeChange = useCallback((mode: ThemeMode) => {
    setTheme(mode)
    setThemeState(mode)
  }, [])

  const handleSetPin = useCallback(async (pin: string) => {
    const hash = await hashPin(pin)
    try {
      localStorage.setItem(PIN_KEY, hash)
    } catch {
      /* ignore */
    }
    setPinHash(hash)
    setPinUnlocked(true)
    showToast('PIN saved.')
  }, [showToast])

  const handleClearPin = useCallback(() => {
    try {
      localStorage.removeItem(PIN_KEY)
    } catch {
      /* ignore */
    }
    setPinHash(null)
    setPinUnlocked(true)
    showToast('PIN cleared.')
  }, [showToast])

  const handleUnlockPin = useCallback(async () => {
    const ok = await verifyPin(pinDraft, pinHash)
    if (!ok) {
      setPinError('Wrong PIN')
      return
    }
    setPinError(null)
    setPinDraft('')
    setPinUnlocked(true)
  }, [pinDraft, pinHash])

  const handleEditTags = useCallback(
    async (id: string, tagsCsv: string) => {
      const tags = tagsCsv
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      await updateNotebookMeta({ id, tags })
      await refreshLibrary()
    },
    [refreshLibrary],
  )

  const handleContentSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setContentSearchHits([])
      return
    }
    const hits = await searchNotebookText(query)
    setContentSearchHits(hits)
  }, [])

  const handleRestoreRevision = useCallback(
    async (key: string) => {
      const ok = await restoreRevision(key)
      if (ok) {
        await refreshLibrary()
        showToast('Revision restored.')
      }
    },
    [refreshLibrary, showToast],
  )

  const handleRename = useCallback(
    async (id: string, nextTitle: string) => {
      await updateNotebookMeta({ id, title: nextTitle })
      await refreshLibrary()
    },
    [refreshLibrary],
  )

  const handleMoveNotebook = useCallback(
    async (id: string, folderId: string | null) => {
      await updateNotebookMeta({ id, folderId })
      await refreshLibrary()
    },
    [refreshLibrary],
  )

  const handleCreateFolder = useCallback(
    async (name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      await putFolder({
        id: newFolderId(),
        name: trimmed,
        createdAt: Date.now(),
      })
      await refreshLibrary()
    },
    [refreshLibrary],
  )

  const handleRenameFolder = useCallback(
    async (id: string, name: string) => {
      const current = folders.find((f) => f.id === id)
      if (!current) return
      await putFolder({ ...current, name: name.trim() || current.name })
      await refreshLibrary()
    },
    [folders, refreshLibrary],
  )

  const handleDeleteFolder = useCallback(
    async (id: string) => {
      if (!window.confirm('Delete this folder? Notes stay in the library.')) {
        return
      }
      await deleteFolder(id)
      await refreshLibrary()
    },
    [refreshLibrary],
  )

  const refreshCover = useCallback(async (id: string) => {
    const data = await getPdfData(id)
    if (!data) return
    const items = await getPageInk(id, 1)
    const coverDataUrl = await renderCoverThumbnail(data, items)
    await updateNotebookMeta({ id, coverDataUrl })
  }, [])

  const closeEditor = useCallback(async () => {
    await flushSave()
    await canvasRef.current?.flushHistory()
    await boardRef.current?.flush()
    if (recordingRef.current) {
      try {
        await recordingRef.current.stop()
      } catch {
        /* ignore */
      }
      recordingRef.current = null
      setRecording(false)
    }
    const id = activeIdRef.current
    if (titleTimerRef.current !== null) {
      window.clearTimeout(titleTimerRef.current)
      titleTimerRef.current = null
    }
    if (id && viewRef.current === 'editor') {
      await updateNotebookMeta({
        id,
        lastPage: pageRef.current,
        title: titleRef.current.trim() || 'Untitled',
      })
      await refreshCover(id)
    } else if (id && viewRef.current === 'board') {
      await updateNotebookMeta({
        id,
        title: titleRef.current.trim() || 'Untitled board',
      })
    }
    setView('library')
    setActiveId(null)
    setFile(null)
    setChromeHidden(false)
    setSelectionCount(0)
    setPagesOpen(false)
    setPendingImage(null)
    setFlashcards([])
    await pushDirtyNotebooks()
    setLastSyncAt(getLastSyncAt())
    await refreshLibrary()
  }, [flushSave, refreshCover, refreshLibrary])

  const handleBack = useCallback(async () => {
    if (
      history.state &&
      (history.state.pdfNotes === 'editor' || history.state.pdfNotes === 'board')
    ) {
      history.back()
      return
    }
    await closeEditor()
  }, [closeEditor])

  useEffect(() => {
    const onPop = () => {
      if (
        viewRef.current === 'editor' ||
        viewRef.current === 'board' ||
        viewRef.current === 'flashcards'
      ) {
        void closeEditor()
      } else if (viewRef.current === 'trash') {
        setView('library')
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [closeEditor])

  const loadPageItems = useCallback(async (nextPage: number) => {
    const id = activeIdRef.current
    setPage(nextPage)
    setSelectionCount(0)
    if (!id) return
    void updateNotebookMeta({ id, lastPage: nextPage })
    const items = await getPageInk(id, nextPage)
    setPageItems(items)
    setInkEpoch((n) => n + 1)
    try {
      const data = await getPdfData(id)
      if (!data) return
      const { pdf, task } = await loadPdfDocument(data.slice(0))
      await indexPdfPageText(id, pdf, nextPage)
      await pdf.cleanup()
      void task.destroy()
    } catch {
      /* indexing is best-effort */
    }
  }, [])

  const handlePageChange = useCallback(
    async (nextPage: number) => {
      await flushSave()
      await canvasRef.current?.flushHistory()
      await loadPageItems(nextPage)
    },
    [flushSave, loadPageItems],
  )

  const handleAddPage = useCallback(async () => {
    const id = activeIdRef.current
    if (!id) return
    surgeryRef.current = true
    try {
      await flushSave()
      const data = await getPdfData(id)
      const meta = await getNotebook(id)
      if (!data || !meta) return
      const template = resolvePaperTemplate(
        meta.paperTemplate ?? paperTemplateRef.current,
      )
      paperTemplateRef.current = template
      writeLastPaperTemplate(template)
      const nextBytes = await appendTemplatePage(data, template)
      const nextCount = meta.pageCount + 1
      await putNotebook(
        { ...meta, pageCount: nextCount, paperTemplate: template },
        nextBytes,
      )
      const opened = new File([nextBytes], `${meta.title}.pdf`, {
        type: 'application/pdf',
      })
      setFile(opened)
      setPageInfo((prev) => ({ ...prev, pageCount: nextCount }))
      pendingSaveRef.current = null
      await handlePageChange(nextCount)
    } finally {
      surgeryRef.current = false
    }
  }, [flushSave, handlePageChange])

  const reloadOpenedPdf = useCallback(
    async (
      meta: NotebookMeta,
      bytes: ArrayBuffer,
      nextPage: number,
      ink: Map<number, PageItem[]>,
    ) => {
      const id = meta.id
      await putNotebook(meta, bytes)
      await replaceNotebookInk(id, ink)
      const opened = new File([bytes], `${meta.title}.pdf`, {
        type: 'application/pdf',
      })
      setFile(opened)
      setPageInfo((prev) => ({ ...prev, pageCount: meta.pageCount }))
      pendingSaveRef.current = null
      await loadPageItems(Math.max(1, Math.min(nextPage, meta.pageCount)))
    },
    [loadPageItems],
  )

  const notebookTemplate = useCallback(async (meta: NotebookMeta) => {
    const template = resolvePaperTemplate(
      meta.paperTemplate ?? paperTemplateRef.current,
    )
    paperTemplateRef.current = template
    writeLastPaperTemplate(template)
    return template
  }, [])

  const handleDeletePage = useCallback(
    async (pageIndex: number) => {
      const id = activeIdRef.current
      if (!id) return
      const meta = await getNotebook(id)
      const data = await getPdfData(id)
      if (!meta || !data || meta.pageCount <= 1) return
      if (!window.confirm('Delete this page? Ink on it will be removed.')) {
        return
      }
      surgeryRef.current = true
      try {
        await flushSave()
        await canvasRef.current?.flushHistory()
        const nextBytes = await removePdfPage(data, pageIndex)
        const ink = inkAfterDelete(await getAllPageInk(id), pageIndex)
        await remapNotebookHistory(id, (p) =>
          p === pageIndex ? null : p > pageIndex ? p - 1 : p,
        )
        canvasRef.current?.resetHistory()
        const nextCount = meta.pageCount - 1
        const nextPage = Math.min(pageIndex, nextCount)
        await reloadOpenedPdf(
          { ...meta, pageCount: nextCount },
          nextBytes,
          nextPage,
          ink,
        )
      } finally {
        surgeryRef.current = false
      }
    },
    [flushSave, reloadOpenedPdf],
  )

  const handleInsertPage = useCallback(
    async (pageIndex: number) => {
      const id = activeIdRef.current
      if (!id) return
      const meta = await getNotebook(id)
      const data = await getPdfData(id)
      if (!meta || !data) return
      surgeryRef.current = true
      try {
        await flushSave()
        await canvasRef.current?.flushHistory()
        const template = await notebookTemplate(meta)
        const nextBytes = await insertTemplatePageAt(data, pageIndex, template)
        const ink = inkAfterInsert(await getAllPageInk(id), pageIndex)
        await remapNotebookHistory(id, (p) => (p >= pageIndex ? p + 1 : p))
        canvasRef.current?.resetHistory()
        await reloadOpenedPdf(
          {
            ...meta,
            pageCount: meta.pageCount + 1,
            paperTemplate: template,
          },
          nextBytes,
          pageIndex,
          ink,
        )
      } finally {
        surgeryRef.current = false
      }
    },
    [flushSave, notebookTemplate, reloadOpenedPdf],
  )

  const handleDuplicatePage = useCallback(
    async (pageIndex: number) => {
      const id = activeIdRef.current
      if (!id) return
      const meta = await getNotebook(id)
      const data = await getPdfData(id)
      if (!meta || !data) return
      surgeryRef.current = true
      try {
        await flushSave()
        await canvasRef.current?.flushHistory()
        const nextBytes = await duplicatePdfPage(data, pageIndex)
        const ink = inkAfterDuplicate(await getAllPageInk(id), pageIndex)
        await remapNotebookHistory(id, (p) => (p > pageIndex ? p + 1 : p))
        canvasRef.current?.resetHistory()
        await reloadOpenedPdf(
          { ...meta, pageCount: meta.pageCount + 1 },
          nextBytes,
          pageIndex + 1,
          ink,
        )
      } finally {
        surgeryRef.current = false
      }
    },
    [flushSave, reloadOpenedPdf],
  )

  const handleMovePage = useCallback(
    async (fromPage: number, toPage: number) => {
      const id = activeIdRef.current
      if (!id || fromPage === toPage) return
      const meta = await getNotebook(id)
      const data = await getPdfData(id)
      if (!meta || !data) return
      surgeryRef.current = true
      try {
        await flushSave()
        await canvasRef.current?.flushHistory()
        const nextBytes = await movePdfPage(data, fromPage, toPage)
        const ink = inkAfterMove(
          await getAllPageInk(id),
          fromPage,
          toPage,
          meta.pageCount,
        )
        await remapNotebookHistory(id, (oldPage) => {
          const order = Array.from({ length: meta.pageCount }, (_, i) => i + 1)
          const [taken] = order.splice(fromPage - 1, 1)
          order.splice(toPage - 1, 0, taken!)
          return order.indexOf(oldPage) + 1
        })
        canvasRef.current?.resetHistory()
        await reloadOpenedPdf(meta, nextBytes, toPage, ink)
      } finally {
        surgeryRef.current = false
      }
    },
    [flushSave, reloadOpenedPdf],
  )

  const handleTitleChange = useCallback((nextTitle: string) => {
    setTitle(nextTitle)
    const id = activeIdRef.current
    if (!id) return
    if (titleTimerRef.current !== null) {
      window.clearTimeout(titleTimerRef.current)
    }
    titleTimerRef.current = window.setTimeout(() => {
      titleTimerRef.current = null
      void updateNotebookMeta({ id, title: nextTitle.trim() || 'Untitled' })
    }, 400)
  }, [])

  const handleExportBackup = useCallback(async () => {
    setBackingUp(true)
    try {
      await downloadBackup()
      setLastBackupAt(getLastBackupAt())
      showToast('Backup downloaded.')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Backup failed.')
    } finally {
      setBackingUp(false)
    }
  }, [showToast])

  const handleImportBackup = useCallback(
    async (file: File) => {
      setBackingUp(true)
      try {
        const n = await importBackupFile(file)
        await refreshLibrary()
        if (driveEmail || wasDriveConnected()) {
          showToast(
            `Restored ${n} notebook${n === 1 ? '' : 's'} as new copies. Sync will upload them separately from any Drive originals.`,
          )
        } else {
          showToast(`Restored ${n} notebook${n === 1 ? '' : 's'}.`)
        }
      } catch (err) {
        showToast(
          isStorageQuotaError(err)
            ? 'Storage is full. Free space, then try again.'
            : err instanceof Error
              ? err.message
              : 'Could not restore backup.',
        )
      } finally {
        setBackingUp(false)
      }
    },
    [driveEmail, refreshLibrary, showToast],
  )

  const handleConnectDrive = useCallback(async () => {
    try {
      const session = await connectDrive()
      setDriveEmail(session.email)
      await runDriveSync()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not connect Drive.')
    }
  }, [runDriveSync, showToast])

  const handleDisconnectDrive = useCallback(() => {
    disconnectDrive()
    setDriveEmail(null)
    showToast('Google Drive disconnected. Notes stay on this device.')
  }, [showToast])

  const handleExportNotebook = useCallback(
    async (id: string) => {
      const data = await getPdfData(id)
      const meta = await getNotebook(id)
      if (!data || !meta) return
      setExporting(true)
      try {
        const inkByPage = await getAllPageInk(id)
        const { blob, vector } = await exportAnnotatedPdf(
          data,
          meta.pageCount || 1,
          inkByPage,
        )
        await downloadOrShare(blob, `${meta.title || 'notes'}-annotated.pdf`)
        if (!vector) {
          showToast(
            'Exported as images because the original PDF could not be kept.',
          )
        }
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : 'Failed to export annotated PDF',
        )
      } finally {
        setExporting(false)
      }
    },
    [showToast],
  )

  const handleInsertImage = useCallback(async (file: File) => {
    try {
      const box = await readImageAsBox(file)
      setPendingImage(box)
      showToast('Tap the page to place the image.')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not read image.')
    }
  }, [showToast])

  const handlePageInfo = useCallback((info: PageInfo) => {
    setPageInfo((prev) => {
      if (
        prev.width === info.width &&
        prev.height === info.height &&
        prev.pageCount === info.pageCount
      ) {
        return prev
      }
      return {
        width: info.width,
        height: info.height,
        pageCount: info.pageCount || prev.pageCount,
      }
    })
  }, [])

  const handleStrokesChange = useCallback(
    (items: PageItem[]) => {
      setPageItems(items)
      scheduleSave(items)
    },
    [scheduleSave],
  )

  const handleToolChange = useCallback((tool: DrawTool) => {
    const preset = toolPresetsRef.current[tool]
    if (tool === 'eraser') {
      setSettings((prev) => ({
        tool,
        color: prev.color,
        width: clampWidth(tool, preset.width),
      }))
      return
    }
    setSettings({
      tool,
      color: preset.color,
      width: clampWidth(tool, preset.width),
    })
  }, [])

  useEffect(() => {
    return onNativeStylusAction((action) => {
      if (action === 'toggle-eraser') handleToolChange('eraser')
      else if (action === 'undo') canvasRef.current?.undo()
      else if (action === 'pencil-only') setPencilOnly((v) => !v)
    })
  }, [handleToolChange])

  const handlePencilOnlyChange = useCallback((value: boolean) => {
    setPencilOnly(value)
    try {
      localStorage.setItem('pdf-notes-pencil-only', value ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [])

  const handleStabilizeChange = useCallback((value: boolean) => {
    setStabilize(value)
    try {
      localStorage.setItem('pdf-notes-stabilize', value ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [])

  const handleShapeSnapChange = useCallback((value: boolean) => {
    setShapeSnap(value)
    try {
      localStorage.setItem('pdf-notes-shape-snap', value ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [])

  const handleSettingsChange = useCallback((patch: Partial<DrawSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      next.width = clampWidth(next.tool, next.width)
      setToolPresets((presets) => ({
        ...presets,
        [next.tool]: { color: next.color, width: next.width },
      }))
      return next
    })
  }, [])

  useEffect(() => {
    if (view !== 'editor') return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      ) {
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        canvasRef.current?.redo()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) canvasRef.current?.redo()
        else canvasRef.current?.undo()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        canvasRef.current?.duplicateSelection()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        canvasRef.current?.selectAll()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        canvasRef.current?.copySelection()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        canvasRef.current?.pasteClipboard()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        canvasRef.current?.clearSelection()
        setPendingImage(null)
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        canvasRef.current?.deleteSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view])

  const handleExport = useCallback(async () => {
    const currentFile = file
    const id = activeIdRef.current
    if (!currentFile || !id) return
    setExporting(true)
    try {
      await flushSave()
      const inkByPage = await getAllPageInk(id)
      inkByPage.set(pageRef.current, pageItems)
      const { blob, vector } = await exportAnnotatedPdf(
        currentFile,
        pageInfo.pageCount || 1,
        inkByPage,
      )
      await downloadOrShare(blob, `${title || 'notes'}-annotated.pdf`)
      if (!vector) {
        showToast('Exported as images because the original PDF could not be kept.')
      }
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : 'Failed to export annotated PDF',
      )
    } finally {
      setExporting(false)
    }
  }, [file, flushSave, pageInfo.pageCount, pageItems, showToast, title])

  const handleHighlightPdfText = useCallback(async () => {
    const id = activeIdRef.current
    if (!id) return
    try {
      const data = await getPdfData(id)
      if (!data) return
      const { pdf, task } = await loadPdfDocument(data.slice(0))
      const { spans } = await extractPageTextSpans(pdf, pageRef.current)
      await pdf.cleanup()
      void task.destroy()
      if (!spans.length) {
        showToast('No selectable PDF text on this page.')
        return
      }
      const use = spans.slice(0, 5)
      const markup: PdfMarkup = {
        id: `markup-${Date.now()}`,
        type: 'pdf-markup',
        mode: 'highlight',
        color: '#facc15',
        rects: use.map((s) => ({
          x: s.x,
          y: s.y,
          width: s.width,
          height: s.height,
        })),
        text: use.map((s) => s.text).join(' '),
        layerId: 'default',
      }
      const next = [...pageItems, markup]
      setPageItems(next)
      setInkEpoch((n) => n + 1)
      scheduleSave(next)
      showToast('Highlighted PDF text.')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Highlight failed.')
    }
  }, [pageItems, scheduleSave, showToast])

  const handleToggleRecord = useCallback(async () => {
    const id = activeIdRef.current
    if (!id) return
    if (recordingRef.current) {
      try {
        await recordingRef.current.stop()
        showToast('Recording saved.')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not stop recording.')
      }
      recordingRef.current = null
      setRecording(false)
      return
    }
    try {
      const session = await startNotebookRecording(id)
      recordingRef.current = session
      setRecording(true)
      showToast('Recording…')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Microphone unavailable.')
    }
  }, [showToast])

  const handlePlayAudio = useCallback(async () => {
    const id = activeIdRef.current
    if (!id) return
    try {
      const audio = await playNotebookAudio(id, (cue) => {
        if (cue.pageIndex !== pageRef.current) {
          void handlePageChange(cue.pageIndex)
        }
      })
      if (!audio) showToast('No audio for this notebook.')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Playback failed.')
    }
  }, [handlePageChange, showToast])

  const handlePresent = useCallback(async () => {
    const el = editorShellRef.current
    if (!el) return
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen()
        showToast('Presentation mode. Press Esc to exit.')
      } else {
        await document.exitFullscreen()
      }
    } catch {
      showToast('Fullscreen is not available.')
    }
  }, [showToast])

  const handleInsertSticker = useCallback(() => {
    setPendingImage({
      dataUrl: STICKER_STAR,
      width: 72,
      height: 72,
      kind: 'sticker',
    })
    showToast('Tap the page to place the sticker.')
  }, [showToast])

  const handleToggleBookmark = useCallback(async () => {
    const id = activeIdRef.current
    if (!id) return
    const pageNum = pageRef.current
    const next = [...bookmarks]
    const idx = next.findIndex((b) => b.page === pageNum)
    if (idx >= 0) next.splice(idx, 1)
    else next.push({ page: pageNum, label: `Page ${pageNum}` })
    setBookmarks(next)
    await updateNotebookMeta({ id, bookmarks: next })
    showToast(idx >= 0 ? 'Bookmark removed.' : 'Bookmark added.')
  }, [bookmarks, showToast])

  const handleOpenFlashcards = useCallback(async () => {
    const id = activeIdRef.current
    if (!id) return
    await flushSave()
    const cards = await listFlashcards(id)
    setFlashcards(cards)
    setView('flashcards')
  }, [flushSave])

  const handleCreateFlashcard = useCallback(async () => {
    const id = activeIdRef.current
    if (!id) return
    const texts = pageItems.filter(isTextBox).map((t) => t.text.trim()).filter(Boolean)
    if (texts.length === 0) {
      showToast('Add text boxes on this page first.')
      return
    }
    const front = texts[0]!
    const back = texts.slice(1).join('\n') || front
    const row: FlashcardRow = {
      id: `fc-${Date.now()}`,
      notebookId: id,
      pageIndex: pageRef.current,
      front,
      back,
      createdAt: Date.now(),
    }
    await putFlashcard(row)
    setFlashcards((prev) => [...prev, row])
    showToast('Flashcard created.')
  }, [pageItems, showToast])

  useEffect(() => {
    if (!settingsOpen) return
    const id = activeIdRef.current
    if (!id) {
      setRevisions([])
      return
    }
    void listRevisions(id).then(setRevisions)
  }, [settingsOpen, activeId])

  const settingsOverlay = settingsOpen ? (
    <div className="fixed inset-0 z-50">
      <SettingsPage
        onBack={() => setSettingsOpen(false)}
        pencilOnly={pencilOnly}
        stabilize={stabilize}
        shapeSnap={shapeSnap}
        onPencilOnlyChange={handlePencilOnlyChange}
        onStabilizeChange={handleStabilizeChange}
        onShapeSnapChange={handleShapeSnapChange}
        driveConfigured={isDriveConfigured()}
        driveEmail={driveEmail}
        driveSyncing={driveSyncing}
        lastSyncAt={lastSyncAt}
        lastBackupAt={lastBackupAt}
        onConnectDrive={() => void handleConnectDrive()}
        onDisconnectDrive={handleDisconnectDrive}
        onSyncNow={() => void runDriveSync()}
        backingUp={backingUp}
        onExportBackup={() => void handleExportBackup()}
        onImportBackup={(file) => void handleImportBackup(file)}
        theme={theme}
        onThemeChange={handleThemeChange}
        pinSet={Boolean(pinHash)}
        onSetPin={(pin) => void handleSetPin(pin)}
        onClearPin={handleClearPin}
        trashed={trashed}
        onRestoreTrash={(id) => void handleRestoreTrash(id)}
        onPurgeTrash={(id) => void handlePurgeTrash(id)}
        revisions={revisions}
        onRestoreRevision={(key) => void handleRestoreRevision(key)}
      />
    </div>
  ) : null

  if (pinHash && !pinUnlocked) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center bg-[#eef1f5] px-4 text-slate-800">
        <form
          className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-lg ring-1 ring-black/5"
          onSubmit={(e) => {
            e.preventDefault()
            void handleUnlockPin()
          }}
        >
          <h1 className="text-lg font-semibold">Enter PIN</h1>
          <p className="mt-1 text-sm text-slate-500">
            Unlock the library to continue.
          </p>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            value={pinDraft}
            onChange={(e) => {
              setPinDraft(e.target.value)
              setPinError(null)
            }}
            className="mt-4 w-full rounded-lg bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200 outline-none focus:ring-slate-400"
            aria-label="PIN"
          />
          {pinError ? (
            <p className="mt-2 text-sm text-red-600">{pinError}</p>
          ) : null}
          <button
            type="submit"
            className="mt-4 w-full rounded-full bg-slate-900 px-3 py-2 text-sm text-white"
          >
            Unlock
          </button>
        </form>
        {toast && <Toast message={toast} />}
      </div>
    )
  }

  if (view === 'library' || view === 'trash') {
    return (
      <>
        {view === 'trash' ? (
          <div className="flex h-full min-h-0 flex-col bg-[#eef1f5] text-slate-800">
            <header className="flex items-center gap-2 px-4 py-3">
              <button
                type="button"
                className="rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-black/10"
                onClick={() => setView('library')}
              >
                Back
              </button>
              <h1 className="text-lg font-semibold">Recently deleted</h1>
            </header>
            <main className="mx-auto w-full max-w-lg flex-1 overflow-auto px-4 pb-8">
              {trashed.length === 0 ? (
                <p className="mt-8 text-sm text-slate-500">Trash is empty.</p>
              ) : (
                <ul className="space-y-2">
                  {trashed.map((row) => (
                    <li
                      key={row.notebookId}
                      className="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 shadow-sm ring-1 ring-black/5"
                    >
                      <span className="truncate text-sm">{row.meta.title}</span>
                      <span className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          className="rounded-full bg-slate-900 px-2 py-1 text-xs text-white"
                          onClick={() => void handleRestoreTrash(row.notebookId)}
                        >
                          Restore
                        </button>
                        <button
                          type="button"
                          className="rounded-full bg-white px-2 py-1 text-xs text-red-600 ring-1 ring-black/10"
                          onClick={() => {
                            if (
                              window.confirm(
                                'Delete forever? This cannot be undone on this device.',
                              )
                            ) {
                              void handlePurgeTrash(row.notebookId)
                            }
                          }}
                        >
                          Delete forever
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </main>
          </div>
        ) : (
          <LibraryPage
            notebooks={notebooks}
            folders={folders}
            importing={importing}
            onImportFiles={(files, folderId) => void handleImportFiles(files, folderId)}
            onCreateNotebook={(opts) => void handleCreateNotebook(opts)}
            onOpen={(id) => void openNotebook(id)}
            onDelete={(id) => void handleDelete(id)}
            onRename={(id, nextTitle) => void handleRename(id, nextTitle)}
            onMoveNotebook={(id, folderId) => void handleMoveNotebook(id, folderId)}
            onCreateFolder={(name) => void handleCreateFolder(name)}
            onRenameFolder={(id, name) => void handleRenameFolder(id, name)}
            onDeleteFolder={(id) => void handleDeleteFolder(id)}
            onOpenSettings={() => setSettingsOpen(true)}
            onExportNotebook={(id) => void handleExportNotebook(id)}
            driveEmail={driveEmail}
            dirtyIds={dirtyIds}
            onCreateBoard={() => void handleCreateBoard()}
            onShareNotebook={(id) => void handleShareNotebook(id)}
            onImportShareFile={(file) => void handleImportShare(file)}
            onToggleFavorite={(id) => void handleToggleFavorite(id)}
            onEditTags={(id, tagsCsv) => void handleEditTags(id, tagsCsv)}
            onOpenTrash={() => setView('trash')}
            contentSearchHits={contentSearchHits}
            onContentSearch={(q) => void handleContentSearch(q)}
          />
        )}
        {settingsOverlay}
        {toast && <Toast message={toast} />}
      </>
    )
  }

  if (view === 'board' && activeId) {
    return (
      <div className="relative flex h-full min-h-0 flex-col bg-[#cfd3da] text-slate-800">
        <header className="flex items-center gap-2 px-3 py-2">
          <button
            type="button"
            className="rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-black/10"
            onClick={() => void handleBack()}
          >
            Back
          </button>
          <input
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            className="min-w-0 flex-1 rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-black/10 outline-none"
            aria-label="Board title"
          />
        </header>
        <div className="min-h-0 flex-1">
          <BoardCanvas ref={boardRef} notebookId={activeId} />
        </div>
        {settingsOverlay}
        {toast && <Toast message={toast} />}
      </div>
    )
  }

  if (view === 'flashcards' && activeId) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[#eef1f5] text-slate-800">
        <header className="flex flex-wrap items-center gap-2 px-4 py-3">
          <button
            type="button"
            className="rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-black/10"
            onClick={() => setView('editor')}
          >
            Back to note
          </button>
          <h1 className="text-lg font-semibold">Flashcards</h1>
          <button
            type="button"
            className="ml-auto rounded-full bg-slate-900 px-3 py-1.5 text-sm text-white"
            onClick={() => void handleCreateFlashcard()}
          >
            From page text
          </button>
        </header>
        <main className="mx-auto w-full max-w-lg flex-1 overflow-auto px-4 pb-8">
          {flashcards.length === 0 ? (
            <p className="mt-8 text-sm text-slate-500">
              No flashcards yet. Create one from text boxes on the current page.
            </p>
          ) : (
            <ul className="space-y-3">
              {flashcards.map((card) => (
                <li
                  key={card.id}
                  className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-black/5"
                >
                  <p className="text-sm font-medium text-slate-900">{card.front}</p>
                  <p className="mt-1 text-sm text-slate-600">{card.back}</p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Page {card.pageIndex}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </main>
        {toast && <Toast message={toast} />}
      </div>
    )
  }

  return (
    <div
      ref={editorShellRef}
      className="relative flex h-full min-h-0 bg-[#cfd3da] text-slate-800"
    >
      <PageSidebar
        file={file}
        page={page}
        pageCount={pageInfo.pageCount}
        notebookId={activeId}
        inkEpoch={thumbEpoch}
        outline={pdfOutline}
        bookmarks={bookmarks}
        onPageChange={(p) => void handlePageChange(p)}
        onDeletePage={(p) => void handleDeletePage(p)}
        onInsertPage={(p) => void handleInsertPage(p)}
        onDuplicatePage={(p) => void handleDuplicatePage(p)}
        onMovePage={(from, to) => void handleMovePage(from, to)}
      />
      {pagesOpen && (
        <div className="fixed inset-0 z-40 sm:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            aria-label="Close pages"
            onClick={() => setPagesOpen(false)}
          />
          <div className="absolute inset-y-0 left-0">
            <PageSidebar
              variant="drawer"
              file={file}
              page={page}
              pageCount={pageInfo.pageCount}
              notebookId={activeId}
              inkEpoch={thumbEpoch}
              outline={pdfOutline}
              bookmarks={bookmarks}
              onPageChange={(p) => {
                setPagesOpen(false)
                void handlePageChange(p)
              }}
              onDeletePage={(p) => void handleDeletePage(p)}
              onInsertPage={(p) => void handleInsertPage(p)}
              onDuplicatePage={(p) => void handleDuplicatePage(p)}
              onMovePage={(from, to) => void handleMovePage(from, to)}
            />
          </div>
        </div>
      )}
      <div className="relative min-w-0 flex-1">
        <FloatingToolbar
          title={title}
          page={page}
          pageCount={pageInfo.pageCount}
          zoom={zoom}
          settings={settings}
          hidden={chromeHidden}
          exporting={exporting}
          selectionCount={selectionCount}
          canUndo={canUndo}
          canRedo={canRedo}
          placingImage={Boolean(pendingImage)}
          onBack={() => void handleBack()}
          onZoomChange={setZoom}
          onSettingsChange={handleSettingsChange}
          onToolChange={handleToolChange}
          onUndo={() => canvasRef.current?.undo()}
          onRedo={() => canvasRef.current?.redo()}
          onClear={() => canvasRef.current?.clear()}
          onExport={() => void handleExport()}
          onOpenSettings={() => {
            void (async () => {
              await flushSave()
              await canvasRef.current?.flushHistory()
              setSettingsOpen(true)
            })()
          }}
          onReveal={showChrome}
          onAddPage={() => void handleAddPage()}
          onDeleteSelection={() => canvasRef.current?.deleteSelection()}
          onDuplicateSelection={() => canvasRef.current?.duplicateSelection()}
          onRotateSelection={() => canvasRef.current?.rotateSelection()}
          onTitleChange={handleTitleChange}
          onJumpPage={(p) => void handlePageChange(p)}
          onOpenPages={() => setPagesOpen(true)}
          onInsertImage={(file) => void handleInsertImage(file)}
          onShareNotebook={() => {
            const id = activeIdRef.current
            if (id) void handleShareNotebook(id)
          }}
          onToggleRecord={() => void handleToggleRecord()}
          recording={recording}
          onPlayAudio={() => void handlePlayAudio()}
          onHighlightPdfText={() => void handleHighlightPdfText()}
          onPresent={() => void handlePresent()}
          onInsertSticker={handleInsertSticker}
          onOpenFlashcards={() => void handleOpenFlashcards()}
          onToggleBookmark={() => void handleToggleBookmark()}
        />
        {bookmarks.length > 0 && (
          <div className="absolute bottom-4 left-1/2 z-20 flex max-w-[90%] -translate-x-1/2 gap-1 overflow-x-auto rounded-full bg-white/95 px-2 py-1 shadow ring-1 ring-black/8">
            {bookmarks.map((b) => (
              <button
                key={`${b.page}-${b.label}`}
                type="button"
                className="shrink-0 rounded-full px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
                onClick={() => void handlePageChange(b.page)}
              >
                {b.label || `p.${b.page}`}
              </button>
            ))}
          </div>
        )}
        <NoteCanvas
          ref={canvasRef}
          file={file}
          documentId={activeId}
          page={page}
          pageCount={pageInfo.pageCount}
          zoom={zoom}
          settings={settings}
          initialStrokes={pageItems}
          inkEpoch={inkEpoch}
          pencilOnly={pencilOnly}
          stabilize={stabilize}
          shapeSnap={shapeSnap}
          pendingImage={pendingImage}
          onPageInfo={handlePageInfo}
          onStrokesChange={handleStrokesChange}
          onZoomChange={setZoom}
          onPageChange={(p) => void handlePageChange(p)}
          onInkActivity={handleInkActivity}
          onShowChrome={showChrome}
          onSelectionChange={setSelectionCount}
          onHistoryChange={(state) => {
            setCanUndo(state.canUndo)
            setCanRedo(state.canRedo)
          }}
          onPendingImageConsumed={() => {
            setPendingImage(null)
            handleToolChange('lasso')
          }}
        />
      </div>
      {settingsOverlay}
      {toast && <Toast message={toast} />}
    </div>
  )
}

function Toast({ message }: { message: string }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4">
      <p className="rounded-full bg-slate-900/90 px-4 py-2 text-sm text-white shadow-lg">
        {message}
      </p>
    </div>
  )
}

export default App
