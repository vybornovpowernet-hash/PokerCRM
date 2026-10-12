import type { FastifyInstance } from 'fastify'
import { parseId } from '../lib/http.js'
import { archiveHabit, createHabit, listHabitHistory, listHabits, reorderHabits, restoreHabit, setHabitLog, updateHabit } from '../services/habits/service.js'

export async function habitsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { month?: string } }>('/api/habits', async (req) => {
    return { habits: listHabits(req.query?.month) }
  })

  app.get('/api/habits/history', async () => {
    return { habits: listHabitHistory() }
  })

  app.post<{ Body: { name?: unknown; color?: unknown } }>('/api/habits', async (req) => {
    return { habit: createHabit(req.body?.name, req.body?.color) }
  })

  app.put<{ Body: { ids?: unknown } }>('/api/habits/order', async (req) => {
    return { habits: reorderHabits(req.body?.ids) }
  })

  app.put<{ Params: { id: string }; Body: { name?: unknown; color?: unknown } }>('/api/habits/:id', async (req) => {
    return { habit: updateHabit(parseId(req.params.id), { name: req.body?.name, color: req.body?.color }) }
  })

  app.put<{ Params: { id: string }; Body: { date?: unknown; status?: unknown } }>('/api/habits/:id/log', async (req) => {
    return { log: setHabitLog(parseId(req.params.id), req.body?.date, req.body?.status) }
  })

  app.post<{ Params: { id: string } }>('/api/habits/:id/restore', async (req) => {
    return { habit: restoreHabit(parseId(req.params.id)) }
  })

  app.delete<{ Params: { id: string } }>('/api/habits/:id', async (req) => {
    archiveHabit(parseId(req.params.id))
    return { ok: true }
  })
}
