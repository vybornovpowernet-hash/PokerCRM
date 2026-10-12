import type { FastifyInstance } from 'fastify'
import { REPOSITORY, checkForUpdates, getAppVersion } from '../services/system.js'

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/system/version', async () => ({ version: getAppVersion(), repository: REPOSITORY }))

  app.get('/api/system/check-updates', async () => checkForUpdates())
}
