import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from 'playwright'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultPlaywrightRoot, resolveBrowserCandidates, resolvePokerDomUrls, scrapeFromMirrors } from '../src/services/rates/pokerdon.js'

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'pokerdon-test-'))
}

function touch(root: string, rel: string): void {
  const abs = path.join(root, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, '')
}

describe('resolveBrowserCandidates', () => {
  const temps: string[] = []
  afterEach(() => {
    for (const dir of temps) rmSync(dir, { recursive: true, force: true })
    temps.length = 0
  })

  it('returns empty when nothing is installed', () => {
    const root = tempDir()
    temps.push(root)
    expect(resolveBrowserCandidates(root, [])).toEqual([])
  })

  it('finds cached ms-playwright chromium builds and skips other folders', () => {
    const root = tempDir()
    temps.push(root)
    touch(root, 'chromium-1243/chrome-win64/chrome.exe')
    touch(root, 'not-chromium/chrome-win64/chrome.exe')
    expect(resolveBrowserCandidates(root, [])).toEqual([path.join(root, 'chromium-1243', 'chrome-win64', 'chrome.exe')])
  })

  it('uses the headless shell binary for headless builds', () => {
    const root = tempDir()
    temps.push(root)
    touch(root, 'chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe')
    expect(resolveBrowserCandidates(root, [])).toEqual([path.join(root, 'chromium_headless_shell-1243', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')])
  })

  it('includes system Chrome and Edge when present', () => {
    const pwRoot = tempDir()
    const sysRoot = tempDir()
    temps.push(pwRoot, sysRoot)
    touch(sysRoot, 'Google/Chrome/Application/chrome.exe')
    touch(sysRoot, 'Microsoft/Edge/Application/msedge.exe')
    expect(resolveBrowserCandidates(pwRoot, [sysRoot])).toEqual([
      path.join(sysRoot, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(sysRoot, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    ])
  })

  it('finds cached Linux and macOS chromium layouts (cross-platform folder move)', () => {
    const linuxRoot = tempDir()
    const macRoot = tempDir()
    temps.push(linuxRoot, macRoot)
    touch(linuxRoot, 'chromium-1243/chrome-linux/chrome')
    touch(macRoot, 'chromium-1243/chrome-mac/Chromium.app/Contents/MacOS/Chromium')
    expect(resolveBrowserCandidates(linuxRoot, [])).toEqual([path.join(linuxRoot, 'chromium-1243', 'chrome-linux', 'chrome')])
    expect(resolveBrowserCandidates(macRoot, [])).toEqual([
      path.join(macRoot, 'chromium-1243', 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
    ])
  })
})

describe('defaultPlaywrightRoot', () => {
  it('uses the platform-specific Playwright cache directory', () => {
    expect(defaultPlaywrightRoot('win32', path.join('C:', 'Users', 'me'))).toBe(
      path.join('C:', 'Users', 'me', 'AppData', 'Local', 'ms-playwright')
    )
    expect(defaultPlaywrightRoot('darwin', '/Users/me')).toBe(path.join('/Users/me', 'Library', 'Caches', 'ms-playwright'))
    expect(defaultPlaywrightRoot('linux', '/home/me')).toBe(path.join('/home/me', '.cache', 'ms-playwright'))
  })

  it('honours PLAYWRIGHT_BROWSERS_PATH and ignores the "0" sentinel', () => {
    const prev = process.env.PLAYWRIGHT_BROWSERS_PATH
    try {
      process.env.PLAYWRIGHT_BROWSERS_PATH = '/custom/playwright'
      expect(defaultPlaywrightRoot('linux', '/home/me')).toBe('/custom/playwright')
      process.env.PLAYWRIGHT_BROWSERS_PATH = '0'
      expect(defaultPlaywrightRoot('linux', '/home/me')).toBe(path.join('/home/me', '.cache', 'ms-playwright'))
    } finally {
      if (prev === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH
      else process.env.PLAYWRIGHT_BROWSERS_PATH = prev
    }
  })
})

const DEFAULT_MIRRORS = ['https://pd-play-x7wq3.com/poker', 'https://plk7pokerdom.com/poker']

describe('resolvePokerDomUrls', () => {
  it('uses the built-in mirrors when the variable is missing or blank', () => {
    expect(resolvePokerDomUrls(undefined)).toEqual(DEFAULT_MIRRORS)
    expect(resolvePokerDomUrls('')).toEqual(DEFAULT_MIRRORS)
    expect(resolvePokerDomUrls('  ,  ')).toEqual(DEFAULT_MIRRORS)
  })

  it('parses a comma-separated list, trims it and drops duplicates', () => {
    const raw = ' https://a.example/poker , ,https://b.example/poker ,https://a.example/poker '
    expect(resolvePokerDomUrls(raw)).toEqual(['https://a.example/poker', 'https://b.example/poker'])
  })

  it('drops non-http entries and falls back to the defaults when nothing valid is left', () => {
    expect(resolvePokerDomUrls('ftp://a.example/poker,https://b.example/poker')).toEqual(['https://b.example/poker'])
    expect(resolvePokerDomUrls('nonsense')).toEqual(DEFAULT_MIRRORS)
  })
})

const RATE_PAGE = 'KZT\n0,1944 ₽\nUSD\n89,3936 ₽'

interface FakePage {
  page: Page
  visited: string[]
}

function fakePage(errorFor: (url: string) => Error | null, bodyFor: (url: string) => string = () => RATE_PAGE): FakePage {
  const visited: string[] = []
  const page = {
    goto: async (url: string) => {
      visited.push(url)
      const err = errorFor(url)
      if (err) throw err
    },
    waitForSelector: async () => undefined,
    locator: () => ({ innerText: async () => bodyFor(visited[visited.length - 1] ?? '') })
  } as unknown as Page
  return { page, visited }
}

function collector(): { log: (url: string, reason: string) => void; lines: string[] } {
  const lines: string[] = []
  return { log: (url, reason) => lines.push(`${url} — ${reason}`), lines }
}

describe('scrapeFromMirrors', () => {
  it('skips a mirror that times out and returns the rate from the next one', async () => {
    const { page, visited } = fakePage((url) => (url === 'https://dead.example/poker' ? new Error('page.goto: Timeout 30000ms exceeded') : null))
    const { log, lines } = collector()
    const rate = await scrapeFromMirrors(page, ['https://dead.example/poker', 'https://alive.example/poker'], log)
    expect(rate).toBeCloseTo(89.3936, 4)
    expect(visited).toEqual(['https://dead.example/poker', 'https://alive.example/poker'])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('Timeout 30000ms exceeded')
  })

  it('skips a mirror that does not resolve', async () => {
    const { page, visited } = fakePage((url) => (url === 'https://gone.example/poker' ? new Error('net::ERR_NAME_NOT_RESOLVED at https://gone.example/poker') : null))
    const { log, lines } = collector()
    await expect(scrapeFromMirrors(page, ['https://gone.example/poker', 'https://alive.example/poker'], log)).resolves.toBeCloseTo(89.3936, 4)
    expect(visited).toEqual(['https://gone.example/poker', 'https://alive.example/poker'])
    expect(lines[0]).toContain('ERR_NAME_NOT_RESOLVED')
  })

  it('skips a reachable mirror whose page carries no USD row', async () => {
    const { page, visited } = fakePage(() => null, (url) => (url === 'https://blank.example/poker' ? 'Sign in to continue' : RATE_PAGE))
    const { log, lines } = collector()
    const rate = await scrapeFromMirrors(page, ['https://blank.example/poker', 'https://alive.example/poker'], log)
    expect(rate).toBeCloseTo(89.3936, 4)
    expect(visited).toEqual(['https://blank.example/poker', 'https://alive.example/poker'])
    expect(lines[0]).toContain('USD rate not found on page')
  })

  it('stops at the first mirror that answers', async () => {
    const { page, visited } = fakePage(() => null)
    const { log, lines } = collector()
    await expect(scrapeFromMirrors(page, ['https://first.example/poker', 'https://second.example/poker'], log)).resolves.toBeCloseTo(89.3936, 4)
    expect(visited).toEqual(['https://first.example/poker'])
    expect(lines).toEqual([])
  })

  it('throws one aggregated error naming every mirror when all of them fail', async () => {
    const mirrors = ['https://dead1.example/poker', 'https://dead2.example/poker', 'https://dead3.example/poker']
    const { page, visited } = fakePage((url) => new Error(`net::ERR_CONNECTION_REFUSED ${url}`))
    const { log, lines } = collector()
    await expect(scrapeFromMirrors(page, mirrors, log)).rejects.toThrow(/Все зеркала PokerDom недоступны \(3\)/)
    expect(visited).toEqual(mirrors)
    expect(lines).toHaveLength(3)
  })
})