import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { initDb, resetDbForTests, setDbForTests } from '../src/db.js'
import type { FastifyInstance } from 'fastify'

describe('rooms API', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    setDbForTests(initDb(':memory:'))
    app = await createApp({ logger: false })
  })

  afterEach(async () => {
    await app.close()
    resetDbForTests()
  })

  it('creates and lists a room', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { name: 'PokerDom', cashCurrency: 'usd', tournamentCurrency: 'rub' }
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.room.cashCurrency).toBe('USD')
    expect(body.room.tournamentCurrency).toBe('RUB')

    const list = await app.inject({ method: 'GET', url: '/api/rooms' })
    expect(list.json().rooms).toHaveLength(1)
  })

  it('rejects duplicate room names with 409', async () => {
    await app.inject({ method: 'POST', url: '/api/rooms', payload: { name: 'PokerDom', cashCurrency: 'USD', tournamentCurrency: 'RUB' } })
    const dup = await app.inject({ method: 'POST', url: '/api/rooms', payload: { name: 'PokerDom', cashCurrency: 'USD', tournamentCurrency: 'USD' } })
    expect(dup.statusCode).toBe(409)
  })

  it('rejects invalid currency codes with 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/rooms', payload: { name: 'X', cashCurrency: 'DD', tournamentCurrency: 'USD' } })
    expect(res.statusCode).toBe(400)
  })

  it('updates a room', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/rooms', payload: { name: 'RedStar', cashCurrency: 'EUR', tournamentCurrency: 'EUR' } })
    const id = created.json().room.id

    const upd = await app.inject({ method: 'PUT', url: `/api/rooms/${id}`, payload: { tournamentCurrency: 'USD' } })
    expect(upd.json().room.tournamentCurrency).toBe('USD')
  })

  it('deletes a room', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/rooms', payload: { name: 'Temp', cashCurrency: 'USD', tournamentCurrency: 'USD' } })
    const id = created.json().room.id

    const del = await app.inject({ method: 'DELETE', url: `/api/rooms/${id}` })
    expect(del.statusCode).toBe(200)

    const list = await app.inject({ method: 'GET', url: '/api/rooms' })
    expect(list.json().rooms).toHaveLength(0)
  })

  it('returns 404 for unknown room', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/rooms/999', payload: { name: 'Nope' } })
    expect(res.statusCode).toBe(404)
  })

  it('returns room templates with labels and rate source labels', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/rooms/templates' })
    expect(res.statusCode).toBe(200)
    const templates = res.json().templates
    expect(templates).toHaveLength(3)
    expect(templates[0]).toMatchObject({ key: 'pokerdom', label: 'PokerDom', rateSource: 'pokerdom', rateSourceLabel: 'Курс PokerDom (USD→RUB)' })
    expect(templates[1]).toMatchObject({ key: 'redstar', label: 'RedStar', rateSource: 'er-api', rateSourceLabel: 'Курс EUR/USD и CNY/USD (er-api)' })
    expect(templates[2]).toMatchObject({ key: 'gg', label: 'GG', rateSource: 'er-api' })
  })

  it('stores rateSource on create', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { name: 'PokerDom', cashCurrency: 'USD', tournamentCurrency: 'RUB', rateSource: 'pokerdom' }
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().room.rateSource).toBe('pokerdom')
  })

  it('defaults rateSource to null when not provided', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/rooms', payload: { name: 'Temp', cashCurrency: 'USD', tournamentCurrency: 'USD' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().room.rateSource).toBeNull()
  })

  it('rejects invalid rateSource with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { name: 'PokerDom', cashCurrency: 'USD', tournamentCurrency: 'RUB', rateSource: 'nope' }
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects currencies outside the allowlist with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { name: 'PokerDom', cashCurrency: 'KZT', tournamentCurrency: 'USD' }
    })
    expect(res.statusCode).toBe(400)
  })

  it('clears rateSource on update with null', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { name: 'PokerDom', cashCurrency: 'USD', tournamentCurrency: 'RUB', rateSource: 'pokerdom' }
    })
    const id = created.json().room.id

    const upd = await app.inject({ method: 'PUT', url: `/api/rooms/${id}`, payload: { rateSource: null } })
    expect(upd.statusCode).toBe(200)
    expect(upd.json().room.rateSource).toBeNull()
  })

  it('stores color on create and defaults to soft white when not provided', async () => {
    const withColor = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { name: 'PokerDom', cashCurrency: 'USD', tournamentCurrency: 'RUB', color: '#6EE7B7' }
    })
    expect(withColor.statusCode).toBe(200)
    expect(withColor.json().room.color).toBe('#6ee7b7')

    const withoutColor = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { name: 'Temp', cashCurrency: 'USD', tournamentCurrency: 'USD' }
    })
    expect(withoutColor.json().room.color).toBe('#f1f5f9')
  })

  it('updates a room color', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/rooms', payload: { name: 'RedStar', cashCurrency: 'EUR', tournamentCurrency: 'EUR' } })
    const id = created.json().room.id

    const upd = await app.inject({ method: 'PUT', url: `/api/rooms/${id}`, payload: { color: '#fda4af' } })
    expect(upd.statusCode).toBe(200)
    expect(upd.json().room.color).toBe('#fda4af')
  })

  it('rejects invalid color with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { name: 'PokerDom', cashCurrency: 'USD', tournamentCurrency: 'RUB', color: 'red' }
    })
    expect(res.statusCode).toBe(400)
  })

  it('stores isWallet on create and defaults to false', async () => {
    const wallet = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { name: 'Bybit', cashCurrency: 'USD', tournamentCurrency: 'USD', isWallet: true }
    })
    expect(wallet.statusCode).toBe(200)
    expect(wallet.json().room.isWallet).toBe(true)

    const plain = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { name: 'PokerDom', cashCurrency: 'USD', tournamentCurrency: 'RUB' }
    })
    expect(plain.json().room.isWallet).toBe(false)
  })

  it('updates isWallet', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/rooms', payload: { name: 'PokerDom', cashCurrency: 'USD', tournamentCurrency: 'RUB' } })
    const id = created.json().room.id

    const on = await app.inject({ method: 'PUT', url: `/api/rooms/${id}`, payload: { isWallet: true } })
    expect(on.json().room.isWallet).toBe(true)

    const off = await app.inject({ method: 'PUT', url: `/api/rooms/${id}`, payload: { isWallet: false } })
    expect(off.json().room.isWallet).toBe(false)
  })
})