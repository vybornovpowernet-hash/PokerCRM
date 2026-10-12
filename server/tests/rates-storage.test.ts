import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initDb, resetDbForTests, setDbForTests } from '../src/db.js'
import { getLatestScaledRate, getScaledRate, isRateStale, lastRateUpdate, ratesForDate, upsertRate } from '../src/services/rates/storage.js'

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

  it('reports stale when no rate exists and fresh when updated', () => {
    expect(isRateStale(1000)).toBe(true)
    upsertRate('2026-09-09', 'USD', 'RUB', 893936, 'pokerdom')
    expect(lastRateUpdate()).not.toBeNull()
    expect(isRateStale(60 * 60 * 1000)).toBe(false)
  })
})