import { afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { projectRoot } from '../src/db.js'

// Каждый тестовый файл получает собственный песочничный корень загрузок внутри
// системного temp. Порядок важен: файл выполняется до импорта services/uploads.js,
// поэтому переменная окружения уже стоит, когда тот вычисляет UPLOADS_ROOT.
const prefix = join(tmpdir(), 'poker-crm-uploads-')
const sandbox = mkdtempSync(prefix)
process.env.VITEST = 'true'
process.env.POKER_CRM_UPLOADS_ROOT = sandbox

const liveRoot = resolve(join(projectRoot, 'data', 'uploads'))

afterAll(() => {
  const target = resolve(sandbox)
  // Удаляем строго свой песочник: путь обязан начинаться с нашего префикса в temp
  // и никогда не совпадать с боевым каталогом. Утечка в temp безвредна, удаление
  // чужих файлов — нет.
  if (target === liveRoot) return
  if (!target.startsWith(prefix)) return
  rmSync(target, { recursive: true, force: true })
})
