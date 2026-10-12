import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initDb, resetDbForTests, setDbForTests } from '../src/db.js'
import { upsertRate } from '../src/services/rates/storage.js'
import { convertCross, convertToUsd, crossRateScaled, latestCrossRateScaled, resolveCrossScaled, withRateCache } from '../src/services/rates/convert.js'
import { setRateOverride, deleteRateOverride } from '../src/services/rates/overrides.js'
import { createRoom } from '../src/services/rooms.js'
import { RATE_SCALE } from '../src/lib/money.js'

describe('rate conversion', () => {
  beforeEach(() => {
    setDbForTests(initDb(':memory:'))
    upsertRate('2026-09-09', 'USD', 'RUB', 900_000, 'pokerdom') // 90.0000
    upsertRate('2026-09-09', 'EUR', 'USD', 11_000, 'er-api') // 1.1000
    upsertRate('2026-09-09', 'USD', 'CNY', 73_000, 'er-api') // 7.3000
  })
  afterEach(() => resetDbForTests())

  it('identity for equal currencies', () => {
    expect(crossRateScaled('USD', 'USD', '2026-09-09')).toBe(RATE_SCALE)
    expect(convertToUsd(12345, 'USD', '2026-09-09')).toBe(12345)
  })

  it('uses direct and inverted pairs', () => {
    expect(crossRateScaled('USD', 'RUB', '2026-09-09')).toBe(900_000)
    expect(crossRateScaled('RUB', 'USD', '2026-09-09')).toBe(Math.round((RATE_SCALE * RATE_SCALE) / 900_000))
    expect(crossRateScaled('EUR', 'USD', '2026-09-09')).toBe(11_000)
  })

  it('chains through USD for EUR→RUB', () => {
    expect(crossRateScaled('EUR', 'RUB', '2026-09-09')).toBe(Math.round((11_000 * 900_000) / RATE_SCALE))
    expect(convertCross(2_00, 'EUR', 'RUB', '2026-09-09')).toBe(198_00) // €2.00 = 198 ₽
  })

  it('latest rate is used as a fallback for days without a fetched rate', () => {
    upsertRate('2026-09-05', 'USD', 'RUB', 880_000, 'pokerdom')
    // Exact-day strict lookup has no rate for 09-06…
    expect(crossRateScaled('USD', 'RUB', '2026-09-06')).toBeNull()
    // …but conversion falls back to the latest known rate (09-09 = 90 ₽).
    expect(latestCrossRateScaled('USD', 'RUB')).toBe(900_000)
    expect(convertCross(1_00, 'USD', 'RUB', '2026-09-06')).toBe(90_00)
  })

  it('returns null when nothing is known for a currency', () => {
    expect(crossRateScaled('KZT', 'USD', '2026-09-09')).toBeNull()
    expect(convertToUsd(100_00, 'KZT', '2026-09-09')).toBeNull()
  })

  it('converts CNY via the direct USD→CNY cross without the ruble', () => {
    expect(crossRateScaled('USD', 'CNY', '2026-09-09')).toBe(73_000)
    expect(resolveCrossScaled('CNY', 'USD', '2026-09-09')).toBe(Math.round((RATE_SCALE * RATE_SCALE) / 73_000))
    // ¥11.00 = 1100 min units → ~ $1.51
    expect(convertToUsd(11_00, 'CNY', '2026-09-09')).toBe(Math.round((1100 * Math.round((RATE_SCALE * RATE_SCALE) / 73_000)) / RATE_SCALE))
  })

  it('prefers a manual per-room override over the frozen feed rate', () => {
    const room = createRoom({ name: 'GG', cashCurrency: 'CNY', tournamentCurrency: 'CNY' })
    upsertRate('2026-09-09', 'USD', 'CNY', 73_000, 'er-api')
    setRateOverride(room.id, 'USD', 'CNY', 70_000) // the exact cash-desk rate

    expect(resolveCrossScaled('USD', 'CNY', '2026-09-09', room.id)).toBe(70_000)
    expect(resolveCrossScaled('CNY', 'USD', '2026-09-09', room.id)).toBe(Math.round((RATE_SCALE * RATE_SCALE) / 70_000))
    // ¥11.00 at the pinned 7.0000 CNY/USD
    expect(convertToUsd(11_00, 'CNY', '2026-09-09', room.id)).toBe(157)
  })

  it('ignores the override when no roomId is provided, or when it points elsewhere', () => {
    const room = createRoom({ name: 'GG', cashCurrency: 'CNY', tournamentCurrency: 'CNY' })
    const other = createRoom({ name: 'Bybit', cashCurrency: 'USD', tournamentCurrency: 'USD' })
    setRateOverride(room.id, 'USD', 'CNY', 70_000)

    expect(convertToUsd(11_00, 'CNY', '2026-09-09')).toBe(
      Math.round((1100 * Math.round((RATE_SCALE * RATE_SCALE) / 73_000)) / RATE_SCALE)
    )
    expect(convertToUsd(11_00, 'CNY', '2026-09-09', other.id)).toBe(
      Math.round((1100 * Math.round((RATE_SCALE * RATE_SCALE) / 73_000)) / RATE_SCALE)
    )
  })

  it('removes the manual override again on delete, falling back to the feed', () => {
    const room = createRoom({ name: 'GG', cashCurrency: 'CNY', tournamentCurrency: 'CNY' })
    setRateOverride(room.id, 'USD', 'CNY', 70_000)
    deleteRateOverride(room.id, 'USD', 'CNY')

    expect(resolveCrossScaled('USD', 'CNY', '2026-09-09', room.id)).toBe(73_000)
    expect(convertToUsd(11_00, 'CNY', '2026-09-09', room.id)).toBe(
      Math.round((1100 * Math.round((RATE_SCALE * RATE_SCALE) / 73_000)) / RATE_SCALE)
    )
  })

  it('honours an override stored in the reverse direction too', () => {
    const room = createRoom({ name: 'GG', cashCurrency: 'CNY', tournamentCurrency: 'CNY' })
    setRateOverride(room.id, 'CNY', 'USD', Math.round(RATE_SCALE / 7.3)) // 1 CNY = 0.1370 USD

    expect(resolveCrossScaled('USD', 'CNY', '2026-09-09', room.id)).toBe(Math.round((RATE_SCALE * RATE_SCALE) / Math.round(RATE_SCALE / 7.3)))
  })

  it('withRateCache memoizes resolved rates for the duration of a synchronous scope', () => {
    // 90000 min RUB at USD→RUB 90 → ~999 min USD
    expect(convertToUsd(90_000, 'RUB', '2026-09-09')).toBe(999)

    let during: number | null = null
    withRateCache(() => {
      convertToUsd(90_000, 'RUB', '2026-09-09') // prime the cache
      upsertRate('2026-09-09', 'USD', 'RUB', 1_000_000, 'pokerdom') // feed moves to 100
      during = convertToUsd(90_000, 'RUB', '2026-09-09') // still the cached 90 → 999
    })

    expect(during).toBe(999)
    // once the scope ends the cache is gone and the new rate applies
    expect(convertToUsd(90_000, 'RUB', '2026-09-09')).toBe(900)
  })
})