import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../src/app.js'
import { initDb, resetDbForTests, setDbForTests } from '../src/db.js'
import { createRoom } from '../src/services/rooms.js'
import { upsertRate } from '../src/services/rates/storage.js'
import { setRateOverride } from '../src/services/rates/overrides.js'

let app: FastifyInstance
let usdRoom: number
let rubRoom: number

beforeEach(async () => {
  setDbForTests(initDb(':memory:'))
  app = await createApp({ logger: false })
  usdRoom = createRoom({ name: 'Bybit', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
  rubRoom = createRoom({ name: 'PokerDom', cashCurrency: 'RUB', tournamentCurrency: 'RUB' }).id
})

afterEach(async () => {
  await app.close()
  resetDbForTests()
})

describe('GET /api/rates/suggest', () => {
  it('suggests a destination amount from the frozen day rate', async () => {
    upsertRate('2026-10-01', 'USD', 'RUB', Math.round(87.02 * 10_000), 'pokerdom')
    const res = await app.inject({
      method: 'GET',
      url: `/api/rates/suggest?from=USD&to=RUB&date=2026-10-01&roomId=${rubRoom}&amount=5000`
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ rate: 870_200, suggestedAmount: 435_100 })
  })

  it('prefers the per-room override over the feed', async () => {
    upsertRate('2026-10-01', 'USD', 'RUB', Math.round(87.02 * 10_000), 'pokerdom')
    setRateOverride(rubRoom, 'USD', 'RUB', Math.round(87.1 * 10_000))
    const res = await app.inject({
      method: 'GET',
      url: `/api/rates/suggest?from=USD&to=RUB&date=2026-10-01&roomId=${rubRoom}&amount=5000`
    })
    expect(res.json().suggestedAmount).toBe(435_500)
  })

  it('returns nulls when no rate is known', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/rates/suggest?from=USD&to=RUB&date=2026-10-01' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ rate: null, suggestedAmount: null })
  })

  it('validates query parameters', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/rates/suggest?from=USD' })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/api/rates/suggest?from=RUBBISH&to=USD' })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/api/rates/suggest?from=USD&to=RUB&date=10-01' })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/api/rates/suggest?from=USD&to=RUB&amount=-5' })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: `/api/rates/suggest?from=USD&to=RUB&roomId=abc` })).statusCode).toBe(400)
  })
})

describe('POST /api/transactions with destAmount', () => {
  it('creates a cross-currency transfer with the exact credited amount', async () => {
    upsertRate('2026-10-01', 'USD', 'RUB', Math.round(87.02 * 10_000), 'pokerdom')
    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      payload: {
        roomId: usdRoom,
        type: 'transfer',
        amount: 50_00,
        fee: 1_30,
        currency: 'USD',
        destinationRoomId: rubRoom,
        destAmount: 4247_59,
        date: '2026-10-01'
      }
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().transaction).toMatchObject({ destAmount: 4247_59, destCurrency: 'RUB' })
  })

  it('rejects destAmount on a non-transfer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      payload: { roomId: usdRoom, type: 'deposit', amount: 10_00, currency: 'USD', destAmount: 100, date: '2026-10-01' }
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/destAmount/)
  })
})
