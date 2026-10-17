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

/** 规范化子目录：去掉首尾斜杠、折叠重复斜杠，并拒绝退出仓库根目录的相对片段 */
export function normalizeSubdir(input: string): string {
  const cleaned = input.trim().replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
  if (!cleaned) return ''
  if (cleaned.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new GitRepoError('invalidUrl', `Invalid subdirectory: ${input}`)
  }
  return cleaned
}

/**
 * 解析仓库地址。支持在地址中直接带上浏览路径：
 * - GitHub / Gitee：https://host/owner/repo/tree/<分支>/<子目录>
 * - 自建 Gitea：https://host[/站点前缀]/owner/repo/src/branch/<分支>/<子目录>
 * 未带路径时取末尾两段为 owner/repo，之前的部分视为站点前缀。
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
  // 前两段固定是 owner/repo，路径标记只会出现在其后（仓库名本身叫 tree/blob/src 时不受影响）
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
      // blob 链接指向文件本身，工作区取其所在目录
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

/** 仓库 API 基地址（各平台各自的路由形态） */
export function repoApiUrl(target: GitRepoTarget): string {
  const path = `${target.owner}/${target.repo}`
  if (target.provider === 'github') return `https://api.github.com/repos/${path}`
  if (target.provider === 'gitee') return `https://gitee.com/api/v5/repos/${path}`
  const base = target.prefix ? `${target.origin}/${target.prefix}` : target.origin
  return `${base}/api/v1/repos/${path}`
}

/** 仓库网页地址（不含分支与子目录） */
export function repoWebUrl(target: GitRepoTarget): string {
  const base = target.prefix ? `${target.origin}/${target.prefix}` : target.origin
  return `${base}/${target.owner}/${target.repo}`
}
