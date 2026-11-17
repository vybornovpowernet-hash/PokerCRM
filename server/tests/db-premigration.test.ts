import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, mkdtempSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initDb, runMigrations } from '../src/db.js'

/** Строгий шаблон имени снимка: время, версия из четырёх цифр, необязательный счётчик. */
const SNAPSHOT_RE = /^premigration-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-v\d{4}(?:-\d+)?\.sqlite$/

/** Время из имени снимка (мс), чтобы порядок удаления не зависел от сортировки строк. */
function snapshotTime(name: string): number {
  const match = name.match(/^premigration-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/)
  if (!match) return 0
  const [y, mo, da, h, mi, s, ms] = match.slice(1).map(Number) as number[]
  return Date.UTC(y as number, (mo as number) - 1, da as number, h as number, mi as number, s as number, ms as number)
}

const MARKER = 'Снимок-до-миграции'

let dir: string

function workDir(): string {
  const created = mkdtempSync(join(tmpdir(), 'poker-crm-premigration-'))
  return created
}

function removeDir(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}

/** Версия последней миграции: свежая файловая база в отдельной временной папке. */
function latestVersion(): number {
  const probe = workDir()
  try {
    const db = initDb(join(probe, 'probe.sqlite'))
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    db.close()
    return version
  } finally {
    removeDir(probe)
  }
}

/**
 * Откат на одну миграцию назад = схема v33. С v34 «последняя миграция» больше не
 * добавляет столбец (она пересобирает таблицу ради CHECK типа), поэтому
 * DROP COLUMN больше не подходит: восстанавливаем `transactions` определением v33
 * и понижает user_version. Без отката схемы понижение версии упало бы
 * duplicate column name при повторном прогоне миграций.
 */
function downgradeToPreviousVersion(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE transactions_v33 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('deposit', 'withdraw', 'transfer', 'casino')),
      amount INTEGER NOT NULL CHECK ((type = 'casino' AND amount <> 0) OR (type <> 'casino' AND amount > 0)),
      fee INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
      currency TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
      counterpart TEXT,
      destination_room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
      date TEXT NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      writeoff INTEGER NOT NULL DEFAULT 0,
      writeoff_reason TEXT,
      dest_amount INTEGER,
      CHECK (type <> 'casino' OR fee = 0)
    );
    INSERT INTO transactions_v33 (id, room_id, type, amount, fee, currency, direction, counterpart, destination_room_id, date, comment, created_at, writeoff, writeoff_reason, dest_amount)
      SELECT id, room_id, type, amount, fee, currency, direction, counterpart, destination_room_id, date, comment, created_at, writeoff, writeoff_reason, dest_amount FROM transactions;
    DROP TABLE transactions;
    ALTER TABLE transactions_v33 RENAME TO transactions;
    CREATE INDEX idx_transactions_room_date ON transactions(room_id, date);
    CREATE INDEX idx_transactions_destination ON transactions(destination_room_id);
  `)
}

/**
 * База «как у друга до обновления»: полностью мигрирована, затем откатана на одну
 * миграцию назад (`downgradeToPreviousVersion`) и понижена на версию.
 */
function oldDbWithMarker(path: string, version: number): void {
  const db = initDb(path)
  try {
    downgradeToPreviousVersion(db)
    db.exec(`PRAGMA user_version = ${version - 1}`)
    // цикл «старая база → снимок → миграция» повторяется несколько раз над одним
    // файлом, поэтому маркер сначала убирается: имя в rooms уникальное
    db.prepare('DELETE FROM rooms WHERE name = ?').run(MARKER)
    db.prepare('INSERT INTO rooms (name, cash_currency, tournament_currency) VALUES (?, ?, ?)').run(MARKER, 'USD', 'USD')
  } finally {
    db.close()
  }
}

function snapshotDir(dbPath: string): string {
  return join(dirname(dbPath), 'premigration')
}

function snapshotFiles(dbPath: string): string[] {
  const dirPath = snapshotDir(dbPath)
  if (!existsSync(dirPath)) return []
  return readdirSync(dirPath).sort()
}

function readVersion(path: string): number {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  } finally {
    db.close()
  }
}

function columnsOf(path: string, table: string): string[] {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().map((r) => (r as { name: string }).name)
  } finally {
    db.close()
  }
}

/**
 * Отличает схему v34 от v33: CHECK типа разрешает строку 'bonus' или нет. v34
 * не добавляет колонок, поэтому список столбцов о ней не скажет ничего —
 * смотреть надо текст ограничения.
 */
function typeCheckAllowsBonus(path: string): boolean {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'transactions'").get() as { sql: string }
    return row.sql.includes("'bonus'")
  } finally {
    db.close()
  }
}

function markerRows(path: string): number {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return (db.prepare('SELECT COUNT(*) c FROM rooms WHERE name = ?').get(MARKER) as { c: number }).c
  } finally {
    db.close()
  }
}

const LATEST = latestVersion()

describe('premigration snapshot', () => {
  beforeEach(() => {
    dir = workDir()
  })
  afterEach(() => {
    removeDir(dir)
  })

  it('writes exactly one strict-named snapshot before applying pending migrations', () => {
    const dbPath = join(dir, 'friend.sqlite')
    oldDbWithMarker(dbPath, LATEST)

    const db = initDb(dbPath)
    try {
      expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(LATEST)
      expect(db.prepare('PRAGMA table_info(transactions)').all().map((r) => (r as { name: string }).name)).toContain('dest_amount')
    } finally {
      db.close()
    }

    const files = snapshotFiles(dbPath)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(SNAPSHOT_RE)

    const snapshot = join(snapshotDir(dbPath), files[0])
    expect(markerRows(snapshot)).toBe(1)
    expect(readVersion(snapshot)).toBe(LATEST - 1)
    // снимок снят ДО v34: его CHECK типа про бонус ничего не знает
    expect(typeCheckAllowsBonus(snapshot)).toBe(false)
    expect(typeCheckAllowsBonus(dbPath)).toBe(true)
    expect(statSync(snapshot).size).toBeGreaterThan(0)
    expect(readVersion(dbPath)).toBe(LATEST)
  })

  it('creates no snapshot for a brand-new database', () => {
    const dbPath = join(dir, 'new.sqlite')
    const db = initDb(dbPath)
    db.close()
    expect(existsSync(snapshotDir(dbPath))).toBe(false)
  })

  it('creates no snapshot and no directory for an in-memory database', () => {
    const before = readdirSync(process.cwd()).filter((n) => n === 'premigration')
    const db = initDb(':memory:')
    downgradeToPreviousVersion(db)
    db.exec(`PRAGMA user_version = ${LATEST - 1}`)
    runMigrations(db)
    db.close()
    const after = readdirSync(process.cwd()).filter((n) => n === 'premigration')
    expect(after).toEqual(before)
  })

  it('creates no snapshot when nothing is pending', () => {
    const dbPath = join(dir, 'uptodate.sqlite')
    const first = initDb(dbPath)
    first.close()
    const db = initDb(dbPath)
    db.close()
    expect(existsSync(snapshotDir(dbPath))).toBe(false)
    expect(readVersion(dbPath)).toBe(LATEST)
  })

  it('keeps only the three newest snapshots', () => {
    const dbPath = join(dir, 'retention.sqlite')
    const seen: string[] = []
    for (let i = 0; i < 5; i++) {
      oldDbWithMarker(dbPath, LATEST)
      const db = initDb(dbPath)
      db.close()
      const files = snapshotFiles(dbPath)
      expect(files.length).toBeLessThanOrEqual(3)
      for (const name of files) if (!seen.includes(name)) seen.push(name)
    }
    const left = snapshotFiles(dbPath)
    expect(left).toHaveLength(3)
    // удаляются именно самые старые — порядок задаёт время в имени снимка
    const byTime = [...seen].sort((a, b) => snapshotTime(a) - snapshotTime(b))
    const expected = byTime.slice(-3).sort()
    expect([...left].sort()).toEqual(expected)
    for (const name of byTime.slice(0, Math.max(0, byTime.length - 3))) {
      expect(left).not.toContain(name)
    }
  })

  it('prunes only its own regular files and never touches foreign entries', () => {
    const dbPath = join(dir, 'foreign.sqlite')
    mkdirSync(snapshotDir(dbPath), { recursive: true })
    const foreign = ['poker-crm-x.zip', 'notes.txt', 'premigration-v0001-x.sqlite', 'premigration.sqlite']
    for (const name of foreign) writeFileSync(join(snapshotDir(dbPath), name), 'keep me')
    // каталог с именем, подходящим под шаблон, удалён быть не должен
    const fakeDirName = 'premigration-2020-01-01T00-00-00-000Z-v0001.sqlite'
    mkdirSync(join(snapshotDir(dbPath), fakeDirName), { recursive: true })
    writeFileSync(join(snapshotDir(dbPath), fakeDirName, 'inside.txt'), 'keep')

    for (let i = 0; i < 4; i++) {
      oldDbWithMarker(dbPath, LATEST)
      const db = initDb(dbPath)
      db.close()
    }

    const entries = readdirSync(snapshotDir(dbPath))
    for (const name of [...foreign, fakeDirName]) {
      expect(entries, name).toContain(name)
    }
    expect(statSync(join(snapshotDir(dbPath), fakeDirName)).isDirectory()).toBe(true)
    expect(existsSync(join(snapshotDir(dbPath), fakeDirName, 'inside.txt'))).toBe(true)
    // каталог с именем по шаблону удалён не был, поэтому считаем только файлы
    const snapshots = entries.filter((n) => SNAPSHOT_RE.test(n) && statSync(join(snapshotDir(dbPath), n)).isFile())
    expect(snapshots).toHaveLength(3)
  })

  it('stops before migrations when the snapshot cannot be written', () => {
    const dbPath = join(dir, 'blocked.sqlite')
    oldDbWithMarker(dbPath, LATEST)
    // каталог снимков заменён обычным файлом: mkdirSync даёт ENOTDIR
    writeFileSync(snapshotDir(dbPath), 'not a directory')

    let error: unknown
    try {
      initDb(dbPath)
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toMatch(/снимок/i)
    expect(message).toMatch(/npm run backup/)
    expect(message).toContain(dbPath)

    // база не тронута: версия та же, CHECK типа ещё про бонус ничего не знает,
    // маркер на месте
    expect(readVersion(dbPath)).toBe(LATEST - 1)
    expect(typeCheckAllowsBonus(dbPath)).toBe(false)
    expect(columnsOf(dbPath, 'transactions')).toContain('dest_amount')
    expect(markerRows(dbPath)).toBe(1)
    // соединение закрыто: временную папку можно удалить без ошибки
    expect(() => removeDir(dir)).not.toThrow()
  })

  it('refuses a database created by a newer program', () => {
    const dbPath = join(dir, 'future.sqlite')
    const db = initDb(dbPath)
    db.exec('PRAGMA user_version = 999')
    db.close()

    expect(() => initDb(dbPath)).toThrow(/более новой версией программы/)
    expect(readVersion(dbPath)).toBe(999)
    expect(existsSync(snapshotDir(dbPath))).toBe(false)

    const handle = new DatabaseSync(dbPath)
    try {
      expect(() => runMigrations(handle)).toThrow(/более новой версией программы/)
    } finally {
      handle.close()
    }
    expect(readVersion(dbPath)).toBe(999)
  })
})
