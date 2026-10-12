import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../src/app.js'
import { initDb, resetDbForTests, setDbForTests } from '../src/db.js'
import { dayKey } from '../src/lib/date.js'

let app: FastifyInstance

beforeEach(async () => {
  setDbForTests(initDb(':memory:'))
  app = await createApp({ logger: false })
})

afterEach(async () => {
  await app.close()
  resetDbForTests()
})

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const total = y * 12 + (m - 1) + delta
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

describe('habits routes', () => {
  it('GET /api/habits returns an empty list initially', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/habits' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ habits: [] })
  })

  it('GET /api/habits validates the month query', async () => {
    for (const month of ['2026-13', 'nope']) {
      const res = await app.inject({ method: 'GET', url: `/api/habits?month=${month}` })
      expect(res.statusCode).toBe(400)
    }
  })

  it('POST /api/habits creates a trimmed habit', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/habits', payload: { name: '  Медитация  ' } })
    expect(res.statusCode).toBe(200)
    const habit = JSON.parse(res.body).habit as { id: number; name: string; archivedAt: string | null }
    expect(habit).toMatchObject({ name: 'Медитация', archivedAt: null })
    expect(typeof habit.id).toBe('number')

    for (const bad of [{}, { name: '' }, { name: '   ' }, { name: 'x'.repeat(101) }, { name: 5 }]) {
      const res2 = await app.inject({ method: 'POST', url: '/api/habits', payload: bad })
      expect(res2.statusCode).toBe(400)
    }
  })

  it('marks a day via PUT /:id/log and clears it with a null status', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/habits', payload: { name: 'Медитация' } })).json() as {
      habit: { id: number }
    }
    const id = created.habit.id
    const today = dayKey()

    const set = await app.inject({ method: 'PUT', url: `/api/habits/${id}/log`, payload: { date: today, status: 'done' } })
    expect(set.statusCode).toBe(200)
    expect(set.json()).toEqual({ log: { date: today, status: 'done' } })

    const listed = (await app.inject({ method: 'GET', url: `/api/habits?month=${monthKey(new Date())}` })).json() as {
      habits: { logs: Record<string, string> }[]
    }
    expect(listed.habits[0].logs).toEqual({ [today]: 'done' })

    const clear = await app.inject({ method: 'PUT', url: `/api/habits/${id}/log`, payload: { date: today, status: null } })
    expect(clear.statusCode).toBe(200)
    expect(clear.json()).toEqual({ log: null })
  })

  it('stores a partial day via PUT /:id/log', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/habits', payload: { name: 'Бег' } })).json() as {
      habit: { id: number }
    }
    const id = created.habit.id
    const today = dayKey()

    const set = await app.inject({ method: 'PUT', url: `/api/habits/${id}/log`, payload: { date: today, status: 'partial' } })
    expect(set.statusCode).toBe(200)
    expect(set.json()).toEqual({ log: { date: today, status: 'partial' } })

    const listed = (await app.inject({ method: 'GET', url: `/api/habits?month=${monthKey(new Date())}` })).json() as {
      habits: { logs: Record<string, string> }[]
    }
    expect(listed.habits[0].logs).toEqual({ [today]: 'partial' })
  })

  it('rejects bad log payloads and unknown habits', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/habits', payload: { name: 'Спорт' } })).json() as {
      habit: { id: number }
    }
    const id = created.habit.id

    const day = dayKey()
    expect((await app.inject({ method: 'PUT', url: `/api/habits/${id}/log`, payload: { date: 'bad', status: 'done' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: `/api/habits/${id}/log`, payload: { date: day, status: 'maybe' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: `/api/habits/9999/log`, payload: { date: day, status: 'done' } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'PUT', url: `/api/habits/abc/log`, payload: { date: day, status: 'done' } })).statusCode).toBe(400)
  })

  it('DELETE /:id soft-archives: hidden from every month, logs preserved in history', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/habits', payload: { name: 'Медитация' } })).json() as {
      habit: { id: number }
    }
    const id = created.habit.id
    const now = new Date()
    const cur = monthKey(now)
    const prev = addMonths(cur, -1)
    const prevDay = `${prev}-15`
    await app.inject({ method: 'PUT', url: `/api/habits/${id}/log`, payload: { date: prevDay, status: 'missed' } })

    const del = await app.inject({ method: 'DELETE', url: `/api/habits/${id}` })
    expect(del.statusCode).toBe(200)
    expect(del.json()).toEqual({ ok: true })
    expect((await app.inject({ method: 'DELETE', url: `/api/habits/${id}` })).statusCode).toBe(200)
    expect((await app.inject({ method: 'DELETE', url: '/api/habits/9999' })).statusCode).toBe(404)

    const current = (await app.inject({ method: 'GET', url: `/api/habits?month=${cur}` })).json() as {
      habits: { id: number; archivedAt: string }[]
    }
    expect(current.habits.map((h) => h.id)).not.toContain(id)

    const past = (await app.inject({ method: 'GET', url: `/api/habits?month=${prev}` })).json() as {
      habits: { id: number; archivedAt: string; logs: Record<string, string> }[]
    }
    expect(past.habits.map((h) => h.id)).not.toContain(id)

    const history = (await app.inject({ method: 'GET', url: '/api/habits/history' })).json() as {
      habits: { id: number; logs: Record<string, string> }[]
    }
    const archived = history.habits.find((h) => h.id === id)
    expect(archived).toBeDefined()
    expect(archived?.logs).toEqual({ [prevDay]: 'missed' })
  })

  it('POST /api/habits accepts a color and rejects a bad one', async () => {
    const ok = await app.inject({ method: 'POST', url: '/api/habits', payload: { name: 'Бег', color: '#A5B4FC' } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().habit).toMatchObject({ name: 'Бег', color: '#a5b4fc' })

    const bad = await app.inject({ method: 'POST', url: '/api/habits', payload: { name: 'Бег', color: 'red' } })
    expect(bad.statusCode).toBe(400)
  })

  it('PUT /api/habits/:id renames and recolors', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/habits', payload: { name: 'Медитация' } })).json() as {
      habit: { id: number }
    }
    const id = created.habit.id

    const res = await app.inject({ method: 'PUT', url: `/api/habits/${id}`, payload: { name: '🧘 Медитация', color: '#bbf7d0' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().habit).toMatchObject({ id, name: '🧘 Медитация', color: '#bbf7d0' })

    const listed = (await app.inject({ method: 'GET', url: `/api/habits?month=${monthKey(new Date())}` })).json() as {
      habits: { id: number; name: string }[]
    }
    expect(listed.habits[0]).toMatchObject({ id, name: '🧘 Медитация' })

    expect((await app.inject({ method: 'PUT', url: `/api/habits/${id}`, payload: { name: '' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: `/api/habits/${id}`, payload: { color: 'nope' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: '/api/habits/9999', payload: { name: 'X' } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'PUT', url: '/api/habits/abc', payload: { name: 'X' } })).statusCode).toBe(400)
  })

  it('PUT /api/habits/order stores the manual order and rejects a bad payload', async () => {
    const ids: number[] = []
    for (const name of ['A', 'B', 'C']) {
      const res = await app.inject({ method: 'POST', url: '/api/habits', payload: { name } })
      ids.push((res.json() as { habit: { id: number } }).habit.id)
    }
    const month = monthKey(new Date())
    const listed = async () =>
      ((await app.inject({ method: 'GET', url: `/api/habits?month=${month}` })).json() as { habits: { id: number }[] }).habits.map((h) => h.id)
    expect(await listed()).toEqual([ids[2], ids[1], ids[0]])

    const res = await app.inject({ method: 'PUT', url: '/api/habits/order', payload: { ids: [ids[0], ids[2]] } })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { habits: { id: number }[] }).habits.map((h) => h.id)).toEqual([ids[0], ids[2], ids[1]])
    expect(await listed()).toEqual([ids[0], ids[2], ids[1]])

    for (const bad of [{}, { ids: 'nope' }, { ids: [0] }, { ids: [1.5] }, { ids: ['x'] }, { ids: [ids[0], ids[0]] }, { ids: [9999] }]) {
      expect((await app.inject({ method: 'PUT', url: '/api/habits/order', payload: bad })).statusCode).toBe(400)
    }
  })

  it('GET /api/habits/history returns archived habits with stats, POST /:id/restore brings one back', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/habits', payload: { name: 'Бег', color: '#fdba74' } })).json() as {
      habit: { id: number }
    }
    const id = created.habit.id
    await app.inject({ method: 'PUT', url: `/api/habits/${id}/log`, payload: { date: '2020-01-01', status: 'done' } })
    await app.inject({ method: 'PUT', url: `/api/habits/${id}/log`, payload: { date: '2020-01-02', status: 'missed' } })
    await app.inject({ method: 'DELETE', url: `/api/habits/${id}` })

    const history = (await app.inject({ method: 'GET', url: '/api/habits/history' })).json() as {
      habits: { id: number; color: string; stats: { done: number; missed: number; completionRate: number } }[]
    }
    expect(history.habits).toHaveLength(1)
    expect(history.habits[0]).toMatchObject({ id, color: '#fdba74' })
    expect(history.habits[0].stats).toMatchObject({ done: 1, missed: 1, completionRate: 50 })

    const restored = await app.inject({ method: 'POST', url: `/api/habits/${id}/restore` })
    expect(restored.statusCode).toBe(200)
    expect(restored.json().habit.archivedAt).toBeNull()
    expect((await app.inject({ method: 'GET', url: '/api/habits/history' })).json()).toEqual({ habits: [] })
    expect((await app.inject({ method: 'POST', url: '/api/habits/9999/restore' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/api/habits/abc/restore' })).statusCode).toBe(400)
  })
})