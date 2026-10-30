const GSI_SRC = 'https://accounts.google.com/gsi/client'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const ROOT_FOLDER = 'PDF Notes'
const APP = 'pdf-notes'
const CONNECTED_KEY = 'pdf-notes-drive-connected'
const EMAIL_KEY = 'pdf-notes-drive-email'

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            callback: (resp: {
              access_token?: string
              error?: string
              expires_in?: number
            }) => void
          }) => {
            requestAccessToken: (opts?: { prompt?: string }) => void
          }
          revoke: (token: string, done?: () => void) => void
        }
      }
    }
  }
}

let accessToken: string | null = null
let tokenExpiresAt = 0
let gsiReady: Promise<void> | null = null

export function googleClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
}

export function isDriveConfigured(): boolean {
  return googleClientId().length > 0
}

export function wasDriveConnected(): boolean {
  try {
    return localStorage.getItem(CONNECTED_KEY) === '1'
  } catch {
    return false
  }
}

export function getStoredDriveEmail(): string | null {
  try {
    return localStorage.getItem(EMAIL_KEY)
  } catch {
    return null
  }
}

export function isDriveTokenLive(): boolean {
  return Boolean(accessToken && Date.now() < tokenExpiresAt - 15_000)
}

const GSI_LOAD_TIMEOUT_MS = 20_000

function loadGsi(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (gsiReady) return gsiReady
  gsiReady = new Promise((resolve, reject) => {
    let settled = false
    const fail = (err: Error) => {
      if (settled) return
      settled = true
      gsiReady = null
      reject(err)
    }
    const ok = () => {
      if (settled) return
      settled = true
      resolve()
    }
    const finish = () => {
      if (window.google?.accounts?.oauth2) ok()
      else fail(new Error('Google Sign-In is unavailable.'))
    }
    const timer = window.setTimeout(
      () => fail(new Error('Google Sign-In timed out.')),
      GSI_LOAD_TIMEOUT_MS,
    )
    const clear = () => window.clearTimeout(timer)
    const existing = document.querySelector(
      `script[src="${GSI_SRC}"]`,
    ) as HTMLScriptElement | null
    if (existing) {
      if (window.google?.accounts?.oauth2) {
        clear()
        ok()
        return
      }
      const ready = (existing as HTMLScriptElement & { readyState?: string })
        .readyState
      if (ready === 'complete' || ready === 'loaded') {
        clear()
        finish()
        return
      }
      existing.addEventListener('load', () => {
        clear()
        finish()
      })
      existing.addEventListener('error', () => {
        clear()
        fail(new Error('Could not load Google Sign-In'))
      })
      return
    }
    const script = document.createElement('script')
    script.src = GSI_SRC
    script.async = true
    script.onload = () => {
      clear()
      finish()
    }
    script.onerror = () => {
      clear()
      fail(new Error('Could not load Google Sign-In'))
    }
    document.head.appendChild(script)
  })
  return gsiReady
}

export async function connectDrive(opts?: {
  silent?: boolean
}): Promise<{ email: string }> {
  const clientId = googleClientId()
  if (!clientId) {
    throw new Error(
      'Add VITE_GOOGLE_CLIENT_ID to connect Google Drive. See README.',
    )
  }
  await loadGsi()
  const oauth = window.google?.accounts?.oauth2
  if (!oauth) throw new Error('Google Sign-In is unavailable.')

  const token = await new Promise<string>((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error || 'Drive sign-in was cancelled.'))
          return
        }
        const seconds = Number(resp.expires_in) || 3600
        accessToken = resp.access_token
        tokenExpiresAt = Date.now() + seconds * 1000
        resolve(resp.access_token)
      },
    })
    client.requestAccessToken({ prompt: opts?.silent ? 'none' : '' })
  })

  const about = await driveJson<{ user?: { emailAddress?: string } }>(
    '/about?fields=user',
    { token },
  )
  const email = about.user?.emailAddress || 'Google Drive'
  try {
    localStorage.setItem(CONNECTED_KEY, '1')
    localStorage.setItem(EMAIL_KEY, email)
  } catch {
    /* ignore */
  }
  return { email }
}

export function disconnectDrive(): void {
  const token = accessToken
  accessToken = null
  tokenExpiresAt = 0
  try {
    localStorage.removeItem(CONNECTED_KEY)
    localStorage.removeItem(EMAIL_KEY)
  } catch {
    /* ignore */
  }
  if (token && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(token)
  }
}

export async function ensureDriveToken(): Promise<string> {
  if (isDriveTokenLive() && accessToken) return accessToken
  if (!wasDriveConnected()) {
    throw new Error('Connect Google Drive in Settings.')
  }
  const { email } = await connectDrive({ silent: true })
  void email
  if (!accessToken) throw new Error('Could not refresh Drive access.')
  return accessToken
}

export interface DriveFile {
  id: string
  name?: string
  appProperties?: Record<string, string>
  modifiedTime?: string
}

async function driveFetch(
  path: string,
  init: RequestInit & { token?: string; upload?: boolean } = {},
): Promise<Response> {
  const token = init.token || (await ensureDriveToken())
  const base = init.upload ? DRIVE_UPLOAD : DRIVE_API
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  const res = await fetch(`${base}${path}`, { ...init, headers })
  if (res.status === 401) {
    accessToken = null
    throw new Error('Drive session expired. Connect again.')
  }
  return res
}

async function driveJson<T>(
  path: string,
  init: RequestInit & { token?: string; upload?: boolean } = {},
): Promise<T> {
  const res = await driveFetch(path, init)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Drive request failed (${res.status})`)
  }
  if (res.status === 204) return {} as T
  return (await res.json()) as T
}

export async function ensureRootFolder(): Promise<string> {
  const q = encodeURIComponent(
    `name = '${ROOT_FOLDER}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key='app' and value='${APP}' }`,
  )
  const listed = await driveJson<{ files?: DriveFile[] }>(
    `/files?q=${q}&fields=files(id,name)&pageSize=5`,
  )
  const existing = listed.files?.[0]
  if (existing) return existing.id
  const created = await driveJson<DriveFile>('/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: ROOT_FOLDER,
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: { app: APP, kind: 'root' },
    }),
  })
  return created.id
}

export async function listRemoteNotebooks(): Promise<DriveFile[]> {
  const q = encodeURIComponent(
    `mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key='app' and value='${APP}' } and appProperties has { key='kind' and value='notebook' }`,
  )
  const files: DriveFile[] = []
  let pageToken: string | undefined
  do {
    const tokenQ = pageToken
      ? `&pageToken=${encodeURIComponent(pageToken)}`
      : ''
    const listed = await driveJson<{
      files?: DriveFile[]
      nextPageToken?: string
    }>(
      `/files?q=${q}&fields=nextPageToken,files(id,name,appProperties,modifiedTime)&pageSize=100${tokenQ}`,
    )
    files.push(...(listed.files ?? []))
    pageToken = listed.nextPageToken
  } while (pageToken)
  return files
}

export async function ensureNotebookFolder(
  rootId: string,
  notebookId: string,
  title: string,
  existingId?: string,
): Promise<string> {
  if (existingId) {
    try {
      const meta = await driveJson<DriveFile & { trashed?: boolean }>(
        `/files/${existingId}?fields=id,trashed`,
      )
      if (meta.id && !meta.trashed) return meta.id
    } catch {
      /* recreate below */
    }
  }
  const created = await driveJson<DriveFile>('/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: title || notebookId,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [rootId],
      appProperties: { app: APP, kind: 'notebook', notebookId },
    }),
  })
  return created.id
}

export async function listChildren(folderId: string): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`)
  const files: DriveFile[] = []
  let pageToken: string | undefined
  do {
    const tokenQ = pageToken
      ? `&pageToken=${encodeURIComponent(pageToken)}`
      : ''
    const listed = await driveJson<{
      files?: DriveFile[]
      nextPageToken?: string
    }>(
      `/files?q=${q}&fields=nextPageToken,files(id,name,appProperties)&pageSize=100${tokenQ}`,
    )
    files.push(...(listed.files ?? []))
    pageToken = listed.nextPageToken
  } while (pageToken)
  return files
}

export async function uploadJsonFile(
  name: string,
  json: unknown,
  parentId: string,
  fileId?: string,
  notebookId?: string,
): Promise<string> {
  const body = JSON.stringify(json)
  return uploadMedia({
    name,
    mime: 'application/json',
    parentId,
    fileId,
    bytes: new TextEncoder().encode(body),
    notebookId,
  })
}

export async function uploadPdfFile(
  name: string,
  data: ArrayBuffer,
  parentId: string,
  fileId?: string,
  notebookId?: string,
): Promise<string> {
  return uploadMedia({
    name,
    mime: 'application/pdf',
    parentId,
    fileId,
    bytes: new Uint8Array(data),
    notebookId,
  })
}

export async function uploadBytesFile(
  name: string,
  data: ArrayBuffer,
  mime: string,
  parentId: string,
  fileId?: string,
  notebookId?: string,
): Promise<string> {
  return uploadMedia({
    name,
    mime,
    parentId,
    fileId,
    bytes: new Uint8Array(data),
    notebookId,
  })
}

async function uploadMedia(opts: {
  name: string
  mime: string
  parentId: string
  fileId?: string
  bytes: Uint8Array
  notebookId?: string
}): Promise<string> {
  const metadata: Record<string, unknown> = opts.fileId
    ? { name: opts.name }
    : {
        name: opts.name,
        parents: [opts.parentId],
        appProperties: {
          app: APP,
          ...(opts.notebookId ? { notebookId: opts.notebookId } : {}),
        },
      }
  const boundary = `pdfnotes_${Math.random().toString(36).slice(2)}`
  const head =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${opts.mime}\r\n\r\n`
  const tail = `\r\n--${boundary}--`
  const headBytes = new TextEncoder().encode(head)
  const tailBytes = new TextEncoder().encode(tail)
  const body = new Uint8Array(headBytes.length + opts.bytes.length + tailBytes.length)
  body.set(headBytes, 0)
  body.set(opts.bytes, headBytes.length)
  body.set(tailBytes, headBytes.length + opts.bytes.length)

  const path = opts.fileId
    ? `/files/${opts.fileId}?uploadType=multipart`
    : `/files?uploadType=multipart`
  const result = await driveJson<DriveFile>(path, {
    method: opts.fileId ? 'PATCH' : 'POST',
    upload: true,
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  return result.id
}

export async function downloadJson<T>(fileId: string): Promise<T> {
  const res = await driveFetch(`/files/${fileId}?alt=media`)
  if (!res.ok) throw new Error('Could not download Drive file.')
  return (await res.json()) as T
}

export async function downloadBytes(fileId: string): Promise<ArrayBuffer> {
  const res = await driveFetch(`/files/${fileId}?alt=media`)
  if (!res.ok) throw new Error('Could not download Drive file.')
  return res.arrayBuffer()
}

export async function renameFolder(folderId: string, name: string): Promise<void> {
  await driveJson(`/files/${folderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

/** Soft-delete a Drive file or folder (moves to trash). */
export async function trashDriveFile(fileId: string): Promise<void> {
  await driveJson(`/files/${fileId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  })
}
