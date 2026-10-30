/**
 * Pure policies for Act On hardening. Run: node scripts/verify-acton-hardening.mjs
 * Mirrors src/lib/metaContent.ts, tombstonePolicy.ts, serialQueue.ts.
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

function tombstoneAction(opts) {
  return opts.listedInRemotes ? 'trash' : 'drop'
}

class SerialQueue {
  constructor() {
    this.tail = Promise.resolve()
  }
  enqueue(fn) {
    const run = this.tail.then(fn, fn)
    this.tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

const base = {
  id: 'n1',
  title: 'Notes',
  createdAt: 1,
  updatedAt: 1,
  pageCount: 1,
  coverDataUrl: null,
  contentUpdatedAt: 100,
}

const cases = []

function check(name, ok) {
  cases.push({ name, ok })
}

check(
  'closeEditor same title does not dirty content',
  metaPatchDirtiesContent(base, { title: 'Notes' }) === false,
)
check(
  'cover-only patch does not dirty content',
  metaPatchDirtiesContent(base, { coverDataUrl: 'data:image/png;base64,xx' }) ===
    false,
)
check(
  'lastPage-only patch does not dirty content',
  metaPatchDirtiesContent(base, { lastPage: 3 }) === false,
)
check(
  'real title rename dirties content',
  metaPatchDirtiesContent(base, { title: 'Renamed' }) === true,
)
check(
  'folder move dirties content',
  metaPatchDirtiesContent(base, { folderId: 'f1' }) === true,
)
check(
  'same folderId does not dirty',
  metaPatchDirtiesContent({ ...base, folderId: 'f1' }, { folderId: 'f1' }) ===
    false,
)

check(
  'tombstone drops when remote list no longer has notebook',
  tombstoneAction({ listedInRemotes: false }) === 'drop',
)
check(
  'tombstone trashes (and retains) while still listed',
  tombstoneAction({ listedInRemotes: true }) === 'trash',
)
check(
  'regression: trash success alone must not imply drop',
  tombstoneAction({ listedInRemotes: true }) !== 'drop',
)

let failed = 0
for (const c of cases) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}`)
  if (!c.ok) failed += 1
}

const order = []
const q = new SerialQueue()
const slow = q.enqueue(
  () =>
    new Promise((resolve) => {
      setTimeout(() => {
        order.push('old-write')
        resolve()
      }, 30)
    }),
)
const remap = q.enqueue(async () => {
  order.push('remap')
})
await Promise.all([slow, remap])
const queueOk = order[0] === 'old-write' && order[1] === 'remap'
console.log(
  `${queueOk ? 'PASS' : 'FAIL'} history serial queue runs remap after in-flight write → ${order.join(',')}`,
)
if (!queueOk) failed += 1

process.exit(failed ? 1 : 0)
