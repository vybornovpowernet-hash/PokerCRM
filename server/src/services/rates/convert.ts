import { RATE_SCALE } from '../../lib/money.js'
import * as storage from './storage.js'
import * as overrides from './overrides.js'

/**
 * Cross-rate resolution on top of the per-day frozen rates.
 * Available primitives: USD→RUB (pokerdom), EUR→USD (er-api), USD→CNY (er-api).
 * Everything else is derived by chaining through USD and by inverting known pairs.
 * Rates never recalculate past days: a day's amount converts with that day's
 * rate if available, otherwise the latest known rate is used.
 *
 * A per-room manual override (`rate_overrides`) takes precedence over the whole
 * feed chain whenever the calling scope knows the room.
 */

type Lookup = (from: string, to: string) => number | null

/**
 * Synchronous, request-scoped memoization of resolved cross rates.
 *
 * Rate resolution costs several statements per non-USD conversion (override
 * lookup + frozen day rate + latest-known fallback). Aggregations convert the
 * same (room, currency, date) pair thousands of times, so an uncached pass over
 * a large tournament set is O(rows) SQLite queries and blocks the event loop.
 *
 * The cache lives only for the duration of a `withRateCache` callback. It is
 * safe because every wrapped callback is synchronous and single-threaded: no
 * `await` can interleave another request and observe a half-built cache. Writes
 * to rates happen outside these scopes, and the cache is discarded afterwards,
 * so stale values can never leak into a later request.
 */
interface RateCache {
  resolved: Map<string, number | null>
}

let rateCache: RateCache | null = null

/** Memoizes rate resolution for the duration of a synchronous callback. */
export function withRateCache<T>(fn: () => T): T {
  if (rateCache !== null) return fn()
  rateCache = { resolved: new Map() }
  try {
    return fn()
  } finally {
    rateCache = null
  }
}

function crossRateInner(from: string, to: string, lookup: Lookup): number | null {
  if (from === to) return RATE_SCALE
  const direct = lookup(from, to)
  if (direct !== null) return direct
  const reverse = lookup(to, from)
  if (reverse !== null) return Math.round((RATE_SCALE * RATE_SCALE) / reverse)
  const fromUsd = toUsdRate(from, lookup)
  const usdTo = fromUsdRate(to, lookup)
  if (fromUsd === null || usdTo === null) return null
  return Math.round((fromUsd * usdTo) / RATE_SCALE)
}

/** Currency → USD (stored directly or inverted from USD → currency). */
function toUsdRate(currency: string, lookup: Lookup): number | null {
  if (currency === 'USD') return RATE_SCALE
  const stored = lookup(currency, 'USD')
  if (stored !== null) return stored
  const inverse = lookup('USD', currency)
  if (inverse !== null) return Math.round((RATE_SCALE * RATE_SCALE) / inverse)
  return null
}

/** USD → currency (stored directly or inverted from currency → USD). */
function fromUsdRate(currency: string, lookup: Lookup): number | null {
  if (currency === 'USD') return RATE_SCALE
  const stored = lookup('USD', currency)
  if (stored !== null) return stored
  const inverse = lookup(currency, 'USD')
  if (inverse !== null) return Math.round((RATE_SCALE * RATE_SCALE) / inverse)
  return null
}

/** Scaled cross rate for a specific day, or null if no rate is known at all. */
export function crossRateScaled(from: string, to: string, date: string): number | null {
  return crossRateInner(from, to, (a, b) => storage.getScaledRate(a, b, date))
}

/** Scaled cross rate using the latest-known rate regardless of the day. */
export function latestCrossRateScaled(from: string, to: string): number | null {
  return crossRateInner(from, to, (a, b) => storage.getLatestScaledRate(a, b))
}

function overrideCrossScaled(roomId: number | undefined, from: string, to: string): number | null {
  if (roomId === undefined) return null
  const direct = overrides.getRateOverrideScaled(roomId, from, to)
  if (direct !== null) return direct
  const reverse = overrides.getRateOverrideScaled(roomId, to, from)
  if (reverse !== null) return Math.round((RATE_SCALE * RATE_SCALE) / reverse)
  return null
}

/**
 * One combined rate resolution for a pair: manual override for the room first,
 * then the day's frozen rate, then the latest known feed rate. Null when none
 * of the three resolves (unknown currency).
 */
export function resolveCrossScaled(from: string, to: string, date: string, roomId?: number): number | null {
  if (from === to) return RATE_SCALE
  const cache = rateCache
  if (cache === null) return resolveUncached(from, to, date, roomId)
  const key = `${roomId ?? ''}|${from}|${to}|${date}`
  const cached = cache.resolved.get(key)
  if (cached !== undefined) return cached
  const value = resolveUncached(from, to, date, roomId)
  cache.resolved.set(key, value)
  return value
}

function resolveUncached(from: string, to: string, date: string, roomId?: number): number | null {
  const manual = overrideCrossScaled(roomId, from, to)
  if (manual !== null) return manual
  return crossRateScaled(from, to, date) ?? latestCrossRateScaled(from, to)
}

/** Convert min units of `currency` into USD min units for a given day. Null if no rate resolves. */
export function convertToUsd(amount: number, currency: string, date: string, roomId?: number): number | null {
  if (currency === 'USD') return amount
  const rate = resolveCrossScaled(currency, 'USD', date, roomId)
  if (rate === null) return null
  return Math.round((amount * rate) / RATE_SCALE)
}

/** Convert min units between two currencies for a given day. Null if no rate resolves. */
export function convertCross(amount: number, from: string, to: string, date: string, roomId?: number): number | null {
  if (from === to) return amount
  const rate = resolveCrossScaled(from, to, date, roomId)
  if (rate === null) return null
  return Math.round((amount * rate) / RATE_SCALE)
}