import type { FastifyInstance } from 'fastify'
import { HttpError } from '../lib/errors.js'
import { isValidDayKey } from '../lib/date.js'
import { getLatestBalances, listForDate, upsertBalance } from '../services/balances.js'
import { getRatesStatus } from '../services/rates/refresh.js'
import { convertToUsd } from '../services/rates/convert.js'
import { tournamentsExistMap } from '../services/tournaments.js'
import { pendingImportPairs } from '../services/pending.js'

export async function balancesRoutes(app: FastifyInstance): Promise<void> {
  app.put<{ Body: { roomId: number; date: string; amount: number; currency: string } }>('/api/balances', async (req) => {
    return { balance: upsertBalance(req.body.roomId, req.body.date, req.body.amount, req.body.currency) }
  })

  app.get<{ Querystring: { date?: string } }>('/api/balances', async (req) => {
    if (req.query.date) {
      const date = req.query.date
      if (!isValidDayKey(date)) throw new HttpError(400, 'date: invalid')
      return { balances: listForDate(date) }
    }
    return { balances: getLatestBalances() }
  })

  app.get('/api/balances/current', async () => {
    const balances = getLatestBalances()
    const rates = getRatesStatus()
    const exists = tournamentsExistMap()
    const pending = pendingImportPairs()
    const rows = balances.map((b) => {
      const amountUsd = convertToUsd(b.amount, b.currency, b.date, b.roomId)
      return {
        ...b,
        amountUsd,
        staleRate: amountUsd === null,
        hasTournaments: exists.has(`${b.roomId}:${b.date}`),
        pendingImport: pending.has(`${b.roomId}:${b.date}`)
      }
    })
    const totalUsd = rows.some((r) => r.amountUsd === null) ? null : rows.reduce((acc, r) => acc + (r.amountUsd as number), 0)
    return {
      balances: rows,
      totalUsd,
      rates: { stale: rates.stale, usdRub: rates.usdRub, eurUsd: rates.eurUsd }
    }
  })
}