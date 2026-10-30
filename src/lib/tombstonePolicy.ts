/** Keep tombstone until the notebook is absent from a fresh remote list. */
export function tombstoneAction(opts: {
  listedInRemotes: boolean
}): 'trash' | 'drop' {
  return opts.listedInRemotes ? 'trash' : 'drop'
}
