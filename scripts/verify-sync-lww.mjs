/**
 * Pure LWW table for decideSyncAction. Run: node scripts/verify-sync-lww.mjs
 * Mirrors src/lib/sync.ts decideSyncAction.
 */
function decideSyncAction(opts) {
  if (opts.localDirty && opts.localTime >= opts.remoteContentTime) return 'push'
  if (opts.remoteContentTime > opts.localTime) return 'pull'
  return 'skip'
}

const cases = [
  {
    name: 'dirty older local must pull (not clobber newer remote)',
    opts: { localTime: 150, remoteContentTime: 200, localDirty: true },
    expect: 'pull',
  },
  {
    name: 'dirty newer local pushes',
    opts: { localTime: 250, remoteContentTime: 200, localDirty: true },
    expect: 'push',
  },
  {
    name: 'dirty equal clocks push (local wins tie)',
    opts: { localTime: 200, remoteContentTime: 200, localDirty: true },
    expect: 'push',
  },
  {
    name: 'clean local with newer remote pulls',
    opts: { localTime: 100, remoteContentTime: 300, localDirty: false },
    expect: 'pull',
  },
  {
    name: 'clean local in sync skips',
    opts: { localTime: 300, remoteContentTime: 300, localDirty: false },
    expect: 'skip',
  },
  {
    name: 'regression: old bug used remoteUpdatedAt=100 with remote content 200',
    opts: { localTime: 150, remoteContentTime: 200, localDirty: true },
    expect: 'pull',
  },
]

let failed = 0
for (const c of cases) {
  const got = decideSyncAction(c.opts)
  const ok = got === c.expect
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name} → ${got}`)
  if (!ok) failed += 1
}
process.exit(failed ? 1 : 0)
