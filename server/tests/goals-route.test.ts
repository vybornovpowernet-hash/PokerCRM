import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../src/app.js'
import { initDb, resetDbForTests, setDbForTests, getDb } from '../src/db.js'
import { createRoom } from '../src/services/rooms.js'

let app: FastifyInstance

beforeEach(async () => {
  setDbForTests(initDb(':memory:'))
  app = await createApp({ logger: false })
})

afterEach(async () => {
  await app.close()
  resetDbForTests()
})

function insertTournament(roomId: number, date: string, buyin: number, result: number, currency: string): void {
  getDb().prepare('INSERT INTO tournaments (room_id, date, buyin, result, currency) VALUES (?, ?, ?, ?, ?)').run(roomId, date, buyin, result, currency)
}

async function post(body: unknown, url = '/api/goals'): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const res = await app.inject({ method: 'POST', url, payload: body })
  return { statusCode: res.statusCode, body: JSON.parse(res.body) as Record<string, unknown> }
}

describe('goals routes', () => {
  it('GET /api/goals returns an empty list initially', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/goals' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ goals: [] })
  })

  it('POST /api/goals creates an active goal', async () => {
    const { statusCode, body } = await post({ metric: 'distance', targetUnits: 100 })
    expect(statusCode).toBe(200)
    const goal = body.goal as Record<string, unknown>
    expect(goal).toMatchObject({ status: 'active', progress: { currentUnits: 0, percent: 0, blank: false }, entries: [] })
    expect(typeof goal.id).toBe('number')
  })

  it('rejects invalid goal payloads', async () => {
    expect((await post({ metric: 'wrong', targetUnits: 100 })).statusCode).toBe(400)
    expect((await post({ metric: 'distance', targetUnits: -5 })).statusCode).toBe(400)
    expect((await post({}))).toMatchObject({ statusCode: 400, body: { error: expect.any(String) } })
  })

  it('reports live progress in the list', async () => {
    const room = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    insertTournament(room, '2026-09-10', 550, 700, 'USD')
    insertTournament(room, '2026-09-11', 550, 0, 'USD')
    await post({ metric: 'distance', targetUnits: 4 })

    const res = await app.inject({ method: 'GET', url: '/api/goals' })
    const goals = (JSON.parse(res.body) as { goals: Record<string, unknown>[] }).goals
    expect(goals).toHaveLength(1)
    expect(goals[0].progress).toMatchObject({ currentUnits: 2, percent: 50, blank: false })
    const milestones = ((goals[0].entries as { milestone: number | null }[]).map((e) => e.milestone).sort())
    expect(milestones).toEqual([50])
    expect((goals[0].status as string)).toBe('active')
  })

  it('adds a user entry via POST /:id/entry', async () => {
    const { body } = await post({ metric: 'bankroll', targetUnits: 10_000 })
    const goalId = (body.goal as { id: number }).id

    const res = await app.inject({ method: 'POST', url: `/api/goals/${goalId}/entry`, payload: { content: 'апнулся на тысячу' } })
    expect(res.statusCode).toBe(200)
    const entry = JSON.parse(res.body).entry as { kind: string; content: string; milestone: number | null }
    expect(entry).toMatchObject({ kind: 'user', milestone: null, content: 'апнулся на тысячу' })

    expect((await post({ content: '' }, `/api/goals/${goalId}/entry`)).statusCode).toBe(400)
    expect((await post({ content: 'x' }, '/api/goals/9999/entry')).statusCode).toBe(404)
  })

  it('sanitizes rich text content on POST /:id/entry', async () => {
    const { body } = await post({ metric: 'custom', targetUnits: 1, title: 'Дневник' })
    const goalId = (body.goal as { id: number }).id

    const res = await app.inject({
      method: 'POST',
      url: `/api/goals/${goalId}/entry`,
      payload: { content: '<p>Жирный <strong>акцент</strong></p><script>boom()</script>' }
    })
    expect(res.statusCode).toBe(200)
    const entry = JSON.parse(res.body).entry as { content: string }
    expect(entry.content).toBe('<p>Жирный <strong>акцент</strong></p>boom()')
  })

  it('closes a goal via POST /:id/close with an outcome', async () => {
    const { body } = await post({ metric: 'bankroll', targetUnits: 10_000 })
    const goalId = (body.goal as { id: number }).id

    const res = await app.inject({ method: 'POST', url: `/api/goals/${goalId}/close`, payload: { outcome: 'achieved' } })
    expect(res.statusCode).toBe(200)
    expect((JSON.parse(res.body).goal as { status: string }).status).toBe('achieved')

    expect((await post({ outcome: 'failed' }, `/api/goals/${goalId}/close`)).statusCode).toBe(400)
    expect((await post({}, `/api/goals/${goalId}/close`)).statusCode).toBe(400)
    expect((await post({ outcome: 'nope' }, `/api/goals/${goalId}/close`)).statusCode).toBe(400)
    expect((await post({ outcome: 'failed' }, '/api/goals/9999/close')).statusCode).toBe(404)
  })

  it('creates a custom goal with a title', async () => {
    const { statusCode, body } = await post({ metric: 'custom', targetUnits: 1, title: 'Выучить испанский' })
    expect(statusCode).toBe(200)
    const goal = body.goal as Record<string, unknown>
    expect(goal).toMatchObject({ metric: 'custom', title: 'Выучить испанский', targetUnits: 1, status: 'active', progress: { currentUnits: null, percent: 0, blank: false } })

    expect((await post({ metric: 'custom', targetUnits: 1 })).statusCode).toBe(400)
  })

  it('rejects the removed "closed" outcome', async () => {
    const { body } = await post({ metric: 'distance', targetUnits: 10 })
    const goalId = (body.goal as { id: number }).id

    expect((await post({ outcome: 'closed' }, `/api/goals/${goalId}/close`)).statusCode).toBe(400)
  })

  it('acknowledges an auto-finished goal via POST /:id/acknowledge', async () => {
    const room = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    insertTournament(room, '2026-09-10', 550, 0, 'USD')
    const { body } = await post({ metric: 'distance', targetUnits: 1 })
    const goal = body.goal as { id: number; status: string; acknowledgedAt: string | null }
    expect(goal).toMatchObject({ status: 'achieved', acknowledgedAt: null })

    const res = await app.inject({ method: 'POST', url: `/api/goals/${goal.id}/acknowledge` })
    expect(res.statusCode).toBe(200)
    expect((JSON.parse(res.body).goal as { acknowledgedAt: string | null }).acknowledgedAt).not.toBeNull()

    expect((await app.inject({ method: 'POST', url: '/api/goals/9999/acknowledge' })).statusCode).toBe(404)
  })

  it('refuses to acknowledge an active goal', async () => {
    const { body } = await post({ metric: 'distance', targetUnits: 10 })
    const goalId = (body.goal as { id: number }).id

    expect((await app.inject({ method: 'POST', url: `/api/goals/${goalId}/acknowledge` })).statusCode).toBe(400)
  })

  it('replaces the checklist via PUT /:id/checklist and returns the reconciled goal', async () => {
    const { body } = await post({ metric: 'distance', targetUnits: 10 })
    const goalId = (body.goal as { id: number }).id

    const checklist = [
      { id: 'id-0', text: 'гигиена', status: 'completed' },
      { id: 'id-1', text: 'разбор', status: 'pending' }
    ]
    const res = await app.inject({ method: 'PUT', url: `/api/goals/${goalId}/checklist`, payload: { items: checklist } })
    expect(res.statusCode).toBe(200)
    const goal = JSON.parse(res.body).goal as { checklist: typeof checklist; progress: { currentUnits: number; percent: number; blank: boolean } }
    expect(goal).toMatchObject({ checklist })
    expect(goal.progress).toMatchObject({ currentUnits: 0, percent: 0, blank: false })
  })

  it('rejects invalid checklist payloads', async () => {
    const { body } = await post({ metric: 'distance', targetUnits: 10 })
    const goalId = (body.goal as { id: number }).id

    const put = async (payload: unknown) =>
      (await app.inject({ method: 'PUT', url: `/api/goals/${goalId}/checklist`, payload })).statusCode

    expect(await put({})).toBe(400)
    expect(await put({ items: 'nope' })).toBe(400)
    expect(await put({ items: [{ id: 'a' }] })).toBe(400)
    expect((await app.inject({ method: 'PUT', url: '/api/goals/9999/checklist', payload: { items: [] } })).statusCode).toBe(404)
  })

  it('allows checklist changes on a settled goal without reopening it', async () => {
    const { body } = await post({ metric: 'distance', targetUnits: 10 })
    const goalId = (body.goal as { id: number }).id
    await post({ outcome: 'achieved' }, `/api/goals/${goalId}/close`)

    const items = [{ id: 'id-0', text: 'гигиена', status: 'completed' }]
    const res = await app.inject({ method: 'PUT', url: `/api/goals/${goalId}/checklist`, payload: { items } })
    expect(res.statusCode).toBe(200)
    expect((JSON.parse(res.body).goal as { status: string; checklist: typeof items }).status).toBe('achieved')
    expect((JSON.parse(res.body).goal as { checklist: typeof items }).checklist).toEqual(items)
  })

  it('persists a manual order through PUT /api/goals/order', async () => {
    const ids: number[] = []
    for (const units of [10, 20, 30]) {
      const { body } = await post({ metric: 'distance', targetUnits: units })
      ids.push((body.goal as { id: number }).id)
    }

    const order = [ids[0], ids[2], ids[1]] as number[]
    const res = await app.inject({ method: 'PUT', url: '/api/goals/order', payload: { ids: order } })
    expect(res.statusCode).toBe(200)
    expect((JSON.parse(res.body) as { goals: { id: number }[] }).goals.map((g) => g.id)).toEqual(order)

    const list = await app.inject({ method: 'GET', url: '/api/goals' })
    expect((JSON.parse(list.body) as { goals: { id: number }[] }).goals.map((g) => g.id)).toEqual(order)
  })

  it('rejects a malformed order payload with 400', async () => {
    const { body } = await post({ metric: 'distance', targetUnits: 10 })
    const goalId = (body.goal as { id: number }).id

    const put = async (payload: unknown) => (await app.inject({ method: 'PUT', url: '/api/goals/order', payload })).statusCode

    expect(await put({})).toBe(400)
    expect(await put({ ids: 'nope' })).toBe(400)
    expect(await put({ ids: [goalId, goalId] })).toBe(400)
    expect(await put({ ids: [9999] })).toBe(400)
  })
})