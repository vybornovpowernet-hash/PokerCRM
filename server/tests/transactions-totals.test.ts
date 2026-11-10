import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../src/app.js'
import { initDb, resetDbForTests, setDbForTests } from '../src/db.js'
import { createRoom } from '../src/services/rooms.js'
import { upsertRate } from '../src/services/rates/storage.js'
import { createTransaction, recordCasinoPnl, listTransactions } from '../src/services/funds.js'

const D = '2026-11-05'
const PREV = '2026-10-20'

let app: FastifyInstance
let bybit: number
let pokerdom: number
let redstar: number
let gg: number
let wina: number

const list = async (query = '') => {
  const res = await app.inject({ method: 'GET', url: `/api/transactions${query}` })
  expect(res.statusCode).toBe(200)
  return res.json()
}

beforeEach(async () => {
  setDbForTests(initDb(':memory:'))
  app = await createApp({ logger: false })

  bybit = createRoom({ name: 'Bybit', cashCurrency: 'USD', tournamentCurrency: 'USD', isWallet: true }).id
  pokerdom = createRoom({ name: 'PokerDom', cashCurrency: 'RUB', tournamentCurrency: 'RUB', rateSource: 'pokerdom' }).id
  redstar = createRoom({ name: 'RedStar', cashCurrency: 'EUR', tournamentCurrency: 'EUR', rateSource: 'er-api' }).id
  gg = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
  wina = createRoom({ name: 'Wina', cashCurrency: 'CNY', tournamentCurrency: 'CNY' }).id

  upsertRate(D, 'USD', 'RUB', 870717, 'pokerdom')
  upsertRate(D, 'EUR', 'USD', 11195, 'er-api')

  // касса и казино: ровно те суммы, что считает страница по фильтру «все типы»
  createTransaction({ roomId: bybit, type: 'deposit', amount: 10_000, fee: 150, currency: 'USD', direction: 'in', date: D })
  createTransaction({ roomId: bybit, type: 'withdraw', amount: 2_000, fee: 130, currency: 'USD', direction: 'out', date: D })
  createTransaction({ roomId: gg, type: 'casino', amount: -14_484, currency: 'USD', date: D })
  recordCasinoPnl({ roomId: gg, type: 'casino', amount: -1_000, currency: 'USD', date: D }, 'fx')
  // переводы: комиссия есть только у кросс-валютного
  createTransaction({ roomId: bybit, type: 'transfer', amount: 4_876, fee: 130, currency: 'USD', destinationRoomId: pokerdom, destAmount: 424_759, date: D })
  createTransaction({ roomId: gg, type: 'transfer', amount: 1_000, fee: 0, currency: 'USD', destinationRoomId: bybit, date: D })
  createTransaction({ roomId: redstar, type: 'transfer', amount: 7_000, fee: 0, currency: 'EUR', destinationRoomId: bybit, destAmount: 7_572, date: D })
  // соседний месяц, чтобы проверить диапазон
  createTransaction({ roomId: bybit, type: 'deposit', amount: 3_000, fee: 0, currency: 'USD', direction: 'in', date: PREV })
})

afterEach(async () => {
  await app.close()
  resetDbForTests()
})

describe('totals: сумма без переводов', () => {
  it('без фильтра типа flowUsd = депозиты - выводы - казино, переводы вне суммы', async () => {
    const body = await list(`?dateFrom=${D}&dateTo=${D}`)
    expect(body.totals.flowUsd).toBe(-7_484) // 100.00 - 20.00 - 144.84 - 10.00 = -74.84
    expect(body.totals.flowScope).toBe('all_without_transfers')
    expect(body.totals.flowCountedRows).toBe(4)
    expect(body.totals.flowMissingRateRows).toBe(0)
    expect(body.totals.transfers).toEqual({ count: 3, feeUsd: 130 })
  })

  it('существующие поля totals не изменились', async () => {
    const body = await list(`?dateFrom=${D}&dateTo=${D}`)
    expect(body.totals.feeUsd).toBe(410) // 1.50 + 1.30 (по кассе) + 1.30 (комиссия перевода)
    expect(body.totals.feeByCurrency).toEqual({ USD: 410 })
    expect(body.totals.missingRateRows).toBe(0)
    expect(body.transactions.length).toBe(7)
  })

  it('сумма равна независимому пересчёту по строкам списка', async () => {
    const body = await list(`?dateFrom=${D}&dateTo=${D}`)
    const rows = listTransactions({ dateFrom: D, dateTo: D })
    let expected = 0
    let counted = 0
    let missing = 0
    for (const t of rows) {
      if (t.type === 'transfer') continue
      if (t.amountUsd === null) {
        missing += 1
        continue
      }
      counted += 1
      expected += t.type === 'casino' ? t.amountUsd : t.direction === 'in' ? t.amountUsd : -t.amountUsd
    }
    expect(body.totals.flowUsd).toBe(expected)
    expect(body.totals.flowCountedRows).toBe(counted)
    expect(body.totals.flowMissingRateRows).toBe(missing)
    expect(counted).toBe(4)
  })
})

describe('totals: фильтр по типу', () => {
  it('type=transfer: суммы нет, только число переводов и их комиссии', async () => {
    const body = await list(`?dateFrom=${D}&dateTo=${D}&type=transfer`)
    expect(body.totals.flowUsd).toBeNull()
    expect(body.totals.flowScope).toBe('none')
    expect(body.totals.flowCountedRows).toBe(0)
    expect(body.totals.transfers).toEqual({ count: 3, feeUsd: 130 })
    expect(body.totals.feeUsd).toBe(130)
    expect(body.totals.feeByCurrency).toEqual({ USD: 130 })
  })

  it('type=deposit, withdraw, casino: прежнее знакочувствительное правило', async () => {
    expect((await list(`?dateFrom=${D}&dateTo=${D}&type=deposit`)).totals.flowUsd).toBe(10_000)
    expect((await list(`?dateFrom=${D}&dateTo=${D}&type=withdraw`)).totals.flowUsd).toBe(-2_000)
    expect((await list(`?dateFrom=${D}&dateTo=${D}&type=casino`)).totals.flowUsd).toBe(-15_484)
    expect((await list(`?dateFrom=${D}&dateTo=${D}&type=casino`)).totals.flowScope).toBe('type')
    expect((await list(`?dateFrom=${D}&dateTo=${D}&type=casino`)).totals.transfers).toEqual({ count: 0, feeUsd: 0 })
  })

  it('фильтр по руму не ломает правило: переводы этого рума всё равно вне суммы', async () => {
    const body = await list(`?dateFrom=${D}&dateTo=${D}&roomId=${bybit}`)
    expect(body.totals.flowUsd).toBe(8_000) // 100.00 - 20.00
    expect(body.totals.flowCountedRows).toBe(2)
    expect(body.totals.transfers).toEqual({ count: 1, feeUsd: 130 })
    // рум, где только перевод: сумма нулевая (строк кассы нет), а не null
    const redstarOnly = await list(`?dateFrom=${D}&dateTo=${D}&roomId=${redstar}`)
    expect(redstarOnly.totals.flowUsd).toBe(0)
    expect(redstarOnly.totals.flowCountedRows).toBe(0)
    expect(redstarOnly.totals.transfers.count).toBe(1)
  })
})

describe('totals: отсутствующий курс', () => {
  it('строка кассы без курса: flowUsd null и flowMissingRateRows = 1, а не ноль молча', async () => {
    // курса CNY нет намеренно
    createTransaction({ roomId: wina, type: 'deposit', amount: 1_000, fee: 0, currency: 'CNY', direction: 'in', date: D })
    const body = await list(`?dateFrom=${D}&dateTo=${D}`)
    expect(body.totals.flowUsd).toBeNull()
    expect(body.totals.flowMissingRateRows).toBe(1)
    expect(body.totals.flowCountedRows).toBe(4)
    // комиссия этой строки нулевая, поэтому fee-счётчик не запятнан
    expect(body.totals.missingRateRows).toBe(0)
  })

  it('комиссия перевода без курса не обнуляется молча: счётчик в missingRateRows', async () => {
    createTransaction({ roomId: wina, type: 'transfer', amount: 2_000, fee: 100, currency: 'CNY', destinationRoomId: gg, date: D })
    const body = await list(`?dateFrom=${D}&dateTo=${D}&type=transfer`)
    expect(body.totals.transfers).toEqual({ count: 4, feeUsd: 130 })
    expect(body.totals.missingRateRows).toBe(1)
    expect(body.totals.feeByCurrency).toEqual({ USD: 130, CNY: 100 })
    expect(body.totals.flowUsd).toBeNull()
    expect(body.totals.flowScope).toBe('none')
  })
})

describe('totals: период', () => {
  it('дата вне диапазона не попадает в сумму и в счётчики', async () => {
    const one = await list(`?dateFrom=${D}&dateTo=${D}`)
    const both = await list(`?dateFrom=${PREV}&dateTo=${D}`)
    expect(one.totals.flowUsd).toBe(-7_484)
    expect(both.totals.flowUsd).toBe(-4_484) // + 30.00 депозит прошлой даты
    expect(both.totals.flowCountedRows).toBe(5)
    expect(one.totals.transfers).toEqual({ count: 3, feeUsd: 130 })
    expect(both.totals.transfers).toEqual({ count: 3, feeUsd: 130 })
  })

  it('пустой период: нули, пустые счётчики и scope без фильтра', async () => {
    const body = await list('?dateFrom=2026-12-01&dateTo=2026-12-31')
    expect(body.totals).toEqual({
      feeUsd: 0,
      feeByCurrency: {},
      missingRateRows: 0,
      flowUsd: 0,
      flowScope: 'all_without_transfers',
      flowCountedRows: 0,
      flowMissingRateRows: 0,
      transfers: { count: 0, feeUsd: 0 }
    })
  })
})

describe('totals: согласованность с виджетом', () => {
  it('сумма комиссий списка равна fees.totalUsd того же периода', async () => {
    const body = await list(`?dateFrom=${D}&dateTo=${D}`)
    const overview = await app.inject({ method: 'GET', url: `/api/transactions/overview?dateFrom=${D}&dateTo=${D}` })
    expect(overview.statusCode).toBe(200)
    expect(overview.json().fees.totalUsd).toBe(body.totals.feeUsd)
    expect(overview.json().fees.missingRateRows).toBe(body.totals.missingRateRows)
  })
})
