import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // setupFiles исполняется перед каждым тестовым файлом, то есть до импорта
    // services/uploads.js, который читает POKER_CRM_UPLOADS_ROOT в момент
    // инициализации модуля.
    setupFiles: ['./tests/setup.ts']
  }
})
