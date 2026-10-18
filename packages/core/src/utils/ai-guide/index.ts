/**
 * Generates an AI-facing JSON structure guide document (a Markdown string).
 *
 * Maintenance: this document is split into "chapters"; each chapter is a body string
 * fragment in src/utils/ai-guide/sections/*.ts. This file only assembles them in order
 * and auto-generates Chinese ordinal headings (one, two, three ...); chapter bodies live
 * elsewhere, which keeps chapters easy to maintain, add and remove.
 *
 * Adding/removing chapters: edit the order / entries of the CHAPTERS array below; ordinals are renumbered automatically.
 *
 * Content must follow code structure changes —— each sections/*.ts is the "source of truth";
 * any behavior change to Field / Index / InitialData / directory layout must be mirrored in the matching chapter.
 *
 * Corresponding source files (for behavior verification):
 *   src/types/schema.ts            —— all type definitions
 *   src/utils/unified-types.ts     —— default unified type set
 *   src/utils/sql-generator/*     —— type/default/quote/length parsing and SQL generation
 *   src/utils/dialect-resolver.ts —— dialect override resolution
 *   src/core/workspace/layout.ts   —— directory layout, filename constants and structure version
 *   src/utils/file-helpers.ts      —— file I/O and structure upgrades
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

/** Generated document filename (written to the root of the folder the user opened) */
export const AI_GUIDE_FILE = 'AI_JSON_STRUCTURE_GUIDE.md'

/** Reads "generate AI guide" from commonConfig (missing means false) */
export function loadGenerateAiGuide(commonConfig: { generate_ai_guide?: boolean } | null | undefined): boolean {
  return commonConfig?.generate_ai_guide ?? false
}

/** Writes "generate AI guide" into commonConfig (modified in place, persisted with common.json) */
export function saveGenerateAiGuide(
  commonConfig: { generate_ai_guide?: boolean } | null | undefined,
  enabled: boolean,
): void {
  if (!commonConfig) return
  commonConfig.generate_ai_guide = enabled
}

// ===== Chapter assembly =====

/** A single chapter: title + body (body uses ### headings; the assembler promotes them to ## numbered headings) */
interface Chapter {
  title: string
  body: string
}

/** Chapter order and titles (add/remove/reorder entries here; ordinals are generated automatically) */
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

/** Converts a number to a Chinese ordinal (supports 1-99; falls back to the plain number beyond that) */
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

/** Renders a single chapter as Markdown (## ordinal + title line, then body) */
function renderChapter(chapter: Chapter, index: number): string {
  const num = toChineseNum(index + 1)
  // Always join the body with a double newline so it does not stick to the heading
  return `## ${num}、${chapter.title}\n\n${chapter.body.trim()}\n`
}

/** Generates the Markdown document content (a plain string, ready to write to disk) */
export function generateAiGuideMarkdown(): string {
  const header = `# Schema Editor 项目 JSON 结构指南（面向 AI 修改）

> 本文件由 schema-editor 自动生成，用于让 AI 在修改本文件夹（被编辑的 schema 项目）内的 JSON 时，
> 准确理解结构语义、字段约定与常见坑。**本文档由 schema-editor 自动生成，本地改动会在下次打开项目时被覆盖，请勿手工修改。**
>
> 关键源码事实来源：\`src/types/schema.ts\`、\`src/utils/sql-generator/*\`、\`src/core/workspace/layout.ts\`、\`src/utils/unified-types.ts\`。`

  const chapters = CHAPTERS.map(renderChapter).join('\n')
  return `${header}\n\n${chapters}`
}
