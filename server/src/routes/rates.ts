import type { FastifyInstance } from 'fastify'
import { autoRefresh, getRatesStatus } from '../services/rates/refresh.js'
import { deleteRateOverride, listOverrides, setRateOverride } from '../services/rates/overrides.js'
import { dismiss, listActive } from '../services/notifications.js'
import { HttpError } from '../lib/errors.js'

export async function ratesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/rates/status', async () => ({ ...getRatesStatus() }))

  app.post('/api/rates/refresh', async () => {
    const result = await autoRefresh()
    return { ok: true, ...result }
  })

  app.get<{ Querystring: { roomId?: string } }>('/api/rates/overrides', async (req) => {
    return { overrides: listOverrides(req.query.roomId === undefined ? undefined : Number(req.query.roomId)) }
  })

  app.put<{ Body: { roomId: number; fromCurrency: string; toCurrency: string; rate: number } }>(
    '/api/rates/overrides',
    async (req) => {
      const { roomId, fromCurrency, toCurrency, rate } = req.body
      if (!Number.isInteger(roomId) || roomId <= 0) throw new HttpError(400, 'roomId: invalid')
      return { override: setRateOverride(roomId, fromCurrency, toCurrency, rate) }
    }
  )

  app.delete<{ Querystring: { roomId: string; fromCurrency: string; toCurrency: string } }>(
    '/api/rates/overrides',
    async (req) => {
      const roomId = Number(req.query.roomId)
      if (!Number.isInteger(roomId) || roomId <= 0) throw new HttpError(400, 'roomId: invalid')
      deleteRateOverride(roomId, req.query.fromCurrency, req.query.toCurrency)
      return { ok: true }
    }
  )

  app.get('/api/notifications', async () => ({ notifications: listActive() }))

  app.post<{ Params: { id: string } }>('/api/notifications/:id/dismiss', async (req) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid id')
    dismiss(id)
    return { ok: true }
  })
}