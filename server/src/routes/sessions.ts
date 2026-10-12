import type { FastifyInstance } from 'fastify'
import { HttpError } from '../lib/errors.js'
import { isValidDayKey } from '../lib/date.js'
import { sessionsInRange } from '../services/sessions.js'

export async function sessionsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { dateFrom?: string; dateTo?: string } }>('/api/sessions', async (req) => {
    const dateFrom = req.query.dateFrom
    const dateTo = req.query.dateTo
    if (!dateFrom || !dateTo || !isValidDayKey(dateFrom) || !isValidDayKey(dateTo)) {
      throw new HttpError(400, 'dateFrom and dateTo (YYYY-MM-DD) are required')
    }
    return { sessions: sessionsInRange(dateFrom, dateTo) }
  })
}