import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../src/app.js'
import { REPOSITORY, checkForUpdates, compareVersions, getAppVersion } from '../src/services/system.js'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
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
})
