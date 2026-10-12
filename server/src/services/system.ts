/**
 * Application version + update checks against the public GitHub Releases API.
 *
 * The version is read from the workspace-root `package.json` (the single source
 * of truth shared by client and server — the private workspace packages carry
 * their own irrelevant versions). Nothing is cached so a user who drops a new
 * build in place sees the fresh number without a restart.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HttpError } from '../lib/errors.js'

const moduleRoot = dirname(fileURLToPath(import.meta.url)) // server/src or server/dist
const projectRoot = join(moduleRoot, '..', '..')

export const REPOSITORY = 'vybornovpowernet-hash/PokerCRM'

const GITHUB_LATEST_RELEASE = `https://api.github.com/repos/${REPOSITORY}/releases/latest`
const USER_AGENT = 'PokerCRM-UpdateChecker'
const TIMEOUT_MS = 15_000

export interface UpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string | null
  releaseUrl: string | null
  releaseNotes: string | null
}

/** Version declared in the workspace-root `package.json`; `0.0.0` if unreadable. */
export function getAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** Compares two dotted versions numerically, ignoring a leading `v` and any
 * pre-release/build suffix. Returns -1, 0 or 1. `2.0` and `2.0.0` are equal. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.trim().replace(/^v/i, '').split(/[.+-]/)
  const pa = parts(a)
  const pb = parts(b)
  const length = Math.max(pa.length, pb.length)
  for (let i = 0; i < length; i++) {
    const x = pa[i]
    const y = pb[i]
    const nx = x === undefined ? 0 : Number(x)
    const ny = y === undefined ? 0 : Number(y)
    if (Number.isFinite(nx) && Number.isFinite(ny)) {
      if (nx !== ny) return nx < ny ? -1 : 1
    } else {
      const sx = x ?? ''
      const sy = y ?? ''
      if (sx !== sy) return sx < sy ? -1 : 1
    }
  }
  return 0
}

/** Queries the latest GitHub release and compares its tag with the local version.
 * A 404 (no published releases yet) is reported as up to date rather than an error. */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = getAppVersion()

  let res: Response
  try {
    res = await fetch(GITHUB_LATEST_RELEASE, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (err) {
    throw new HttpError(502, `Не удалось связаться с GitHub API: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (res.status === 404) {
    return { hasUpdate: false, currentVersion, latestVersion: null, releaseUrl: null, releaseNotes: null }
  }
  if (!res.ok) {
    throw new HttpError(502, `GitHub API вернул статус ${res.status}`)
  }

  const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown; body?: unknown }
  if (typeof body.tag_name !== 'string' || body.tag_name.trim() === '') {
    throw new HttpError(502, 'GitHub API: ответ без tag_name')
  }
  const latestVersion = body.tag_name.trim().replace(/^v/i, '')
  return {
    hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
    currentVersion,
    latestVersion,
    releaseUrl: typeof body.html_url === 'string' ? body.html_url : null,
    releaseNotes: typeof body.body === 'string' && body.body.trim() !== '' ? body.body : null
  }
}
