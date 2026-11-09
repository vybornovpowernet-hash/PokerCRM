import { describe, expect, it } from 'vitest'
import {
  DB_CLOSED_MESSAGE,
  DB_TEST_PROCESS_MESSAGE,
  closeDb,
  decideDbOpen,
  getDb,
  initDb,
  resetDbForTests,
  setDbForTests,
  shouldWarnJournalMode
} from '../src/db.js'

describe('решение getDb по состояниям (чистая функция, база не открывается)', () => {
  it('живой инстанс имеет приоритет над всеми остальными признаками', () => {
    expect(decideDbOpen({ hasInstance: true, closed: false, testProcess: false })).toBe('instance')
    expect(decideDbOpen({ hasInstance: true, closed: true, testProcess: false })).toBe('instance')
    expect(decideDbOpen({ hasInstance: true, closed: true, testProcess: true })).toBe('instance')
  })

  it('закрытая база важнее тестового процесса', () => {
    expect(decideDbOpen({ hasInstance: false, closed: true, testProcess: true })).toBe('refuse-closed')
    expect(decideDbOpen({ hasInstance: false, closed: true, testProcess: false })).toBe('refuse-closed')
  })

  it('тестовый процесс без инстанса и без закрытия отказывается открывать боевую базу', () => {
    expect(decideDbOpen({ hasInstance: false, closed: false, testProcess: true })).toBe('refuse-test')
  })

  it('обычный запуск открывает файл', () => {
    expect(decideDbOpen({ hasInstance: false, closed: false, testProcess: false })).toBe('open-live')
  })

  it('тексты отказов русские и называют причину', () => {
    expect(DB_CLOSED_MESSAGE).toMatch(/База данных закрыта/)
    expect(DB_CLOSED_MESSAGE).toMatch(/getDb/)
    expect(DB_TEST_PROCESS_MESSAGE).toMatch(/Тестовый процесс/)
    expect(DB_TEST_PROCESS_MESSAGE).toMatch(/setDbForTests/)
  })
})

describe('предикат предупреждения о журнале (чистая функция)', () => {
  it('файловая база в wal не предупреждает', () => {
    expect(shouldWarnJournalMode('/data/poker-crm.sqlite', 'wal')).toBe(false)
  })

  it('файловая база не-wal предупреждает', () => {
    expect(shouldWarnJournalMode('/data/poker-crm.sqlite', 'delete')).toBe(true)
    expect(shouldWarnJournalMode('/data/poker-crm.sqlite', 'truncate')).toBe(true)
    expect(shouldWarnJournalMode('/data/poker-crm.sqlite', 'memory')).toBe(true)
    expect(shouldWarnJournalMode('/data/poker-crm.sqlite', '')).toBe(true)
  })

  it(':memory: никогда не предупреждает', () => {
    expect(shouldWarnJournalMode(':memory:', 'memory')).toBe(false)
    expect(shouldWarnJournalMode(':memory:', 'wal')).toBe(false)
    expect(shouldWarnJournalMode(':memory:', 'delete')).toBe(false)
  })
})

describe('закрытый режим getDb (интеграционно на :memory:)', () => {
  it('после closeDb getDb бросает сообщение про закрытую базу', () => {
    const db = initDb(':memory:')
    setDbForTests(db)
    expect(getDb()).toBe(db)

    closeDb()
    expect(() => getDb()).toThrow(DB_CLOSED_MESSAGE)
    expect(() => getDb()).not.toThrow(DB_TEST_PROCESS_MESSAGE)
  })

  it('повторная подстановка возвращает работоспособность', () => {
    closeDb()
    const next = initDb(':memory:')
    setDbForTests(next)
    expect(getDb()).toBe(next)
    getDb().prepare("INSERT INTO rooms (name) VALUES ('после повторной подстановки')").run()
    expect((getDb().prepare('SELECT COUNT(*) c FROM rooms').get() as { c: number }).c).toBe(1)
    closeDb()
  })

  it('после resetDbForTests в тестовом процессе — отказ открыть боевую базу, а не «закрыта»', () => {
    resetDbForTests()
    expect(() => getDb()).toThrow(DB_TEST_PROCESS_MESSAGE)
    expect(() => getDb()).not.toThrow(DB_CLOSED_MESSAGE)
  })
})
