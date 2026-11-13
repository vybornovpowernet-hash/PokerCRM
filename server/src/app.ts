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
import { systemRoutes } from './routes/system.js'
import { UPLOADS_ROOT, ensureUploadDirs } from './services/uploads.js'

/** Лимиты по умолчанию: тело JSON-запроса и один файл в multipart. */
export const DEFAULT_BODY_LIMIT_BYTES = 20 * 1024 * 1024
export const DEFAULT_UPLOAD_FILE_LIMIT_BYTES = 20 * 1024 * 1024

export interface CreateAppOptions {
  logger?: boolean
  serveClient?: boolean
  /** Лимит тела запроса; сообщение о превышении берётся отсюда, а не захардкожено. */
  bodyLimitBytes?: number
  /** Лимит одного загружаемого файла (ZIP отчётов, фото дневника). */
  maxUploadFileBytes?: number
  /** Корни статики. Нужны тестам, чтобы не трогать боевые `client/dist` и `data/uploads`. */
  staticRoots?: { uploads?: string; client?: string }
}

/** Человекочитаемый размер для текстов ошибок: байты до мегабайта — в байтах. */
export function formatMegabytes(bytes: number): string {
  const mb = 1024 * 1024
  if (bytes < mb) return `${bytes} байт`
  const value = bytes / mb
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return `${rounded} МБ`
}

/**
 * Русские тексты штатных ошибок Fastify и `@fastify/multipart`. Коды сняты
 * экспериментом на `inject` (`onError`-хук), а не по догадке:
 * FST_ERR_CTP_INVALID_JSON_BODY, FST_ERR_CTP_EMPTY_JSON_BODY, FST_ERR_CTP_BODY_TOO_LARGE,
 * FST_ERR_CTP_INVALID_MEDIA_TYPE, FST_REQ_FILE_TOO_LARGE, FST_FILES_LIMIT,
 * ERR_STREAM_PREMATURE_CLOSE (именно его даёт лимит «один файл», когда поток обрывают).
 * `undefined` — значит «не подменяем», дальше работает общий обработчик.
 */
function russianFastifyErrorText(err: { code?: string }, limits: { bodyLimitBytes: number; maxUploadFileBytes: number }): string | undefined {
  switch (err.code) {
    case 'FST_ERR_CTP_INVALID_JSON_BODY':
      return 'Тело запроса не является корректным JSON.'
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
      return 'Ожидалось тело запроса в формате JSON.'
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return `Тело запроса больше разрешённого (${formatMegabytes(limits.bodyLimitBytes)}).`
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return 'Неподдерживаемый тип содержимого: нужен JSON.'
    case 'FST_REQ_FILE_TOO_LARGE':
      return `Файл больше разрешённого (${formatMegabytes(limits.maxUploadFileBytes)}).`
    case 'FST_FILES_LIMIT':
      return 'Слишком много файлов: за раз принимается один файл.'
    // busboy обрывает поток, как только превышает лимит файлов, или если клиент ушёл
    // посреди загрузки: это ошибка запроса (400), а не внутренний сбой (500)
    case 'ERR_STREAM_PREMATURE_CLOSE':
    case 'FST_MP_PREMATURE_CLOSE':
      return 'Загрузка файла не завершена: файлов больше одного либо соединение оборвалось.'
    default:
      return undefined
  }
}

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const bodyLimitBytes = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES
  const maxUploadFileBytes = options.maxUploadFileBytes ?? DEFAULT_UPLOAD_FILE_LIMIT_BYTES
  const uploadsRoot = options.staticRoots?.uploads ?? UPLOADS_ROOT
  const clientRoot = options.staticRoots?.client ?? fileURLToPath(new URL('../../client/dist/', import.meta.url))

  const app = Fastify({ logger: options.logger ?? false, bodyLimit: bodyLimitBytes })

  await app.register(cors, { origin: true })

  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: maxUploadFileBytes,
      fields: 5,
      fieldSize: 128
    }
  })

  // Единый набор заголовков на все ответы (API, статика, ошибки). CSP сознательно не
  // вводится: приложение локальное, а жёсткая политика сломала бы инлайновые стили сборки.
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'no-referrer')
    return payload
  })

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      void reply.status(err.status).send({ error: err.message })
      return
    }
    const errCode = (err as { code?: string }).code
    const russian = russianFastifyErrorText(err as { code?: string }, { bodyLimitBytes, maxUploadFileBytes })
    const status = typeof (err as { statusCode?: unknown }).statusCode === 'number' ? (err as { statusCode: number }).statusCode : 500
    if (russian !== undefined) {
      // 413 приходит от Fastify с готовым statusCode, 400 — от оборванного потока
      const code = errCode === 'ERR_STREAM_PREMATURE_CLOSE' || errCode === 'FST_MP_PREMATURE_CLOSE' || errCode === 'FST_FILES_LIMIT' ? 400 : status
      void reply.status(code).send({ error: russian })
      return
    }
    if (status >= 400 && status < 500) {
      const message = (err as { message?: string }).message ?? 'Bad request'
      void reply.status(status).send({ error: message })
      return
    }
    // 500: детали (текст, стек, пути) остаются в журнале, наружу — только общая фраза
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
  await app.register(systemRoutes)

  app.get('/api/health', async () => ({ ok: true, uptime: process.uptime() }))

  // Diary photos live on disk under `data/uploads` and are served read-only at
  // `/uploads/*`. `decorateReply: false` keeps `reply.sendFile` free for the
  // client bundle below (only one @fastify/static registration may decorate).
  // `dotfiles: 'ignore'` — служебные и скрытые файлы каталога наружу не отдаются.
  ensureUploadDirs()
  await app.register(fastifyStatic, { root: uploadsRoot, prefix: '/uploads/', decorateReply: false, dotfiles: 'ignore' })

  const serveClient = options.serveClient ?? process.env.NODE_ENV === 'production'
  const hasClientBundle = fs.existsSync(path.join(clientRoot, 'index.html'))
  if (serveClient && hasClientBundle) {
    // index.html обязан пере проверяться на каждой загрузке (иначе после обновления
    // пользователь получит старый бандл), а файлы из /assets/ содержат хэш имени и
    // могут жить в кэше год.
    await app.register(fastifyStatic, {
      root: clientRoot,
      setHeaders: (reply, filePath) => {
        if (filePath.endsWith(`${path.sep}index.html`)) {
          reply.header('Cache-Control', 'no-cache')
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          reply.header('Cache-Control', 'public, max-age=31536000, immutable')
        }
      }
    })
    app.setNotFoundHandler((req, reply) => {
      // /uploads/* не отдаётся сборке: отсутствующее фото обязано быть 404, а не HTML
      if ((req.method === 'GET' || req.method === 'HEAD') && !req.url.startsWith('/api') && !req.url.startsWith('/uploads')) {
        return reply.sendFile('index.html')
      }
      return reply.status(404).send({ error: 'Not found' })
    })
  } else {
    // Единая форма «не найдено» во всех режимах: без сборки клиента Fastify отвечал бы
    // своим профилем {message,error,statusCode}, и обработчик ошибок на клиенте показывал
    // бы «Not Found» вместо нашего «Not found».
    if (serveClient && !hasClientBundle) {
      console.warn(
        `[static] Боевой режим запускается без сборки клиента: в ${clientRoot} нет index.html. ` +
          `Сервер поднимется и будет отвечать на /api/*, но интерфейс по адресу ` +
          `http://127.0.0.1:${process.env.PORT ?? 3001}/ не откроется. Соберите клиент: npm run build.`
      )
    }
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'Not found' }))
  }

  return app
}
