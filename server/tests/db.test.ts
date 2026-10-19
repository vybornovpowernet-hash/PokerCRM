import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initDb, runMigrations, setDbForTests, resetDbForTests, withTransaction } from '../src/db.js'

/**
 * v26 turns the `casino_writeoffs` marker table into ordinary casino
 * transactions, so every upgrade fixture has to carry the two tables it reads
 * and writes. Fixtures that already declare their own `transactions` (v15) or
 * `casino_writeoffs` (v26) keep them — hence IF NOT EXISTS.
 *
 * v29 rebuilds `transactions` with an FK to `rooms`, so fixtures that jump past
 * v1 also need the parent table; its shape matches the v11-era rooms schema.
 * v30 only ADDs a column to whatever `transactions` exists, so no fixture help
 * is needed for it.
 */
function legacyLedgerSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      cash_currency TEXT NOT NULL DEFAULT 'USD',
      tournament_currency TEXT NOT NULL DEFAULT 'USD',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      rate_source TEXT,
      color TEXT NOT NULL DEFAULT '#f1f5f9',
      is_wallet INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('deposit','withdraw','transfer','casino')),
      amount INTEGER NOT NULL,
      fee INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('in','out')),
      counterpart TEXT,
      destination_room_id INTEGER,
      comment TEXT,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS casino_writeoffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(room_id, date)
    );
  `)
}

/**
 * v27 adds `goal_entries.images`, but fixtures that jump straight into v21+
 * never ran v12 (which created `goal_entries`), so the table must exist before
 * the ALTER. Fixtures starting below v21 do not need it — their migration chain
 * rebuilds the table itself.
 */
function legacyGoalEntriesSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS goal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('system','user')),
      content TEXT NOT NULL,
      milestone INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(goal_id, milestone)
    );
  `)
}

/**
 * v28 rebuilds `habit_logs` to widen its status CHECK, so fixtures that jump
 * into v21+ (which never ran v20, the migration that created the table) need it
 * to exist first. Fixtures below v21 do not need it — v20 creates it for them.
 * `habits` is declared alongside because `habit_logs` has an FK to it, and some
 * early fixtures do not build `habits` at all.
 */
function legacyHabitLogsSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS habits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      archived_at TEXT
    );
    CREATE TABLE IF NOT EXISTS habit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      habit_id INTEGER NOT NULL REFERENCES habits(id),
      date TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('done','missed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(habit_id, date)
    );
  `)
}

describe('db', () => {
  it('runs migrations and creates all tables on an in-memory db', () => {
    const db = initDb(':memory:')

    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name)

    for (const t of ['rooms', 'exchange_rates', 'transactions', 'balance_entries', 'tournaments', 'notifications', 'rate_overrides', 'pending_imports', 'goals', 'goal_entries', 'settings', 'habits', 'habit_logs']) {
      expect(names).toContain(t)
    }
    // v26 turned casino write-offs into ordinary casino transactions
    expect(names).not.toContain('casino_writeoffs')

    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    expect(version).toBe(30)

    const roomCols = db
      .prepare('PRAGMA table_info(rooms)')
      .all()
      .map((r) => (r as { name: string }).name)
    expect(roomCols).toContain('rate_source')
    expect(roomCols).toContain('color')
    expect(roomCols).toContain('is_wallet')

    const balanceCols = db
      .prepare('PRAGMA table_info(balance_entries)')
      .all()
      .map((r) => (r as { name: string }).name)
    expect(balanceCols).toContain('source')
    expect(balanceCols).toContain('base_amount')
    expect(balanceCols).toContain('base_tx_id')

    const txCols = db
      .prepare('PRAGMA table_info(transactions)')
      .all()
      .map((r) => (r as { name: string }).name)
    expect(txCols).toContain('fee')
    expect(txCols).toContain('destination_room_id')

    const tournamentCols = db
      .prepare('PRAGMA table_info(tournaments)')
      .all()
      .map((r) => (r as { name: string }).name)
    expect(tournamentCols).toContain('name')
    expect(tournamentCols).toContain('rank')
    expect(tournamentCols).toContain('entrants')
    expect(tournamentCols).toContain('tournament_id')
    expect(tournamentCols).toContain('is_mbr')

    const overrideCols = db
      .prepare('PRAGMA table_info(rate_overrides)')
      .all()
      .map((r) => (r as { name: string }).name)
    expect(overrideCols).toEqual(expect.arrayContaining(['room_id', 'from_currency', 'to_currency', 'rate']))

    const tournamentIndexes = db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tournaments'")
      .all()
      .map((r) => (r as { name: string; sql: string }).name)
    expect(tournamentIndexes).toEqual(expect.arrayContaining(['idx_tournaments_date_room']))
    db.close()
  })

  it('v12 creates goals tables with unique (goal_id, milestone) and cascade', () => {
    const db = initDb(':memory:')

    const goalCols = db
      .prepare('PRAGMA table_info(goals)')
      .all()
      .map((r) => (r as { name: string }).name)
    expect(goalCols).toEqual(
      expect.arrayContaining(['metric', 'target_units', 'currency', 'deadline', 'status', 'achieved_at', 'failed_at', 'checklist'])
    )

    const entryCols = db
      .prepare('PRAGMA table_info(goal_entries)')
      .all()
      .map((r) => (r as { name: string }).name)
    expect(entryCols).toEqual(expect.arrayContaining(['goal_id', 'kind', 'content', 'images', 'milestone']))

    const ins = db
      .prepare('INSERT INTO goals (metric, target_units, currency) VALUES (?, ?, ?)')
      .run('bankroll', 100_00, 'USD')
    const goalId = Number(ins.lastInsertRowid)
    const entry = db.prepare('INSERT INTO goal_entries (goal_id, kind, content, milestone) VALUES (?, ?, ?, ?)')
    entry.run(goalId, 'system', '50%', 50)
    expect(() => entry.run(goalId, 'system', '50% again', 50)).toThrow()
    expect(() => entry.run(goalId, 'system', '75%', 75)).not.toThrow()
    expect(() => entry.run(goalId, 'user', 'just because', null)).not.toThrow()

    expect(() => db.prepare('INSERT INTO goals (metric, target_units, status) VALUES (?, ?, ?)').run('bankroll', 1, 'bogus')).toThrow()

    db.prepare('DELETE FROM goals WHERE id = ?').run(goalId)
    const left = (db.prepare('SELECT COUNT(*) AS c FROM goal_entries').get() as { c: number }).c
    expect(left).toBe(0)
    db.close()
  })

  it('v11 adds is_wallet and flags existing Bybit rooms case-insensitively', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poker-crm-db-'))
    const dbPath = join(dir, 'v10.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        cash_currency TEXT NOT NULL DEFAULT 'USD',
        tournament_currency TEXT NOT NULL DEFAULT 'USD',
        rate_source TEXT,
        color TEXT NOT NULL DEFAULT '#f1f5f9',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('deposit', 'withdraw', 'transfer')),
        amount INTEGER NOT NULL CHECK (amount >= 0),
        fee INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
        currency TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
        counterpart TEXT,
        destination_room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        comment TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE tournaments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        buyin INTEGER NOT NULL,
        result INTEGER NOT NULL,
        currency TEXT NOT NULL,
        name TEXT,
        rank INTEGER,
        entrants INTEGER,
        tournament_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE balance_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(room_id, date)
      );
      INSERT INTO rooms (name) VALUES ('Bybit'), ('bybit'), (' PokerDom ');
      PRAGMA user_version = 10;
    `)

    legacyLedgerSchema(db)

    runMigrations(db)

    const isWallet = (name: string) =>
      (db.prepare('SELECT is_wallet FROM rooms WHERE name = ?').get(name) as { is_wallet: number }).is_wallet
    expect(isWallet('Bybit')).toBe(1)
    expect(isWallet('bybit')).toBe(1)
    expect(isWallet(' PokerDom ')).toBe(0)
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(30)

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('v13 adds goals.title on an upgrade from v12', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poker-crm-db-'))
    const dbPath = join(dir, 'v12.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE goals (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        metric       TEXT    NOT NULL DEFAULT 'bankroll',
        target_units INTEGER NOT NULL CHECK (target_units > 0),
        currency     TEXT    NOT NULL DEFAULT 'USD',
        deadline     TEXT,
        status       TEXT    NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','achieved','failed')),
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        achieved_at  TEXT,
        failed_at    TEXT
      );
      INSERT INTO goals (metric, target_units) VALUES ('distance', 10);
      CREATE TABLE goal_entries (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id    INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        kind       TEXT    NOT NULL CHECK (kind IN ('system','user')),
        content    TEXT    NOT NULL,
        milestone  INTEGER,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(goal_id, milestone)
      );
      CREATE TABLE rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        cash_currency TEXT NOT NULL DEFAULT 'USD',
        tournament_currency TEXT NOT NULL DEFAULT 'USD',
        rate_source TEXT,
        color TEXT NOT NULL DEFAULT '#f1f5f9',
        is_wallet INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE tournaments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        buyin INTEGER NOT NULL,
        result INTEGER NOT NULL,
        currency TEXT NOT NULL,
        name TEXT,
        rank INTEGER,
        entrants INTEGER,
        tournament_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('deposit', 'withdraw', 'transfer')),
        amount INTEGER NOT NULL CHECK (amount >= 0),
        fee INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
        currency TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
        counterpart TEXT,
        destination_room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        comment TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE balance_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(room_id, date)
      );
      PRAGMA user_version = 12;
    `)

    legacyLedgerSchema(db)

    runMigrations(db)

    const goalCols = db
      .prepare('PRAGMA table_info(goals)')
      .all()
      .map((r) => (r as { name: string }).name)
    expect(goalCols).toContain('title')
    expect((db.prepare('SELECT title FROM goals').get() as { title: string | null }).title).toBeNull()
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(30)

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('v14 adds is_mbr and backfills existing Mystery Battle Royale rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poker-crm-db-'))
    const dbPath = join(dir, 'v13.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        cash_currency TEXT NOT NULL DEFAULT 'USD',
        tournament_currency TEXT NOT NULL DEFAULT 'USD',
        rate_source TEXT,
        color TEXT NOT NULL DEFAULT '#f1f5f9',
        is_wallet INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE tournaments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        buyin INTEGER NOT NULL,
        result INTEGER NOT NULL,
        currency TEXT NOT NULL,
        name TEXT,
        rank INTEGER,
        entrants INTEGER,
        tournament_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('deposit', 'withdraw', 'transfer')),
        amount INTEGER NOT NULL CHECK (amount >= 0),
        fee INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
        currency TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
        counterpart TEXT,
        destination_room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        comment TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE balance_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(room_id, date)
      );
      CREATE TABLE goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        metric TEXT NOT NULL DEFAULT 'bankroll',
        target_units INTEGER NOT NULL CHECK (target_units > 0),
        currency TEXT NOT NULL DEFAULT 'USD',
        deadline TEXT,
        title TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','achieved','failed')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        achieved_at TEXT,
        failed_at TEXT
      );
      CREATE TABLE goal_entries (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id    INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        kind       TEXT    NOT NULL CHECK (kind IN ('system','user')),
        content    TEXT    NOT NULL,
        milestone  INTEGER,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(goal_id, milestone)
      );
      INSERT INTO rooms (name) VALUES ('GG');
      INSERT INTO tournaments (room_id, date, buyin, result, currency, name) VALUES
        (1, '2026-09-16', 100, 550, 'USD', 'Mystery Battle Royale $1, Hold''em No Limit'),
        (1, '2026-09-16', 100, 0, 'USD', 'Mystery Battle Royale $3, Hold''em No Limit'),
        (1, '2026-09-16', 550, 840, 'USD', 'Daily Turbo 5.50'),
        (1, '2026-09-16', 250, 0, 'USD', NULL);
      PRAGMA user_version = 13;
    `)

    legacyLedgerSchema(db)

    runMigrations(db)

    const rows = db
      .prepare('SELECT name, is_mbr FROM tournaments ORDER BY id')
      .all() as { name: string | null; is_mbr: number }[]
    expect(rows.map((r) => r.is_mbr)).toEqual([1, 1, 0, 0])
    expect(rows.map((r) => r.name)).toContain('Daily Turbo 5.50')
    expect((db.prepare('SELECT COUNT(*) AS c FROM tournaments').get() as { c: number }).c).toBe(4)
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(30)

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('v15 rebuilds transactions: keeps rows, adds casino type and signed amounts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poker-crm-db-'))
    const dbPath = join(dir, 'v14.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        cash_currency TEXT NOT NULL DEFAULT 'USD',
        tournament_currency TEXT NOT NULL DEFAULT 'USD',
        rate_source TEXT,
        color TEXT NOT NULL DEFAULT '#f1f5f9',
        is_wallet INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('deposit', 'withdraw', 'transfer')),
        amount INTEGER NOT NULL CHECK (amount >= 0),
        fee INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
        currency TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
        counterpart TEXT,
        destination_room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        comment TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_transactions_room_date ON transactions(room_id, date);
      CREATE TABLE balance_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(room_id, date)
      );
      CREATE TABLE goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        metric TEXT NOT NULL DEFAULT 'bankroll',
        target_units INTEGER NOT NULL CHECK (target_units > 0),
        currency TEXT NOT NULL DEFAULT 'USD',
        deadline TEXT,
        title TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','achieved','failed')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        achieved_at TEXT,
        failed_at TEXT
      );
      CREATE TABLE goal_entries (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id    INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        kind       TEXT    NOT NULL CHECK (kind IN ('system','user')),
        content    TEXT    NOT NULL,
        milestone  INTEGER,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(goal_id, milestone)
      );
      INSERT INTO rooms (name) VALUES ('GG');
      INSERT INTO transactions (room_id, type, amount, fee, currency, direction, date)
        VALUES (1, 'deposit', 5000, 0, 'USD', 'in', '2026-09-16');
      PRAGMA user_version = 14;
    `)

    legacyLedgerSchema(db)

    runMigrations(db)

    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(30)
    const kept = db.prepare('SELECT type, amount, destination_room_id FROM transactions WHERE id = 1').get() as {
      type: string
      amount: number
      destination_room_id: number | null
    }
    expect(kept).toEqual({ type: 'deposit', amount: 5000, destination_room_id: null })

    const ins = db.prepare(
      'INSERT INTO transactions (room_id, type, amount, fee, currency, direction, date) VALUES (1, ?, ?, ?, ?, ?, ?)'
    )
    expect(() => ins.run('casino', 2000, 0, 'USD', 'in', '2026-09-17')).not.toThrow()
    expect(() => ins.run('casino', -2000, 0, 'USD', 'out', '2026-09-17')).not.toThrow()
    expect(() => ins.run('casino', 0, 0, 'USD', 'out', '2026-09-17')).toThrow()
    expect(() => ins.run('casino', 2000, 50, 'USD', 'in', '2026-09-17')).toThrow()
    expect(() => ins.run('deposit', 0, 0, 'USD', 'in', '2026-09-17')).toThrow()
    expect(() => ins.run('deposit', -2000, 0, 'USD', 'in', '2026-09-17')).toThrow()

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('v16 creates settings seeded with day_start_hour = 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poker-crm-db-'))
    const dbPath = join(dir, 'v15.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        cash_currency TEXT NOT NULL DEFAULT 'USD',
        tournament_currency TEXT NOT NULL DEFAULT 'USD',
        rate_source TEXT,
        color TEXT NOT NULL DEFAULT '#f1f5f9',
        is_wallet INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('deposit', 'withdraw', 'transfer', 'casino')),
        amount INTEGER NOT NULL,
        fee INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
        counterpart TEXT,
        destination_room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        comment TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE balance_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(room_id, date)
      );
      CREATE TABLE goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        metric TEXT NOT NULL DEFAULT 'bankroll',
        target_units INTEGER NOT NULL CHECK (target_units > 0),
        currency TEXT NOT NULL DEFAULT 'USD',
        deadline TEXT,
        title TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','achieved','failed')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        achieved_at TEXT,
        failed_at TEXT
      );
      CREATE TABLE goal_entries (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id    INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        kind       TEXT    NOT NULL CHECK (kind IN ('system','user')),
        content    TEXT    NOT NULL,
        milestone  INTEGER,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(goal_id, milestone)
      );
      PRAGMA user_version = 15;
    `)

    legacyLedgerSchema(db)

    runMigrations(db)

    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(30)
    const seeded = db.prepare("SELECT value FROM settings WHERE key = 'day_start_hour'").get() as { value: string }
    expect(seeded).toEqual({ value: '0' })

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('v17 snapshots manual balances and absorbs transactions already recorded on their day', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poker-crm-db-'))
    const dbPath = join(dir, 'v16.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        cash_currency TEXT NOT NULL DEFAULT 'USD',
        tournament_currency TEXT NOT NULL DEFAULT 'USD',
        rate_source TEXT,
        color TEXT NOT NULL DEFAULT '#f1f5f9',
        is_wallet INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('deposit', 'withdraw', 'transfer', 'casino')),
        amount INTEGER NOT NULL,
        fee INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
        counterpart TEXT,
        destination_room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        comment TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE balance_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(room_id, date)
      );
      CREATE TABLE goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        metric TEXT NOT NULL DEFAULT 'bankroll',
        target_units INTEGER NOT NULL CHECK (target_units > 0),
        currency TEXT NOT NULL DEFAULT 'USD',
        deadline TEXT,
        title TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','achieved','failed')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        achieved_at TEXT,
        failed_at TEXT
      );
      CREATE TABLE goal_entries (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id    INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        kind       TEXT    NOT NULL CHECK (kind IN ('system','user')),
        content    TEXT    NOT NULL,
        milestone  INTEGER,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(goal_id, milestone)
      );
      INSERT INTO rooms (name) VALUES ('GG');
      INSERT INTO transactions (room_id, type, amount, fee, currency, direction, date)
        VALUES (1, 'deposit', 5000, 0, 'USD', 'in', '2026-09-16');
      INSERT INTO balance_entries (room_id, date, amount, currency, source)
        VALUES (1, '2026-09-16', 15000, 'USD', 'manual');
      PRAGMA user_version = 16;
    `)

    legacyLedgerSchema(db)

    runMigrations(db)

    const row = db
      .prepare('SELECT amount, base_amount, base_tx_id FROM balance_entries WHERE room_id = 1 AND date = ?')
      .get('2026-09-16') as { amount: number; base_amount: number; base_tx_id: number }
    expect(row).toMatchObject({ amount: 15000, base_amount: 15000, base_tx_id: 1 })

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('v18 restores the manual amount that v17 had re-derived', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poker-crm-db-'))
    const dbPath = join(dir, 'v17.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE balance_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        base_amount INTEGER,
        base_tx_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(room_id, date)
      );
      CREATE TABLE goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        metric TEXT NOT NULL DEFAULT 'bankroll',
        target_units INTEGER NOT NULL CHECK (target_units > 0),
        currency TEXT NOT NULL DEFAULT 'USD',
        deadline TEXT,
        title TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','achieved','failed')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        achieved_at TEXT,
        failed_at TEXT
      );
      CREATE TABLE goal_entries (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id    INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        kind       TEXT    NOT NULL CHECK (kind IN ('system','user')),
        content    TEXT    NOT NULL,
        milestone  INTEGER,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(goal_id, milestone)
      );
      INSERT INTO balance_entries (room_id, date, amount, currency, source, base_amount, base_tx_id)
        VALUES (1, '2026-09-16', 20000, 'USD', 'manual', 15000, 1);
      INSERT INTO balance_entries (room_id, date, amount, currency, source, base_amount, base_tx_id)
        VALUES (1, '2026-09-17', 5000, 'USD', 'auto', NULL, NULL);
      PRAGMA user_version = 17;
    `)

    legacyLedgerSchema(db)

    runMigrations(db)

    expect((db.prepare("SELECT amount FROM balance_entries WHERE date = '2026-09-16'").get() as { amount: number }).amount).toBe(15000)
    // auto rows are not touched by v18 — the startup recompute rebuilds them
    expect((db.prepare("SELECT amount FROM balance_entries WHERE date = '2026-09-17'").get() as { amount: number }).amount).toBe(5000)
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(30)

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('v19 adds an empty checklist column to goals on an upgrade from v18', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poker-crm-db-'))
    const dbPath = join(dir, 'v18.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE goals (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        metric       TEXT    NOT NULL DEFAULT 'bankroll',
        target_units INTEGER NOT NULL CHECK (target_units > 0),
        currency     TEXT    NOT NULL DEFAULT 'USD',
        deadline     TEXT,
        title        TEXT,
        status       TEXT    NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','achieved','failed')),
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        achieved_at  TEXT,
        failed_at    TEXT
      );
      CREATE TABLE goal_entries (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id    INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        kind       TEXT    NOT NULL CHECK (kind IN ('system','user')),
        content    TEXT    NOT NULL,
        milestone  INTEGER,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(goal_id, milestone)
      );
      INSERT INTO goals (metric, target_units) VALUES ('distance', 10);
      PRAGMA user_version = 18;
    `)

    legacyLedgerSchema(db)

    runMigrations(db)

    const goalCols = db
      .prepare('PRAGMA table_info(goals)')
      .all()
      .map((r) => (r as { name: string }).name)
    expect(goalCols).toContain('checklist')
    expect((db.prepare('SELECT checklist FROM goals').get() as { checklist: string }).checklist).toBe('[]')
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(30)

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('v20 creates habits and habit_logs: soft-delete column, unique day logs', () => {
    const db = initDb(':memory:')

    const habitCols = db
      .prepare('PRAGMA table_info(habits)')
      .all()
      .map((r) => (r as { name: string }).name)
    expect(habitCols).toEqual(expect.arrayContaining(['id', 'name', 'created_at', 'archived_at']))

    const logCols = db
      .prepare('PRAGMA table_info(habit_logs)')
      .all()
      .map((r) => (r as { name: string }).name)
    expect(logCols).toEqual(expect.arrayContaining(['habit_id', 'date', 'status']))

    const ins = db.prepare('INSERT INTO habits (name) VALUES (?)')
    ins.run('Медитация')
    const habitId = (db.prepare('SELECT id FROM habits').get() as { id: number }).id
    expect((db.prepare('SELECT archived_at FROM habits WHERE id = ?').get(habitId) as { archived_at: string | null }).archived_at).toBeNull()

    const log = db.prepare('INSERT INTO habit_logs (habit_id, date, status) VALUES (?, ?, ?)')
    log.run(habitId, '2026-09-20', 'done')
    expect(() => log.run(habitId, '2026-09-20', 'missed')).toThrow()
    expect(() => log.run(habitId, '2026-09-21', 'bogus')).toThrow()

    db.prepare('UPDATE habits SET archived_at = ? WHERE id = ?').run('2026-09-21', habitId)
    expect((db.prepare('SELECT archived_at FROM habits WHERE id = ?').get(habitId) as { archived_at: string }).archived_at).toBe('2026-09-21')
    db.close()
  })

  it('v20 upgrade from v19 creates the habit tables and keeps the goals data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poker-crm-db-'))
    const dbPath = join(dir, 'v19.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE goals (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        metric       TEXT    NOT NULL DEFAULT 'bankroll',
        target_units INTEGER NOT NULL CHECK (target_units > 0),
        currency     TEXT    NOT NULL DEFAULT 'USD',
        deadline     TEXT,
        title        TEXT,
        status       TEXT    NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','achieved','failed')),
        checklist    TEXT    NOT NULL DEFAULT '[]',
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        achieved_at  TEXT,
        failed_at    TEXT
      );
      CREATE TABLE goal_entries (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id    INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        kind       TEXT    NOT NULL CHECK (kind IN ('system','user')),
        content    TEXT    NOT NULL,
        milestone  INTEGER,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(goal_id, milestone)
      );
      INSERT INTO goals (metric, target_units) VALUES ('distance', 10);
      PRAGMA user_version = 19;
    `)

    legacyLedgerSchema(db)

    runMigrations(db)

    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name)
    expect(names).toContain('habits')
    expect(names).toContain('habit_logs')
    expect((db.prepare('SELECT COUNT(*) AS c FROM goals').get() as { c: number }).c).toBe(1)
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(30)

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('v21 adds the closed status and history snapshot columns, keeping entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poker-crm-db-'))
    const dbPath = join(dir, 'v20.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE goals (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        metric       TEXT    NOT NULL DEFAULT 'bankroll',
        target_units INTEGER NOT NULL CHECK (target_units > 0),
        currency     TEXT    NOT NULL DEFAULT 'USD',
        deadline     TEXT,
        title        TEXT,
        status       TEXT    NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','achieved','failed')),
        checklist    TEXT    NOT NULL DEFAULT '[]',
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        achieved_at  TEXT,
        failed_at    TEXT
      );
      CREATE TABLE goal_entries (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id    INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        kind       TEXT    NOT NULL CHECK (kind IN ('system','user')),
        content    TEXT    NOT NULL,
        milestone  INTEGER,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(goal_id, milestone)
      );
      INSERT INTO goals (metric, target_units, title) VALUES ('distance', 10, 'Сто турниров');
      INSERT INTO goal_entries (goal_id, kind, content, milestone) VALUES (1, 'system', 'Пройдено 50%', 50);
      CREATE TABLE habits (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT
      );
      PRAGMA user_version = 20;
    `)

    legacyLedgerSchema(db)
    legacyHabitLogsSchema(db)

    runMigrations(db)

    const cols = db
      .prepare('PRAGMA table_info(goals)')
      .all()
      .map((r) => (r as { name: string }).name)
    expect(cols).toEqual(expect.arrayContaining(['closed_at', 'final_percent', 'final_units', 'acknowledged_at']))

    expect(db.prepare('SELECT title, status FROM goals WHERE id = 1').get()).toEqual({ title: 'Сто турниров', status: 'active' })
    expect((db.prepare('SELECT COUNT(*) AS c FROM goal_entries').get() as { c: number }).c).toBe(1)

    db.prepare("UPDATE goals SET status = 'closed', final_percent = 40, final_units = 4 WHERE id = 1").run()
    expect(db.prepare('SELECT final_percent, final_units FROM goals WHERE id = 1').get()).toEqual({ final_percent: 40, final_units: 4 })
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(30)

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('v22 adds acknowledged_at and backfills already finished goals', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poker-crm-db-'))
    const dbPath = join(dir, 'v21.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE goals (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        metric        TEXT    NOT NULL DEFAULT 'bankroll',
        target_units  INTEGER NOT NULL CHECK (target_units > 0),
        currency      TEXT    NOT NULL DEFAULT 'USD',
        deadline      TEXT,
        title         TEXT,
        checklist     TEXT    NOT NULL DEFAULT '[]',
        status        TEXT    NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','achieved','failed','closed')),
        closed_at     TEXT,
        final_percent INTEGER,
        final_units   INTEGER,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        achieved_at   TEXT,
        failed_at     TEXT
      );
      INSERT INTO goals (metric, target_units, status) VALUES ('distance', 10, 'active');
      INSERT INTO goals (metric, target_units, status) VALUES ('distance', 10, 'achieved');
      INSERT INTO goals (metric, target_units, status) VALUES ('distance', 10, 'closed');
      CREATE TABLE habits (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT
      );
PRAGMA user_version = 21;
    `)

    legacyLedgerSchema(db)
    legacyGoalEntriesSchema(db)
    legacyHabitLogsSchema(db)

    runMigrations(db)

    const cols = db
      .prepare('PRAGMA table_info(goals)')
      .all()
      .map((r) => (r as { name: string }).name)
    expect(cols).toContain('acknowledged_at')

    const rows = db.prepare('SELECT id, status, acknowledged_at FROM goals ORDER BY id').all() as unknown as {
      id: number
      status: string
      acknowledged_at: string | null
    }[]
    expect(rows.map((r) => [r.status, r.acknowledged_at === null])).toEqual([
      ['active', true],
      ['achieved', false],
      ['closed', false]
    ])
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(30)

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('v23 adds the habit color column and defaults existing habits', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poker-crm-db-'))
    const dbPath = join(dir, 'v22.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE habits (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT
      );
      INSERT INTO habits (name) VALUES ('Медитация');
      CREATE TABLE goals (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        metric          TEXT    NOT NULL DEFAULT 'bankroll',
        target_units    INTEGER NOT NULL CHECK (target_units > 0),
        currency        TEXT    NOT NULL DEFAULT 'USD',
        deadline        TEXT,
        title           TEXT,
        checklist       TEXT    NOT NULL DEFAULT '[]',
        status          TEXT    NOT NULL DEFAULT 'active',
        closed_at       TEXT,
        final_percent   INTEGER,
        final_units     INTEGER,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        achieved_at     TEXT,
        failed_at       TEXT,
        acknowledged_at TEXT
      );
PRAGMA user_version = 22;
    `)

    legacyLedgerSchema(db)
    legacyGoalEntriesSchema(db)
    legacyHabitLogsSchema(db)

    runMigrations(db)

    const cols = db
      .prepare('PRAGMA table_info(habits)')
      .all()
      .map((r) => (r as { name: string }).name)
    expect(cols).toContain('color')
    expect(db.prepare('SELECT name, color FROM habits WHERE id = 1').get()).toEqual({ name: 'Медитация', color: '#f1f5f9' })
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(30)

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('v24 adds the goal sort order and backfills the previous newest-first view', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poker-crm-db-'))
    const dbPath = join(dir, 'v23.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE goals (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        metric       TEXT    NOT NULL DEFAULT 'bankroll',
        target_units INTEGER NOT NULL CHECK (target_units > 0),
        currency     TEXT    NOT NULL DEFAULT 'USD',
        deadline     TEXT,
        title        TEXT,
        checklist    TEXT    NOT NULL DEFAULT '[]',
        status       TEXT    NOT NULL DEFAULT 'active',
        closed_at    TEXT,
        final_percent INTEGER,
        final_units  INTEGER,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        achieved_at  TEXT,
        failed_at    TEXT,
        acknowledged_at TEXT
      );
      INSERT INTO goals (target_units, title, created_at) VALUES (100, 'старая', '2026-01-01 10:00:00');
      INSERT INTO goals (target_units, title, created_at) VALUES (100, 'средняя', '2026-01-02 10:00:00');
      INSERT INTO goals (target_units, title, created_at) VALUES (100, 'новая', '2026-01-03 10:00:00');
      INSERT INTO goals (target_units, title, created_at) VALUES (100, 'близнец', '2026-01-03 10:00:00');
      CREATE TABLE habits (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        color       TEXT    NOT NULL DEFAULT '#f1f5f9',
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT
      );
PRAGMA user_version = 23;
    `)

    legacyLedgerSchema(db)
    legacyGoalEntriesSchema(db)
    legacyHabitLogsSchema(db)

    runMigrations(db)

    const rows = db.prepare('SELECT id, title, sort_order FROM goals ORDER BY sort_order, id').all() as unknown as {
      id: number
      title: string
      sort_order: number
    }[]
    expect(rows.map((r) => r.title)).toEqual(['близнец', 'новая', 'средняя', 'старая'])
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1, 2, 3])

    const column = (db.prepare('PRAGMA table_info(goals)').all() as unknown as { name: string; notnull: number; dflt_value: string | null }[]).find(
      (c) => c.name === 'sort_order'
    )
    expect(column).toMatchObject({ notnull: 1, dflt_value: '0' })
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(30)

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('v25 adds the habit sort order and backfills the previous alphabetical view', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poker-crm-db-'))
    const dbPath = join(dir, 'v24.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE habits (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        color       TEXT    NOT NULL DEFAULT '#f1f5f9',
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT
      );
      INSERT INTO habits (name, created_at) VALUES ('сон', '2026-01-01 10:00:00');
      INSERT INTO habits (name, created_at) VALUES ('Спорт', '2026-01-02 10:00:00');
      INSERT INTO habits (name, created_at) VALUES ('спорт', '2026-01-03 10:00:00');
      INSERT INTO habits (name, archived_at) VALUES ('вода', '2026-01-04');
      INSERT INTO habits (name, archived_at) VALUES ('вода', '2026-01-05');
PRAGMA user_version = 24;
    `)

    legacyLedgerSchema(db)
    legacyGoalEntriesSchema(db)
    legacyHabitLogsSchema(db)

    runMigrations(db)

    const bySort = db.prepare('SELECT id FROM habits ORDER BY sort_order, id').all() as unknown as { id: number }[]
    const alphabetical = db.prepare('SELECT id FROM habits ORDER BY name COLLATE NOCASE, id').all() as unknown as { id: number }[]
    const sortOrders = db.prepare('SELECT sort_order FROM habits ORDER BY sort_order, id').all() as unknown as { sort_order: number }[]
    expect(bySort).toEqual(alphabetical)
    expect(sortOrders.map((r) => r.sort_order)).toEqual([0, 1, 2, 3, 4])

    const column = (db.prepare('PRAGMA table_info(habits)').all() as unknown as { name: string; notnull: number; dflt_value: string | null }[]).find(
      (c) => c.name === 'sort_order'
    )
    expect(column).toMatchObject({ notnull: 1, dflt_value: '0' })
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(30)

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('v26 turns casino write-offs into casino transactions and drops the table', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poker-crm-db-'))
    const dbPath = join(dir, 'v25.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE rooms (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        cash_currency TEXT NOT NULL DEFAULT 'USD',
        tournament_currency TEXT NOT NULL DEFAULT 'USD',
        color TEXT,
        rate_source TEXT,
        is_wallet INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO rooms (id, name) VALUES (1, 'PokerDom'), (2, 'GGpoker');
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('deposit', 'withdraw', 'transfer', 'casino')),
        amount INTEGER NOT NULL CHECK ((type = 'casino' AND amount <> 0) OR (type <> 'casino' AND amount > 0)),
        fee INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
        currency TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
        counterpart TEXT,
        destination_room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        comment TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (type <> 'casino' OR fee = 0)
      );
      CREATE TABLE casino_writeoffs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        comment TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(room_id, date)
      );
      INSERT INTO transactions (id, room_id, type, amount, currency, direction, date, created_at)
        VALUES (1, 1, 'deposit', 100_00, 'USD', 'in', '2026-09-08', '2026-09-08 20:00:00');
      INSERT INTO casino_writeoffs (room_id, date, amount, currency, comment, created_at) VALUES
        (1, '2026-09-10', -1470, 'USD', 'Играл в казино', '2026-09-10 21:30:00'),
        (2, '2026-09-11',  300,  'USD', NULL,            '2026-09-11 21:30:00'),
        (1, '2026-09-12',    0,  'USD', 'нулевое',       '2026-09-12 21:30:00');
PRAGMA user_version = 25;
    `)

    legacyLedgerSchema(db)
    legacyGoalEntriesSchema(db)
    legacyHabitLogsSchema(db)

    runMigrations(db)

    const migrated = db
      .prepare("SELECT id, room_id, type, amount, fee, currency, direction, date, comment, created_at FROM transactions WHERE type = 'casino' ORDER BY id")
      .all() as unknown as Record<string, unknown>[]
    // the amount keeps its sign, the direction follows it, the fee stays 0 and the
    // original comment/timestamp survive — a zero row is dropped (casino forbids it)
    expect(migrated).toEqual([
      {
        id: 2,
        room_id: 1,
        type: 'casino',
        amount: -1470,
        fee: 0,
        currency: 'USD',
        direction: 'out',
        date: '2026-09-10',
        comment: 'Играл в казино',
        created_at: '2026-09-10 21:30:00'
      },
      {
        id: 3,
        room_id: 2,
        type: 'casino',
        amount: 300,
        fee: 0,
        currency: 'USD',
        direction: 'in',
        date: '2026-09-11',
        comment: null,
        created_at: '2026-09-11 21:30:00'
      }
    ])
    // the untouched rows stay exactly where they were
    expect((db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE type = ?').get('deposit') as { c: number }).c).toBe(1)

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name)
    expect(tables).not.toContain('casino_writeoffs')
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(30)

    // re-running migrations on the upgraded db is a no-op
    legacyLedgerSchema(db)
    runMigrations(db)
    expect((db.prepare("SELECT COUNT(*) AS c FROM transactions WHERE type = 'casino'").get() as { c: number }).c).toBe(2)

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('v27 adds goal_entries.images as an empty JSON list and keeps existing notes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poker-crm-v27-'))
    const db = initDb(join(dir, 'v27.sqlite'))
    db.exec(`
      DROP TABLE goal_entries;
      DROP TABLE goals;
      CREATE TABLE goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        metric TEXT NOT NULL DEFAULT 'bankroll',
        target_units INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        deadline TEXT,
        title TEXT,
        checklist TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        closed_at TEXT,
        final_percent INTEGER,
        final_units INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        achieved_at TEXT,
        failed_at TEXT,
        acknowledged_at TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE goal_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('system','user')),
        content TEXT NOT NULL,
        milestone INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(goal_id, milestone)
      );
      INSERT INTO goals (id, metric, target_units, title) VALUES (1, 'custom', 1, 'Старая цель');
      INSERT INTO goal_entries (goal_id, kind, content) VALUES (1, 'user', 'старая заметка');
      PRAGMA user_version = 26;
    `)

    runMigrations(db)

    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(30)
    const row = db.prepare('SELECT content, images FROM goal_entries').get() as { content: string; images: string }
    expect(row.content).toBe('старая заметка')
    expect(row.images).toBe('[]')

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('v28 widens the habit_logs status check to partial and keeps every log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poker-crm-v28-'))
    const db = initDb(join(dir, 'v28.sqlite'))
    db.exec(`
      DROP TABLE habit_logs;
      CREATE TABLE habit_logs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        habit_id   INTEGER NOT NULL REFERENCES habits(id),
        date       TEXT    NOT NULL,
        status     TEXT    NOT NULL CHECK (status IN ('done','missed')),
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(habit_id, date)
      );
      CREATE INDEX idx_habit_logs_date ON habit_logs(date);
      INSERT INTO habits (id, name) VALUES (1, 'Медитация');
      INSERT INTO habit_logs (habit_id, date, status) VALUES
        (1, '2026-09-20', 'done'),
        (1, '2026-09-21', 'missed');
      PRAGMA user_version = 27;
    `)

    runMigrations(db)

    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(30)
    const rows = db.prepare('SELECT date, status FROM habit_logs ORDER BY date').all() as unknown as Record<string, unknown>[]
    expect(rows).toEqual([
      { date: '2026-09-20', status: 'done' },
      { date: '2026-09-21', status: 'missed' }
    ])

    const ins = db.prepare('INSERT INTO habit_logs (habit_id, date, status) VALUES (?, ?, ?)')
    expect(() => ins.run(1, '2026-09-22', 'partial')).not.toThrow()
    expect(() => ins.run(1, '2026-09-23', 'bogus')).toThrow()

    // re-running migrations on the upgraded db is a no-op
    runMigrations(db)
    expect((db.prepare('SELECT COUNT(*) AS c FROM habit_logs').get() as { c: number }).c).toBe(3)

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('v29 keeps the sender transfer row when the destination room is deleted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poker-crm-v29-'))
    const db = initDb(join(dir, 'v29.sqlite'))
    db.exec(`
      DROP TABLE transactions;
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('deposit', 'withdraw', 'transfer', 'casino')),
        amount INTEGER NOT NULL CHECK ((type = 'casino' AND amount <> 0) OR (type <> 'casino' AND amount > 0)),
        fee INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
        currency TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
        counterpart TEXT,
        destination_room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        comment TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (type <> 'casino' OR fee = 0)
      );
      CREATE INDEX idx_transactions_room_date ON transactions(room_id, date);
      INSERT INTO rooms (id, name) VALUES (1, 'PokerDom'), (2, 'Bybit');
      INSERT INTO transactions (id, room_id, type, amount, fee, currency, direction, destination_room_id, date)
        VALUES (1, 1, 'transfer', 5000, 100, 'USD', 'out', 2, '2026-09-09'),
               (2, 1, 'deposit', 10000, 0, 'USD', 'in', NULL, '2026-09-08');
      PRAGMA user_version = 28;
    `)

    runMigrations(db)

    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(30)
    const kept = db.prepare('SELECT id, room_id, type, amount, fee, destination_room_id FROM transactions ORDER BY id').all() as unknown as Record<
      string,
      number | string | null
    >[]
    expect(kept).toEqual([
      { id: 1, room_id: 1, type: 'transfer', amount: 5000, fee: 100, destination_room_id: 2 },
      { id: 2, room_id: 1, type: 'deposit', amount: 10000, fee: 0, destination_room_id: null }
    ])

    const fks = db.prepare('PRAGMA foreign_key_list(transactions)').all() as unknown as { from: string; on_delete: string }[]
    const destFk = fks.find((f) => f.from === 'destination_room_id')
    expect(destFk?.on_delete).toBe('SET NULL')

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'transactions'")
      .all()
      .map((r) => (r as { name: string }).name)
    expect(indexes).toContain('idx_transactions_destination')

    // deleting the recipient keeps the sender's ledger row, minus its recipient
    db.exec('DELETE FROM rooms WHERE id = 2')
    const after = db.prepare('SELECT id, type, amount, fee, destination_room_id FROM transactions WHERE id = 1').get() as {
      id: number
      type: string
      amount: number
      fee: number
      destination_room_id: number | null
    }
    expect(after).toEqual({ id: 1, type: 'transfer', amount: 5000, fee: 100, destination_room_id: null })

    // re-running migrations on the upgraded db is a no-op
    runMigrations(db)
    expect((db.prepare('SELECT COUNT(*) AS c FROM transactions').get() as { c: number }).c).toBe(2)

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('v30 flags pre-existing day-closing write-offs and leaves ordinary casino rows editable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poker-crm-v30-'))
    const db = initDb(join(dir, 'v30.sqlite'))
    db.exec(`
      DROP TABLE transactions;
      CREATE TABLE transactions (
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
        CHECK (type <> 'casino' OR fee = 0)
      );
      INSERT INTO rooms (id, name) VALUES (1, 'PokerDom');
      INSERT INTO transactions (id, room_id, type, amount, fee, currency, direction, date, comment)
        VALUES (1, 1, 'casino', 20000, 0, 'USD', 'in', '2026-09-10', 'Авто-списание: баланс за день относится к казино (2026-09-10)'),
               (2, 1, 'casino', 5000, 0, 'USD', 'in', '2026-09-11', 'свой выигрыш'),
               (3, 1, 'deposit', 10000, 0, 'USD', 'in', '2026-09-08', NULL);
      PRAGMA user_version = 29;
    `)

    runMigrations(db)

    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(30)
    const rows = db.prepare('SELECT id, writeoff, comment FROM transactions ORDER BY id').all() as unknown as {
      id: number
      writeoff: number
      comment: string | null
    }[]
    expect(rows).toEqual([
      { id: 1, writeoff: 1, comment: 'Авто-списание: баланс за день относится к казино (2026-09-10)' },
      { id: 2, writeoff: 0, comment: 'свой выигрыш' },
      { id: 3, writeoff: 0, comment: null }
    ])

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('allows duplicate NULL tournament_id and rejects duplicate non-NULL ones', () => {
    const db = initDb(':memory:')
    db.prepare("INSERT INTO rooms (name) VALUES ('GG')").run()
    const room = (db.prepare('SELECT id FROM rooms').get() as { id: number }).id
    const ins = db.prepare('INSERT INTO tournaments (room_id, date, buyin, result, currency, tournament_id) VALUES (?, ?, ?, ?, ?, ?)')

    ins.run(room, '2026-09-12', 100, 0, 'USD', null)
    ins.run(room, '2026-09-12', 200, 0, 'USD', null)
    expect(() => ins.run(room, '2026-09-12', 300, 0, 'USD', 311146578)).not.toThrow()
    expect(() => ins.run(room, '2026-09-13', 400, 0, 'USD', 311146578)).toThrow()
    db.close()
  })

  it('enforces unique (room_id, date) on balance_entries', () => {
    const db = initDb(':memory:')
    db.prepare("INSERT INTO rooms (name, cash_currency, tournament_currency) VALUES ('PokerDom', 'USD', 'RUB')").run()
    const room = (db.prepare('SELECT id FROM rooms').get() as { id: number }).id

    const ins = db.prepare('INSERT INTO balance_entries (room_id, date, amount, currency) VALUES (?, ?, ?, ?)')
    ins.run(room, '2026-09-09', 100, 'USD')
    expect(() => ins.run(room, '2026-09-09', 200, 'USD')).toThrow()
    db.close()
  })

  it('cascades deletes from rooms to tournaments', () => {
    const db = initDb(':memory:')
    db.prepare("INSERT INTO rooms (name) VALUES ('RedStar')").run()
    const room = (db.prepare('SELECT id FROM rooms').get() as { id: number }).id

    db.prepare('INSERT INTO tournaments (room_id, date, buyin, result, currency) VALUES (?, ?, ?, ?, ?)').run(
      room,
      '2026-09-09',
      500,
      1200,
      'EUR'
    )

    db.prepare('DELETE FROM rooms WHERE id = ?').run(room)
    const left = (db.prepare('SELECT COUNT(*) AS c FROM tournaments').get() as { c: number }).c
    expect(left).toBe(0)
    db.close()
  })

  it('enforces unique (room_id, date) on pending_imports and cascades room deletes', () => {
    const db = initDb(':memory:')
    db.prepare("INSERT INTO rooms (name) VALUES ('PokerDom')").run()
    const room = (db.prepare('SELECT id FROM rooms').get() as { id: number }).id

    const ins = db.prepare('INSERT INTO pending_imports (room_id, date) VALUES (?, ?)')
    ins.run(room, '2026-09-09')
    expect(() => ins.run(room, '2026-09-09')).toThrow()

    db.prepare('DELETE FROM rooms WHERE id = ?').run(room)
    const left = (db.prepare('SELECT COUNT(*) AS c FROM pending_imports').get() as { c: number }).c
    expect(left).toBe(0)
    db.close()
  })

  it('withTransaction commits on success and rolls back on error', () => {
    const db = initDb(':memory:')
    db.prepare("INSERT INTO rooms (name) VALUES ('Bybit')").run()
    const dbRoomId = (db.prepare('SELECT id FROM rooms').get() as { id: number }).id
    setDbForTests(db)

    withTransaction(() => {
      db.prepare("INSERT INTO rooms (name) VALUES ('Transactional')").run()
    })
    const created = (db.prepare('SELECT COUNT(*) AS c FROM rooms WHERE name = ?').get('Transactional') as { c: number }).c
    expect(created).toBe(1)

    const idBefore = (db.prepare('SELECT MAX(id) AS m FROM rooms').get() as { m: number }).m
    expect(() =>
      withTransaction(() => {
        db.prepare("INSERT INTO rooms (name) VALUES ('Doomed')").run()
        throw new Error('boom')
      })
    ).toThrow('boom')
    const doomed = (db.prepare('SELECT COUNT(*) AS c FROM rooms WHERE name = ?').get('Doomed') as { c: number }).c
    expect(doomed).toBe(0)
    const idAfter = (db.prepare('SELECT MAX(id) AS m FROM rooms').get() as { m: number }).m
    expect(idAfter).toBe(idBefore)

    withTransaction(() => {
      db.prepare('DELETE FROM rooms WHERE id = ?').run(dbRoomId)
    })
    resetDbForTests()
    db.close()
  })

  it('withTransaction rejects an asynchronous callback instead of corrupting nesting', () => {
    const db = initDb(':memory:')
    setDbForTests(db)

    expect(() =>
      withTransaction((() => {
        db.prepare("INSERT INTO rooms (name) VALUES ('Async')").run()
        return Promise.resolve()
      }) as unknown as () => void)
    ).toThrow(/synchronous/)

    const created = (db.prepare('SELECT COUNT(*) AS c FROM rooms WHERE name = ?').get('Async') as { c: number }).c
    expect(created).toBe(0)
    resetDbForTests()
    db.close()
  })

  it('withTransaction supports nesting via savepoints', () => {
    const db = initDb(':memory:')
    setDbForTests(db)

    withTransaction(() => {
      db.prepare("INSERT INTO rooms (name) VALUES ('Outer')").run()
      withTransaction(() => {
        db.prepare("INSERT INTO rooms (name) VALUES ('Inner')").run()
      })
      db.prepare("INSERT INTO rooms (name) VALUES ('Outer2')").run()
    })
    const names = (db.prepare('SELECT name FROM rooms ORDER BY name').all() as { name: string }[]).map((r) => r.name)
    expect(names).toEqual(['Inner', 'Outer', 'Outer2'])

    expect(() =>
      withTransaction(() => {
        db.prepare("INSERT INTO rooms (name) VALUES ('Outer3')").run()
        withTransaction(() => {
          db.prepare("INSERT INTO rooms (name) VALUES ('Inner2')").run()
          throw new Error('inner boom')
        })
        db.prepare("INSERT INTO rooms (name) VALUES ('Outer4')").run()
      })
    ).toThrow('inner boom')
    const after = (db.prepare('SELECT name FROM rooms ORDER BY name').all() as { name: string }[]).map((r) => r.name)
    expect(after).toEqual(['Inner', 'Outer', 'Outer2'])

    resetDbForTests()
    db.close()
  })

  it('a failed nested transaction does not discard sibling writes of the outer one', () => {
    const db = initDb(':memory:')
    setDbForTests(db)

    withTransaction(() => {
      db.prepare("INSERT INTO rooms (name) VALUES ('Before')").run()
      expect(() =>
        withTransaction(() => {
          db.prepare("INSERT INTO rooms (name) VALUES ('Doomed')").run()
          throw new Error('inner boom')
        })
      ).toThrow('inner boom')
      // the sibling write happens AFTER the inner rollback: a stale savepoint
      // left by a failed ROLLBACK TO/RELEASE would silently rewind it
      db.prepare("INSERT INTO rooms (name) VALUES ('Sibling')").run()
    })

    const names = (db.prepare('SELECT name FROM rooms ORDER BY name').all() as { name: string }[]).map((r) => r.name)
    expect(names).toEqual(['Before', 'Sibling'])

    resetDbForTests()
    db.close()
  })

  it('closeDb checkpoints, closes and stays idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poker-crm-db-'))
    const dbPath = join(dir, 'close.sqlite')
    const db = initDb(dbPath)
    setDbForTests(db)
    db.prepare("INSERT INTO rooms (name) VALUES ('Bybit')").run()

    const walPath = `${dbPath}-wal`
    expect(existsSync(walPath)).toBe(true)
    expect(statSync(walPath).size).toBeGreaterThan(0)

    expect(() => closeDb()).not.toThrow()
    expect(() => closeDb()).not.toThrow()

    expect(existsSync(walPath) ? statSync(walPath).size : 0).toBe(0)

    const reopened = new DatabaseSync(dbPath)
    expect((reopened.prepare('SELECT COUNT(*) AS c FROM rooms').get() as { c: number }).c).toBe(1)
    reopened.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
