import { describe, expect, it } from 'vitest'
import { dayKey, dayKeyFromUtcStamp, isValidDayKey } from '../src/lib/date.js'

describe('dayKey', () => {
  it('formats local date as YYYY-MM-DD', () => {
    expect(dayKey(new Date(2026, 8, 9, 23, 59))).toBe('2026-09-09')
    expect(dayKey(new Date(2026, 0, 3))).toBe('2026-01-03')
  })
})

describe('dayKeyFromUtcStamp', () => {
  it('converts a SQLite UTC stamp to the local day key', () => {
    const stamp = '2026-11-01 02:30:00'
    expect(dayKeyFromUtcStamp(stamp)).toBe(dayKey(new Date('2026-11-01T02:30:00Z')))
  })

  it('accepts the T separator and fractional seconds', () => {
    const expected = dayKey(new Date('2026-11-01T02:30:00Z'))
    expect(dayKeyFromUtcStamp('2026-11-01T02:30:00')).toBe(expected)
    expect(dayKeyFromUtcStamp('2026-11-01T02:30:00.000Z')).toBe(expected)
  })

  it('returns null for missing or malformed stamps', () => {
    for (const bad of ['', '   ', 'nope', '2026-11-01', '2026-13-40 00:00:00']) {
      expect(dayKeyFromUtcStamp(bad)).toBeNull()
    }
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