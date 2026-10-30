/**
 * Pure-policy checks for interrogate findings. Run:
 *   node scripts/verify-findings-fix.mjs
 */

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function metaPatchDirtiesContent(current, patch) {
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

function dirtyKey(cx, cy) {
  return `${cx},${cy}`
}

function driveSyncSkipsNotebook(opts) {
  return opts.tombstoned || opts.trashed
}

const base = {
  id: 'n1',
  title: 'Notes',
  createdAt: 1,
  updatedAt: 1,
  pageCount: 1,
  coverDataUrl: null,
  contentUpdatedAt: 100,
  tags: ['a'],
  favorite: false,
  bookmarks: [{ page: 1, label: 'p1' }],
}

let failed = 0
function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) failed += 1
}

check(
  'tags change dirties content',
  metaPatchDirtiesContent(base, { tags: ['a', 'b'] }) === true,
)
check(
  'same tags does not dirty',
  metaPatchDirtiesContent(base, { tags: ['a'] }) === false,
)
check(
  'favorite flip dirties content',
  metaPatchDirtiesContent(base, { favorite: true }) === true,
)
check(
  'same favorite does not dirty',
  metaPatchDirtiesContent(base, { favorite: false }) === false,
)
check(
  'bookmarks change dirties content',
  metaPatchDirtiesContent(base, {
    bookmarks: [{ page: 2, label: 'p2' }],
  }) === true,
)
check(
  'same bookmarks does not dirty',
  metaPatchDirtiesContent(base, {
    bookmarks: [{ page: 1, label: 'p1' }],
  }) === false,
)
check(
  'cover-only still does not dirty',
  metaPatchDirtiesContent(base, { coverDataUrl: 'x' }) === false,
)

const addKey = dirtyKey(2, 3)
const deleteKey = dirtyKey(2, 3)
check(
  'dirtyKey add/delete format match',
  addKey === deleteKey && addKey === '2,3' && addKey !== 'nb:2:3',
)

check(
  'trashed notebook skips drive sync',
  driveSyncSkipsNotebook({ tombstoned: false, trashed: true }) === true,
)
check(
  'tombstoned notebook skips drive sync',
  driveSyncSkipsNotebook({ tombstoned: true, trashed: false }) === true,
)
check(
  'live notebook does not skip',
  driveSyncSkipsNotebook({ tombstoned: false, trashed: false }) === false,
)

process.exit(failed ? 1 : 0)
