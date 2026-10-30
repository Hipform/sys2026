import { useEffect, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  Cloud,
  CloudOff,
  Download,
  ArchiveRestore,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import type { NotebookRevision, TrashedNotebook } from '../types/document'
import type { ThemeMode } from '../lib/theme'

export interface SettingsPageProps {
  onBack: () => void
  pencilOnly: boolean
  stabilize: boolean
  shapeSnap: boolean
  onPencilOnlyChange: (value: boolean) => void
  onStabilizeChange: (value: boolean) => void
  onShapeSnapChange: (value: boolean) => void
  driveConfigured: boolean
  driveEmail: string | null
  driveSyncing?: boolean
  lastSyncAt: number | null
  lastBackupAt: number | null
  onConnectDrive: () => void
  onDisconnectDrive: () => void
  onSyncNow: () => void
  backingUp?: boolean
  onExportBackup: () => void
  onImportBackup: (file: File) => void
  theme?: ThemeMode
  onThemeChange?: (mode: ThemeMode) => void
  pinSet?: boolean
  onSetPin?: (pin: string) => void
  onClearPin?: () => void
  trashed?: TrashedNotebook[]
  onRestoreTrash?: (id: string) => void
  onPurgeTrash?: (id: string) => void
  revisions?: NotebookRevision[]
  onRestoreRevision?: (key: string) => void
}

export function SettingsPage({
  onBack,
  pencilOnly,
  stabilize,
  shapeSnap,
  onPencilOnlyChange,
  onStabilizeChange,
  onShapeSnapChange,
  driveConfigured,
  driveEmail,
  driveSyncing,
  lastSyncAt,
  lastBackupAt,
  onConnectDrive,
  onDisconnectDrive,
  onSyncNow,
  backingUp,
  onExportBackup,
  onImportBackup,
  theme = 'light',
  onThemeChange,
  pinSet,
  onSetPin,
  onClearPin,
  trashed = [],
  onRestoreTrash,
  onPurgeTrash,
  revisions = [],
  onRestoreRevision,
}: SettingsPageProps) {
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(
    null,
  )
  const [pinDraft, setPinDraft] = useState('')

  useEffect(() => {
    let cancelled = false
    void navigator.storage?.estimate?.().then((est) => {
      if (cancelled) return
      setUsage({
        used: est.usage ?? 0,
        quota: est.quota ?? 0,
      })
    })
    return () => {
      cancelled = true
    }
  }, [])

  const usedPct =
    usage && usage.quota > 0
      ? Math.min(100, Math.round((usage.used / usage.quota) * 100))
      : 0

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#eef1f5] text-slate-800">
      <header className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-black/10"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-lg font-semibold">Settings</h1>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-4 pb-8">
        <section className="mx-auto max-w-lg space-y-6">
          <Card title="Writing">
            <Toggle
              label="Pencil only"
              hint="Ignore finger drawing; palm stays a pan/scroll."
              value={pencilOnly}
              onChange={onPencilOnlyChange}
            />
            <Toggle
              label="Stroke stabilize"
              hint="Smooths jitter while writing."
              value={stabilize}
              onChange={onStabilizeChange}
            />
            <Toggle
              label="Shape snap"
              hint="Hold near the start of a closed shape to resize it."
              value={shapeSnap}
              onChange={onShapeSnapChange}
            />
          </Card>

          {onThemeChange && (
            <Card title="Appearance">
              <Toggle
                label="Dark mode"
                hint="Uses the system dark palette for chrome."
                value={theme === 'dark'}
                onChange={(dark) => onThemeChange(dark ? 'dark' : 'light')}
              />
            </Card>
          )}

          {(onSetPin || onClearPin) && (
            <Card title="PIN lock">
              <p className="text-sm text-slate-600">
                Optional session gate for opening notebooks. Not encryption.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="4+ digits"
                  value={pinDraft}
                  onChange={(e) => setPinDraft(e.target.value)}
                  className="w-32 rounded-lg bg-slate-50 px-3 py-1.5 text-sm ring-1 ring-slate-200 outline-none"
                />
                {onSetPin && (
                  <button
                    type="button"
                    className="rounded-full bg-slate-900 px-3 py-1.5 text-sm text-white"
                    onClick={() => {
                      const next = pinDraft.trim()
                      if (next.length < 4) return
                      onSetPin(next)
                      setPinDraft('')
                    }}
                  >
                    {pinSet ? 'Change PIN' : 'Set PIN'}
                  </button>
                )}
                {pinSet && onClearPin && (
                  <button
                    type="button"
                    className="rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-black/10"
                    onClick={onClearPin}
                  >
                    Clear PIN
                  </button>
                )}
              </div>
            </Card>
          )}

          <Card title="Google Drive">
            {!driveConfigured ? (
              <p className="text-sm text-slate-600">
                Set <code className="rounded bg-slate-100 px-1">VITE_GOOGLE_CLIENT_ID</code> to
                enable Drive sync. See the README.
              </p>
            ) : driveEmail ? (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-sm text-slate-800">
                  <Cloud className="h-4 w-4" />
                  {driveEmail}
                </p>
                <p className="text-xs text-slate-500">
                  Last sync {formatWhen(lastSyncAt)}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={driveSyncing}
                    onClick={onSyncNow}
                    className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {driveSyncing ? 'Syncing…' : 'Sync now'}
                  </button>
                  <button
                    type="button"
                    onClick={onConnectDrive}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-black/10"
                  >
                    <Cloud className="h-3.5 w-3.5" />
                    Reconnect
                  </button>
                  <button
                    type="button"
                    onClick={onDisconnectDrive}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-black/10"
                  >
                    <CloudOff className="h-3.5 w-3.5" />
                    Disconnect
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-slate-600">
                  Notes stay on this device. Connect Drive to copy them to a PDF
                  Notes folder in your Google account.
                </p>
                <button
                  type="button"
                  onClick={onConnectDrive}
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-sm text-white"
                >
                  <Cloud className="h-3.5 w-3.5" />
                  Connect Google Drive
                </button>
              </div>
            )}
          </Card>

          <Card title="Backup">
            <p className="text-sm text-slate-600">
              Download a JSON copy of every notebook on this device. Last backup{' '}
              {formatWhen(lastBackupAt)}. Restore always creates new notebook IDs
              {driveEmail
                ? ', so a later Drive sync uploads clones instead of merging with existing Drive folders'
                : ''}
              .
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={backingUp}
                onClick={onExportBackup}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-black/10 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                {backingUp ? 'Backup…' : 'Download backup'}
              </button>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-black/10">
                <ArchiveRestore className="h-3.5 w-3.5" />
                Restore
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) onImportBackup(file)
                  }}
                />
              </label>
            </div>
          </Card>

          {(onRestoreTrash || onPurgeTrash) && (
            <Card title="Recently deleted">
              {trashed.length === 0 ? (
                <p className="text-sm text-slate-600">Trash is empty.</p>
              ) : (
                <ul className="space-y-2">
                  {trashed.map((row) => (
                    <li
                      key={row.notebookId}
                      className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-2"
                    >
                      <span className="min-w-0 truncate text-sm">
                        {row.meta.title}
                      </span>
                      <span className="flex shrink-0 gap-1">
                        {onRestoreTrash && (
                          <button
                            type="button"
                            className="rounded-full bg-white px-2 py-1 text-xs ring-1 ring-black/10"
                            onClick={() => onRestoreTrash(row.notebookId)}
                          >
                            Restore
                          </button>
                        )}
                        {onPurgeTrash && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs text-red-600 ring-1 ring-black/10"
                            onClick={() => {
                              if (
                                window.confirm(
                                  'Delete forever? This cannot be undone on this device.',
                                )
                              ) {
                                onPurgeTrash(row.notebookId)
                              }
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                            Delete forever
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {revisions.length > 0 && onRestoreRevision && (
            <Card title="Revisions">
              <p className="text-sm text-slate-600">
                Local snapshots kept when Drive overwrote this notebook.
              </p>
              <ul className="mt-2 space-y-1">
                {revisions.slice(0, 8).map((rev) => (
                  <li
                    key={rev.key}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="text-slate-600">
                      {new Date(rev.savedAt).toLocaleString()} ({rev.reason})
                    </span>
                    <button
                      type="button"
                      className="rounded-full bg-white px-2 py-1 text-xs ring-1 ring-black/10"
                      onClick={() => onRestoreRevision(rev.key)}
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="This device">
            {usage && usage.quota > 0 ? (
              <>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-slate-900"
                    style={{ width: `${usedPct}%` }}
                  />
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  {formatBytes(usage.used)} of {formatBytes(usage.quota)} used (
                  {usedPct}%)
                </p>
              </>
            ) : (
              <p className="text-sm text-slate-600">
                Storage estimate is not available in this browser.
              </p>
            )}
          </Card>
        </section>
      </main>
    </div>
  )
}

function Card({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint: string
  value: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative h-6 w-10 shrink-0 rounded-full transition ${
          value ? 'bg-slate-900' : 'bg-slate-300'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
            value ? 'left-4.5' : 'left-0.5'
          }`}
          style={{ left: value ? 18 : 2 }}
        />
      </button>
    </label>
  )
}

function formatWhen(ts: number | null): string {
  if (!ts) return 'never'
  const delta = Date.now() - ts
  if (delta < 60_000) return 'just now'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} min ago`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} hr ago`
  return new Date(ts).toLocaleDateString()
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
