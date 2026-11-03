import type { FastifyInstance } from 'fastify'
import { autoRefresh, getRatesStatus } from '../services/rates/refresh.js'
import { deleteRateOverride, listOverrides, setRateOverride } from '../services/rates/overrides.js'
import { resolveCrossScaled } from '../services/rates/convert.js'
import { applyRate } from '../lib/money.js'
import { dayKey, isValidDayKey } from '../lib/date.js'
import { validateCurrency } from '../services/rooms.js'
import { parseId } from '../lib/http.js'
import { dismiss, listActive } from '../services/notifications.js'
import { HttpError } from '../lib/errors.js'

export async function ratesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/rates/status', async () => ({ ...getRatesStatus() }))

  // Read-only suggestion for the transfer form: the best rate the feed knows
  // for a pair/day/room (override → frozen day rate → latest known). The UI
  // prefills the exact destination amount with it, but the user's figure —
  // the room's real cash-desk number — is what gets stored in `dest_amount`.
  app.get<{
    Querystring: { from?: string; to?: string; date?: string; roomId?: string; amount?: string }
  }>('/api/rates/suggest', async (req) => {
    if (!req.query.from || !req.query.to) throw new HttpError(400, 'from and to are required')
    const from = validateCurrency(req.query.from, 'from')
    const to = validateCurrency(req.query.to, 'to')
    const date = req.query.date ?? dayKey()
    if (!isValidDayKey(date)) throw new HttpError(400, 'date: must be a valid YYYY-MM-DD day')
    const roomId = req.query.roomId ? parseId(req.query.roomId) : undefined
    const amount = req.query.amount ? Number(req.query.amount) : undefined
    if (amount !== undefined && (!Number.isInteger(amount) || amount < 0)) {
      throw new HttpError(400, 'amount: must be a non-negative integer (min units)')
    }
    const rate = resolveCrossScaled(from, to, date, roomId)
    if (rate === null) return { rate: null, suggestedAmount: null }
    return { rate, suggestedAmount: amount === undefined ? null : applyRate(amount, rate) }
  })

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