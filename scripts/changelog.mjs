import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  generateMarkDown,
  getCurrentGitRef,
  getGitDiff,
  getLastGitTag,
  loadChangelogConfig,
  parseCommits,
} from 'changelogen'

const cwd = fileURLToPath(new URL('..', import.meta.url))
const changelogPath = fileURLToPath(new URL('../CHANGELOG.md', import.meta.url))
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const git = (args) => spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout.trim()
const gitRefExists = (ref) => spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd }).status === 0

const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : ''

if (new RegExp(`^## v${version.replace(/\./g, '\\.')}\\.?\\s*$`, 'm').test(changelog)) {
  console.error(`CHANGELOG.md already contains v${version}; delete that section before regenerating`)
  process.exit(1)
}

// Only start from versions that have both a CHANGELOG section and a matching tag, so commits tagged without a section are never skipped
const from =
  [...changelog.matchAll(/^##\s+(v?[\d.]+)/gm)]
    .map((match) => match[1])
    .find((tag) => gitRefExists(tag)) ||
  (await getLastGitTag(cwd)) ||
  git(['rev-list', '--max-parents=0', 'HEAD'])

const config = await loadChangelogConfig(cwd, {
  from,
  to: await getCurrentGitRef(cwd),
  newVersion: version,
})

// The changelogen CLI unconditionally drops chore(deps)/chore(release); here inclusion is decided solely by the types in the config
const commits = parseCommits(await getGitDiff(config.from, config.to, cwd), config)
  .map((commit) => ({ ...commit, type: commit.type.toLowerCase() }))
  .filter((commit) => config.types[commit.type])

const markdown = await generateMarkDown(commits, config)
const firstEntry = changelog.match(/^###?\s+.*$/m)
const updated = firstEntry
  ? changelog.slice(0, firstEntry.index) + markdown + '\n\n' + changelog.slice(firstEntry.index)
  : (changelog || '# Changelog\n\n') + '\n' + markdown + '\n\n'

writeFileSync(changelogPath, updated)
console.log(`Wrote section v${version} (${config.from}...${config.to}, ${commits.length} commits)`)

