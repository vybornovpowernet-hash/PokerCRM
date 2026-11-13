import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { initDb, resetDbForTests, setDbForTests } from '../src/db.js'
import { createApp, formatMegabytes } from '../src/app.js'

const png = Buffer.from('89504e470d0a1a0a0000000d', 'hex')

/** Part multipart/form-data с указанным содержимым. */
function filePart(name: string, filename: string, data: Buffer): string {
  return (
    `--edge\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\n` +
    `Content-Type: image/png\r\n\r\n${data.toString('binary')}\r\n`
  )
}

let root: string
let uploadsRoot: string
let clientRoot: string
let app: FastifyInstance

async function buildApp(overrides: Partial<Parameters<typeof createApp>[0]> = {}) {
  app = await createApp({
    logger: false,
    serveClient: true,
    bodyLimitBytes: 64,
    maxUploadFileBytes: 1024,
    staticRoots: { uploads: uploadsRoot, client: clientRoot },
    ...overrides
  })
  // служебный маршрут: бросает узнаваемую внутреннюю ошибку, которую нельзя показать наружу
  app.get('/_probe/boom', async () => {
    throw new Error('ЗЕЛЁНЫЙ-СЛЕД-ВНУТРЕННЕГО-СООБЩЕНИЯ')
  })
  await app.ready()
  return app
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'poker-crm-app-hardening-'))
  uploadsRoot = join(root, 'uploads')
  clientRoot = join(root, 'client')
  mkdirSync(join(uploadsRoot, 'diary'), { recursive: true })
  mkdirSync(join(clientRoot, 'assets'), { recursive: true })
  writeFileSync(join(uploadsRoot, 'diary', 'real.png'), png)
  writeFileSync(join(uploadsRoot, 'diary', '.hidden.png'), png)
  writeFileSync(join(uploadsRoot, '.env'), 'секрет корня загрузок')
  writeFileSync(join(clientRoot, 'index.html'), '<!doctype html><title>Poker CRM</title>')
  writeFileSync(join(clientRoot, 'assets', 'x.js'), 'console.log(1)')
  // файл ВНЕ обоих корней: если обход пути возможен, он утечёт именно он
  writeFileSync(join(root, 'outside-secret.txt'), 'СЕКРЕТ ВНЕ КОРНЯ СТАТИКИ')
})

afterEach(async () => {
  await app?.close()
  resetDbForTests()
  rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

beforeEach(() => {
  setDbForTests(initDb(':memory:'))
})

describe('А. ошибки Fastify по-русски, форма тела ответов прежняя', () => {
  it('некорректный JSON: 400 и русскоязычный error', async () => {
    await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/api/settings', headers: { 'content-type': 'application/json' }, payload: '{"dayStartHour":' })
    expect(res.statusCode).toBe(400)
    const body = res.json() as { error: string }
    expect(Object.keys(body)).toEqual(['error'])
    expect(body.error).toMatch(/[а-яё]/i)
    expect(body.error).not.toMatch(/content-type is set|Body is not valid/i)
  })

  it('пустое тело при application/json: 400 по-русски', async () => {
    await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/api/settings', headers: { 'content-type': 'application/json' }, payload: '' })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: string }).error).toMatch(/[а-яё]/i)
  })

  it('слишком большое тело: 413, текст взят из настройки лимита', async () => {
    await buildApp({ bodyLimitBytes: 64 })
    const res = await app.inject({ method: 'PUT', url: '/api/settings', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ dayStartHour: 5, pad: 'x'.repeat(4096) }) })
    expect(res.statusCode).toBe(413)
    const error = (res.json() as { error: string }).error
    expect(error).toMatch(/[а-яё]/i)
    // лимит 64 байта = 0 МБ: в тексте обязано быть число из настройки, а не захардкоженные 20
    expect(error).toContain(formatMegabytes(64))
    expect(error).not.toMatch(/body too large|Request body/i)
  })

  it('неподдерживаемый тип содержимого: 415 по-русски', async () => {
    await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: 'dayStartHour=5' })
    expect(res.statusCode).toBe(415)
    const error = (res.json() as { error: string }).error
    expect(error).toMatch(/[а-яё]/i)
    expect(error).not.toMatch(/Unsupported Media Type/)
  })

  it('второй файл при лимите в один файл: 400 по-русски, а не 500', async () => {
    await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/goals/images',
      headers: { 'content-type': 'multipart/form-data; boundary=edge' },
      payload: Buffer.from(filePart('file', 'a.png', png) + filePart('file2', 'b.png', png) + '--edge--\r\n', 'binary')
    })
    expect(res.statusCode).toBe(400)
    const error = (res.json() as { error: string }).error
    expect(error).toMatch(/[а-яё]/i)
    expect(error).not.toMatch(/Internal server error/)
  })

  it('файл больше лимита: 413 по-русски', async () => {
    await buildApp({ maxUploadFileBytes: 1024 })
    const big = Buffer.concat([png, Buffer.alloc(4096, 1)])
    const res = await app.inject({
      method: 'POST',
      url: '/api/goals/images',
      headers: { 'content-type': 'multipart/form-data; boundary=edge' },
      payload: Buffer.from(filePart('file', 'big.png', big) + '--edge--\r\n', 'binary')
    })
    expect(res.statusCode).toBe(413)
    expect((res.json() as { error: string }).error).toMatch(/[а-яё]/i)
  })

  it('500 остаётся без внутренних деталей', async () => {
    await buildApp()
    const res = await app.inject({ method: 'GET', url: '/_probe/boom' })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: 'Internal server error' })
    expect(res.body).not.toContain('ЗЕЛЁНЫЙ-СЛЕД')
  })

  it('русские тексты валидации самих маршрутов не изменились', async () => {
    await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: { dayStartHour: 99 } })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: string }).error).toBe('dayStartHour должен быть целым числом от 0 до 12')
  })
})

describe('Б. статика', () => {
  it('несуществующий путь в /uploads/ — 404 JSON, а не HTML сборки', async () => {
    await buildApp()
    const res = await app.inject({ method: 'GET', url: '/uploads/diary/nope.png' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'Not found' })
    expect(res.headers['content-type']).toContain('application/json')
  })

  it('точечные файлы не отдаются', async () => {
    await buildApp()
    const hidden = await app.inject({ method: 'GET', url: '/uploads/diary/.hidden.png' })
    expect(hidden.statusCode).toBe(404)
    expect(hidden.body).not.toContain('PNG')
    const env = await app.inject({ method: 'GET', url: '/uploads/.env' })
    expect(env.statusCode).toBe(404)
    expect(env.body).not.toContain('секрет корня')
  })

  it('обычный файл из /uploads/ отдаётся', async () => {
    await buildApp()
    const res = await app.inject({ method: 'GET', url: '/uploads/diary/real.png' })
    expect(res.statusCode).toBe(200)
    expect(res.rawPayload.subarray(0, 4).toString('hex')).toBe('89504e47')
  })

  it('index.html не кэшируется «в вечность»', async () => {
    await buildApp()
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('no-cache')
    const again = await app.inject({ method: 'GET', url: '/', headers: { 'if-none-match': String(res.headers['etag']) } })
    expect(again.statusCode).toBe(304)
  })

  it('файлы из /assets/ кэшируются как immutable', async () => {
    await buildApp()
    const res = await app.inject({ method: 'GET', url: '/assets/x.js' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
  })

  it('обход пути не отдаёт файл вне корня', async () => {
    await buildApp()
    for (const url of ['/uploads/../outside-secret.txt', '/uploads/%2e%2e/outside-secret.txt', '/uploads/..%2foutside-secret.txt', '/uploads/diary/../../outside-secret.txt']) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.body, url).not.toContain('СЕКРЕТ ВНЕ КОРНЯ СТАТИКИ')
    }
  })

  it('HEAD и Range продолжают работать, SPA-fallback тоже', async () => {
    await buildApp()
    const head = await app.inject({ method: 'HEAD', url: '/uploads/diary/real.png' })
    expect(head.statusCode).toBe(200)
    expect(head.headers['content-length']).toBeDefined()
    const ranged = await app.inject({ method: 'GET', url: '/assets/x.js', headers: { range: 'bytes=0-3' } })
    expect(ranged.statusCode).toBe(206)
    expect(ranged.headers['content-range']).toBe('bytes 0-3/14')
    const spa = await app.inject({ method: 'GET', url: '/some/spa/route' })
    expect(spa.statusCode).toBe(200)
    expect(spa.body).toContain('Poker CRM')
  })
})

describe('В. заголовки', () => {
  it('nosniff, X-Frame-Options и Referrer-Policy на api, статике и 404', async () => {
    await buildApp()
    for (const url of ['/api/health', '/uploads/diary/real.png', '/api/nope', '/_probe/boom']) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.headers['x-content-type-options'], url).toBe('nosniff')
      expect(res.headers['x-frame-options'], url).toBe('DENY')
      expect(res.headers['referrer-policy'], url).toBe('no-referrer')
    }
  })
})

describe('Г. боевой запуск без сборки клиента', () => {
  it('одно предупреждение по-русски с путём, сервер при этом жив', async () => {
    const emptyClient = join(root, 'empty-client')
    mkdirSync(emptyClient, { recursive: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    app = await createApp({ logger: false, serveClient: true, staticRoots: { uploads: uploadsRoot, client: emptyClient } })
    await app.ready()
    const messages = warn.mock.calls.map((c) => c.join(' '))
    expect(messages.length).toBe(1)
    expect(messages[0]).toMatch(/[а-яё]/i)
    expect(messages[0]).toContain(emptyClient)
    const health = await app.inject({ method: 'GET', url: '/api/health' })
    expect(health.statusCode).toBe(200)
    const root404 = await app.inject({ method: 'GET', url: '/' })
    expect(root404.statusCode).toBe(404)
  })
})

describe('прежнее поведение не сломано', () => {
  it('health, 404 неизвестного api-маршрута и обычные ответы маршрутов', async () => {
    await buildApp()
    const health = await app.inject({ method: 'GET', url: '/api/health' })
    expect(health.statusCode).toBe(200)
    expect(health.json()).toEqual({ ok: true, uptime: expect.any(Number) })
    const unknown = await app.inject({ method: 'GET', url: '/api/nope' })
    expect(unknown.statusCode).toBe(404)
    expect(unknown.json()).toEqual({ error: 'Not found' })
    const settings = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(settings.statusCode).toBe(200)
    expect(settings.json()).toEqual({ settings: { dayStartHour: 0 } })
  })

  it('POST с русским текстом ошибки из маршрута работает как раньше', async () => {
    await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/rooms', headers: { 'content-type': 'application/json' }, payload: { name: '', cashCurrency: 'USD', tournamentCurrency: 'USD' } })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: string }).error).toContain('name')
  })

  it('в дев-режиме (без сборки клиента) 404 сохраняет ту же форму тела', async () => {
    app = await createApp({ logger: false, serveClient: false, staticRoots: { uploads: uploadsRoot, client: clientRoot } })
    await app.ready()
    for (const url of ['/uploads/diary/nope.png', '/api/nope', '/some/route']) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.statusCode, url).toBe(404)
      expect(res.json(), url).toEqual({ error: 'Not found' })
    }
  })
})
