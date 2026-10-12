import { describe, expect, it } from 'vitest'
import { formatAmount, formatUnits, parseUnits } from '../src/lib/money'
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
})
