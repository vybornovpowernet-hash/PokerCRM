import type { FastifyInstance } from 'fastify'
import { parseId } from '../lib/http.js'
import { HttpError } from '../lib/errors.js'
import { addUserEntry, acknowledgeGoal, closeGoal, createGoal, deleteUserEntry, listGoals, reorderGoals, setChecklist, updateUserEntry } from '../services/goals/service.js'
import { isSupportedImageMime, saveDiaryImage } from '../services/uploads.js'

export async function goalsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { metric?: string; startDate?: string; endDate?: string; includeFinishedDaily?: string; finishedOnly?: string } }>(
    '/api/goals',
    async (req) => ({ goals: listGoals(req.query ?? {}) }),
  )

  app.put<{ Body: { ids?: unknown } }>('/api/goals/order', async (req) => {
    return { goals: reorderGoals(req.body?.ids) }
  })

  app.post<{ Body: { metric?: unknown; targetUnits?: unknown; deadline?: unknown; title?: unknown; checklist?: unknown } }>('/api/goals', async (req) => {
    return {
      goal: createGoal({
        metric: req.body?.metric,
        targetUnits: req.body?.targetUnits,
        deadline: req.body?.deadline,
        title: req.body?.title,
        checklist: req.body?.checklist
      })
    }
  })

  app.put<{ Params: { id: string }; Body: { items?: unknown } }>('/api/goals/:id/checklist', async (req) => {
    return { goal: setChecklist(parseId(req.params.id), req.body?.items) }
  })

  app.post('/api/goals/images', async (req) => {
    const data = await req.file()
    if (!data) throw new HttpError(400, 'file: required')
    if (!isSupportedImageMime(data.mimetype)) throw new HttpError(400, 'file: unsupported image type')
    const buffer = await data.toBuffer()
    if (data.file.truncated) throw new HttpError(400, 'file: too large')
    return { path: saveDiaryImage(buffer, data.mimetype) }
  })

  app.post<{ Params: { id: string }; Body: { content?: unknown; images?: unknown } }>('/api/goals/:id/entry', async (req) => {
    return { entry: addUserEntry(parseId(req.params.id), req.body?.content, req.body?.images) }
  })

  app.put<{ Params: { id: string; entryId: string }; Body: { content?: unknown; images?: unknown } }>(
    '/api/goals/:id/entry/:entryId',
    async (req) => {
      return { entry: updateUserEntry(parseId(req.params.id), parseId(req.params.entryId), req.body?.content, req.body?.images) }
    }
  )

  app.delete<{ Params: { id: string; entryId: string } }>('/api/goals/:id/entry/:entryId', async (req) => {
    deleteUserEntry(parseId(req.params.id), parseId(req.params.entryId))
    return { ok: true }
  })

  app.post<{ Params: { id: string }; Body: { outcome?: unknown } }>('/api/goals/:id/close', async (req) => {
    return { goal: closeGoal(parseId(req.params.id), req.body?.outcome) }
  })

  app.post<{ Params: { id: string } }>('/api/goals/:id/acknowledge', async (req) => {
    return { goal: acknowledgeGoal(parseId(req.params.id)) }
  })
}