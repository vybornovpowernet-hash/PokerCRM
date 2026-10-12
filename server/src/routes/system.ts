import type { FastifyInstance } from 'fastify'
import { REPOSITORY, checkForUpdates, getAppVersion, runInPlaceUpdate } from '../services/system.js'

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/system/version', async () => ({ version: getAppVersion(), repository: REPOSITORY }))

  app.get('/api/system/check-updates', async () => checkForUpdates())

  // Downloads the latest `main`, stages it and launches the updater script that
  // kills this process by PID, overwrites the app files and relaunches. The
  // response is flushed first; then the process exits so the script can replace
  // the locked files (Windows). Skipped under vitest so tests never kill the runner.
  app.post('/api/system/update', async (_req, reply) => {
    const result = await runInPlaceUpdate(process.pid)
    if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
      reply.raw.once('finish', () => {
        setTimeout(() => process.exit(0), 300)
      })
    }
    return { ok: true, files: result.files, message: 'Обновление загружено. Приложение перезапустится автоматически.' }
  })
}
