/**
 * Application version + update checks against the public GitHub Releases API.
 *
 * The version is read from the workspace-root `package.json` (the single source
 * of truth shared by client and server — the private workspace packages carry
 * their own irrelevant versions). Nothing is cached so a user who drops a new
 * build in place sees the fresh number without a restart.
 */

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { HttpError } from '../lib/errors.js'

const moduleRoot = dirname(fileURLToPath(import.meta.url)) // server/src or server/dist
const projectRoot = join(moduleRoot, '..', '..')

export const REPOSITORY = 'vybornovpowernet-hash/PokerCRM'

const GITHUB_LATEST_RELEASE = `https://api.github.com/repos/${REPOSITORY}/releases/latest`
const USER_AGENT = 'PokerCRM-UpdateChecker'
const TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 60_000

export const UPDATE_TMP_DIR = '.update-tmp'
export const UPDATE_SCRIPT_BAT = 'apply-update.bat'
export const UPDATE_SCRIPT_SH = 'apply-update.sh'

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

interface LatestRelease {
  tagName: string
  htmlUrl: string | null
  body: string | null
  zipballUrl: string | null
}

/**
 * Fetches the latest GitHub release. Returns null on a 404 (no published
 * releases yet — reported as "up to date" by the caller). A missing
 * `zipball_url` is preserved as null so the updater can refuse to guess a
 * download source.
 */
async function fetchLatestRelease(): Promise<LatestRelease | null> {
  let res: Response
  try {
    res = await fetch(GITHUB_LATEST_RELEASE, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (err) {
    throw new HttpError(502, `Не удалось связаться с GitHub API: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (res.status === 404) return null
  if (!res.ok) {
    throw new HttpError(502, `GitHub API вернул статус ${res.status}`)
  }

  const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown; body?: unknown; zipball_url?: unknown }
  if (typeof body.tag_name !== 'string' || body.tag_name.trim() === '') {
    throw new HttpError(502, 'GitHub API: ответ без tag_name')
  }
  return {
    tagName: body.tag_name.trim(),
    htmlUrl: typeof body.html_url === 'string' ? body.html_url : null,
    body: typeof body.body === 'string' && body.body.trim() !== '' ? body.body : null,
    zipballUrl: typeof body.zipball_url === 'string' && body.zipball_url.trim() !== '' ? body.zipball_url : null
  }
}

/** Queries the latest GitHub release and compares its tag with the local version.
 * A 404 (no published releases yet) is reported as up to date rather than an error. */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = getAppVersion()
  const release = await fetchLatestRelease()
  if (!release) {
    return { hasUpdate: false, currentVersion, latestVersion: null, releaseUrl: null, releaseNotes: null }
  }

  const latestVersion = release.tagName.replace(/^v/i, '')
  return {
    hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
    currentVersion,
    latestVersion,
    releaseUrl: release.htmlUrl,
    releaseNotes: release.body
  }
}

/**
 * Resolves a zip entry path inside `base`, rejecting anything that escapes it
 * (absolute paths, drive letters, `..` traversal). Returns null for unsafe names
 * so the caller silently skips them — a compromised archive can never write
 * outside the staging directory.
 */
export function resolveArchiveEntry(base: string, relative: string): string | null {
  const portable = relative.replace(/\\/g, '/')
  if (portable.startsWith('/')) return null
  const parts = portable.split('/').filter((part) => part.length > 0 && part !== '.')
  if (parts.length === 0 || parts.some((part) => part === '..' || part.includes(':'))) return null
  return join(base, ...parts)
}

export interface StageUpdateResult {
  files: number
}

/**
 * GitHub wraps every archive in a single top-level directory — `main.zip`
 * uses `<repo>-main/`, while a release zipball uses `<owner>-<repo>-<hash>/`.
 * The name is not stable, so it is detected from the entries themselves: strip
 * the wrapper only when every file lives under the same first path segment.
 * Files at the archive root (or several roots) yield an empty prefix.
 */
export function detectArchivePrefix(entries: { entryName: string }[]): string {
  let prefix: string | null = null
  for (const entry of entries) {
    const name = entry.entryName.replace(/\\/g, '/')
    const slash = name.indexOf('/')
    if (slash <= 0) return ''
    const top = name.slice(0, slash)
    if (prefix === null) prefix = top
    else if (prefix !== top) return ''
  }
  return prefix === null ? '' : `${prefix}/`
}

/**
 * Downloads the archive of the latest GitHub Release and unpacks the app files
 * into `<root>/.update-tmp/extracted`, ready for a surgical overwrite by the
 * updater script. The download source is the release's `zipball_url` — the code
 * that arrives therefore always matches the version advertised by the Releases
 * API (never the moving `main` branch). Nothing outside the staging directory
 * is ever touched.
 */
export async function downloadAndStageUpdate(rootDir: string = projectRoot): Promise<StageUpdateResult> {
  const tmpDir = join(rootDir, UPDATE_TMP_DIR)
  const extractDir = join(tmpDir, 'extracted')
  rmSync(tmpDir, { recursive: true, force: true })
  mkdirSync(extractDir, { recursive: true })

  const release = await fetchLatestRelease()
  if (!release) {
    throw new HttpError(502, 'Релизы не найдены — обновление недоступно')
  }
  if (!release.zipballUrl) {
    throw new HttpError(502, 'В последнем релизе нет ссылки на архив (zipball_url)')
  }

  let res: Response
  try {
    res = await fetch(release.zipballUrl, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
    })
  } catch (err) {
    throw new HttpError(502, `Не удалось скачать обновление: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!res.ok) {
    throw new HttpError(502, `GitHub вернул статус ${res.status} при загрузке архива`)
  }

  let zip: AdmZip
  try {
    zip = new AdmZip(Buffer.from(await res.arrayBuffer()))
  } catch {
    throw new HttpError(502, 'Архив обновления повреждён')
  }

  const entries = zip.getEntries().filter((entry) => !entry.isDirectory)
  const prefix = detectArchivePrefix(entries)
  let files = 0
  for (const entry of entries) {
    const name = entry.entryName.replace(/\\/g, '/')
    const relative = name.startsWith(prefix) ? name.slice(prefix.length) : name
    const target = resolveArchiveEntry(extractDir, relative)
    if (!target) continue
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, entry.getData())
    files += 1
  }

  if (files === 0) {
    throw new HttpError(502, 'В архиве обновления нет файлов приложения')
  }
  return { files }
}

/**
 * The updater scripts are regenerated on every run so a stale copy (or a
 * tampered one) can never be reused. They wait for the old server to release
 * its Windows file locks, kill it by PID, copy the staged files over the app
 * with surgical exclusions (`data`, `logs`, `.env`, the scripts themselves),
 * then reinstall deps and relaunch. No mass deletion is ever performed.
 */
export function updateScriptContents(): { bat: string; sh: string } {
  const bat = [
    '@echo off',
    'chcp 65001 >nul',
    'cd /d "%~dp0"',
    '',
    'echo [PokerCRM] Waiting for the old server to release its file locks...',
    'timeout /t 3 /nobreak >nul',
    'if not "%~1"=="" taskkill /F /PID %~1 /T >nul 2>&1',
    '',
    'echo [PokerCRM] Copying update files (data, logs and config are kept)...',
    'xcopy /y /e /c /h /i ".update-tmp\\extracted\\*" "." /XD ".update-tmp" data logs node_modules /XF ".env" "apply-update.bat" "apply-update.sh"',
    'if errorlevel 1 (',
    '  echo [PokerCRM] Update copy failed.',
    '  pause',
    '  exit /b 1',
    ')',
    'rmdir /s /q ".update-tmp"',
    '',
    'echo [PokerCRM] Installing dependencies...',
    'call npm install',
    '',
    'echo [PokerCRM] Restarting Poker CRM...',
    'call "start.bat"',
    ''
  ].join('\r\n')

  const sh = [
    '#!/usr/bin/env sh',
    'cd "$(dirname "$0")" || exit 1',
    '',
    'echo "[PokerCRM] Waiting for the old server to release its file locks..."',
    'sleep 3',
    'if [ -n "${1:-}" ]; then',
    '  kill -9 "$1" 2>/dev/null || true',
    'fi',
    '',
    'echo "[PokerCRM] Copying update files (data, logs and config are kept)..."',
    'if command -v rsync >/dev/null 2>&1; then',
    '  rsync -a --exclude .git --exclude data --exclude logs --exclude node_modules --exclude .update-tmp --exclude .env --exclude apply-update.bat --exclude apply-update.sh ".update-tmp/extracted/" ./',
    'else',
    '  cp -R ".update-tmp/extracted/." ./',
    'fi',
    'rm -rf ".update-tmp"',
    '',
    'echo "[PokerCRM] Installing dependencies..."',
    'npm install',
    '',
    'echo "[PokerCRM] Restarting Poker CRM..."',
    'sh ./start.sh',
    ''
  ].join('\n')

  return { bat, sh }
}

export function writeUpdateScripts(rootDir: string = projectRoot): void {
  const { bat, sh } = updateScriptContents()
  writeFileSync(join(rootDir, UPDATE_SCRIPT_BAT), bat, 'utf8')
  writeFileSync(join(rootDir, UPDATE_SCRIPT_SH), sh, { encoding: 'utf8', mode: 0o755 })
}

/**
 * Launches the platform updater as a detached process, handing it the current
 * pid so it can terminate this server before overwriting files. The caller is
 * expected to exit right after the response is flushed.
 */
export function spawnUpdateScript(pid: number, rootDir: string = projectRoot): void {
  const child =
    process.platform === 'win32'
      ? spawn('cmd.exe', ['/c', UPDATE_SCRIPT_BAT, String(pid)], { cwd: rootDir, detached: true, stdio: 'ignore' })
      : spawn('sh', [UPDATE_SCRIPT_SH, String(pid)], { cwd: rootDir, detached: true, stdio: 'ignore' })
  child.unref()
}

export async function runInPlaceUpdate(pid: number, rootDir: string = projectRoot): Promise<StageUpdateResult> {
  const result = await downloadAndStageUpdate(rootDir)
  writeUpdateScripts(rootDir)
  spawnUpdateScript(pid, rootDir)
  return result
}
