import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { numericHash, parsePokerDomText, PokerDomParseError } from '../src/services/pokerdomimport.js'

// Report dates carry no year, so the parser resolves it from the current server
// day; pin the clock to keep the fixtures below deterministic.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-19T12:00:00') })
})

afterEach(() => {
  vi.useRealTimers()
})

const REPORT = [
  '16 сент., 14:00',
  'Супер Прогрессивный Нокаут 30 000 р.',
  'БЛ Холдем',
  '500 р.',
  'Вхождение #1',
  '500 р.\t13\t1 288,05 р.',
  '',
  '16 сент., 14:30',
  'План Турецкого 30 000 р.',
  'БЛ Холдем',
  '300 р.',
  'Вхождение #1',
  '300 р.\t15\t825,74 р.',
  '',
  '16 сент., 13:30',
  'Френки "4 Пальца" 25 000 р.',
  'БЛ Холдем',
  '250 р.',
  'Вхождение #1',
  '250 р.\t17\t641,32 р.',
  '',
  '16 сент., 15:00',
  'Прогрессивный Нокаут 20 000 р.',
  'БЛ Холдем',
  '250 р.',
  'Вхождение #1',
  '250 р.\t75\t50 р.',
  '',
  '16 сент., 16:00',
  'Супер Прогрессивный Нокаут 30 000 р.',
  'БЛ Холдем',
  '500 р.',
  'Вхождение #1',
  '500 р.\t71\t0 р.',
  '',
  '16 сент., 17:30',
  'Нокаут "Цыгана" Микки 150 000 р.',
  'БЛ Холдем',
  '500 р.',
  'Вхождение #1',
  '500 р.\t152\t0 р.',
  '',
  '16 сент., 17:30',
  'Квантум ПКО 7 000 р.',
  'БЛ Холдем',
  '250 р.',
  'Вхождение #1',
  '250 р.\t7\t150 р.',
  '',
  '16 сент., 18:00',
  'Супер Прогрессивный Нокаут 30 000 р.',
  'БЛ Холдем',
  '500 р.',
  'Вхождение #1',
  '500 р.\t67\t0 р.',
  '',
  '16 сент., 18:30',
  'Мультибаунти 20 000 р.',
  'БЛ Холдем',
  '250 р.',
  '250 р.\t63\t0 р.',
  '',
  '16 сент., 19:00',
  'Везение Бориса "Бритвы" 40 000 р.',
  'БЛ Холдем',
  '400 р.',
  'Вхождение #1',
  '400 р.\t185\t0 р.',
  '',
  '16 сент., 19:00',
  'Прогрессивный Нокаут 20 000 р.',
  'БЛ Холдем',
  '250 р.',
  'Вхождение #1',
  '250 р.\t60\t0 р.'
].join('\n')

describe('parsePokerDomText', () => {
  it('parses the real 11-tournament report', () => {
    const { tournaments, failed } = parsePokerDomText(REPORT, 'RUB')
    expect(failed).toEqual([])
    expect(tournaments).toHaveLength(11)
  })

  it('extracts date, name, buyin (base, not multiplied), result, place', () => {
    const { tournaments } = parsePokerDomText(REPORT, 'RUB')
    const t = tournaments[0]!
    expect(t.date).toBe('2026-09-16')
    expect(t.name).toBe('Супер Прогрессивный Нокаут 30 000 р.')
    expect(t.buyin).toBe(500_00)
    expect(t.result).toBe(128_805)
    expect(t.rank).toBe(13)
    expect(t.currency).toBe('RUB')
  })

  it('produces stable unique tournament IDs (dedup key)', () => {
    const a = parsePokerDomText(REPORT, 'RUB').tournaments
    const b = parsePokerDomText(REPORT, 'RUB').tournaments
    expect(a.map((t) => t.tournamentId)).toEqual(b.map((t) => t.tournamentId))
    const ids = new Set(a.map((t) => t.tournamentId))
    expect(ids.size).toBe(a.length)
  })

  it('same name+time+buyin → same ID (re-paste dedups)', () => {
    const a = parsePokerDomText(REPORT, 'RUB').tournaments
    const b = parsePokerDomText('16 сент., 14:00\nСупер Прогрессивный Нокаут 30 000 р.\nБЛ Холдем\n500 р.\nВхождение #1\n500 р.\t5\t2 000 р.', 'RUB').tournaments
    expect(b[0]!.tournamentId).toBe(a[0]!.tournamentId)
  })

  it('re-entry buyin is multiplied (Вхождение #2 → ×2)', () => {
    const text = [
      '16 сент., 20:00',
      'Турнир Х 10 000 р.',
      'БЛ Холдем',
      '250 р.',
      'Вхождение #2',
      '250 р.\t9\t900 р.'
    ].join('\n')
    const { tournaments, failed } = parsePokerDomText(text, 'RUB')
    expect(failed).toEqual([])
    expect(tournaments[0]!.buyin).toBe(500_00)
    expect(tournaments[0]!.result).toBe(900_00)
  })

  it('block without "Вхождение" line still parses', () => {
    const text = ['17 сент., 10:00', 'Турнир Без Входа', 'БЛ Холдем', '500 р.', '500 р.\t3\t3 000 р.'].join('\n')
    const { tournaments } = parsePokerDomText(text, 'RUB')
    expect(tournaments[0]!.buyin).toBe(500_00)
    expect(tournaments[0]!.rank).toBe(3)
  })

  it('zero result is a valid number', () => {
    const { tournaments } = parsePokerDomText(REPORT, 'RUB')
    const t = tournaments.find((x) => x.name.includes('Цыгана'))!
    expect(t.result).toBe(0)
    expect(t.rank).toBe(152)
  })

  it('handles thousands separated by spaces', () => {
    const text = ['18 сент., 12:00', 'Большой Турнир 100 000 р.', 'БЛ Холдем', '1 000 р.', 'Вхождение #1', '1 000 р.\t2\t12 500 р.'].join('\n')
    const { tournaments } = parsePokerDomText(text, 'RUB')
    expect(tournaments[0]!.buyin).toBe(100_000)
    expect(tournaments[0]!.result).toBe(1_250_000)
  })

  it('collects failures but keeps the rest', () => {
    const text = [
      '16 сент., 14:00',
      'Хороший турнир 10 000 р.',
      'БЛ Холдем',
      '250 р.',
      'Вхождение #1',
      '250 р.\t7\t700 р.',
      '',
      '17 сент., 10:00',
      'Блок сломан - только дата и название'
    ].join('\n')
    const { tournaments, failed } = parsePokerDomText(text, 'RUB')
    expect(tournaments).toHaveLength(1)
    expect(failed.length).toBeGreaterThan(0)
    expect(failed[0]!.error).toContain('строк')
  })

  it('ignores stray non-date lines appended to a valid block', () => {
    const text = [
      '16 сент., 14:00',
      'Хороший турнир 10 000 р.',
      'БЛ Холдем',
      '250 р.',
      'Вхождение #1',
      '250 р.\t7\t700 р.',
      'мусорная строка после блока'
    ].join('\n')
    const { tournaments, failed } = parsePokerDomText(text, 'RUB')
    expect(failed).toEqual([])
    expect(tournaments).toHaveLength(1)
  })

  it('throws on empty text', () => {
    expect(() => parsePokerDomText('', 'RUB')).toThrow(PokerDomParseError)
  })

  it('groups concurrent tournaments (same date, different times)', () => {
    const { tournaments } = parsePokerDomText(REPORT, 'RUB')
    const byTime = new Map<string, number>()
    for (const t of tournaments) byTime.set(t.name, (byTime.get(t.name) ?? 0) + 1)
    expect(byTime.get('Супер Прогрессивный Нокаут 30 000 р.')).toBe(3)
  })

  it('parses across multiple calendar days', () => {
    const text = [
      '15 сент., 09:00',
      'Утренний 10 000 р.',
      'БЛ Холдем',
      '100 р.',
      '100 р.\t20\t0 р.',
      '',
      '16 сент., 09:00',
      'Дневной 10 000 р.',
      'БЛ Холдем',
      '100 р.',
      '100 р.\t5\t500 р.'
    ].join('\n')
    const { tournaments } = parsePokerDomText(text, 'RUB')
    expect(tournaments.map((t) => t.date)).toEqual(['2026-09-15', '2026-09-16'])
  })
})

describe('Logical Day Boundary (dayStartHour), same rule as the GG parser', () => {
  const NIGHT = ['5 окт., 03:40', 'Ночной Турнир 10 000 р.', 'БЛ Холдем', '100 р.', '100 р.\t7\t900 р.'].join('\n')

  it('shifts a start before dayStartHour to the previous day', () => {
    const { tournaments, failed } = parsePokerDomText(NIGHT, 'RUB', 7)
    expect(failed).toEqual([])
    expect(tournaments[0]!.date).toBe('2026-10-04')
  })

  it('keeps a start at or after dayStartHour on its own day', () => {
    const { tournaments } = parsePokerDomText(NIGHT, 'RUB', 3)
    expect(tournaments[0]!.date).toBe('2026-10-05')
  })

  it('defaults to no shift (dayStartHour = 0)', () => {
    const { tournaments } = parsePokerDomText(NIGHT, 'RUB')
    expect(tournaments[0]!.date).toBe('2026-10-05')
  })

  it('the dedup ID ignores the shift: changing the setting re-imports into the new day instead of duplicating', () => {
    const unshifted = parsePokerDomText(NIGHT, 'RUB', 0).tournaments[0]!
    const shifted = parsePokerDomText(NIGHT, 'RUB', 7).tournaments[0]!
    expect(shifted.tournamentId).toBe(unshifted.tournamentId)
    expect(shifted.date).not.toBe(unshifted.date)
  })
})

describe('report year resolution (report dates carry no year)', () => {
  const JANUARY = ['01 янв., 12:00', 'Новогодний 10 000 р.', 'БЛ Холдем', '100 р.', '100 р.\t5\t500 р.'].join('\n')
  const DECEMBER = ['31 дек., 22:00', 'Новогодний 10 000 р.', 'БЛ Холдем', '100 р.', '100 р.\t5\t500 р.'].join('\n')

  it('uses the current year for a date that is not in the future', () => {
    const { tournaments, failed } = parsePokerDomText(JANUARY, 'RUB', 0, '2027-01-01')
    expect(failed).toEqual([])
    expect(tournaments[0]!.date).toBe('2027-01-01')
  })

  it('rolls a still-future date back one year (31 дек. imported on 1 января)', () => {
    const { tournaments, failed } = parsePokerDomText(DECEMBER, 'RUB', 0, '2027-01-01')
    expect(failed).toEqual([])
    expect(tournaments[0]!.date).toBe('2026-12-31')
  })

  it('keeps the current year once that day has already arrived', () => {
    const { tournaments } = parsePokerDomText(DECEMBER, 'RUB', 0, '2027-12-31')
    expect(tournaments[0]!.date).toBe('2027-12-31')
  })
})

describe('date validation and time extraction', () => {
  it('rejects an impossible calendar date as a block failure, keeping the rest', () => {
    const text = [
      '16 сент., 14:00',
      'Хороший турнир 10 000 р.',
      'БЛ Холдем',
      '250 р.',
      '250 р.\t7\t700 р.',
      '',
      '31 апр., 12:00',
      'Невозможный турнир 10 000 р.',
      'БЛ Холдем',
      '250 р.',
      '250 р.\t5\t500 р.'
    ].join('\n')
    const { tournaments, failed } = parsePokerDomText(text, 'RUB', 0, '2026-10-19')
    expect(tournaments).toHaveLength(1)
    expect(failed).toHaveLength(1)
    expect(failed[0]!.error).toContain('дата')
  })

  it('reads a single-digit hour and applies the day boundary to it', () => {
    const text = ['5 окт., 4:00', 'Ранний турнир 10 000 р.', 'БЛ Холдем', '100 р.', '100 р.\t5\t500 р.'].join('\n')
    const { tournaments, failed } = parsePokerDomText(text, 'RUB', 7, '2026-10-19')
    expect(failed).toEqual([])
    expect(tournaments[0]!.date).toBe('2026-10-04')
  })
})

describe('tournament id space', () => {
  it('stays a positive safe integer and collision-free over a large sample', () => {
    const ids = Array.from({ length: 20_000 }, (_, i) => numericHash(`Турнир ${i}|2026-09-16 14:00|50000`))
    expect(ids.every((id) => Number.isSafeInteger(id) && id > 0)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
    // the legacy hash returned Math.abs(int32) — never above 2^32
    expect(ids.some((id) => id > 0xffffffff)).toBe(true)
  })

  it('separates two report keys the legacy 32-bit hash merged into one id', () => {
    // Both keys below hash to 951582727 under the old algorithm, and the import
    // upserts on UNIQUE(room_id, tournament_id) — so a collision silently
    // overwrote an unrelated tournament.
    const legacyHash = (s: string): number => {
      let h = 0
      for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
      return Math.abs(h)
    }
    const a = 'Сателлит Зодиак 66000 р.|2026-09-11 09:49|49200'
    const b = 'Гарантия Дейли 21000 р.|2024-01-06 11:17|126400'
    expect(legacyHash(a)).toBe(legacyHash(b))
    expect(numericHash(a)).not.toBe(numericHash(b))
  })
})