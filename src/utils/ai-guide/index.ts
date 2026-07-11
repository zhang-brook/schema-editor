/**
 * 生成面向 AI 的 JSON 结构说明文档（markdown 字符串）。
 *
 * 维护方式：本文档按「章节」拆分，每个章节是 src/utils/ai-guide/sections/*.ts
 * 中的一个 body 字符串片段。本文件只负责「按顺序装配」并自动生成中文序号标题
 * （一、二、三…），章节内容本身不在这里，便于单独维护、增删章节。
 *
 * 增删章节：编辑下方 CHAPTERS 数组的顺序 / 增删条目即可，序号会自动重排。
 *
 * 内容必须跟随代码结构变化而更新——各 sections/*.ts 是「事实来源」，
 * 任何对 Field / Index / InitialData / 目录布局的行为调整都应同步对应章节。
 *
 * 对应源文件（核对行为时用）：
 *   src/types/schema.ts            —— 全部类型定义
 *   src/utils/unified-types.ts     —— 默认统一类型集
 *   src/utils/sql-generator/*     —— 类型/默认/引号/长度解析与 SQL 生成
 *   src/utils/dialect-resolver.ts —— 方言覆盖解析
 *   src/core/workspace/layout.ts   —— 目录布局与文件名常量、结构版本号
 *   src/utils/file-helpers.ts      —— 文件读写与结构升级
 */

import { overviewBody } from './sections/overview'
import { layoutBody } from './sections/layout'
import { commonBody } from './sections/common'
import { databaseBody } from './sections/database'
import { schemaTableBody } from './sections/schemaTable'
import { fieldBody } from './sections/field'
import { indexBody } from './sections/index'
import { initialDataBody } from './sections/initialData'
import { dialectBody } from './sections/dialect'
import { checklistBody } from './sections/checklist'

/** 生成的文档文件名（写入用户打开的文件夹根目录） */
export const AI_GUIDE_FILE = 'AI_JSON_STRUCTURE_GUIDE.md'

/** 从 commonConfig 读取「是否生成 AI 指南」（缺失视为 true） */
export function loadGenerateAiGuide(commonConfig: { generate_ai_guide?: boolean } | null | undefined): boolean {
  return commonConfig?.generate_ai_guide ?? false
}

/** 将「是否生成 AI 指南」写入 commonConfig（就地修改，随 common.json 落盘） */
export function saveGenerateAiGuide(
  commonConfig: { generate_ai_guide?: boolean } | null | undefined,
  enabled: boolean,
): void {
  if (!commonConfig) return
  commonConfig.generate_ai_guide = enabled
}

// ===== 章节装配 =====

/** 单个章节：标题 + 正文（正文用 ### 级，由装配器统一升为 ## 序号标题） */
interface Chapter {
  title: string
  body: string
}

/** 章节顺序与标题（改这里即可增删/排序，序号自动生成） */
const CHAPTERS: Chapter[] = [
  { title: '总则', body: overviewBody },
  { title: '目录布局（用户打开的文件夹）', body: layoutBody },
  { title: 'common.json', body: commonBody },
  { title: 'current/database.json', body: databaseBody },
  { title: 'schema.json 与 table.json', body: schemaTableBody },
  { title: 'Field（字段）详解', body: fieldBody },
  { title: 'Index（索引）', body: indexBody },
  { title: 'initial-data.json（初始数据）', body: initialDataBody },
  { title: '方言覆盖通用规则', body: dialectBody },
  { title: 'AI 改 JSON 前快速核查清单', body: checklistBody },
]

/** 数字转中文序号（支持 1~99；超出回退为数字） */
function toChineseNum(n: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (n === 10) return '十'
  if (n >= 1 && n < 10) return digits[n]!
  if (n > 10 && n < 20) return '十' + digits[n - 10]!
  if (n >= 20 && n < 100) {
    const tens = Math.floor(n / 10)
    const ones = n % 10
    return digits[tens]! + '十' + (ones === 0 ? '' : digits[ones]!)
  }
  return String(n)
}

/** 生成单章节 markdown（## 一、标题 + 正文） */
function renderChapter(chapter: Chapter, index: number): string {
  const num = toChineseNum(index + 1)
  // 正文统一以双换行衔接，避免与标题粘连
  return `## ${num}、${chapter.title}\n\n${chapter.body.trim()}\n`
}

/** 生成 markdown 文档内容（纯字符串，便于直接写盘） */
export function generateAiGuideMarkdown(): string {
  const header = `# Schema Editor 项目 JSON 结构指南（面向 AI 修改）

> 本文件由 schema-editor 自动生成，用于让 AI 在修改本文件夹（被编辑的 schema 项目）内的 JSON 时，
> 准确理解结构语义、字段约定与常见坑。**本文档由 schema-editor 自动生成，本地改动会在下次打开项目时被覆盖，请勿手工修改。**
>
> 关键源码事实来源：\`src/types/schema.ts\`、\`src/utils/sql-generator/*\`、\`src/core/workspace/layout.ts\`、\`src/utils/unified-types.ts\`。`

  const chapters = CHAPTERS.map(renderChapter).join('\n')
  return `${header}\n\n${chapters}`
}
