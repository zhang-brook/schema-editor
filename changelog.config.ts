import type { ChangelogConfig } from 'changelogen'

// 分组的先后顺序沿用 changelogen 默认（feat/perf/fix/refactor/docs/build/chore/test/style/ci），此处只改标题
// 把某个类型设为 false 可直接隐藏该组，例如 chore: false
export default {
  noAuthors: true,
  types: {
    feat: { title: '🚀 新功能' },
    fix: { title: '🩹 问题修复' },
    perf: { title: '🔥 性能优化' },
    refactor: { title: '♻️ 代码重构' },
    style: { title: '🎨 代码风格' },
    docs: { title: '📖 文档' },
    test: { title: '✅ 测试' },
    build: { title: '📦 构建' },
    ci: { title: '🤖 持续集成' },
    chore: { title: '🏡 杂项' },
    revert: { title: '⏪ 回滚' },
  },
} satisfies Partial<ChangelogConfig>
