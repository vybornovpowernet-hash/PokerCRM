import type { FastifyInstance } from 'fastify'
import { HttpError } from '../lib/errors.js'
import { isValidDayKey } from '../lib/date.js'
import { parseId } from '../lib/http.js'
import {
  createTransaction,
  deleteTransaction,
  flowTotals,
  listTransactions,
  updateTransaction
} from '../services/funds.js'
import { orphanedDiscrepancies, writeoffDiscrepancy } from '../services/tournaments.js'
import type { TransactionInput } from '../services/funds.js'

export async function transactionsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: { type?: string; roomId?: string; currency?: string; dateFrom?: string; dateTo?: string; includeDiscrepancies?: string }
  }>('/api/transactions', async (req) => {
    const { type, currency, dateFrom, dateTo, includeDiscrepancies } = req.query
    const roomId = req.query.roomId !== undefined ? parseId(req.query.roomId) : undefined
    const transactions = listTransactions({
      type: type as TransactionInput['type'] | undefined,
      roomId,
      currency,
      dateFrom,
      dateTo
    })
    const discrepancies = includeDiscrepancies === '1' ? orphanedDiscrepancies(dateFrom, dateTo, roomId) : []
    return { transactions, discrepancies }
  })

  app.get<{ Querystring: { dateFrom?: string; dateTo?: string } }>('/api/transactions/flows', async (req) => {
    const dateFrom = req.query.dateFrom
    const dateTo = req.query.dateTo
    if (!dateFrom || !dateTo || !isValidDayKey(dateFrom) || !isValidDayKey(dateTo)) {
      throw new HttpError(400, 'dateFrom and dateTo (YYYY-MM-DD) are required')
    }
    return { flows: flowTotals(dateFrom, dateTo) }
  })

  app.post<{ Body: TransactionInput }>('/api/transactions', async (req) => {
    return { transaction: createTransaction(req.body) }
  })

  app.post<{ Body: { roomId: string | number; date: string; comment?: string } }>(
    '/api/transactions/writeoff-discrepancy',
    async (req) => {
      const { date, comment } = req.body
      const roomId = typeof req.body.roomId === 'number' ? req.body.roomId : parseId(req.body.roomId)
      if (!date || !isValidDayKey(date)) throw new HttpError(400, 'date: must be a valid YYYY-MM-DD day')
      return { reconcile: writeoffDiscrepancy(roomId, date, comment ?? '') }
    }
  )

  app.put<{ Params: { id: string }; Body: TransactionInput }>('/api/transactions/:id', async (req) => {
    const id = parseId(req.params.id)
    return { transaction: updateTransaction(id, req.body) }
  })

  app.delete<{ Params: { id: string } }>('/api/transactions/:id', async (req) => {
    deleteTransaction(parseId(req.params.id))
    return { ok: true }
  })
}