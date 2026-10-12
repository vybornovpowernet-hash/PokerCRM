import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../src/app.js'
import {
  REPOSITORY,
  UPDATE_TMP_DIR,
  checkForUpdates,
  compareVersions,
  detectArchivePrefix,
  downloadAndStageUpdate,
  getAppVersion,
  resolveArchiveEntry,
  updateScriptContents
} from '../src/services/system.js'

vi.mock('../src/services/system.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/system.js')>()
  return { ...actual, runInPlaceUpdate: vi.fn().mockResolvedValue({ files: 3 }) }
})

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

function zipBody(entries: Record<string, string>): Buffer {
  const zip = new AdmZip()
  for (const [name, content] of Object.entries(entries)) zip.addFile(name, Buffer.from(content))
  return zip.toBuffer()
}

/**
 * Stubs `fetch` for a full release flow: the Releases API call answers with a
 * payload carrying `zipball_url`, and the archive call answers with a zip built
 * from `entries`. Returns the recorded request URLs so tests can assert which
 * source was downloaded.
 */
function stubRelease(entries: Record<string, string>, tag = 'v1.1.0'): { calls: string[] } {
  const calls: string[] = []
  const zipballUrl = `https://api.github.com/repos/${REPOSITORY}/zipball/${tag}`
  const apiResponse = jsonResponse({ tag_name: tag, zipball_url: zipballUrl, html_url: 'https://github.com/x', body: 'notes' })
  const zipResponse = new Response(zipBody(entries), { status: 200 })
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      calls.push(url)
      return Promise.resolve(url.includes('/releases/latest') ? apiResponse : zipResponse)
    })
  )
  return { calls }
}

describe('compareVersions', () => {
  it('orders numeric segments and tolerates a leading v', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('v1.2.0', '1.1.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0)
    expect(compareVersions('2.0', '2.0.0')).toBe(0)
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
  })
})

describe('getAppVersion', () => {
  it('reads a semver from the workspace-root package.json', () => {
    expect(getAppVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('reports the current release version 1.1.0', () => {
    expect(getAppVersion()).toBe('1.1.0')
  })
})

describe('checkForUpdates', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('flags an update when the release tag is newer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ tag_name: 'v9.9.9', html_url: 'https://github.com/example/releases/tag/v9.9.9', body: 'Что нового' })
      )
    )
    const r = await checkForUpdates()
    expect(r.hasUpdate).toBe(true)
    expect(r.latestVersion).toBe('9.9.9')
    expect(r.releaseUrl).toContain('v9.9.9')
    expect(r.releaseNotes).toBe('Что нового')
    expect(r.currentVersion).toBe(getAppVersion())
  })

  it('reports no update when the tag matches the local version', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ tag_name: `v${getAppVersion()}` })))
    const r = await checkForUpdates()
    expect(r.hasUpdate).toBe(false)
    expect(r.latestVersion).toBe(getAppVersion())
  })

  it('treats a 404 (no published releases yet) as up to date', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })))
    const r = await checkForUpdates()
    expect(r.hasUpdate).toBe(false)
    expect(r.latestVersion).toBeNull()
    expect(r.releaseUrl).toBeNull()
    expect(r.releaseNotes).toBeNull()
  })

  it('throws a 502 when the network is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')))
    await expect(checkForUpdates()).rejects.toMatchObject({ status: 502 })
  })

  it('throws a 502 on a non-ok, non-404 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })))
    await expect(checkForUpdates()).rejects.toMatchObject({ status: 502 })
  })

  it('sends a User-Agent header (required by the GitHub API)', async () => {
    const spy = vi.fn().mockResolvedValue(jsonResponse({ tag_name: 'v1.0.0' }))
    vi.stubGlobal('fetch', spy)
    await checkForUpdates()
    const init = spy.mock.calls[0]?.[1] as RequestInit | undefined
    const headers = init?.headers as Record<string, string>
    expect(headers['User-Agent']).toBeTruthy()
    expect(headers.Accept).toContain('github')
  })
})

describe('system API', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = await createApp({ logger: false })
  })

  afterEach(async () => {
    await app.close()
    vi.unstubAllGlobals()
  })

  it('GET /api/system/version returns version and repository', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/system/version' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ version: getAppVersion(), repository: REPOSITORY })
  })

  it('GET /api/system/check-updates forwards the GitHub result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ tag_name: `v${getAppVersion()}` })))
    const res = await app.inject({ method: 'GET', url: '/api/system/check-updates' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ hasUpdate: false, currentVersion: getAppVersion() })
  })

  it('GET /api/system/check-updates surfaces a GitHub outage as 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ENOTFOUND')))
    const res = await app.inject({ method: 'GET', url: '/api/system/check-updates' })
    expect(res.statusCode).toBe(502)
    expect(JSON.parse(res.body).error).toContain('GitHub')
  })

  it('POST /api/system/update stages the update and reports how many files were readied', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/system/update' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, files: 3 })
  })
})

describe('resolveArchiveEntry', () => {
  it('joins safe relative paths inside the base directory', () => {
    expect(resolveArchiveEntry('/base', 'client/src/main.tsx')).toBe(join('/base', 'client', 'src', 'main.tsx'))
    expect(resolveArchiveEntry('/base', 'a\\b.txt')).toBe(join('/base', 'a', 'b.txt'))
  })

  it('rejects traversal, absolute and drive-qualified entries', () => {
    expect(resolveArchiveEntry('/base', '../evil.txt')).toBeNull()
    expect(resolveArchiveEntry('/base', 'a/../../evil.txt')).toBeNull()
    expect(resolveArchiveEntry('/base', '/etc/passwd')).toBeNull()
    expect(resolveArchiveEntry('/base', 'C:\\Windows\\x.dll')).toBeNull()
    expect(resolveArchiveEntry('/base', '..')).toBeNull()
  })
})

describe('detectArchivePrefix', () => {
  it('strips a single wrapper directory (release zipball shape)', () => {
    expect(
      detectArchivePrefix([{ entryName: 'vybornovpowernet-hash-PokerCRM-abc1234/package.json' }, { entryName: 'vybornovpowernet-hash-PokerCRM-abc1234/client/src/main.tsx' }])
    ).toBe('vybornovpowernet-hash-PokerCRM-abc1234/')
  })

  it('returns an empty prefix when files sit at the archive root', () => {
    expect(detectArchivePrefix([{ entryName: 'package.json' }])).toBe('')
  })

  it('returns an empty prefix when there are several top-level entries', () => {
    expect(detectArchivePrefix([{ entryName: 'a/x.ts' }, { entryName: 'b/y.ts' }])).toBe('')
  })
})

describe('downloadAndStageUpdate', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('downloads the release zipball_url and strips the owner-repo-hash root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'poker-update-'))
    try {
      const { calls } = stubRelease({
        'vybornovpowernet-hash-PokerCRM-abc1234/package.json': '{"version":"1.1.0"}',
        'vybornovpowernet-hash-PokerCRM-abc1234/client/src/main.tsx': 'export {}',
        'vybornovpowernet-hash-PokerCRM-abc1234/.env.example': 'PORT=3001'
      })
      const result = await downloadAndStageUpdate(root)
      expect(result.files).toBe(3)
      expect(readFileSync(join(root, UPDATE_TMP_DIR, 'extracted', 'package.json'), 'utf8')).toContain('1.1.0')
      expect(existsSync(join(root, UPDATE_TMP_DIR, 'extracted', 'client', 'src', 'main.tsx'))).toBe(true)
      expect(calls[0]).toContain('/releases/latest')
      expect(calls[1]).toContain('/zipball/')
      expect(calls.some((url) => url.includes('main.zip'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('throws a 502 when there is no release to install', async () => {
    const root = mkdtempSync(join(tmpdir(), 'poker-update-'))
    try {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })))
      await expect(downloadAndStageUpdate(root)).rejects.toMatchObject({ status: 502 })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('throws a 502 when the release lacks a zipball_url', async () => {
    const root = mkdtempSync(join(tmpdir(), 'poker-update-'))
    try {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ tag_name: 'v1.1.0', html_url: 'https://github.com/x' })))
      await expect(downloadAndStageUpdate(root)).rejects.toMatchObject({ status: 502 })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('throws a 502 when the zipball download returns a non-ok status', async () => {
    const root = mkdtempSync(join(tmpdir(), 'poker-update-'))
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) =>
          Promise.resolve(url.includes('/releases/latest') ? jsonResponse({ tag_name: 'v1.1.0', zipball_url: 'https://api.github.com/zipball' }) : new Response('', { status: 500 }))
        )
      )
      await expect(downloadAndStageUpdate(root)).rejects.toMatchObject({ status: 502 })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('throws a 502 when the network is unreachable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'poker-update-'))
    try {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ENOTFOUND')))
      await expect(downloadAndStageUpdate(root)).rejects.toMatchObject({ status: 502 })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('throws a 502 when the archive carries no app files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'poker-update-'))
    try {
      stubRelease({})
      await expect(downloadAndStageUpdate(root)).rejects.toMatchObject({ status: 502 })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('updateScriptContents', () => {
  const { bat, sh } = updateScriptContents()

  it('kills the old server by PID on Windows without mass deletion', () => {
    expect(bat).toContain('taskkill /F /PID %~1 /T')
    expect(bat).toContain('xcopy')
    expect(bat).toContain('call "start.bat"')
    expect(bat).toContain('".env"')
    expect(bat).not.toMatch(/del\s+\/s/i)
    expect(bat).not.toMatch(/rmdir\s+\/s\s+\/q\s+\."/i)
  })

  it('copies over the shell tree while preserving data, logs and config', () => {
    expect(sh).toContain('kill -9 "$1"')
    expect(sh).toContain('--exclude data')
    expect(sh).toContain('--exclude logs')
    expect(sh).toContain('--exclude .env')
    expect(sh).not.toContain('--delete')
    expect(sh).not.toMatch(/rm -rf \*/)
    expect(sh).toContain('sh ./start.sh')
  })
})
