import { describe, expect, it } from 'vitest'
import { dayKey, isValidDayKey } from '../src/lib/date.js'

describe('dayKey', () => {
  it('formats local date as YYYY-MM-DD', () => {
    expect(dayKey(new Date(2026, 8, 9, 23, 59))).toBe('2026-09-09')
    expect(dayKey(new Date(2026, 0, 3))).toBe('2026-01-03')
  })
})

describe('isValidDayKey', () => {
  it('accepts well-formed keys', () => {
    expect(isValidDayKey('2026-09-09')).toBe(true)
  })

  it('rejects malformed keys', () => {
    expect(isValidDayKey('2026-9-9')).toBe(false)
    expect(isValidDayKey('not-a-date')).toBe(false)
    expect(isValidDayKey('2026-02-30')).toBe(false)
  })
})