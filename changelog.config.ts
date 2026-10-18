import type { ChangelogConfig } from 'changelogen'

// 分组的先后顺序沿用 changelogen 默认（feat/perf/fix/refactor/docs/build/chore/test/style/ci），此处只改标题
// 把某个类型设为 false 可直接隐藏该组，例如 chore: false
export default {
  noAuthors: true,
  types: {
    feat: { title: '🚀 Features' },
    fix: { title: '🩹 Bug Fixes' },
    perf: { title: '🔥 Performance' },
    refactor: { title: '♻️ Refactoring' },
    style: { title: '🎨 Styles' },
    docs: { title: '📖 Documentation' },
    test: { title: '✅ Tests' },
    build: { title: '📦 Build' },
    ci: { title: '🤖 CI' },
    chore: { title: '🏡 Chores' },
    revert: { title: '⏪ Reverts' },
  },
} satisfies Partial<ChangelogConfig>
