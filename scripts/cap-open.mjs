import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const platform = process.argv[2]
if (platform !== 'ios' && platform !== 'android') {
  console.error('Usage: node scripts/cap-open.mjs ios|android')
  process.exit(1)
}

if (!existsSync(platform)) {
  console.error(
    `Native ${platform}/ is not in this repo. Run once:\n  npx cap add ${platform}\nthen:\n  npm run cap:sync\n  npm run cap:${platform}`,
  )
  process.exit(1)
}

const result = spawnSync('npx', ['cap', 'open', platform], {
  stdio: 'inherit',
  shell: true,
})
process.exit(result.status ?? 1)
