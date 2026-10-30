import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Cloud,
  FilePlus,
  FileUp,
  Folder,
  FolderPlus,
  LayoutDashboard,
  Search,
  Settings,
  Star,
  Trash2,
} from 'lucide-react'
import type { Folder as FolderMeta, NotebookMeta } from '../types/document'
import type { PaperTemplate } from '../types/note'

export type ContentSearchHit = {
  notebookId: string
  pageIndex: number
  snippet: string
}

const FOLDER_KEY = 'pdf-notes-folder-filter'
const QUERY_KEY = 'pdf-notes-search'

export interface LibraryPageProps {
  notebooks: NotebookMeta[]
  folders: FolderMeta[]
  importing: boolean
  onImportFiles: (files: File[], folderId?: string | null) => void
  onCreateNotebook: (opts: {
    title: string
    template: PaperTemplate
    pageCount: number
    folderId?: string | null
  }) => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  onMoveNotebook: (id: string, folderId: string | null) => void
  onCreateFolder: (name: string) => void
  onRenameFolder: (id: string, name: string) => void
  onDeleteFolder: (id: string) => void
  onOpenSettings: () => void
  onExportNotebook: (id: string) => void
  driveEmail?: string | null
  dirtyIds?: string[]
  onCreateBoard?: () => void
  onShareNotebook?: (id: string) => void
  onImportShareFile?: (file: File) => void
  onToggleFavorite?: (id: string) => void
  onEditTags?: (id: string, tagsCsv: string) => void
  onOpenTrash?: () => void
  contentSearchHits?: ContentSearchHit[]
  onContentSearch?: (query: string) => void
}

function readSession(key: string, fallback: string): string {
  try {
    return sessionStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

export function LibraryPage({
  notebooks,
  folders,
  importing,
  onImportFiles,
  onCreateNotebook,
  onOpen,
  onDelete,
  onRename,
  onMoveNotebook,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onOpenSettings,
  onExportNotebook,
  driveEmail,
  dirtyIds = [],
  onCreateBoard,
  onShareNotebook,
  onImportShareFile,
  onToggleFavorite,
  onEditTags,
  onOpenTrash,
  contentSearchHits = [],
  onContentSearch,
}: LibraryPageProps) {
  const [folderFilter, setFolderFilter] = useState<string | 'all'>(() => {
    const stored = readSession(FOLDER_KEY, 'all')
    return stored
  })
  const [query, setQuery] = useState(() => readSession(QUERY_KEY, ''))
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [composer, setComposer] = useState(false)
  const [folderSheet, setFolderSheet] = useState(false)
  const [newTitle, setNewTitle] = useState('Untitled')
  const [newTemplate, setNewTemplate] = useState<PaperTemplate>('blank')
  const [newPages, setNewPages] = useState(8)
  const [menu, setMenu] = useState<{
    id: string
    x: number
    y: number
  } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [nameModal, setNameModal] = useState<{
    title: string
    value: string
    allowEmpty?: boolean
    submit: (value: string) => void
  } | null>(null)
  const suppressClickRef = useRef(false)
  const pressTimerRef = useRef<number | null>(null)
  const pressStartRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    try {
      sessionStorage.setItem(FOLDER_KEY, folderFilter)
      sessionStorage.setItem(QUERY_KEY, query)
    } catch {
      /* ignore */
    }
  }, [folderFilter, query])

  useEffect(() => {
    onContentSearch?.(query)
  }, [query, onContentSearch])

  useEffect(() => {
    if (folderFilter !== 'all' && !folders.some((f) => f.id === folderFilter)) {
      setFolderFilter('all')
    }
  }, [folderFilter, folders])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  const clearPress = () => {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current)
      pressTimerRef.current = null
    }
    pressStartRef.current = null
  }

  const commitRename = (id: string) => {
    const next = draftTitle.trim()
    setRenamingId(null)
    if (next) onRename(id, next)
  }

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const nb of notebooks) {
      for (const tag of nb.tags ?? []) {
        if (tag.trim()) set.add(tag.trim())
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [notebooks])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const hitIds = new Set(contentSearchHits.map((h) => h.notebookId))
    return notebooks
      .filter((nb) => {
        if (folderFilter !== 'all' && (nb.folderId ?? null) !== folderFilter) {
          return false
        }
        if (tagFilter) {
          const tags = nb.tags ?? []
          if (!tags.some((t) => t === tagFilter)) return false
        }
        if (!q) return true
        if (nb.title.toLowerCase().includes(q)) return true
        if ((nb.tags ?? []).some((t) => t.toLowerCase().includes(q))) {
          return true
        }
        return hitIds.has(nb.id)
      })
      .sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite))
  }, [notebooks, folderFilter, query, contentSearchHits, tagFilter])

  const takeFiles = (list: FileList | File[] | null) => {
    if (!list) return
    const files = [...list]
    if (files.length > 0) {
      onImportFiles(files, folderFilter === 'all' ? null : folderFilter)
    }
  }

  const openNewFolder = () => {
    setNameModal({
      title: 'Folder name',
      value: '',
      submit: (name) => onCreateFolder(name),
    })
  }

  const folderList = (
    <>
      <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Folders
      </p>
      <button
        type="button"
        onClick={() => {
          setFolderFilter('all')
          setFolderSheet(false)
        }}
        className={`mt-2 w-full rounded-lg px-2 py-1.5 text-left text-sm ${
          folderFilter === 'all'
            ? 'bg-slate-900 text-white'
            : 'text-slate-700 hover:bg-slate-100'
        }`}
      >
        All notes
      </button>
      <ul className="mt-1 space-y-0.5">
        {folders.map((folder) => (
          <li key={folder.id} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setFolderFilter(folder.id)
                setFolderSheet(false)
              }}
              onDoubleClick={() => {
                setNameModal({
                  title: 'Rename folder',
                  value: folder.name,
                  submit: (name) => onRenameFolder(folder.id, name),
                })
              }}
              className={`min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-sm ${
                folderFilter === folder.id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {folder.name}
            </button>
            <button
              type="button"
              className="rounded px-1 text-xs text-slate-400 hover:text-red-600"
              title="Delete folder"
              onClick={() => void onDeleteFolder(folder.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="mt-3 inline-flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-100"
        onClick={openNewFolder}
      >
        <FolderPlus className="h-4 w-4" />
        New folder
      </button>
      {onOpenTrash && (
        <button
          type="button"
          className="mt-1 inline-flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-100"
          onClick={() => {
            setFolderSheet(false)
            onOpenTrash()
          }}
        >
          <Trash2 className="h-4 w-4" />
          Recently deleted
        </button>
      )}
    </>
  )

  return (
    <div
      className="flex h-full min-h-0 bg-[#eef1f5] text-slate-800"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        takeFiles(e.dataTransfer.files)
      }}
    >
      <aside className="hidden w-56 shrink-0 border-r border-black/5 bg-white/70 px-3 py-4 sm:block">
        {folderList}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Documents
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">
              PDFs stay on this device. Ink is saved automatically.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {driveEmail && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs text-slate-600 shadow-sm ring-1 ring-black/10">
                <Cloud className="h-3.5 w-3.5" />
                {driveEmail}
              </span>
            )}
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm ring-1 ring-black/10 sm:hidden"
              onClick={() => setFolderSheet(true)}
            >
              <Folder className="h-4 w-4" />
              Folders
            </button>
            <label className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search titles or tags"
                className="h-9 w-44 rounded-full bg-white pl-8 pr-3 text-sm ring-1 ring-black/10 outline-none focus:ring-slate-400"
              />
            </label>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm ring-1 ring-black/10 hover:bg-slate-50"
              onClick={() => setComposer(true)}
            >
              <FilePlus className="h-4 w-4" />
              New notebook
            </button>
            {onCreateBoard && (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm ring-1 ring-black/10 hover:bg-slate-50"
                onClick={onCreateBoard}
              >
                <LayoutDashboard className="h-4 w-4" />
                New board
              </button>
            )}
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800">
              <FileUp className="h-4 w-4" aria-hidden />
              {importing ? 'Importing…' : 'Import PDF'}
              <input
                type="file"
                accept="application/pdf"
                multiple
                className="hidden"
                disabled={importing}
                onChange={(e) => {
                  takeFiles(e.target.files)
                  e.target.value = ''
                }}
              />
            </label>
            {onImportShareFile && (
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm ring-1 ring-black/10 hover:bg-slate-50">
                Import share
                <input
                  type="file"
                  accept=".json,.pdfnotes.json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) onImportShareFile(file)
                  }}
                />
              </label>
            )}
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm ring-1 ring-black/10 hover:bg-slate-50"
              onClick={onOpenSettings}
            >
              <Settings className="h-4 w-4" />
              Settings
            </button>
          </div>
        </header>

        <main className="relative min-h-0 flex-1 overflow-auto px-5 pb-8 sm:px-8">
          {allTags.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setTagFilter(null)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  tagFilter === null
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-600 ring-1 ring-black/10'
                }`}
              >
                All tags
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() =>
                    setTagFilter((prev) => (prev === tag ? null : tag))
                  }
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    tagFilter === tag
                      ? 'bg-slate-900 text-white'
                      : 'bg-white text-slate-600 ring-1 ring-black/10'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
          {dragging && (
            <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-slate-400 bg-white/80 text-sm font-medium text-slate-600">
              Drop PDFs to import
            </div>
          )}
          {query.trim() && contentSearchHits.length > 0 && (
            <div className="mb-4 rounded-xl bg-white/80 p-3 text-sm ring-1 ring-black/5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                In notebook text
              </p>
              <ul className="mt-1 space-y-1">
                {contentSearchHits.slice(0, 8).map((hit, i) => (
                  <li key={`${hit.notebookId}-${hit.pageIndex}-${i}`}>
                    <button
                      type="button"
                      className="w-full truncate text-left text-slate-700 hover:text-slate-900"
                      onClick={() => onOpen(hit.notebookId)}
                    >
                      p.{hit.pageIndex}: {hit.snippet}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {visible.length === 0 ? (
            <div className="mx-auto mt-16 max-w-md rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 py-14 text-center">
              <p className="text-base font-medium text-slate-700">
                No notebooks yet
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Create a blank note or import a PDF to start writing.
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {visible.map((nb) => (
                <li key={nb.id}>
                  <article className="relative">
                    <button
                      type="button"
                      aria-label={`Open ${nb.title}`}
                      onClick={() => {
                        if (suppressClickRef.current) {
                          suppressClickRef.current = false
                          return
                        }
                        if (renamingId === nb.id) return
                        onOpen(nb.id)
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setMenu({ id: nb.id, x: e.clientX, y: e.clientY })
                      }}
                      onPointerDown={(e) => {
                        if (e.pointerType === 'mouse' && e.button !== 0) return
                        pressStartRef.current = { x: e.clientX, y: e.clientY }
                        pressTimerRef.current = window.setTimeout(() => {
                          pressTimerRef.current = null
                          suppressClickRef.current = true
                          setMenu({ id: nb.id, x: e.clientX, y: e.clientY })
                        }, 520)
                      }}
                      onPointerMove={(e) => {
                        const start = pressStartRef.current
                        if (!start) return
                        if (
                          Math.hypot(e.clientX - start.x, e.clientY - start.y) >
                          12
                        ) {
                          clearPress()
                        }
                      }}
                      onPointerUp={clearPress}
                      onPointerCancel={clearPress}
                      className="block w-full text-left"
                    >
                      <div className="aspect-[3/4] overflow-hidden rounded-xl bg-white shadow-[0_10px_28px_rgba(15,23,42,0.12)] ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(15,23,42,0.16)]">
                        {nb.coverDataUrl ? (
                          <img
                            src={nb.coverDataUrl}
                            alt=""
                            className="h-full w-full object-cover object-top"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center bg-slate-100 text-xs text-slate-400">
                            No preview
                          </div>
                        )}
                      </div>
                    </button>
                    {renamingId === nb.id ? (
                      <input
                        autoFocus
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        onBlur={() => commitRename(nb.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                        className="mt-2.5 w-full rounded-md bg-white px-1.5 py-0.5 text-sm font-medium text-slate-900 ring-1 ring-slate-300 outline-none"
                      />
                    ) : (
                      <h2 className="mt-2.5 flex items-center gap-1 truncate text-sm font-medium text-slate-900">
                        {nb.favorite ? (
                          <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
                        ) : null}
                        <span className="truncate">{nb.title}</span>
                        {nb.kind === 'board' ? (
                          <span className="shrink-0 text-[10px] font-normal text-slate-400">
                            board
                          </span>
                        ) : null}
                      </h2>
                    )}
                    <p className="text-xs text-slate-500">
                      {nb.pageCount} page{nb.pageCount === 1 ? '' : 's'} ·{' '}
                      {formatUpdated(nb.updatedAt)}
                      {dirtyIds.includes(nb.id) ? ' · sync pending' : ''}
                    </p>
                    {(nb.tags?.length ?? 0) > 0 ? (
                      <p className="mt-1 flex flex-wrap gap-1">
                        {nb.tags!.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            className="rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                            onClick={(e) => {
                              e.stopPropagation()
                              setTagFilter(tag)
                            }}
                          >
                            {tag}
                          </button>
                        ))}
                      </p>
                    ) : null}
                  </article>
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>

      {folderSheet && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/30"
            aria-label="Close folders"
            onClick={() => setFolderSheet(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[70vh] overflow-auto rounded-t-2xl bg-white px-3 py-4 shadow-2xl">
            {folderList}
          </div>
        </div>
      )}

      {composer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl">
            <h2 className="text-base font-semibold">New notebook</h2>
            <label className="mt-3 block text-xs font-medium text-slate-500">
              Title
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="mt-1 w-full rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-900 ring-1 ring-slate-200 outline-none focus:ring-slate-400"
              />
            </label>
            <p className="mt-3 text-xs font-medium text-slate-500">Paper</p>
            <div className="mt-1 grid grid-cols-4 gap-1">
              {(
                [
                  ['blank', 'Blank'],
                  ['lined', 'Lined'],
                  ['grid', 'Grid'],
                  ['dotted', 'Dotted'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setNewTemplate(value)}
                  className={`rounded-lg px-2 py-2 text-xs font-medium ${
                    newTemplate === value
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="mt-3 block text-xs font-medium text-slate-500">
              Pages
              <input
                type="number"
                min={1}
                max={80}
                value={newPages}
                onChange={(e) =>
                  setNewPages(Math.max(1, Math.min(80, Number(e.target.value) || 1)))
                }
                className="mt-1 w-full rounded-lg bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200 outline-none"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-full px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                onClick={() => setComposer(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-full bg-slate-900 px-3 py-1.5 text-sm text-white"
                onClick={() => {
                  onCreateNotebook({
                    title: newTitle,
                    template: newTemplate,
                    pageCount: newPages,
                    folderId: folderFilter === 'all' ? null : folderFilter,
                  })
                  setComposer(false)
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {nameModal && (
        <NameModal
          title={nameModal.title}
          value={nameModal.value}
          allowEmpty={nameModal.allowEmpty}
          onCancel={() => setNameModal(null)}
          onSubmit={(value) => {
            nameModal.submit(value)
            setNameModal(null)
          }}
        />
      )}

      {menu && (
        <div
          className="fixed z-50 min-w-[11rem] overflow-hidden rounded-xl bg-white py-1 shadow-[0_16px_40px_rgba(15,23,42,0.18)] ring-1 ring-black/10"
          style={{
            left: Math.min(menu.x, window.innerWidth - 200),
            top: Math.min(menu.y, window.innerHeight - 220),
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
            onClick={() => {
              const nb = notebooks.find((n) => n.id === menu.id)
              setDraftTitle(nb?.title ?? '')
              setRenamingId(menu.id)
              setMenu(null)
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
            onClick={() => {
              const id = menu.id
              setMenu(null)
              onExportNotebook(id)
            }}
          >
            Export PDF
          </button>
          {onShareNotebook && (
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
              onClick={() => {
                const id = menu.id
                setMenu(null)
                onShareNotebook(id)
              }}
            >
              Share
            </button>
          )}
          {onToggleFavorite && (
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
              onClick={() => {
                const id = menu.id
                setMenu(null)
                onToggleFavorite(id)
              }}
            >
              {notebooks.find((n) => n.id === menu.id)?.favorite
                ? 'Unfavorite'
                : 'Favorite'}
            </button>
          )}
          {onEditTags && (
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
              onClick={() => {
                const nb = notebooks.find((n) => n.id === menu.id)
                const id = menu.id
                setMenu(null)
                setNameModal({
                  title: 'Tags (comma-separated)',
                  value: (nb?.tags ?? []).join(', '),
                  allowEmpty: true,
                  submit: (value) => onEditTags(id, value),
                })
              }}
            >
              Edit tags
            </button>
          )}
          <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Move to
          </div>
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
            onClick={() => {
              onMoveNotebook(menu.id, null)
              setMenu(null)
            }}
          >
            All notes
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className="block w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
              onClick={() => {
                onMoveNotebook(menu.id, folder.id)
                setMenu(null)
              }}
            >
              {folder.name}
            </button>
          ))}
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
            onClick={() => {
              const id = menu.id
              setMenu(null)
              onDelete(id)
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

function NameModal({
  title,
  value,
  allowEmpty = false,
  onCancel,
  onSubmit,
}: {
  title: string
  value: string
  allowEmpty?: boolean
  onCancel: () => void
  onSubmit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/30 p-4">
      <form
        className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl"
        onSubmit={(e) => {
          e.preventDefault()
          const next = draft.trim()
          if (next || allowEmpty) onSubmit(next)
        }}
      >
        <h2 className="text-base font-semibold">{title}</h2>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="mt-3 w-full rounded-lg bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200 outline-none focus:ring-slate-400"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-full px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-full bg-slate-900 px-3 py-1.5 text-sm text-white"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  )
}

function formatUpdated(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
