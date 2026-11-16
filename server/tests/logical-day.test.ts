import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { dayKey, dayKeyFromUtcStamp, logicalDayKey, logicalDayKeyFromUtcStamp } from '../src/lib/date.js'
import { getLogicalDay, getLogicalToday } from '../src/services/logicalDay.js'
import { setDayStartHour } from '../src/services/settings.js'
import { initDb, resetDbForTests, setDbForTests } from '../src/db.js'

// Локальные.wall-clock инстанты: new Date(y, m-1, d, h, min) — правильный день в любом часовом поясе.
function local(y: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(y, month - 1, day, hour, minute)
}

describe('logicalDayKey — чистая функция игрового дня', () => {
  it('сдвигает ночь до порога на предыдущий день', () => {
    expect(logicalDayKey(local(2026, 11, 14, 3, 30), 7)).toBe('2026-11-13')
    expect(logicalDayKey(local(2026, 11, 14, 6, 59), 7)).toBe('2026-11-13')
  })

  it('порог строгий: 07:00 и 07:01 уже новый игровой день', () => {
    expect(logicalDayKey(local(2026, 11, 14, 7, 0), 7)).toBe('2026-11-14')
    expect(logicalDayKey(local(2026, 11, 14, 7, 1), 7)).toBe('2026-11-14')
  })

  it('порог 0 оставляет календарный день', () => {
    expect(logicalDayKey(local(2026, 11, 14, 3, 30), 0)).toBe('2026-11-14')
    expect(logicalDayKey(local(2026, 11, 14, 3, 30))).toBe('2026-11-14')
  })

  it('переход месяца и года уходит в предыдущий месяц/год', () => {
    expect(logicalDayKey(local(2026, 12, 1, 3, 30), 7)).toBe('2026-11-30')
    expect(logicalDayKey(local(2027, 1, 1, 3, 30), 7)).toBe('2026-12-31')
    expect(logicalDayKey(local(2026, 11, 1, 3, 30), 7)).toBe('2026-10-31')
  })

  it('високосный день не съезжает', () => {
    expect(logicalDayKey(local(2028, 3, 1, 3, 30), 7)).toBe('2028-02-29')
    expect(logicalDayKey(local(2028, 2, 29, 3, 30), 7)).toBe('2028-02-28')
    expect(logicalDayKey(local(2028, 2, 29, 8, 0), 7)).toBe('2028-02-29')
  })

  it('последний день месяца днём остаётся своим днём', () => {
    expect(logicalDayKey(local(2026, 11, 30, 3, 0), 7)).toBe('2026-11-29')
    expect(logicalDayKey(local(2026, 11, 30, 12, 0), 7)).toBe('2026-11-30')
  })

  it('порог 12: граница на полдне', () => {
    expect(logicalDayKey(local(2026, 11, 14, 11, 59), 12)).toBe('2026-11-13')
    expect(logicalDayKey(local(2026, 11, 14, 12, 0), 12)).toBe('2026-11-14')
  })

  it('всегда календарный день порога 0 при любом часе', () => {
    for (const hour of [0, 1, 6, 7, 12, 23]) {
      expect(logicalDayKey(local(2026, 11, 14, hour), 0)).toBe(dayKey(local(2026, 11, 14, hour)))
    }
  })
})

describe('logicalDayKeyFromUtcStamp — игровой день из created_at', () => {
  function utcStamp(d: Date): string {
    return d.toISOString().slice(0, 19).replace('T', ' ')
  }

  it('ночь до порога отдаёт предыдущий день', () => {
    expect(logicalDayKeyFromUtcStamp(utcStamp(local(2026, 11, 14, 3, 30)), 7)).toBe('2026-11-13')
    expect(logicalDayKeyFromUtcStamp(utcStamp(local(2026, 11, 14, 6, 59)), 7)).toBe('2026-11-13')
  })

  it('порог 0 совпадает с dayKeyFromUtcStamp', () => {
    for (const instant of [local(2026, 11, 14, 3, 30), local(2026, 12, 1, 0, 5), local(2028, 2, 29, 23, 0)]) {
      const stamp = utcStamp(instant)
      expect(logicalDayKeyFromUtcStamp(stamp, 0)).toBe(dayKeyFromUtcStamp(stamp))
    }
  })

  it('день после порога и смена месяца', () => {
    expect(logicalDayKeyFromUtcStamp(utcStamp(local(2026, 11, 14, 7, 0)), 7)).toBe('2026-11-14')
    expect(logicalDayKeyFromUtcStamp(utcStamp(local(2026, 12, 1, 3, 30)), 7)).toBe('2026-11-30')
  })

  it('некорректный штамп — null, как у dayKeyFromUtcStamp', () => {
    expect(logicalDayKeyFromUtcStamp('2026-13-45 01:00:00', 7)).toBeNull()
    expect(logicalDayKeyFromUtcStamp('не дата', 7)).toBeNull()
    expect(logicalDayKeyFromUtcStamp('', 7)).toBeNull()
  })
})

describe('DST-ночь (Europe/Berlin) — порог следует за локальным часом', () => {
  const previousZone = process.env.TZ
  let applied = false

  beforeAll(() => {
    process.env.TZ = 'Europe/Berlin'
    applied = Intl.DateTimeFormat().resolvedOptions().timeZone === 'Europe/Berlin'
  })

  afterAll(() => {
    process.env.TZ = previousZone
  })

  it('скачок 02:00 -> 03:00 не удваивает и не теряет игровой день', () => {
    if (!applied) {
      // Windows иногда игнорирует смену TZ внутри процесса. Проверено: на этой машине
      // Europe/Berlin применяется, кейс выполняется по-настоящему; ветка — страховка.
      return
    }
    expect(local(2026, 3, 29, 1, 30).getHours()).toBe(1)
    expect(new Date('2026-03-29T00:30:00Z').getHours()).toBe(1)
    expect(new Date('2026-03-29T01:30:00Z').getHours()).toBe(3)
    expect(logicalDayKey(new Date('2026-03-29T00:30:00Z'), 2)).toBe('2026-03-28')
    expect(logicalDayKey(new Date('2026-03-29T01:30:00Z'), 2)).toBe('2026-03-29')
  })
})

describe('getLogicalToday / getLogicalDay — порог из настройки', () => {
  beforeEach(() => {
    setDbForTests(initDb(':memory:'))
    vi.useFakeTimers({ toFake: ['Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
    resetDbForTests()
  })

  it('ночь до порога: сегодня = вчерашний день', () => {
    setDayStartHour(7)
    vi.setSystemTime(local(2026, 11, 14, 3, 30))
    expect(getLogicalToday()).toBe('2026-11-13')
    expect(getLogicalDay()).toEqual({ today: '2026-11-13', dayStartHour: 7 })
  })

  it('07:00: сегодня = календарный день', () => {
    setDayStartHour(7)
    vi.setSystemTime(local(2026, 11, 14, 7, 0))
    expect(getLogicalToday()).toBe('2026-11-14')
  })

  it('порог 0: сегодня всегда календарный день', () => {
    setDayStartHour(7)
    setDayStartHour(0)
    vi.setSystemTime(local(2026, 11, 14, 3, 30))
    expect(getLogicalToday()).toBe('2026-11-14')
    expect(getLogicalDay().dayStartHour).toBe(0)
  })

  it('принимает явные часы (для одного чтения порога на запрос)', () => {
    setDayStartHour(7)
    expect(getLogicalToday(local(2026, 12, 1, 3, 30))).toBe('2026-11-30')
  })
})
