import { GitRepoError, type GitProviderKind, type GitRepoTarget } from './types'

const SEGMENT_PATTERN = /^[A-Za-z0-9_.-]+$/

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    throw new GitRepoError('invalidUrl', `Malformed URL segment: ${segment}`)
  }
}

function providerKind(hostname: string): GitProviderKind {
  if (hostname === 'github.com') return 'github'
  if (hostname === 'gitee.com') return 'gitee'
  return 'gitea'
}

/** Normalizes a subdirectory: trims leading/trailing slashes, collapses repeated slashes, and rejects relative segments that escape the repository root */
export function normalizeSubdir(input: string): string {
  const cleaned = input.trim().replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
  if (!cleaned) return ''
  if (cleaned.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new GitRepoError('invalidUrl', `Invalid subdirectory: ${input}`)
  }
  return cleaned
}

/**
 * Parses a repository URL. Browse paths may be included directly in the URL:
 * - GitHub / Gitee: https://host/owner/repo/tree/<branch>/<subdir>
 * - Self-hosted Gitea: https://host[/site-prefix]/owner/repo/src/branch/<branch>/<subdir>
 * Without a path, the last two segments are taken as owner/repo and anything before them is the site prefix.
 */
export function parseRepoUrl(input: string): GitRepoTarget {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new GitRepoError('invalidUrl', `Not a valid URL: ${input}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new GitRepoError('invalidUrl', `Unsupported protocol: ${url.protocol}`)
  }

  const provider = providerKind(url.hostname)
  const segments = url.pathname.split('/').filter(Boolean).map(decodeSegment)
  const markers = provider === 'gitea' ? ['src'] : ['tree', 'blob']
  // The first two segments are always owner/repo; path markers can only appear after them (unaffected when the repository itself is named tree/blob/src)
  const markerIdx = segments.findIndex((segment, index) => index >= 2 && markers.includes(segment))

  const head = markerIdx === -1 ? segments : segments.slice(0, markerIdx)
  if (head.length < 2) throw new GitRepoError('invalidUrl', `Missing owner/repo in the URL: ${input}`)
  const owner = head[head.length - 2]!
  const repo = head[head.length - 1]!.replace(/\.git$/, '')
  if (!SEGMENT_PATTERN.test(owner) || !SEGMENT_PATTERN.test(repo)) {
    throw new GitRepoError('invalidUrl', `Invalid repository path: ${owner}/${repo}`)
  }

  let branch = ''
  let subdir = ''
  if (markerIdx !== -1) {
    const rest = segments.slice(markerIdx + 1)
    if (provider === 'gitea') {
      if (rest[0] !== 'branch' && rest[0] !== 'tag') throw new GitRepoError('invalidUrl', 'Only branch or tag links are supported')
      branch = rest[1] ?? ''
      subdir = normalizeSubdir(rest.slice(2).join('/'))
    } else {
      branch = rest[0] ?? ''
      // A blob link points at the file itself, so the workspace uses its containing directory
      const pathParts = segments[markerIdx] === 'blob' ? rest.slice(1, -1) : rest.slice(1)
      subdir = normalizeSubdir(pathParts.join('/'))
    }
  }

  return {
    provider,
    origin: url.origin,
    host: url.host,
    owner,
    repo,
    branch,
    subdir,
    prefix: head.slice(0, -2).join('/'),
  }
}

/** Repository API base URL (each platform has its own route shape) */
export function repoApiUrl(target: GitRepoTarget): string {
  const path = `${target.owner}/${target.repo}`
  if (target.provider === 'github') return `https://api.github.com/repos/${path}`
  if (target.provider === 'gitee') return `https://gitee.com/api/v5/repos/${path}`
  const base = target.prefix ? `${target.origin}/${target.prefix}` : target.origin
  return `${base}/api/v1/repos/${path}`
}

/** Repository web URL (without branch and subdirectory) */
export function repoWebUrl(target: GitRepoTarget): string {
  const base = target.prefix ? `${target.origin}/${target.prefix}` : target.origin
  return `${base}/${target.owner}/${target.repo}`
}
