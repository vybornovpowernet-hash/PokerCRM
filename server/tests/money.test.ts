import { describe, expect, it } from 'vitest'
import { applyRate, formatMinUnits, inverseRate, RATE_SCALE } from '../src/lib/money.js'

// 1 USD = 89.3936 RUB → stored as 893936 (RATE_SCALE = 1e4)
const USD_RUB = 893936

describe('applyRate', () => {
  it('converts USD cents to RUB kopecks forward', () => {
    expect(applyRate(100, USD_RUB)).toBe(8939)
  })

  it('converts a larger amount without off-by-one float drift', () => {
    // $1234.56 → 123456 cents → 11 036 176 kopecks (₽110 361.76)
    expect(applyRate(123456, USD_RUB)).toBe(11_036_176)
  })
})

describe('inverseRate', () => {
  it('converts RUB kopecks back to USD cents', () => {
    // ₽89.3936 = 893936 kopecks → 100.00 USD = 10000 cents
    expect(inverseRate(893936, USD_RUB)).toBe(10000)
  })

  it('throws on zero rate', () => {
    expect(() => inverseRate(100, 0)).toThrow()
  })
})

describe('formatMinUnits', () => {
  it('formats positive amounts with symbol', () => {
    expect(formatMinUnits(123456, 'USD')).toBe('$1234.56')
    expect(formatMinUnits(8939, 'RUB')).toBe('₽89.39')
  })

  it('formats negative amounts (loss)', () => {
    expect(formatMinUnits(-500, 'EUR')).toBe('-€5.00')
  })
})