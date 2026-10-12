import type { FastifyInstance } from 'fastify'
import { HttpError } from '../lib/errors.js'
import { isValidDayKey } from '../lib/date.js'
import { activityCalendar, sessionStats, tournamentTimeline } from '../services/statistics.js'

export async function statisticsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/statistics/timeline', async () => {
    return { timeline: tournamentTimeline() }
  })

  app.get<{ Querystring: { year?: string; month?: string } }>('/api/statistics/calendar', async (req) => {
    const year = Number(req.query.year)
    const month = Number(req.query.month)
    if (!req.query.year || !req.query.month || !Number.isInteger(year) || !Number.isInteger(month)) {
      throw new HttpError(400, 'year and month are required')
    }
    return { calendar: activityCalendar(year, month) }
  })

  app.get<{ Querystring: { dateFrom?: string; dateTo?: string; roomIds?: string } }>(
    '/api/statistics/sessions',
    async (req) => {
      const dateFrom = req.query.dateFrom
      const dateTo = req.query.dateTo
      if (!dateFrom || !dateTo || !isValidDayKey(dateFrom) || !isValidDayKey(dateTo)) {
        throw new HttpError(400, 'dateFrom and dateTo are required (YYYY-MM-DD)')
      }
      const roomIds = parseRoomIds(req.query.roomIds)
      return { stats: sessionStats(dateFrom, dateTo, roomIds) }
    }
  )
}

function parseRoomIds(raw: string | undefined): number[] | undefined {
  if (!raw) return undefined
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
}