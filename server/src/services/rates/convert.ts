import { RATE_SCALE, applyRate, inverseRate } from '../../lib/money.js'
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
 *
 * Amount conversion is done at the amount level: when a pair only exists in the
 * opposite direction, the stored forward rate is inverted per call via
 * `inverseRate`, so the full precision of the feed rate survives (inverting the
 * *rate* to RATE_SCALE first would round it, and RUB amounts are large enough
 * for that to move real money). The scaled-rate helpers below stay
 * rate-returning and are only for callers that divide by them themselves.
 */

type Lookup = (from: string, to: string) => number | null

/** A resolved converter: min units of the source currency → min units of the target. */
type Converter = (amount: number) => number | null

/**
 * Synchronous, request-scoped memoization of resolved cross rates.
 *
 * Resolution costs several statements per non-USD conversion (override lookup +
 * frozen day rate + latest-known fallback). Aggregations convert the same
 * (room, currency, date) pair thousands of times, so an uncached pass over a
 * large tournament set is O(rows) SQLite queries and blocks the event loop.
 *
 * The cache lives only for the duration of a `withRateCache` callback. It is
 * safe because every wrapped callback is synchronous and single-threaded: no
 * `await` can interleave another request and observe a half-built cache. Writes
 * to rates happen outside these scopes, and the cache is discarded afterwards,
 * so stale values can never leak into a later request.
 */
interface RateCache {
  converters: Map<string, Converter>
  rates: Map<string, number | null>
}

let rateCache: RateCache | null = null

/** Memoizes rate resolution for the duration of a synchronous callback. */
export function withRateCache<T>(fn: () => T): T {
  if (rateCache !== null) return fn()
  rateCache = { converters: new Map(), rates: new Map() }
  try {
    return fn()
  } finally {
    rateCache = null
  }
}

/**
 * Wraps a lookup so a non-positive stored rate is treated as "unknown" instead
 * of a usable value: a zero row must never reach `inverseRate` (division by
 * zero) or poison a conversion with an `Infinity` rate.
 */
function positive(lookup: Lookup): Lookup {
  return (from, to) => {
    const rate = lookup(from, to)
    return rate !== null && rate > 0 ? rate : null
  }
}

const dayLookup = (date: string): Lookup => positive((a, b) => storage.getScaledRate(a, b, date))
const latestLookup = (): Lookup => positive((a, b) => storage.getLatestScaledRate(a, b))

/** Scaled cross rate via direct pair, inverted pair or a chain through USD. */
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
  return crossRateInner(from, to, dayLookup(date))
}

/** Scaled cross rate using the latest-known rate regardless of the day. */
export function latestCrossRateScaled(from: string, to: string): number | null {
  return crossRateInner(from, to, latestLookup())
}

function overrideCrossScaled(roomId: number | undefined, from: string, to: string): number | null {
  if (roomId === undefined) return null
  const direct = overrides.getRateOverrideScaled(roomId, from, to)
  if (direct !== null && direct > 0) return direct
  const reverse = overrides.getRateOverrideScaled(roomId, to, from)
  if (reverse !== null && reverse > 0) return Math.round((RATE_SCALE * RATE_SCALE) / reverse)
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
  const key = `r|${roomId ?? ''}|${from}|${to}|${date}`
  const cached = cache.rates.get(key)
  if (cached !== undefined) return cached
  const value = resolveUncached(from, to, date, roomId)
  cache.rates.set(key, value)
  return value
}

function resolveUncached(from: string, to: string, date: string, roomId?: number): number | null {
  const manual = overrideCrossScaled(roomId, from, to)
  if (manual !== null) return manual
  return crossRateScaled(from, to, date) ?? latestCrossRateScaled(from, to)
}

/** amount (min units of `from`) → USD min units, using a single rate source. */
function toUsdConverter(currency: string, lookup: Lookup): Converter | null {
  if (currency === 'USD') return (amount) => amount
  const stored = lookup(currency, 'USD')
  if (stored !== null) return (amount) => applyRate(amount, stored)
  const inverse = lookup('USD', currency)
  if (inverse !== null) return (amount) => inverseRate(amount, inverse)
  return null
}

/** USD min units → min units of `currency`, using a single rate source. */
function fromUsdConverter(currency: string, lookup: Lookup): Converter | null {
  if (currency === 'USD') return (amount) => amount
  const stored = lookup('USD', currency)
  if (stored !== null) return (amount) => applyRate(amount, stored)
  const inverse = lookup(currency, 'USD')
  if (inverse !== null) return (amount) => inverseRate(amount, inverse)
  return null
}

/**
 * Precise converter through one rate source: direct multiply, inverted divide
 * (full feed precision) or a chain through USD. The resolved rates are captured
 * as numbers, so a converter cached in `withRateCache` really is frozen. Null
 * when nothing resolves.
 */
function converterVia(from: string, to: string, lookup: Lookup): Converter | null {
  if (from === to) return (amount) => amount
  const direct = lookup(from, to)
  if (direct !== null) return (amount) => applyRate(amount, direct)
  const reverse = lookup(to, from)
  if (reverse !== null) return (amount) => inverseRate(amount, reverse)
  const toUsd = toUsdConverter(from, lookup)
  const fromUsd = fromUsdConverter(to, lookup)
  if (toUsd === null || fromUsd === null) return null
  return (amount) => {
    const usd = toUsd(amount)
    return usd === null ? null : fromUsd(usd)
  }
}

/** Manual per-room override converter (forward or inverted). Null when absent. */
function overrideConverter(from: string, to: string, roomId: number | undefined): Converter | null {
  if (roomId === undefined) return null
  const direct = overrides.getRateOverrideScaled(roomId, from, to)
  if (direct !== null && direct > 0) return (amount) => applyRate(amount, direct)
  const reverse = overrides.getRateOverrideScaled(roomId, to, from)
  if (reverse !== null && reverse > 0) return (amount) => inverseRate(amount, reverse)
  return null
}

/** Converter for a pair: manual override, then the day's rate, then the latest. */
function buildConverter(from: string, to: string, date: string, roomId?: number): Converter {
  const manual = overrideConverter(from, to, roomId)
  if (manual !== null) return manual
  return converterVia(from, to, dayLookup(date)) ?? converterVia(from, to, latestLookup()) ?? (() => null)
}

function pairConverter(from: string, to: string, date: string, roomId?: number): Converter {
  if (from === to) return (amount) => amount
  const cache = rateCache
  if (cache === null) return buildConverter(from, to, date, roomId)
  const key = `c|${roomId ?? ''}|${from}|${to}|${date}`
  const cached = cache.converters.get(key)
  if (cached !== undefined) return cached
  const value = buildConverter(from, to, date, roomId)
  cache.converters.set(key, value)
  return value
}

/** Convert min units of `currency` into USD min units for a given day. Null if no rate resolves. */
export function convertToUsd(amount: number, currency: string, date: string, roomId?: number): number | null {
  if (currency === 'USD') return amount
  return pairConverter(currency, 'USD', date, roomId)(amount)
}

/** Convert min units between two currencies for a given day. Null if no rate resolves. */
export function convertCross(amount: number, from: string, to: string, date: string, roomId?: number): number | null {
  if (from === to) return amount
  return pairConverter(from, to, date, roomId)(amount)
}
