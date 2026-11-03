import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  addDays,
  currentMonthKey,
  dayKey,
  dayKeyFromUtcStamp,
  isValidDayKey,
  isValidMonthKey,
  monthEnd,
  monthStart
} from '../src/lib/date.js'

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

  it('maps local midnight and the last second before it to the right days', () => {
    const localDayStart = new Date(2026, 10, 4)
    const atMidnight = utcStamp(localDayStart)
    const lastSecondBefore = utcStamp(new Date(localDayStart.getTime() - 1000))
    expect(dayKeyFromUtcStamp(atMidnight)).toBe('2026-11-04')
    expect(dayKeyFromUtcStamp(lastSecondBefore)).toBe('2026-11-03')
  })

  it('returns null for a date-only stamp, an empty string and non-strings', () => {
    expect(dayKeyFromUtcStamp('2026-11-03')).toBeNull()
    expect(dayKeyFromUtcStamp('')).toBeNull()
    expect(dayKeyFromUtcStamp(null as unknown as string)).toBeNull()
    expect(dayKeyFromUtcStamp(undefined as unknown as string)).toBeNull()
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

  it('rejects leading or trailing whitespace without trimming', () => {
    expect(isValidDayKey(' 2026-01-01')).toBe(false)
    expect(isValidDayKey('2026-01-01 ')).toBe(false)
  })

  it('rejects timestamps that only start like a day key', () => {
    expect(isValidDayKey('2026-01-01T00:00')).toBe(false)
    expect(isValidDayKey('2026-01-019999999999')).toBe(false)
  })

  it('accepts the leap day of a leap year and rejects it in a common year', () => {
    expect(isValidDayKey('2028-02-29')).toBe(true)
    expect(isValidDayKey('2026-02-29')).toBe(false)
  })

  it('accepts the calendar extremes it can represent', () => {
    expect(isValidDayKey('9999-12-31')).toBe(true)
    expect(isValidDayKey('2026-12-31')).toBe(true)
    expect(isValidDayKey('2026-13-01')).toBe(false)
    expect(isValidDayKey('2026-01-00')).toBe(false)
  })

  it('rejects digits from another script and very long strings', () => {
    expect(isValidDayKey('٢٠٢٦-٠١-٠١')).toBe(false)
    expect(isValidDayKey('2026-01-0'.padEnd(5000, '1'))).toBe(false)
  })

  it('rejects non-strings without throwing', () => {
    for (const bad of [null, undefined, 0, 20260101, true, ['2026-01-01'], {}]) {
      expect(isValidDayKey(bad as unknown as string)).toBe(false)
    }
  })
})

describe('addDays', () => {
  it('rolls over the end of a 31-day month', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
  })

  it('rolls over the end of a common-year February', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('rolls over the end of the year and back to the previous year', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('walks into, through and back out of 29 February 2028', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
    expect(addDays('2028-02-29', -1)).toBe('2028-02-28')
  })

  it('shifts by a whole year in both directions', () => {
    expect(addDays('2026-11-03', 365)).toBe('2027-11-03')
    expect(addDays('2027-11-03', -365)).toBe('2026-11-03')
    expect(addDays('2028-02-29', 366)).toBe('2029-03-01')
  })

  it('keeps the day for a zero shift and steps back inside a month', () => {
    expect(addDays('2026-05-15', 0)).toBe('2026-05-15')
    expect(addDays('2026-05-15', -20)).toBe('2026-04-25')
  })

  it('advances one calendar day per step for every day of 2026', () => {
    let day = '2026-01-01'
    for (let i = 1; i < 365; i++) {
      const expected = new Date(Date.UTC(2026, 0, 1 + i))
      const want = `${expected.getUTCFullYear()}-${String(expected.getUTCMonth() + 1).padStart(2, '0')}-${String(expected.getUTCDate()).padStart(2, '0')}`
      day = addDays(day, 1)
      expect(day, `шаг ${i}`).toBe(want)
    }
  })

  it('is a whole-day shift, not 86 400 000 milliseconds of local time', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29')
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25')
    expect(addDays('2026-09-05', 1)).toBe('2026-09-06')
  })
})

describe('monthStart and monthEnd', () => {
  it('starts a month on the first', () => {
    expect(monthStart('2026-02')).toBe('2026-02-01')
    expect(monthStart('2026-12')).toBe('2026-12-01')
  })

  it('ends February 2026 on the 28th and February 2028 on the 29th', () => {
    expect(monthEnd('2026-02')).toBe('2026-02-28')
    expect(monthEnd('2028-02')).toBe('2028-02-29')
  })

  it('ends a 31-day and a 30-day month correctly', () => {
    expect(monthEnd('2026-12')).toBe('2026-12-31')
    expect(monthEnd('2027-11')).toBe('2027-11-30')
  })

  it('produces a range whose ends are valid day keys', () => {
    for (const month of ['2026-02', '2028-02', '2026-12']) {
      expect(isValidDayKey(monthStart(month)), monthStart(month)).toBe(true)
      expect(isValidDayKey(monthEnd(month)), monthEnd(month)).toBe(true)
    }
  })
})

describe('isValidMonthKey', () => {
  it('accepts every real month number', () => {
    for (const month of ['2026-01', '2026-09', '2026-10', '2026-12', '1999-07']) {
      expect(isValidMonthKey(month), month).toBe(true)
    }
  })

  it('rejects out-of-range, short, long and empty month keys', () => {
    for (const bad of ['2026-13', '2026-00', '2026-1', '2026-011', '', '2026-01-01', '26-01', '2026_01']) {
      expect(isValidMonthKey(bad), JSON.stringify(bad)).toBe(false)
    }
  })

  it('rejects padded month keys and null without throwing', () => {
    expect(isValidMonthKey(' 2026-01')).toBe(false)
    expect(isValidMonthKey('2026-01 ')).toBe(false)
    expect(isValidMonthKey(null as unknown as string)).toBe(false)
    expect(isValidMonthKey(undefined as unknown as string)).toBe(false)
  })
})

describe('currentMonthKey', () => {
  afterAll(() => {
    vi.useRealTimers()
  })

  it('formats the fixed system time as YYYY-MM', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 3, 23, 59, 59))
    expect(currentMonthKey()).toBe('2026-11')
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0))
    expect(currentMonthKey()).toBe('2026-01')
    vi.setSystemTime(new Date(2028, 1, 29, 12, 0, 0))
    expect(currentMonthKey()).toBe('2028-02')
  })

  it('returns a YYYY-MM prefix of dayKey for the ambient clock', () => {
    vi.useRealTimers()
    expect(currentMonthKey()).toBe(dayKey().slice(0, 7))
  })
})

describe('transition days in the ambient zone', () => {
  it('accepts every real day of 2026 and of leap 2028 in this zone', () => {
    for (let i = 0; i < 365; i++) {
      expect(isValidDayKey(utcDay(new Date(Date.UTC(2026, 0, 1 + i)))), utcDay(new Date(Date.UTC(2026, 0, 1 + i)))).toBe(true)
    }
    for (let i = 0; i < 366; i++) {
      expect(isValidDayKey(utcDay(new Date(Date.UTC(2028, 0, 1 + i))))).toBe(true)
    }
  })

  it('keeps day keys of local midnights on the 2026 DST switch days', () => {
    for (const monthDay of ['2026-03-29', '2026-10-25']) {
      const [y, m, d] = monthDay.split('-').map(Number)
      expect(dayKey(new Date(y as number, (m as number) - 1, d as number, 0, 30))).toBe(monthDay)
      expect(isValidDayKey(monthDay)).toBe(true)
    }
  })
})

/**
 * Смена TZ внутри процесса работает на Node 24/Windows (проверено: смещение
 * менялось 3 -> 1 -> 14 ч), поэтому пояс закрепляется явно. Если платформа
 * проигнорирует TZ, блок пропускается целиком, а не проходит без проверок.
 */
const tzSwitches = (() => {
  const saved = process.env.TZ
  process.env.TZ = 'Europe/Berlin'
  const ok = Intl.DateTimeFormat().resolvedOptions().timeZone === 'Europe/Berlin'
  if (saved === undefined) delete process.env.TZ
  else process.env.TZ = saved
  return ok
})()

describe.skipIf(!tzSwitches)('day keys in a pinned daylight-saving zone (Europe/Berlin)', () => {
  const savedZone = process.env.TZ

  beforeAll(() => {
    process.env.TZ = 'Europe/Berlin'
  })

  afterAll(() => {
    if (savedZone === undefined) delete process.env.TZ
    else process.env.TZ = savedZone
  })

  it('reads the zone it asked for', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/Berlin')
  })

  it('moves the spring-forward boundary to 01:00 UTC on 29 March 2026', () => {
    expect(isValidDayKey('2026-03-29')).toBe(true)
    expect(dayKey(new Date('2026-03-28T23:00:00Z'))).toBe('2026-03-29')
    expect(dayKeyFromUtcStamp('2026-03-28 22:59:59')).toBe('2026-03-28')
    expect(dayKeyFromUtcStamp('2026-03-28 23:00:00')).toBe('2026-03-29')
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29')
  })

  it('moves the autumn boundary back to 01:00 UTC on 25 October 2026', () => {
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25')
    expect(dayKeyFromUtcStamp('2026-10-24 22:00:00')).toBe('2026-10-25')
    expect(dayKeyFromUtcStamp('2026-10-24 21:59:59')).toBe('2026-10-24')
    expect(isValidDayKey('2026-10-25')).toBe(true)
  })
})

/** SQLite-style UTC stamp (`YYYY-MM-DD HH:MM:SS`) of an instant. */
function utcStamp(d: Date): string {
  return `${utcDay(d)} ${d.toISOString().slice(11, 19)}`
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}
