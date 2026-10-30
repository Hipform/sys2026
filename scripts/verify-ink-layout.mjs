/**
 * Ink layout must stay viewport-independent. Run: node scripts/verify-ink-layout.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'src/lib/pdf.ts'), 'utf8')

const checks = [
  {
    name: 'exports INK_LAYOUT_CSS_WIDTH = 820',
    ok: /export const INK_LAYOUT_CSS_WIDTH = 820/.test(src),
  },
  {
    name: 'notePageMaxCssWidth returns constant',
    ok: /function notePageMaxCssWidth\(\): number \{\s*return INK_LAYOUT_CSS_WIDTH/.test(
      src,
    ),
  },
  {
    name: 'no window.innerWidth in max width helper',
    ok: !/notePageMaxCssWidth[\s\S]*?innerWidth/.test(src),
  },
]

let failed = 0
for (const c of checks) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}`)
  if (!c.ok) failed += 1
}
process.exit(failed ? 1 : 0)
