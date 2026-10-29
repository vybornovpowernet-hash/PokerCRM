import { describe, expect, it } from 'vitest'
import {
  caretAfterSignificant,
  countSignificant,
  formatAmount,
  formatSignedAmount,
  formatThousands,
  formatUnits,
  normalizeAmountInput,
  parseUnits
} from '../src/lib/money'
import { TRANSACTION_TYPE_LABELS } from '../src/lib/types'

describe('money', () => {
  it('parses unsigned amounts into min units', () => {
    expect(parseUnits('100')).toBe(100_00)
    expect(parseUnits('100.5')).toBe(100_50)
    expect(parseUnits('100.55')).toBe(100_55)
    expect(parseUnits('0.05')).toBe(5)
    expect(parseUnits('abc')).toBeNull()
    expect(parseUnits('-10')).toBeNull()
  })

  it('parses signed amounts only when allowed', () => {
    expect(parseUnits('-10', { signed: true })).toBe(-10_00)
    expect(parseUnits('-10.25', { signed: true })).toBe(-10_25)
    expect(parseUnits('-0.05', { signed: true })).toBe(-5)
    expect(parseUnits('+10', { signed: true })).toBeNull()
    expect(parseUnits('-10.255', { signed: true })).toBeNull()
  })

  it('formats units and amounts', () => {
    expect(formatUnits(-10_25)).toBe('-10.25')
    expect(formatUnits(5)).toBe('0.05')
    expect(formatAmount(-10_25, 'USD')).toBe('$-10.25')
  })

  it('groups thousands with non-breaking spaces', () => {
    expect(formatThousands('')).toBe('')
    expect(formatThousands('7')).toBe('7')
    expect(formatThousands('1234')).toBe('1\u00A0234')
    expect(formatThousands('1234567')).toBe('1\u00A0234\u00A0567')
    expect(formatThousands('1234.5')).toBe('1\u00A0234.5')
    expect(formatThousands('1234.')).toBe('1\u00A0234.')
    expect(formatThousands('0.05')).toBe('0.05')
    expect(formatThousands(-1234)).toBe('-1\u00A0234')
    expect(formatUnits(123_456_789)).toBe('1\u00A0234\u00A0567.89')
    expect(formatSignedAmount(1_213_866, 'USD')).toBe('$12\u00A0138.66')
  })

  it('parses grouped input back into min units', () => {
    expect(parseUnits('1 234.56')).toBe(1234_56)
    expect(parseUnits('1\u00A0234.56')).toBe(1234_56)
    expect(parseUnits('1\u00A0234\u00A0567')).toBe(123_456_700)
  })

  it('keeps the caret anchored to the same significant character', () => {
    expect(countSignificant('12 151.5')).toBe(7)
    expect(countSignificant('')).toBe(0)
    expect(caretAfterSignificant('1 234', 5)).toBe(5)
    expect(caretAfterSignificant('12 151', 3)).toBe(4)
    expect(caretAfterSignificant('1 234', 0)).toBe(0)
    expect(caretAfterSignificant('1 234', 99)).toBe(5)
    expect(countSignificant(normalizeAmountInput('.'))).toBe(2)
    expect(caretAfterSignificant('0.', countSignificant(normalizeAmountInput('.')))).toBe(2)
    expect(countSignificant(normalizeAmountInput('123,'))).toBe(4)
  })

  it('labels the casino transaction type', () => {
    expect(TRANSACTION_TYPE_LABELS.casino).toBe('Казино')
  })

  it('normalizes a balance field while the user types', () => {
    expect(normalizeAmountInput('12,34')).toBe('12.34')
    expect(normalizeAmountInput('1 234,5')).toBe('1234.5')
    expect(normalizeAmountInput('1\u00A0234,56')).toBe('1234.56')
    expect(normalizeAmountInput('1.2345')).toBe('1.23')
    expect(normalizeAmountInput(',5')).toBe('0.5')
    expect(normalizeAmountInput('1,2,3')).toBe('1.23')
    expect(normalizeAmountInput('abc12руб')).toBe('12')
    expect(normalizeAmountInput('-10')).toBe('10')
    expect(normalizeAmountInput('')).toBe('')
  })

  it('is idempotent and always keeps the value parseable when complete', () => {
    for (const raw of ['12,34', '1 234,5', '1.2345', '7', '', ',5']) {
      const once = normalizeAmountInput(raw)
      expect(normalizeAmountInput(once)).toBe(once)
      if (once !== '' && !once.endsWith('.')) expect(parseUnits(once)).not.toBeNull()
    }
  })

  it('renders the minus before the currency symbol', () => {
    expect(formatSignedAmount(-10_25, 'USD')).toBe('-$10.25')
    expect(formatSignedAmount(10_25, 'USD')).toBe('$10.25')
    expect(formatSignedAmount(0, 'RUB')).toBe('₽0.00')
  })
})
