import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HttpError } from './lib/errors.js'
import { roomsRoutes } from './routes/rooms.js'
import { ratesRoutes } from './routes/rates.js'
import { transactionsRoutes } from './routes/transactions.js'
import { balancesRoutes } from './routes/balances.js'
import { sessionsRoutes } from './routes/sessions.js'
import { tournamentsRoutes } from './routes/tournaments.js'
import { statisticsRoutes } from './routes/statistics.js'
import { goalsRoutes } from './routes/goals.js'
import { habitsRoutes } from './routes/habits.js'
import { settingsRoutes } from './routes/settings.js'
import { UPLOADS_ROOT, ensureUploadDirs } from './services/uploads.js'

export interface CreateAppOptions {
  logger?: boolean
  serveClient?: boolean
}

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 20 * 1024 * 1024 })

  await app.register(cors, { origin: true })

  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: 20 * 1024 * 1024,
      fields: 5,
      fieldSize: 128
    }
  })

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      void reply.status(err.status).send({ error: err.message })
      return
    }
    const status = typeof (err as { statusCode?: unknown }).statusCode === 'number' ? (err as { statusCode: number }).statusCode : 500
    if (status >= 400 && status < 500) {
      const message = (err as { message?: string }).message ?? 'Bad request'
      void reply.status(status).send({ error: message })
      return
    }
    app.log.error(err)
    void reply.status(500).send({ error: 'Internal server error' })
  })

  await app.register(roomsRoutes)
  await app.register(ratesRoutes)
  await app.register(transactionsRoutes)
  await app.register(balancesRoutes)
  await app.register(sessionsRoutes)
  await app.register(tournamentsRoutes)
  await app.register(statisticsRoutes)
  await app.register(goalsRoutes)
  await app.register(habitsRoutes)
  await app.register(settingsRoutes)

  app.get('/api/health', async () => ({ ok: true, uptime: process.uptime() }))

  // Diary photos live on disk under `data/uploads` and are served read-only at
  // `/uploads/*`. `decorateReply: false` keeps `reply.sendFile` free for the
  // client bundle below (only one @fastify/static registration may decorate).
  ensureUploadDirs()
  await app.register(fastifyStatic, { root: UPLOADS_ROOT, prefix: '/uploads/', decorateReply: false })

  const serveClient = options.serveClient ?? process.env.NODE_ENV === 'production'
  if (serveClient) {
    const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url))
    if (fs.existsSync(path.join(clientDist, 'index.html'))) {
      await app.register(fastifyStatic, { root: clientDist })
      app.setNotFoundHandler((req, reply) => {
        if ((req.method === 'GET' || req.method === 'HEAD') && !req.url.startsWith('/api')) {
          return reply.sendFile('index.html')
        }
        return reply.status(404).send({ error: 'Not found' })
      })
    }
  }

  return app
}