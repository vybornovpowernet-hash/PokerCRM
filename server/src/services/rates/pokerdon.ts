import { existsSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { parseUsdRateFromPage } from './parse.js'

/**
 * Mirrors are configurable through `POKERDOM_MIRRORS` (comma-separated). The defaults
 * hold the current mirror first and the legacy one as a fallback — a dead mirror costs
 * one navigation timeout instead of the whole refresh.
 */
const DEFAULT_POKERDOM_MIRRORS: readonly string[] = [
  'https://pd-play-x7wq3.com/poker',
  'https://plk7pokerdom.com/poker'
]
const PAGE_TIMEOUT_MS = 30_000
const TEXT_WAIT_MS = 30_000
const ATTEMPTS = 3

/** Ordered, deduplicated mirror list; an empty/garbage variable falls back to the defaults. */
export function resolvePokerDomUrls(raw: string | undefined = process.env.POKERDOM_MIRRORS): string[] {
  const parsed = (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^https?:\/\/\S+$/i.test(part))
  const unique = [...new Set(parsed)]
  return unique.length > 0 ? unique : [...DEFAULT_POKERDOM_MIRRORS]
}

let browserPromise: Promise<Browser> | null = null

const WIN_SYSTEM_APPS = [
  ['Google', 'Chrome', 'Application', 'chrome.exe'],
  ['Microsoft', 'Edge', 'Application', 'msedge.exe']
] as const

export function resolveBrowserCandidates(
  playwrightRoot = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'),
  systemRoots: readonly string[] = winSystemRoots()
): string[] {
  const candidates: string[] = []
  const dirs = (() => {
    try {
      return readdirSync(playwrightRoot)
    } catch {
      return [] as string[]
    }
  })()
  for (const dir of dirs) {
    if (!/^chromium/.test(dir)) continue
    const headless = dir.startsWith('chromium_headless_shell')
    const sub = headless ? 'chrome-headless-shell-win64' : 'chrome-win64'
    const exe = path.join(playwrightRoot, dir, sub, headless ? 'chrome-headless-shell.exe' : 'chrome.exe')
    if (existsSync(exe)) candidates.push(exe)
  }
  for (const root of systemRoots) {
    for (const parts of WIN_SYSTEM_APPS) {
      const exe = path.join(root, ...parts)
      if (existsSync(exe)) candidates.push(exe)
    }
  }
  return candidates
}

function winSystemRoots(): readonly string[] {
  if (os.platform() !== 'win32') return []
  return [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter((p): p is string => Boolean(p))
}

async function launchBrowser(): Promise<Browser> {
  let defaultErr: unknown
  try {
    return await chromium.launch({ headless: true })
  } catch (err) {
    defaultErr = err
  }
  const msg = defaultErr instanceof Error ? defaultErr.message : String(defaultErr)
  if (!msg.includes('Executable doesn\'t exist')) throw defaultErr
  const candidates = resolveBrowserCandidates()
  if (candidates.length === 0) {
    throw new Error('Chromium для Playwright не установлен, и системный Chrome/Edge не найден. Выполните: npx playwright install chromium', { cause: defaultErr })
  }
  let lastErr: unknown = defaultErr
  for (const candidate of candidates) {
    try {
      return await chromium.launch({ headless: true, executablePath: candidate })
    } catch (fallbackErr) {
      lastErr = fallbackErr
    }
  }
  const detail = lastErr instanceof Error ? lastErr.message : String(lastErr)
  throw new Error(`Не удалось запустить ни один из браузеров (проверены: ${candidates.join(', ')}): ${detail}`, { cause: lastErr })
}

export function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((err: unknown) => {
      browserPromise = null
      throw err
    })
  }
  return browserPromise
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const browser = await browserPromise.catch(() => null)
    if (browser) await browser.close().catch(() => undefined)
    browserPromise = null
  }
}

/** Fetch the USD → RUB rate from the PokerDom page using a headless browser. */
export async function scrapeUsdRub(): Promise<number> {
  const urls = resolvePokerDomUrls()
  const browser = await getBrowser()
  let lastErr: unknown = null

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const context = await browser.newContext({ locale: 'ru-RU' })
      try {
        const page: Page = context.pages()[0] ?? (await context.newPage())
        return await scrapeFromMirrors(page, urls)
      } finally {
        await context.close().catch(() => undefined)
      }
    } catch (err) {
      lastErr = err
      if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 5_000 * attempt))
    }
  }
  throw new Error(`PokerDom scraper failed after ${ATTEMPTS} attempts: ${errorMessage(lastErr)}`)
}

export type MirrorLog = (url: string, reason: string) => void

const defaultMirrorLog: MirrorLog = (url, reason) => {
  console.info(`[rates] PokerDom mirror unavailable ${url}: ${reason}`)
}

/**
 * Walks the mirrors in order and returns the rate from the first one that answers.
 * A navigation timeout, a DNS failure (`ERR_NAME_NOT_RESOLVED`), a page that never
 * shows the USD block, or an unparsable rate only demotes that single mirror: it is
 * reported at info level and the loop moves on. When every mirror is exhausted we
 * throw one aggregated error naming each mirror and its reason — that message is what
 * the rate notification shows in the UI.
 */
export async function scrapeFromMirrors(
  page: Page,
  urls: readonly string[],
  log: MirrorLog = defaultMirrorLog
): Promise<number> {
  const failures: string[] = []
  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS })
      await page.waitForSelector('body:has-text("USD")', { timeout: TEXT_WAIT_MS })
      return await parsePage(page)
    } catch (err) {
      const reason = errorMessage(err)
      failures.push(`${url} — ${reason}`)
      log(url, reason)
    }
  }
  throw new Error(`Все зеркала PokerDom недоступны (${urls.length}): ${failures.join('; ')}`)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function parsePage(page: Page): Promise<number> {
  const text = await page.locator('body').innerText()
  return parseUsdRateFromPage(text)
}