import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../src/app.js'
import { getDb, initDb, resetDbForTests, setDbForTests } from '../src/db.js'
import { HttpError } from '../src/lib/errors.js'
import { createRoom } from '../src/services/rooms.js'
import { getBalance, upsertBalance } from '../src/services/balances.js'
import { createTransaction, deleteTransaction, flowTotals, listTransactions, updateTransaction } from '../src/services/funds.js'
import { computeRoomProfit, sessionsInRange } from '../src/services/sessions.js'
import { adjustBalanceToTournaments, reconcileDay, writeoffRemainder } from '../src/services/tournaments.js'
import { upsertRate } from '../src/services/rates/storage.js'

/**
 * Бонус (рейкбек, кэшбэк, подарочное начисление рума) — это прибыль, а не внешний
 * приход: строка двигает баланс рума, но не попадает ни в `in`, ни в `out`, поэтому
 * профит дня `S = delta − (in − out)` её не занижает, а сверка вычитает её
 * отдельным членом: `R = S − T − X − B`.
 *
 * Порядок записей в тестах намеренный: сначала транзакция, потом ручной снимок.
 * Снимок — абсолютная величина, а транзакция, введённая ПОСЛЕ снимка, сдвигает его
 * (`shiftManualBalanceOnDay`) — это проверяется отдельным кейсом.
 */

let app: FastifyInstance

beforeEach(async () => {
  setDbForTests(initDb(':memory:'))
  app = await createApp({ logger: false })
})

afterEach(async () => {
  await app.close()
  resetDbForTests()
})

function usdRoom(): number {
  return createRoom({ name: 'GGpoker', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
}

function addTournament(roomId: number, date: string, buyin: number, result: number, currency = 'USD'): void {
  getDb().prepare('INSERT INTO tournaments (room_id, date, buyin, result, currency) VALUES (?, ?, ?, ?, ?)').run(roomId, date, buyin, result, currency)
}

describe('bonus: validation and shape', () => {
  it('accepts a bonus and derives the direction from the sign', () => {
    const id = usdRoom()
    const credited = createTransaction({ roomId: id, type: 'bonus', amount: 50_00, currency: 'USD', date: '2026-11-10', comment: 'рейкбек' })
    expect(credited).toMatchObject({ type: 'bonus', amount: 50_00, direction: 'in', fee: 0 })

    const clawed = createTransaction({ roomId: id, type: 'bonus', amount: -10_00, currency: 'USD', date: '2026-11-10' })
    expect(clawed.direction).toBe('out')
  })

  it('refuses zero and a fee; the sign, not the client, decides the direction', () => {
    const id = usdRoom()
    const other = createRoom({ name: 'Bybit', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    expect(() => createTransaction({ roomId: id, type: 'bonus', amount: 0, currency: 'USD', date: '2026-11-10' })).toThrow(HttpError)
    expect(() => createTransaction({ roomId: id, type: 'bonus', amount: 10_00, fee: 1_00, currency: 'USD', date: '2026-11-10' })).toThrow(HttpError)
    expect(() =>
      createTransaction({ roomId: id, type: 'bonus', amount: 10_00, currency: 'USD', date: '2026-11-10', destinationRoomId: other })
    ).toThrow(HttpError)
    expect(() =>
      createTransaction({ roomId: id, type: 'bonus', amount: 10_00, currency: 'USD', date: '2026-11-10', destAmount: 9_00 })
    ).toThrow(HttpError)
    // Знак суммы первичен: присланное direction игнорируется ровно как у казино.
    expect(createTransaction({ roomId: id, type: 'bonus', amount: 10_00, currency: 'USD', direction: 'out', date: '2026-11-10' }).direction).toBe('in')
  })

  it('the schema CHECK allows a negative bonus and rejects a zero bonus or a fee', () => {
    const id = usdRoom()
    const db = getDb()
    const insert = db.prepare(
      "INSERT INTO transactions (room_id, type, amount, fee, currency, direction, date) VALUES (?, 'bonus', ?, ?, 'USD', ?, '2026-11-10')"
    )
    expect(() => insert.run(id, -10_00, 0, 'out')).not.toThrow()
    expect(() => insert.run(id, 10_00, 1_00, 'in')).toThrow()
    expect(() => insert.run(id, 0, 0, 'in')).toThrow()
  })
})

describe('bonus: balance and external flows', () => {
  it('never appears as an external flow, so the day profit keeps it', () => {
    const id = usdRoom()
    createTransaction({ roomId: id, type: 'bonus', amount: 50_00, currency: 'USD', date: '2026-11-10' })
    upsertBalance(id, '2026-11-09', 100_00, 'USD')
    upsertBalance(id, '2026-11-10', 150_00, 'USD')

    expect(flowTotals('2026-11-09', '2026-11-10').filter((f) => f.roomId === id)).toEqual([])

    const profit = computeRoomProfit(getBalance(id, '2026-11-10')!)
    expect(profit.profitUsd).toBe(50_00)
    expect(profit.flowInUsd).toBe(0)
    expect(profit.bonusUsd).toBe(50_00)
    // Рейкбек — не турнирная игра: в «чистый покер» он не входит (решение D3).
    expect(profit.pokerProfitUsd).toBe(0)
  })

  it('shifts a manual snapshot recorded earlier the same day', () => {
    const id = usdRoom()
    upsertBalance(id, '2026-11-09', 100_00, 'USD')
    upsertBalance(id, '2026-11-10', 150_00, 'USD')

    createTransaction({ roomId: id, type: 'bonus', amount: 50_00, currency: 'USD', date: '2026-11-10' })
    expect(getBalance(id, '2026-11-10')?.amount).toBe(200_00)

    const clawback = createTransaction({ roomId: id, type: 'bonus', amount: -10_00, currency: 'USD', date: '2026-11-10' })
    expect(getBalance(id, '2026-11-10')?.amount).toBe(190_00)

    updateTransaction(clawback.id, { roomId: id, type: 'bonus', amount: -30_00, currency: 'USD', date: '2026-11-10' })
    expect(getBalance(id, '2026-11-10')?.amount).toBe(170_00)

    deleteTransaction(clawback.id)
    expect(getBalance(id, '2026-11-10')?.amount).toBe(200_00)
  })

  it('converts a RUB bonus with the day rate', () => {
    const id = createRoom({ name: 'PokerDom', cashCurrency: 'RUB', tournamentCurrency: 'RUB' }).id
    upsertRate('2026-11-10', 'USD', 'RUB', 90 * 10_000, 'pokerdom')
    createTransaction({ roomId: id, type: 'bonus', amount: 4_500_00, currency: 'RUB', date: '2026-11-10' })
    upsertBalance(id, '2026-11-09', 9_000_00, 'RUB')
    upsertBalance(id, '2026-11-10', 13_500_00, 'RUB')

    const profit = computeRoomProfit(getBalance(id, '2026-11-10')!)
    expect(profit.profitUsd).toBe(50_00)
    expect(profit.bonusUsd).toBe(50_00)
  })

  // Решение пользователя 2026-11-17: день, где был ТОЛЬКО бонус (ни турниров, ни казино),
  // игровой сессией не считается. Но начисление обязано остаться в математике: его
  // auto-запись баланса — то, от чего меряется дельта следующей реальной сессии.
  it('a bonus-only automatic day is not a session row', () => {
    const id = usdRoom()
    upsertBalance(id, '2026-11-01', 100_00, 'USD')
    createTransaction({ roomId: id, type: 'bonus', amount: 50_00, currency: 'USD', date: '2026-11-05' })

    expect(sessionsInRange('2026-11-02', '2026-11-10')).toEqual([])
    // начисление при этом никуда не делось: оно и в кассе, и в цепочке балансов
    expect(listTransactions({ roomId: id, type: 'bonus' }).map((t) => t.amount)).toEqual([50_00])
    expect(getBalance(id, '2026-11-05')).toMatchObject({ source: 'auto', amount: 150_00 })
    // и спрятанный день не начинает сигналить: у auto-дня сверка по-прежнему «не с чем»
    const hidden = reconcileDay(id, '2026-11-05')
    expect(hidden.flagged).toBe(false)
    expect(hidden.blank).toContain('нет ручного баланса')
  })

  it('the hidden bonus day does not leak into the next real session as a phantom remainder', () => {
    const id = usdRoom()
    upsertBalance(id, '2026-11-01', 100_00, 'USD')
    createTransaction({ roomId: id, type: 'bonus', amount: 50_00, currency: 'USD', date: '2026-11-05' })
    addTournament(id, '2026-11-08', 20_00, 50_00)
    upsertBalance(id, '2026-11-08', 180_00, 'USD')

    const days = sessionsInRange('2026-11-02', '2026-11-10')
    expect(days.map((d) => d.date)).toEqual(['2026-11-08'])
    const session = days[0]?.rooms[0]
    // дельта 180 − 150 (auto-запись бонусного дня) = 30 = ровно турнирный профит
    expect(session).toMatchObject({ profitUsd: 30_00, bonusUsd: 0, pokerProfitUsd: 30_00 })
    const reconcile = reconcileDay(id, '2026-11-08')
    expect(reconcile).toMatchObject({ sessionProfitUsd: 30_00, tournamentProfitUsd: 30_00, bonusUsd: 0, remainderUsd: 0 })
    expect(reconcile.flagged).toBe(false)
  })

  it('numbers of the real session do not depend on where the range starts', () => {
    const id = usdRoom()
    upsertBalance(id, '2026-11-01', 100_00, 'USD')
    createTransaction({ roomId: id, type: 'bonus', amount: 50_00, currency: 'USD', date: '2026-11-05' })
    addTournament(id, '2026-11-08', 20_00, 50_00)
    upsertBalance(id, '2026-11-08', 180_00, 'USD')

    const wide = sessionsInRange('2026-11-02', '2026-11-10')[0]?.rooms[0]
    const tight = sessionsInRange('2026-11-08', '2026-11-08')[0]?.rooms[0]
    expect(tight).toMatchObject({ profitUsd: wide?.profitUsd ?? NaN, bonusUsd: wide?.bonusUsd ?? NaN })
    expect(tight?.profitUsd).toBe(30_00)
  })

  it('a manual snapshot on a bonus day keeps that day visible (the anchor is not hidden)', () => {
    const id = usdRoom()
    createTransaction({ roomId: id, type: 'bonus', amount: 50_00, currency: 'USD', date: '2026-11-10' })
    upsertBalance(id, '2026-11-09', 100_00, 'USD')
    upsertBalance(id, '2026-11-10', 150_00, 'USD')

    const days = sessionsInRange('2026-11-10', '2026-11-10')
    expect(days).toHaveLength(1)
    expect(days[0]?.rooms[0]).toMatchObject({ bonusUsd: 50_00, pokerProfitUsd: 0 })
  })

  it('a bonus on a real session day stays its own term of the same row', () => {
    const id = usdRoom()
    addTournament(id, '2026-11-10', 50_00, 100_00)
    createTransaction({ roomId: id, type: 'bonus', amount: 50_00, currency: 'USD', date: '2026-11-10' })
    upsertBalance(id, '2026-11-09', 100_00, 'USD')
    upsertBalance(id, '2026-11-10', 200_00, 'USD')

    const day = sessionsInRange('2026-11-10', '2026-11-10')[0]
    expect(day?.rooms[0]).toMatchObject({ profitUsd: 100_00, bonusUsd: 50_00, pokerProfitUsd: 50_00 })
    expect(day?.totalUsd).toBe(50_00)
  })

  it('a casino-only day is still a session row (only the bonus lost that right)', () => {
    const id = usdRoom()
    // порядок естественный: сначала якорь, потом операция — только тогда auto-цепочка
    // строится вокруг якоря (`upsertBalance` пересборку не вызывает)
    upsertBalance(id, '2026-11-09', 100_00, 'USD')
    createTransaction({ roomId: id, type: 'casino', amount: -20_00, currency: 'USD', date: '2026-11-10' })

    const days = sessionsInRange('2026-11-10', '2026-11-10')
    expect(days.map((d) => d.date)).toEqual(['2026-11-10'])
    expect(days[0]?.rooms[0]).toMatchObject({ source: 'auto', casinoUsd: -20_00, bonusUsd: 0, profitUsd: -20_00, pokerProfitUsd: 0 })
  })
})

describe('bonus: day reconciliation R = S − T − X − B', () => {
  it('a bonus-only day has zero remainder and is not flagged', () => {
    const id = usdRoom()
    createTransaction({ roomId: id, type: 'bonus', amount: 50_00, currency: 'USD', date: '2026-11-10' })
    upsertBalance(id, '2026-11-09', 100_00, 'USD')
    upsertBalance(id, '2026-11-10', 150_00, 'USD')

    const reconcile = reconcileDay(id, '2026-11-10')
    expect(reconcile).toMatchObject({
      sessionProfitUsd: 50_00,
      tournamentProfitUsd: 0,
      casinoUsd: 0,
      bonusUsd: 50_00,
      remainderUsd: 0,
      flagged: false
    })
    expect(reconcile.blank).toBeNull()
  })

  it('the bonus is counted exactly once next to tournaments', () => {
    const id = usdRoom()
    addTournament(id, '2026-11-10', 50_00, 100_00)
    createTransaction({ roomId: id, type: 'bonus', amount: 50_00, currency: 'USD', date: '2026-11-10' })
    upsertBalance(id, '2026-11-09', 100_00, 'USD')
    // delta 100.00 = турниры 50.00 + бонус 50.00 → списывать нечего
    upsertBalance(id, '2026-11-10', 200_00, 'USD')

    const before = reconcileDay(id, '2026-11-10')
    expect(before.tournamentProfitUsd).toBe(50_00)
    expect(before.bonusUsd).toBe(50_00)
    expect(before.remainderUsd).toBe(0)

    const after = writeoffRemainder(id, '2026-11-10')
    expect(after.remainderUsd).toBe(0)
    expect(listTransactions({ roomId: id, type: 'casino' })).toHaveLength(0)
  })

  it('only the unexplained leftover is written off when a bonus is present', () => {
    const id = usdRoom()
    addTournament(id, '2026-11-10', 50_00, 100_00)
    createTransaction({ roomId: id, type: 'bonus', amount: 50_00, currency: 'USD', date: '2026-11-10' })
    upsertBalance(id, '2026-11-09', 100_00, 'USD')
    // delta 150.00: 50.00 турниры + 50.00 бонус + 50.00 остаток
    upsertBalance(id, '2026-11-10', 250_00, 'USD')

    expect(reconcileDay(id, '2026-11-10').remainderUsd).toBe(50_00)
    const after = writeoffRemainder(id, '2026-11-10')
    expect(after.remainderUsd).toBe(0)
    const casinoRows = listTransactions({ roomId: id, type: 'casino' })
    expect(casinoRows.map((t) => t.amount)).toEqual([50_00])
  })

  it('adjust-balance keeps the bonus in the target delta', () => {
    const id = usdRoom()
    addTournament(id, '2026-11-10', 50_00, 100_00)
    createTransaction({ roomId: id, type: 'bonus', amount: 50_00, currency: 'USD', date: '2026-11-10' })
    upsertBalance(id, '2026-11-09', 100_00, 'USD')
    upsertBalance(id, '2026-11-10', 100_00, 'USD')

    const reconcile = adjustBalanceToTournaments(id, '2026-11-10')
    expect(getBalance(id, '2026-11-10')?.amount).toBe(200_00)
    expect(reconcile.remainderUsd).toBe(0)
    expect(reconcile.flagged).toBe(false)
  })
})

describe('bonus: HTTP surface', () => {
  it('POST and the type filter work, and the list totals show the credit as money in', async () => {
    const id = usdRoom()
    const created = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      payload: { roomId: id, type: 'bonus', amount: 50_00, currency: 'USD', date: '2026-11-10' }
    })
    expect(created.statusCode).toBe(200)
    expect(created.json().transaction).toMatchObject({ type: 'bonus', direction: 'in' })

    const filtered = await app.inject({ method: 'GET', url: '/api/transactions?type=bonus&dateFrom=2026-11-01&dateTo=2026-11-30' })
    expect(filtered.statusCode).toBe(200)
    const body = filtered.json() as { transactions: { type: string }[]; totals: { flowUsd: number | null; flowScope: string } }
    expect(body.transactions.map((t) => t.type)).toEqual(['bonus'])
    // Подпись «зашло/ушло» показывает эффект на баланс, поэтому бонус в ней есть.
    expect(body.totals.flowUsd).toBe(50_00)
    expect(body.totals.flowScope).toBe('type')
  })

  it('the overview keeps bonuses out of cash and reports them in their own block', async () => {
    const id = usdRoom()
    createTransaction({ roomId: id, type: 'deposit', amount: 100_00, currency: 'USD', date: '2026-11-10', direction: 'in' })
    createTransaction({ roomId: id, type: 'bonus', amount: 50_00, currency: 'USD', date: '2026-11-10' })
    createTransaction({ roomId: id, type: 'bonus', amount: -10_00, currency: 'USD', date: '2026-11-10' })

    const overview = (await app.inject({ method: 'GET', url: '/api/transactions/overview?dateFrom=2026-11-10&dateTo=2026-11-10' })).json() as {
      cash: { depositedUsd: number }
      casino: { rows: number }
      bonus: { rows: number; totalUsd: number; creditedUsd: number; withheldUsd: number }
      rooms: { bonusUsd: number }[]
    }
    expect(overview.cash.depositedUsd).toBe(100_00)
    expect(overview.casino.rows).toBe(0)
    expect(overview.bonus).toMatchObject({ rows: 2, totalUsd: 40_00, creditedUsd: 50_00, withheldUsd: -10_00 })
    expect(overview.rooms[0]?.bonusUsd).toBe(40_00)
  })

  it('an unknown type is still rejected', async () => {
    const id = usdRoom()
    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      payload: { roomId: id, type: 'rakeback', amount: 10_00, currency: 'USD', date: '2026-11-10' }
    })
    expect(res.statusCode).toBe(400)
  })
})
