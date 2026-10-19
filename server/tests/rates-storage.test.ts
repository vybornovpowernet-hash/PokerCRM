import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDb, initDb, resetDbForTests, setDbForTests } from '../src/db.js'
import {
  getLatestRate,
  getLatestScaledRate,
  getScaledRate,
  isRateRowStale,
  lastRateUpdate,
  parseDbTimestamp,
  ratesForDate,
  upsertRate
} from '../src/services/rates/storage.js'

describe('exchange rate storage', () => {
  beforeEach(() => setDbForTests(initDb(':memory:')))
  afterEach(() => resetDbForTests())

  it('upserts per-day rates and reads them back', () => {
    upsertRate('2026-09-09', 'USD', 'RUB', 893936, 'pokerdom')
    upsertRate('2026-09-10', 'USD', 'RUB', 902123, 'pokerdom')
    // Same day + pair → overwrite, not duplicate
    upsertRate('2026-09-10', 'USD', 'RUB', 911000, 'pokerdom')

    expect(getScaledRate('USD', 'RUB', '2026-09-09')).toBe(893936)
    expect(getScaledRate('USD', 'RUB', '2026-09-10')).toBe(911000)
    expect(getScaledRate('USD', 'RUB', '2026-09-11')).toBeNull()
    expect(getLatestScaledRate('USD', 'RUB')).toBe(911000)
    expect(ratesForDate('2026-09-10')).toHaveLength(1)
  })

  it('returns the latest row of a pair with its own day and timestamp', () => {
    upsertRate('2026-09-09', 'USD', 'RUB', 893936, 'pokerdom')
    upsertRate('2026-09-10', 'USD', 'RUB', 911000, 'pokerdom')

    const latest = getLatestRate('USD', 'RUB')
    expect(latest).not.toBeNull()
    expect(latest).toMatchObject({ date: '2026-09-10', fromCurrency: 'USD', toCurrency: 'RUB', rate: 911000, source: 'pokerdom' })
    expect(getLatestRate('USD', 'CNY')).toBeNull()
  })

  it('reports freshness per feed instead of by the newest row overall', () => {
    upsertRate('2026-09-09', 'USD', 'RUB', 893936, 'pokerdom')
    upsertRate('2026-09-09', 'EUR', 'USD', 1080000, 'er-api')
    // the EUR feed froze long ago while USD/RUB kept updating
    getDb()
      .prepare("UPDATE exchange_rates SET updated_at = '2020-01-01 00:00:00' WHERE to_currency = 'USD'")
      .run()

    const usdRub = getLatestRate('USD', 'RUB')
    const eurUsd = getLatestRate('EUR', 'USD')
    if (!usdRub || !eurUsd) throw new Error('rates missing')
    expect(isRateRowStale(usdRub.updatedAt, 60 * 60 * 1000)).toBe(false)
    expect(isRateRowStale(eurUsd.updatedAt, 60 * 60 * 1000)).toBe(true)

    // The aggregate MAX() would have called the dead feed fresh — exactly the
    // lie the per-feed test replaces. `lastRateUpdate` is informational only.
    expect(lastRateUpdate()!.getTime()).toBe(parseDbTimestamp(usdRub.updatedAt).getTime())
    expect(lastRateUpdate()!.getTime()).not.toBe(parseDbTimestamp(eurUsd.updatedAt).getTime())
    expect(isRateRowStale('2000-01-01 00:00:00', 1000)).toBe(true)
  })
})
