import { describe, expect, it } from 'vitest'
import { formatAmount, formatSignedAmount, formatUnits, normalizeAmountInput, parseUnits } from '../src/lib/money'
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
