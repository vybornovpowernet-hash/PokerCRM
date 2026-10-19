import { dayKey } from '../../lib/date.js'
import { RATE_SCALE } from '../../lib/money.js'
import * as storage from './storage.js'
import { fetchCnyUsdRate, fetchEurUsdRate } from './eras.js'
import { scrapeUsdRub } from './pokerdon.js'
import * as notifications from '../notifications.js'

export const STALE_AFTER_MS = 4 * 60 * 60 * 1000

export const KIND_USD_RUB_FAILED = 'rate-failed-usd-rub'
export const KIND_EUR_USD_FAILED = 'rate-failed-eur-usd'
export const KIND_CNY_USD_FAILED = 'rate-failed-cny-usd'

export interface RefreshResult {
  usdRub: boolean
  eurUsd: boolean
  cnyUsd: boolean
}

export const RETRY_BASE_MS = 30 * 1000
export const RETRY_MAX_MS = 15 * 60 * 1000

/** Failures of one kind are silent until NOTIFY_AFTER_FAILURES consecutive misses. */
export const NOTIFY_AFTER_FAILURES = 3

let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryDelayMs = RETRY_BASE_MS
const consecutiveFailures: Record<string, number> = {}

/** Single refresh attempt: fetch all three rates now. Non-silent when failing repeatedly. */
export async function refreshAllRates(): Promise<RefreshResult> {
  const [usdRub, eurUsd, cnyUsd] = await Promise.all([
    runWithNotification(KIND_USD_RUB_FAILED, 'PokerDom', refreshUsdRub),
    runWithNotification(KIND_EUR_USD_FAILED, 'EUR/USD', refreshEurUsd),
    runWithNotification(KIND_CNY_USD_FAILED, 'CNY/USD', refreshCnyUsd)
  ])
  return { usdRub, eurUsd, cnyUsd }
}

/**
 * Self-healing refresh used by startup, the 4h interval and the manual endpoint:
 * on a partial failure a retry is armed with growing backoff; full success cancels it.
 */
export async function autoRefresh(): Promise<RefreshResult> {
  const result = await refreshAllRates()
  if (result.usdRub && result.eurUsd && result.cnyUsd) {
    cancelRetry()
  } else {
    scheduleRetry()
  }
  return result
}

/** Test-only reset of the retry backoff and the consecutive-failure counters. */
export function resetRateRefreshState(): void {
  cancelRetry()
  retryDelayMs = RETRY_BASE_MS
  for (const kind of Object.keys(consecutiveFailures)) {
    delete consecutiveFailures[kind]
  }
}

function scheduleRetry(): void {
  if (retryTimer !== null) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    void autoRefresh().catch(() => undefined)
  }, retryDelayMs)
  retryDelayMs = Math.min(retryDelayMs * 2, RETRY_MAX_MS)
}

function cancelRetry(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  retryDelayMs = RETRY_BASE_MS
}

export async function refreshUsdRub(): Promise<void> {
  const rate = await scrapeUsdRub()
  storage.upsertRate(dayKey(), 'USD', 'RUB', Math.round(rate * RATE_SCALE), 'pokerdom')
}

export async function refreshEurUsd(): Promise<void> {
  const rate = await fetchEurUsdRate()
  storage.upsertRate(dayKey(), 'EUR', 'USD', Math.round(rate * RATE_SCALE), 'er-api')
}

export async function refreshCnyUsd(): Promise<void> {
  const rate = await fetchCnyUsdRate()
  storage.upsertRate(dayKey(), 'USD', 'CNY', Math.round(rate * RATE_SCALE), 'er-api')
}

/**
 * Freshness of one feed. `rate`/`date` describe the latest known row (the same
 * value conversions fall back to), `stale` answers the only question the UI
 * must not lie about: has THIS source updated within STALE_AFTER_MS?
 */
export interface RateFeed {
  rate: number | null
  date: string | null
  updatedAt: string | null
  stale: boolean
}

export interface RatesStatus {
  usdRub: RateFeed
  eurUsd: RateFeed
  cnyUsd: RateFeed
  /** Newest write across feeds (informational). */
  updatedAt: string | null
  /** True when at least one feed is stale. */
  stale: boolean
}

export function getRatesStatus(): RatesStatus {
  const usdRub = feedStatus('USD', 'RUB')
  const eurUsd = feedStatus('EUR', 'USD')
  const cnyUsd = feedStatus('USD', 'CNY')
  return {
    usdRub,
    eurUsd,
    cnyUsd,
    updatedAt: storage.lastRateUpdate()?.toISOString() ?? null,
    // Any stale feed degrades the status: a dead source stays visible instead of
    // being hidden behind a live sibling, which is what the old MAX() did.
    stale: usdRub.stale || eurUsd.stale || cnyUsd.stale
  }
}

function feedStatus(from: string, to: string): RateFeed {
  const row = storage.getLatestRate(from, to)
  if (!row) return { rate: null, date: null, updatedAt: null, stale: true }
  return {
    rate: row.rate / RATE_SCALE,
    date: row.date,
    updatedAt: storage.parseDbTimestamp(row.updatedAt).toISOString(),
    stale: storage.isRateRowStale(row.updatedAt, STALE_AFTER_MS)
  }
}

async function runWithNotification(kind: string, label: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn()
    notifications.resolveKind(kind)
    delete consecutiveFailures[kind]
    return true
  } catch (err) {
    const next = (consecutiveFailures[kind] ?? 0) + 1
    consecutiveFailures[kind] = next
    if (next >= NOTIFY_AFTER_FAILURES) {
      const message = `${label} курс не обновился: ${err instanceof Error ? err.message : String(err)}. Повторные попытки выполняются автоматически.`
      notifications.add(kind, message)
    }
    return false
  }
}