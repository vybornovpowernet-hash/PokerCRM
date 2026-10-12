import type { FastifyInstance } from 'fastify'
import { getSettings, setDayStartHour } from '../services/settings.js'

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => ({ settings: getSettings() }))

  app.put<{ Body: { dayStartHour?: unknown } }>('/api/settings', async (req) => {
    return { settings: { dayStartHour: setDayStartHour(req.body?.dayStartHour) } }
  })
}
