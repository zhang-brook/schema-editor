import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createUiPreferences, DEFAULT_UI_PREFERENCES, normalizeUiPreferences } from './ui-preferences'

let workDir: string
let file: string

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(tmpdir(), 'schema-editor-ui-prefs-'))
  file = path.join(workDir, 'ui-preferences.json')
})

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true })
})

describe('normalizeUiPreferences', () => {
  it('falls back to integrated for unknown values', () => {
    expect(normalizeUiPreferences(null)).toEqual(DEFAULT_UI_PREFERENCES)
    expect(normalizeUiPreferences({ titleBarMode: 'frameless' })).toEqual(DEFAULT_UI_PREFERENCES)
    expect(normalizeUiPreferences({ titleBarMode: 'native' })).toEqual({ titleBarMode: 'native' })
  })
})

describe('createUiPreferences', () => {
  it('reads defaults when the file is missing or corrupted', async () => {
    expect(await createUiPreferences(file).load()).toEqual(DEFAULT_UI_PREFERENCES)
    await fs.writeFile(file, '{not json', 'utf8')
    expect(await createUiPreferences(file).load()).toEqual(DEFAULT_UI_PREFERENCES)
  })

  it('persists the title bar mode and a new instance reads it back', async () => {
    await createUiPreferences(file).setTitleBarMode('native')
    expect(await createUiPreferences(file).load()).toEqual({ titleBarMode: 'native' })
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ titleBarMode: 'native' })
  })

  it('keeps later changes in the same instance without re-reading the file', async () => {
    const prefs = createUiPreferences(file)
    await prefs.setTitleBarMode('native')
    expect(await prefs.setTitleBarMode('integrated')).toEqual({ titleBarMode: 'integrated' })
    expect(await createUiPreferences(file).load()).toEqual({ titleBarMode: 'integrated' })
  })
})
