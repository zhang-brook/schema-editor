import { describe, expect, it } from 'vitest'
import { GitRepoError } from './types'
import { normalizeSubdir, parseRepoUrl, repoApiUrl, repoWebUrl } from './url'

function errorCode(call: () => unknown): string {
  try {
    call()
  } catch (error) {
    if (error instanceof GitRepoError) return error.code
    throw error
  }
  throw new Error('Expected the call to throw')
}

describe('normalizeSubdir', () => {
  it('strips surrounding slashes, collapses duplicates and trims', () => {
    expect(normalizeSubdir('/data/db/')).toBe('data/db')
    expect(normalizeSubdir('data//db')).toBe('data/db')
    expect(normalizeSubdir('  data/db  ')).toBe('data/db')
    expect(normalizeSubdir('')).toBe('')
    expect(normalizeSubdir('/')).toBe('')
  })

  it.each(['..', './a', 'a/../b', 'a/./b', '/..'])('rejects a relative segment in %s', input => {
    expect(errorCode(() => normalizeSubdir(input))).toBe('invalidUrl')
  })
})

describe('parseRepoUrl', () => {
  it('parses a bare GitHub repository URL', () => {
    expect(parseRepoUrl('https://github.com/acme/design')).toEqual({
      provider: 'github',
      origin: 'https://github.com',
      host: 'github.com',
      owner: 'acme',
      repo: 'design',
      branch: '',
      subdir: '',
      prefix: '',
    })
  })

  it('strips a .git suffix and ignores the trailing slash', () => {
    expect(parseRepoUrl('https://github.com/acme/design.git/')).toMatchObject({ owner: 'acme', repo: 'design' })
  })

  it('reads branch and subdirectory out of a tree link', () => {
    expect(parseRepoUrl('https://github.com/acme/design/tree/main/sql/db')).toMatchObject({
      provider: 'github',
      branch: 'main',
      subdir: 'sql/db',
    })
    expect(parseRepoUrl('https://gitee.com/acme/design/tree/master/sql/db')).toMatchObject({
      provider: 'gitee',
      host: 'gitee.com',
      branch: 'master',
      subdir: 'sql/db',
    })
  })

  it('takes the containing directory from a blob link', () => {
    expect(parseRepoUrl('https://github.com/acme/design/blob/main/sql/db/schema.json')).toMatchObject({
      branch: 'main',
      subdir: 'sql/db',
    })
    expect(parseRepoUrl('https://gitee.com/acme/design/blob/dev/table.json')).toMatchObject({
      branch: 'dev',
      subdir: '',
    })
  })

  it('parses a self-hosted Gitea link with a site prefix', () => {
    const target = parseRepoUrl('http://git.internal:3000/gitea/acme/design/src/branch/main/data')
    expect(target).toEqual({
      provider: 'gitea',
      origin: 'http://git.internal:3000',
      host: 'git.internal:3000',
      owner: 'acme',
      repo: 'design',
      branch: 'main',
      subdir: 'data',
      prefix: 'gitea',
    })
    expect(repoApiUrl(target)).toBe('http://git.internal:3000/gitea/api/v1/repos/acme/design')
    expect(repoWebUrl(target)).toBe('http://git.internal:3000/gitea/acme/design')
  })

  it('accepts Gitea tag links', () => {
    expect(parseRepoUrl('https://gitea.com/acme/design/src/tag/v1.0/sql')).toMatchObject({ branch: 'v1.0', subdir: 'sql' })
  })

  it('keeps repositories literally named after a path marker', () => {
    expect(parseRepoUrl('https://github.com/acme/tree')).toMatchObject({ owner: 'acme', repo: 'tree', branch: '', subdir: '' })
    expect(parseRepoUrl('https://github.com/acme/tree/tree/dev/x')).toMatchObject({ owner: 'acme', repo: 'tree', branch: 'dev', subdir: 'x' })
  })

  it('reads only the first segment after the marker as the branch', () => {
    // A web link cannot distinguish a branch name containing slashes from a subdirectory, so take the first segment
    expect(parseRepoUrl('https://github.com/acme/design/tree/feature/x/sql')).toMatchObject({ branch: 'feature', subdir: 'x/sql' })
  })

  it('lets URL normalization neutralize a trailing .. instead of escaping', () => {
    expect(parseRepoUrl('https://github.com/acme/design/tree/main/..')).toMatchObject({ branch: '', subdir: '' })
  })

  it.each([
    'not a url',
    'ftp://github.com/acme/design',
    'https://github.com/acme',
    'https://gitea.com/acme/design/src/commit/abc123',
    'https://github.com/acme/design/tree/main/a%2F..%2Fb',
    'https://github.com/acme/design/tree/main/%E0%A4%A',
  ])('rejects %s', input => {
    expect(errorCode(() => parseRepoUrl(input))).toBe('invalidUrl')
  })

  it('builds API and web URLs per provider', () => {
    expect(repoApiUrl(parseRepoUrl('https://github.com/acme/design'))).toBe('https://api.github.com/repos/acme/design')
    expect(repoApiUrl(parseRepoUrl('https://gitee.com/acme/design'))).toBe('https://gitee.com/api/v5/repos/acme/design')
    expect(repoApiUrl(parseRepoUrl('https://gitea.com/acme/design'))).toBe('https://gitea.com/api/v1/repos/acme/design')
    expect(repoWebUrl(parseRepoUrl('https://gitee.com/acme/design'))).toBe('https://gitee.com/acme/design')
  })
})
