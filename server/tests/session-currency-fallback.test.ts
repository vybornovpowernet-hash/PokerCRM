import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDb, initDb, resetDbForTests, setDbForTests } from '../src/db.js'
import { createRoom } from '../src/services/rooms.js'
import { createTransaction } from '../src/services/funds.js'
import { getBalance, shiftManualBalanceOnDay, upsertBalance } from '../src/services/balances.js'
import { sessionsInRange } from '../src/services/sessions.js'
import { upsertRate } from '../src/services/rates/storage.js'

let room: number

beforeEach(() => {
  setDbForTests(initDb(':memory:'))
  room = createRoom({ name: 'PokerDom', cashCurrency: 'USD', tournamentCurrency: 'RUB' }).id
})

afterEach(() => resetDbForTests())

describe('no silent fallback on unresolvable rates', () => {
  it('marks the day unconvertible instead of comparing raw units across currencies', () => {
    upsertBalance(room, '2026-09-08', 100_00, 'RUB')
    upsertBalance(room, '2026-09-09', 120_00, 'USD')

    const days = sessionsInRange('2026-09-08', '2026-09-09')
    const entry = days.find((d) => d.date === '2026-09-09')?.rooms[0]
    expect(entry?.delta).toBeNull()
    expect(entry?.convertible).toBe(false)
    expect(entry?.profitUsd).toBeNull()
    expect(entry?.pokerProfitUsd).toBeNull()

    // the anchor day keeps its own delta but is not convertible either
    expect(days[0].rooms[0].delta).toBe(100_00)
    expect(days[0].rooms[0].convertible).toBe(false)
  })

  it('reports a reconcilable delta once the rate appears', () => {
    upsertRate('2026-09-09', 'USD', 'RUB', 90 * 10_000, 'pokerdom')
    upsertBalance(room, '2026-09-08', 90_00, 'RUB')
    upsertBalance(room, '2026-09-09', 110_00, 'USD')

    const entry = sessionsInRange('2026-09-08', '2026-09-09').find((d) => d.date === '2026-09-09')?.rooms[0]
    // prev 9000 kopecks = 90 ₽ = $1.00 → delta = 11000 − 100 = 10900
    expect(entry?.delta).toBe(10_900)
    expect(entry?.convertible).toBe(true)
    expect(entry?.profitUsd).toBe(10_900)
  })
})

describe('shiftManualBalanceOnDay', () => {
  it('throws instead of silently skipping the shift when no rate resolves', () => {
    upsertBalance(room, '2026-09-09', 100_00, 'USD')
    expect(() => shiftManualBalanceOnDay(room, '2026-09-09', 9_000, 'RUB')).toThrow(/Курс не найден/)
    expect(getBalance(room, '2026-09-09')?.amount).toBe(100_00)
  })

  it('rolls the whole transaction back when the anchor cannot be converted', () => {
    upsertBalance(room, '2026-09-09', 100_00, 'USD')
    expect(() =>
      createTransaction({ roomId: room, type: 'deposit', amount: 50_00, currency: 'RUB', direction: 'in', date: '2026-09-09' })
    ).toThrow(/Курс не найден/)
    expect(getBalance(room, '2026-09-09')?.amount).toBe(100_00)
    const count = getDb().prepare('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }
    expect(count.n).toBe(0)
  })

  it('shifts the manual anchor by the converted effect when a rate exists', () => {
    upsertRate('2026-09-09', 'USD', 'RUB', 90 * 10_000, 'pokerdom')
    upsertBalance(room, '2026-09-09', 100_00, 'USD')
    // 9000 kopecks = 90 ₽ at 90 ₽/USD → +100 cents
    createTransaction({ roomId: room, type: 'deposit', amount: 9_000, currency: 'RUB', direction: 'in', date: '2026-09-09' })
    expect(getBalance(room, '2026-09-09')?.amount).toBe(100_00 + 100)
  })
})
