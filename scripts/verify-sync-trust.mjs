/**
 * Phase 0 sync-trust policies. Run: node scripts/verify-sync-trust.mjs
 */

function shouldPersistOnVisibility(hidden) {
  return hidden === true
}

function shouldReuseNotebookFolder(meta) {
  return Boolean(meta?.id) && meta.trashed !== true
}

function gsiReadyAfterFailure(prevFailed) {
  return prevFailed ? null : Promise.resolve()
}

let failed = 0
function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) failed += 1
}

check(
  'visibility show must not persist',
  shouldPersistOnVisibility(false) === false,
)
check(
  'visibility hide must persist',
  shouldPersistOnVisibility(true) === true,
)
check(
  'trashed folderId must not be reused',
  shouldReuseNotebookFolder({ id: 'x', trashed: true }) === false,
)
check(
  'live folderId may be reused',
  shouldReuseNotebookFolder({ id: 'x', trashed: false }) === true,
)
check(
  'gsi failure clears sticky promise',
  gsiReadyAfterFailure(true) === null,
)

process.exit(failed ? 1 : 0)
