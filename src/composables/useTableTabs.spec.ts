import { describe, expect, it } from 'vitest'
import type { Schema, Table } from '@/types/schema'
import { addTab, removeTab, type TableTab } from './useTableTabs'

function makeTab(schemaName: string, tableName: string): TableTab {
  const table = { name: tableName, fields: [], indexes: [] } as unknown as Table
  const schema = { schema: schemaName, tables: [table] } as unknown as Schema
  return { schema, table }
}

function names(tabs: TableTab[]): string[] {
  return tabs.map(tab => `${tab.schema.schema}.${tab.table.name}`)
}

describe('表标签列表逻辑', () => {
  it('追加新标签', () => {
    const tabs: TableTab[] = []
    addTab(tabs, makeTab('app', 'users'), () => false)
    addTab(tabs, makeTab('app', 'orders'), () => false)
    expect(names(tabs)).toEqual(['app.users', 'app.orders'])
  })

  it('同一张表不重复进标签', () => {
    const tabs: TableTab[] = []
    const tab = makeTab('app', 'users')
    addTab(tabs, tab, () => false)
    addTab(tabs, tab, () => false)
    addTab(tabs, { ...tab }, () => false)
    expect(tabs).toHaveLength(1)
  })

  it('超出上限时丢弃最早的非当前标签', () => {
    const tabs: TableTab[] = []
    for (let i = 0; i < 13; i++) addTab(tabs, makeTab('app', `t${i}`), tab => tab.table.name === 't12')
    expect(tabs).toHaveLength(12)
    expect(names(tabs)[0]).toBe('app.t1')
    expect(names(tabs)[11]).toBe('app.t12')
  })

  it('移除标签时返回右邻，无右邻取左邻', () => {
    const a = makeTab('app', 'a')
    const b = makeTab('app', 'b')
    const c = makeTab('app', 'c')
    const tabs = [a, b, c]
    expect(removeTab(tabs, b)).toBe(c)
    expect(names(tabs)).toEqual(['app.a', 'app.c'])
    expect(removeTab(tabs, c)).toBe(a)
  })

  it('移除最后一个标签返回 null', () => {
    const only = makeTab('app', 'only')
    const tabs = [only]
    expect(removeTab(tabs, only)).toBeNull()
    expect(tabs).toEqual([])
  })

  it('移除不在列表中的标签不产生变更', () => {
    const tabs = [makeTab('app', 'a')]
    expect(removeTab(tabs, makeTab('app', 'b'))).toBeNull()
    expect(tabs).toHaveLength(1)
  })
})
