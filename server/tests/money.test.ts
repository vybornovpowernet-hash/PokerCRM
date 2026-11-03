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

  it('scales by RATE_SCALE: a rate of exactly 1 changes nothing', () => {
    expect(RATE_SCALE).toBe(10_000)
    expect(applyRate(1, RATE_SCALE)).toBe(1)
    expect(applyRate(12345, RATE_SCALE)).toBe(12345)
  })

  it('converts negative amounts symmetrically for the same magnitude', () => {
    expect(applyRate(-100, USD_RUB)).toBe(-8939)
    expect(applyRate(-123456, USD_RUB)).toBe(-11_036_176)
    expect(applyRate(-123456, 10800)).toBe(-133332)
    for (let units = 1; units <= 2000; units++) {
      expect(applyRate(-units, USD_RUB)).toBe(-applyRate(units, USD_RUB))
    }
  })

  it('treats a zero rate as a zero result instead of throwing', () => {
    expect(applyRate(1000, 0)).toBe(0)
    // Math.round от отрицательной доли даёт минус-ноль: значение то же (0), но
    // Object.is различает их — закрепляем фактическое поведение.
    expect(applyRate(-1000, 0)).toBeLessThan(1)
    expect(Object.is(applyRate(-1000, 0), -0)).toBe(true)
  })

  it('rounds amounts below one target unit down to a signed zero', () => {
    expect(applyRate(1, 112)).toBe(0)
    expect(Object.is(applyRate(-1, 112), -0)).toBe(true)
    expect(applyRate(-1, 112) + 0).toBe(0)
    expect(applyRate(100, 112)).toBe(1)
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

  it('throws a message naming the offending rate', () => {
    expect(() => inverseRate(100, 0)).toThrow('rate must be non-zero')
  })

  it('undoes applyRate for every small amount at the live feed rates', () => {
    for (const rate of [USD_RUB, 10800, 71200]) {
      for (let units = 1; units <= 2000; units++) {
        expect(inverseRate(applyRate(units, rate), rate), `${units} при курсе ${rate}`).toBe(units)
      }
    }
  })

  it('undoes applyRate for negative amounts too', () => {
    for (const rate of [USD_RUB, 10800, 71200]) {
      for (let units = -2000; units <= -1; units++) {
        expect(inverseRate(applyRate(units, rate), rate), `${units} при курсе ${rate}`).toBe(units)
      }
    }
  })

  it('converts an exact multiple of the forward rate back without drift', () => {
    expect(inverseRate(-893936, USD_RUB)).toBe(-10000)
    expect(inverseRate(1, RATE_SCALE)).toBe(1)
  })
})

describe('rounding of exact halves (current rule, do not change silently)', () => {
  it('rounds a positive half UP and a negative half toward zero', () => {
    // 5 * 0.5 = 2.5 → 3; -5 * 0.5 = -2.5 → -2, because Math.round always goes up.
    expect(applyRate(5, 5000)).toBe(3)
    expect(applyRate(-5, 5000)).toBe(-2)
    expect(applyRate(5, 5000) + applyRate(-5, 5000)).toBe(1)
  })

  it('keeps the same asymmetry in inverseRate', () => {
    // 1 / 0.0032 = 312.5 → 313, while -1 / 0.0032 = -312.5 → -312.
    expect(inverseRate(1, 32)).toBe(313)
    expect(inverseRate(-1, 32)).toBe(-312)
  })

  it('is invisible on the live feed rates, which never land on a half', () => {
    for (const rate of [USD_RUB, 10800, 71200, 112]) {
      for (let units = -2000; units <= 2000; units++) {
        expect(applyRate(-units, rate), `курс ${rate}, сумма ${-units}`).toBe(-applyRate(units, rate))
      }
    }
  })

  it('pins the asymmetry as documented behaviour: changing it needs a separate decision', () => {
    // Ни один боевой курс не попадает на .5, но правило Math.round остаётся
    // несимметричным по знаку. Правка (half away from zero) изменила бы суммы
    // списаний и ручных курсов — она возможна только по отдельному решению.
    expect(Math.round(2.5)).toBe(3)
    expect(Math.round(-2.5)).toBe(-2)
  })
})

describe('formatMinUnits', () => {
  it('formats positive amounts with symbol', () => {
    expect(formatMinUnits(123456, 'USD')).toBe('$1234.56')
    expect(formatMinUnits(8939, 'RUB')).toBe('₽89.39')
  })

  it('formats negative amounts (loss)', () => {
    expect(formatMinUnits(-500, 'EUR')).toBe('-€5.00')
    expect(formatMinUnits(-1, 'USD')).toBe('-$0.01')
    expect(formatMinUnits(-123456, 'USD')).toBe('-$1234.56')
  })

  it('formats zero and sub-unit amounts with two decimals', () => {
    expect(formatMinUnits(0, 'USD')).toBe('$0.00')
    expect(formatMinUnits(0, 'RUB')).toBe('₽0.00')
    expect(formatMinUnits(1, 'USD')).toBe('$0.01')
    expect(formatMinUnits(99, 'USD')).toBe('$0.99')
    expect(formatMinUnits(100, 'USD')).toBe('$1.00')
  })

  it('uses the right symbol for each supported currency', () => {
    expect(formatMinUnits(123456, 'USD')).toBe('$1234.56')
    expect(formatMinUnits(123456, 'RUB')).toBe('₽1234.56')
    expect(formatMinUnits(123456, 'EUR')).toBe('€1234.56')
    expect(formatMinUnits(123456, 'CNY')).toBe('¥1234.56')
  })

  it('falls back to the currency code for an unknown currency', () => {
    expect(formatMinUnits(123456, 'GBP')).toBe('GBP 1234.56')
  })

  it('keeps the largest safe integer readable without exponent notation', () => {
    expect(formatMinUnits(9007199254740991, 'USD')).toBe('$90071992547409.91')
    expect(formatMinUnits(9007199254740991, 'CNY')).toBe('¥90071992547409.91')
  })
})
