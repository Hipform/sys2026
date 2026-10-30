/** Thin native bridge for Capacitor shells (Phase 9). Safe no-ops on web. */

export function isNativeShell(): boolean {
  try {
    return Boolean(
      (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
        .Capacitor?.isNativePlatform?.(),
    )
  } catch {
    return false
  }
}

export function nativePlatform(): 'ios' | 'android' | 'web' {
  try {
    const cap = (
      window as unknown as {
        Capacitor?: { getPlatform?: () => string }
      }
    ).Capacitor
    const p = cap?.getPlatform?.()
    if (p === 'ios' || p === 'android') return p
  } catch {
    /* web */
  }
  return 'web'
}

/**
 * Map platform stylus shortcuts to pencil-only / tool toggles.
 * iPadOS pencil double-tap and Android stylus buttons arrive as custom events
 * once Capacitor plugins are installed; until then this is a stable hook.
 */
export function onNativeStylusAction(
  handler: (action: 'toggle-eraser' | 'undo' | 'pencil-only') => void,
): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<{ action?: string }>).detail
    if (detail?.action === 'toggle-eraser') handler('toggle-eraser')
    else if (detail?.action === 'undo') handler('undo')
    else if (detail?.action === 'pencil-only') handler('pencil-only')
  }
  window.addEventListener('pdf-notes-stylus', listener)
  return () => window.removeEventListener('pdf-notes-stylus', listener)
}

export async function nativeShareFile(
  filename: string,
  blob: Blob,
): Promise<boolean> {
  if (!isNativeShell()) return false
  try {
    const nav = navigator as Navigator & {
      share?: (data: { files?: File[]; title?: string }) => Promise<void>
      canShare?: (data: { files?: File[] }) => boolean
    }
    const file = new File([blob], filename, { type: blob.type })
    if (nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: filename })
      return true
    }
  } catch {
    return false
  }
  return false
}
