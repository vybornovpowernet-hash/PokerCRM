import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../src/app.js'
import { getDb, initDb, resetDbForTests, setDbForTests } from '../src/db.js'
import { createRoom } from '../src/services/rooms.js'
import { upsertRate } from '../src/services/rates/storage.js'
import { setRateOverride } from '../src/services/rates/overrides.js'
import { createTransaction, recordCasinoPnl, listTransactions } from '../src/services/funds.js'

const D = '2026-11-05'
const PREV = '2026-10-20'

let app: FastifyInstance
let bybit: number
let pokerdom: number
let redstar: number
let gg: number
let wina: number

const overview = async (dateFrom: string, dateTo: string) =>
  app.inject({ method: 'GET', url: `/api/transactions/overview?dateFrom=${dateFrom}&dateTo=${dateTo}` })

beforeEach(async () => {
  setDbForTests(initDb(':memory:'))
  app = await createApp({ logger: false })

  bybit = createRoom({ name: 'Bybit', cashCurrency: 'USD', tournamentCurrency: 'USD', isWallet: true }).id
  pokerdom = createRoom({ name: 'PokerDom', cashCurrency: 'RUB', tournamentCurrency: 'RUB', rateSource: 'pokerdom' }).id
  redstar = createRoom({ name: 'RedStar', cashCurrency: 'EUR', tournamentCurrency: 'EUR', rateSource: 'er-api' }).id
  gg = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
  wina = createRoom({ name: 'Wina', cashCurrency: 'CNY', tournamentCurrency: 'CNY' }).id

  upsertRate(D, 'USD', 'RUB', 870717, 'pokerdom') // 87.0717
  upsertRate(D, 'EUR', 'USD', 11195, 'er-api') // 1.1195
  upsertRate(PREV, 'USD', 'RUB', 870717, 'pokerdom')

  // касса
  createTransaction({ roomId: bybit, type: 'deposit', amount: 10_000, fee: 150, currency: 'USD', direction: 'in', date: D })
  createTransaction({ roomId: bybit, type: 'withdraw', amount: 2_000, fee: 130, currency: 'USD', direction: 'out', date: D })
  createTransaction({ roomId: pokerdom, type: 'deposit', amount: 10_000, fee: 100, currency: 'RUB', direction: 'in', date: D })
  createTransaction({ roomId: wina, type: 'withdraw', amount: 1_000, fee: 100, currency: 'CNY', direction: 'out', date: D })
  // переводы: считаемся и три вида исключений
  createTransaction({ roomId: bybit, type: 'transfer', amount: 4_876, fee: 130, currency: 'USD', destinationRoomId: pokerdom, destAmount: 424_759, date: D })
  createTransaction({ roomId: redstar, type: 'transfer', amount: 7_000, fee: 0, currency: 'EUR', destinationRoomId: bybit, destAmount: 7_572, date: D })
  createTransaction({ roomId: gg, type: 'transfer', amount: 5_000, fee: 0, currency: 'USD', destinationRoomId: wina, destAmount: 35_000, date: D }) // курса CNY нет
  createTransaction({ roomId: gg, type: 'transfer', amount: 1_000, fee: 0, currency: 'USD', destinationRoomId: bybit, date: D }) // одна валюта, без точной суммы
  createTransaction({ roomId: pokerdom, type: 'transfer', amount: 5_000, fee: 0, currency: 'RUB', destinationRoomId: bybit, date: D }) // разная валюта, без точной суммы
  // историческая строка «одна валюта + точная сумма»: сервер так создавать уже не даёт
  getDb()
    .prepare(
      `INSERT INTO transactions (room_id, type, amount, fee, currency, direction, destination_room_id, dest_amount, date, writeoff)
       VALUES (?, 'transfer', 2000, 0, 'USD', 'out', ?, 2000, ?, 0)`
    )
    .run(gg, bybit, D)
  // казино: ручная строка и два авто-списания с причиной fx (в том числе положительное)
  createTransaction({ roomId: gg, type: 'casino', amount: -14_484, currency: 'USD', date: D })
  recordCasinoPnl({ roomId: gg, type: 'casino', amount: -1_000, currency: 'USD', date: D }, 'fx')
  recordCasinoPnl({ roomId: gg, type: 'casino', amount: 16, currency: 'USD', date: D }, 'fx')
  // соседний месяц
  createTransaction({ roomId: bybit, type: 'deposit', amount: 7_777, fee: 0, currency: 'USD', direction: 'in', date: PREV })
})

afterEach(async () => {
  await app.close()
  resetDbForTests()
})

describe('виджет: касса и комиссии', () => {
  it('считает внесено, выведено и чистый внос без комиссий', async () => {
    const res = await overview(D, D)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    // деп: 100.00 USD + 10000 RUB по 87.0717 = 115 центов; вывод: 20.00 USD (CNY-вывод без курса исключён)
    expect(body.cash.depositedUsd).toBe(10_115)
    expect(body.cash.withdrawnUsd).toBe(2_000)
    expect(body.cash.netInUsd).toBe(8_115)
  })

  it('переводы не входят ни во внесено, ни в выведено', async () => {
    const body = (await overview(D, D)).json()
    // только депозиты/выводы: 101.15 USD и 20.00 USD, переводов на 902.56+ USD там нет
    expect(body.cash.depositedUsd).toBe(10_115)
    expect(body.cash.withdrawnUsd).toBe(2_000)
  })

  it('комиссии: всего, по типам, по румам и раздельно по валютам', async () => {
    const body = (await overview(D, D)).json()
    expect(body.fees.totalUsd).toBe(411) // 150 + 130 (USD) + 100 RUB = 1 цент
    expect(body.fees.byType.deposit).toEqual({ usd: 151, count: 2 })
    expect(body.fees.byType.withdraw).toEqual({ usd: 130, count: 2 })
    expect(body.fees.byType.transfer).toEqual({ usd: 130, count: 1 })
    // сырые единицы никогда не складываются между валютами
    expect(body.fees.byCurrency).toEqual({ USD: 410, RUB: 100, CNY: 100 })
    const rooms = Object.fromEntries(body.fees.byRoom.map((r: { roomId: number; usd: number }) => [r.roomId, r.usd]))
    expect(rooms[bybit]).toBe(410)
    expect(rooms[pokerdom]).toBe(1)
    expect(rooms[wina]).toBe(0)
  })

  it('строку без курса исключает и считает в missingRateRows, а не нулём', async () => {
    const body = (await overview(D, D)).json()
    expect(body.cash.missingRateRows).toBe(1) // вывод в CNY
    expect(body.fees.missingRateRows).toBe(1) // его же комиссия
    expect(body.casino.missingRateRows).toBe(0)
    expect(body.fees.totalUsd).toBe(411) // CNY-комиссия в USD-итог не вошла
  })
})

describe('виджет: казино и авто-списания', () => {
  it('разводит вручную записанное и списания остатка, с разбивкой по причинам', async () => {
    const body = (await overview(D, D)).json()
    expect(body.casino.totalUsd).toBe(-15_468)
    expect(body.casino.winsUsd).toBe(16)
    expect(body.casino.lossesUsd).toBe(-15_484)
    expect(body.casino.manualUsd).toBe(-14_484)
    expect(body.casino.autoUsd).toBe(-984)
    expect(body.casino.byReason).toEqual({
      casino: { usd: 0, count: 0 },
      fx: { usd: -984, count: 2 },
      other: { usd: 0, count: 0 }
    })
  })
})

describe('виджет: курсовая разница переводов', () => {
  it('считает потери и выгоды неотрицательными величинами и итог как разность', async () => {
    const body = (await overview(D, D)).json()
    // Bybit->PokerDom: по курсу 4245.62 RUB, зачислено 4247.59 -> выгода 2 цента
    // RedStar->Bybit: по курсу 78.37 USD, зачислено 75.72 -> потеря 265 центов
    expect(body.fx.lossesUsd).toBe(265)
    expect(body.fx.gainsUsd).toBe(2)
    expect(body.fx.netLossUsd).toBe(263)
    expect(body.fx.rows).toBe(2)
  })

  it('считает исключённые переводы по трём причинам и не включает их в разницу', async () => {
    const body = (await overview(D, D)).json()
    expect(body.fx.excluded).toEqual({ noDestAmount: 1, sameCurrency: 2, noRate: 1 })
    expect(body.fx.rows).toBe(2)
  })

  it('уважает ручной курс рума-получателя', async () => {
    setRateOverride(pokerdom, 'USD', 'RUB', 900_000) // касса PokerDom считает по 90.00
    const body = (await overview(D, D)).json()
    // 4876 * 90.00 = 438840; минус 424759 = 14081 RUB потеря -> inverseRate(14081, 900000) = 156 центов
    expect(body.fx.lossesUsd).toBe(265 + 156)
    expect(body.fx.gainsUsd).toBe(0)
    expect(body.fx.netLossUsd).toBe(421)
  })
})

describe('виджет: разбивка по румам и маршруты переводов', () => {
  it('отдаёт таблицу по румам в USD', async () => {
    const body = (await overview(D, D)).json()
    const room = (id: number) => body.rooms.find((r: { roomId: number }) => r.roomId === id)
    expect(room(bybit)).toMatchObject({ depositedUsd: 10_000, withdrawnUsd: 2_000, feesUsd: 410, casinoUsd: 0, fxUsd: 265 })
    expect(room(pokerdom)).toMatchObject({ depositedUsd: 115, feesUsd: 1, fxUsd: -2 })
    expect(room(gg)).toMatchObject({ casinoUsd: -15_468 })
    expect(room(wina).withdrawnUsd).toBe(0)
  })

  it('маршруты переводов: откуда, куда, число и комиссии, без сумм самих переводов', async () => {
    const body = (await overview(D, D)).json()
    const route = (from: number, to: number) => body.routes.find((r: { fromRoomId: number; toRoomId: number }) => r.fromRoomId === from && r.toRoomId === to)
    expect(route(bybit, pokerdom)).toMatchObject({ count: 1, feeUsd: 130, feeByCurrency: { USD: 130 } })
    expect(route(redstar, bybit)).toMatchObject({ count: 1, feeUsd: 0, feeByCurrency: { EUR: 0 } })
    expect(route(gg, bybit).count).toBe(2)
    expect(body.routes.find((r: { toRoomName?: string }) => r.toRoomName === undefined)).toBeUndefined()
  })
})

describe('виджет: период, пусто и валидация', () => {
  it('границы периода включительно, соседний месяц не захватывается', async () => {
    const one = (await overview(D, D)).json()
    expect(one.cash.depositedUsd).toBe(10_115)
    const prevOnly = (await overview(PREV, PREV)).json()
    expect(prevOnly.cash.depositedUsd).toBe(7_777)
    expect(prevOnly.fx.rows).toBe(0)
    const both = (await overview(PREV, D)).json()
    expect(both.cash.depositedUsd).toBe(17_892)
    const month = (await overview('2026-11-01', '2026-11-30')).json()
    expect(month.cash.depositedUsd).toBe(10_115)
  })

  it('пустой период даёт нули и пустые массивы', async () => {
    const body = (await overview('2026-12-01', '2026-12-31')).json()
    expect(body.cash).toEqual({ depositedUsd: 0, withdrawnUsd: 0, netInUsd: 0, missingRateRows: 0 })
    expect(body.fees.totalUsd).toBe(0)
    expect(body.fees.byCurrency).toEqual({})
    expect(body.fees.byRoom).toEqual([])
    expect(body.casino.totalUsd).toBe(0)
    expect(body.fx).toMatchObject({ lossesUsd: 0, gainsUsd: 0, netLossUsd: 0, rows: 0, excluded: { noDestAmount: 0, sameCurrency: 0, noRate: 0 } })
    expect(body.rooms).toEqual([])
    expect(body.routes).toEqual([])
  })

  it('даты валидируются строго, порядок периода обязателен', async () => {
    for (const url of [
      '/api/transactions/overview?dateFrom=2026-13-01&dateTo=2026-12-31',
      '/api/transactions/overview?dateFrom=2026-01-01&dateTo=%202026-01-02',
      '/api/transactions/overview?dateFrom=2026-01-01T00:00&dateTo=2026-01-02',
      '/api/transactions/overview?dateFrom=2026-01-02',
      '/api/transactions/overview?dateTo=2026-01-02',
      '/api/transactions/overview?dateFrom=2026-01-02&dateTo=2026-01-01',
      '/api/transactions/overview?dateFrom=2026-1-1&dateTo=2026-01-02'
    ]) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.statusCode, url).toBe(400)
      expect(res.json().error, url).toMatch(/dateFrom|dateTo/)
    }
  })
})

describe('согласованность виджета со списком операций', () => {
  it('итоги равны независимому проходу по строкам списка', async () => {
    const body = (await overview(D, D)).json()
    const rows = listTransactions({ dateFrom: D, dateTo: D })
    let deposited = 0
    let withdrawn = 0
    let fees = 0
    let casino = 0
    let fx = 0
    let cashMissing = 0
    let feeMissing = 0
    let fxRows = 0
    for (const t of rows) {
      if (t.type === 'deposit' || t.type === 'withdraw') {
        if (t.amountUsd === null) cashMissing++
        else if (t.type === 'deposit') deposited += t.amountUsd
        else withdrawn += t.amountUsd
      }
      if (t.fee > 0) {
        if (t.feeUsd === null) feeMissing++
        else fees += t.feeUsd
      }
      if (t.type === 'casino' && t.amountUsd !== null) casino += t.amountUsd
      if (t.fxDiffUsd !== null) {
        fxRows++
        fx += t.fxDiffUsd
      }
    }
    expect(body.cash.depositedUsd).toBe(deposited)
    expect(body.cash.withdrawnUsd).toBe(withdrawn)
    expect(body.cash.netInUsd).toBe(deposited - withdrawn)
    expect(body.cash.missingRateRows).toBe(cashMissing)
    expect(body.fees.totalUsd).toBe(fees)
    expect(body.fees.missingRateRows).toBe(feeMissing)
    expect(body.casino.totalUsd).toBe(casino)
    expect(body.fx.netLossUsd).toBe(fx)
    expect(body.fx.rows).toBe(fxRows)
  })
})

describe('список операций: totals и поля строки', () => {
  it('GET /api/transactions отдаёт totals по отфильтрованным строкам', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/transactions?dateFrom=${D}&dateTo=${D}` })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.totals.feeUsd).toBe(411)
    expect(body.totals.feeByCurrency).toEqual({ USD: 410, RUB: 100, CNY: 100 })
    expect(body.totals.missingRateRows).toBe(1)
    // фильтр по руму меняет и totals
    const onlyBybit = await app.inject({ method: 'GET', url: `/api/transactions?dateFrom=${D}&dateTo=${D}&roomId=${bybit}` })
    expect(onlyBybit.json().totals.feeUsd).toBe(410)
    expect(onlyBybit.json().totals.feeByCurrency).toEqual({ USD: 410 })
    expect(onlyBybit.json().totals.missingRateRows).toBe(0)
  })

  it('кросс-валютный перевод с точной суммой несёт fxExpectedDest и fxDiffUsd, остальные строки null', async () => {
    const body = (await app.inject({ method: 'GET', url: `/api/transactions?dateFrom=${D}&dateTo=${D}` })).json()
    const by = (id: number) => body.transactions.find((t: { id: number }) => t.id === id)
    const rows = body.transactions as Array<{ id: number; type: string; roomId: number; destinationRoomId: number | null }>
    const rubTransfer = rows.find((t) => t.type === 'transfer' && t.destinationRoomId === pokerdom)!
    const eurTransfer = rows.find((t) => t.type === 'transfer' && t.roomId === redstar)!
    const noRateTransfer = rows.find((t) => t.type === 'transfer' && t.destinationRoomId === wina)!
    expect(by(rubTransfer.id)).toMatchObject({ fxExpectedDest: 424_562, fxDiffUsd: -2, feeUsd: 130 })
    expect(by(eurTransfer.id)).toMatchObject({ fxExpectedDest: 7_572 + 265, fxDiffUsd: 265 })
    expect(by(noRateTransfer.id).fxExpectedDest).toBeNull()
    expect(by(noRateTransfer.id).fxDiffUsd).toBeNull()
    const deposit = rows.find((t) => t.type === 'deposit' && t.roomId === bybit)!
    expect(by(deposit.id)).toMatchObject({ fxExpectedDest: null, fxDiffUsd: null, feeUsd: 150 })
    const rubDeposit = rows.find((t) => t.type === 'deposit' && t.roomId === pokerdom)!
    expect(by(rubDeposit.id).feeUsd).toBe(1) // 100 RUB-копеек по 87.0717 = 1 цент
    const sameCurrency = rows.find((t) => t.type === 'transfer' && t.destinationRoomId === bybit && t.roomId === gg)!
    expect(by(sameCurrency.id).fxDiffUsd).toBeNull()
  })

  it('в ответе одной операции поля тоже есть', async () => {
    const created = createTransaction({ roomId: bybit, type: 'transfer', amount: 4_876, fee: 130, currency: 'USD', destinationRoomId: pokerdom, destAmount: 424_759, date: D })
    expect(created.fxExpectedDest).toBe(424_562)
    expect(created.fxDiffUsd).toBe(-2)
    const res = await app.inject({ method: 'GET', url: `/api/transactions/flows?dateFrom=${D}&dateTo=${D}` })
    expect(res.statusCode).toBe(200)
  })
})
