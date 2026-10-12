import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../src/app.js'
import { initDb, resetDbForTests, setDbForTests } from '../src/db.js'
import { getDayStartHour, getSettings, setDayStartHour } from '../src/services/settings.js'
import { HttpError } from '../src/lib/errors.js'

beforeEach(() => {
  setDbForTests(initDb(':memory:'))
})

afterEach(() => {
  resetDbForTests()
})

describe('settings', () => {
  it('defaults day_start_hour to 0 on a fresh database', () => {
    expect(getDayStartHour()).toBe(0)
    expect(getSettings()).toEqual({ dayStartHour: 0 })
  })

  it('persists day_start_hour and reads it back', () => {
    expect(setDayStartHour(6)).toBe(6)
    expect(getDayStartHour()).toBe(6)
    expect(getSettings()).toEqual({ dayStartHour: 6 })
    setDayStartHour(12)
    expect(getDayStartHour()).toBe(12)
  })

  it('rejects non-integer and out-of-range values with 400 without changing the stored one', () => {
    setDayStartHour(6)
    for (const bad of [undefined, null, '6', -1, 13, 6.5, NaN]) {
      let caught: unknown
      try {
        setDayStartHour(bad)
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(HttpError)
      expect((caught as HttpError).status).toBe(400)
    }
    expect(getDayStartHour()).toBe(6)
  })
})

describe('settings API', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = await createApp({ logger: false })
  })

  afterEach(async () => {
    await app.close()
  })

  it('GET /api/settings returns the default boundary', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ settings: { dayStartHour: 0 } })
  })

  it('PUT /api/settings persists the boundary and reads it back', async () => {
    const put = await app.inject({ method: 'PUT', url: '/api/settings', payload: { dayStartHour: 6 } })
    expect(put.statusCode).toBe(200)
    expect(JSON.parse(put.body)).toEqual({ settings: { dayStartHour: 6 } })

    const get = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(JSON.parse(get.body)).toEqual({ settings: { dayStartHour: 6 } })
  })

  it('PUT /api/settings 400s on an out-of-range value', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: { dayStartHour: 13 } })
    expect(res.statusCode).toBe(400)
    expect(getDayStartHour()).toBe(0)
  })
})
