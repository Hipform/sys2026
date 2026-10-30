import type { NotebookMeta } from '../types/document'

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Fields that move the Drive LWW content clock / localDirty.
 * Cover and lastPage are local chrome; they must not win over remote ink.
 */
export function metaPatchDirtiesContent(
  current: NotebookMeta,
  patch: Partial<NotebookMeta>,
): boolean {
  if (patch.title !== undefined && patch.title !== current.title) return true
  if (
    patch.folderId !== undefined &&
    (patch.folderId ?? null) !== (current.folderId ?? null)
  ) {
    return true
  }
  if (
    patch.tags !== undefined &&
    !sameJson(patch.tags ?? [], current.tags ?? [])
  ) {
    return true
  }
  if (
    patch.favorite !== undefined &&
    Boolean(patch.favorite) !== Boolean(current.favorite)
  ) {
    return true
  }
  if (
    patch.bookmarks !== undefined &&
    !sameJson(patch.bookmarks ?? [], current.bookmarks ?? [])
  ) {
    return true
  }
  return false
}
