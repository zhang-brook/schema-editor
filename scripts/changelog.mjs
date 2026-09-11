import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const changelogPath = fileURLToPath(new URL('../CHANGELOG.md', import.meta.url))

// 版本号取自 package.json，提交范围默认是「上一个 tag → HEAD」
if (existsSync(changelogPath) && new RegExp(`^## v${version}\\.?\\s*$`, 'm').test(readFileSync(changelogPath, 'utf8'))) {
  console.error(`CHANGELOG.md 已包含 v${version}，如需重新生成请先删除该小节`)
  process.exit(1)
}

const { status } = spawnSync('pnpm', ['exec', 'changelogen', '--output', 'CHANGELOG.md', '-r', version], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

process.exit(status ?? 1)
