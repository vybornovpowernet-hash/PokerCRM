import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleRoot = dirname(fileURLToPath(import.meta.url)) // server/src or server/dist
const projectRoot = join(moduleRoot, '..', '..')

const MIGRATIONS: string[] = [
  // v1: initial schema
  `
  CREATE TABLE rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    cash_currency TEXT NOT NULL DEFAULT 'USD',
    tournament_currency TEXT NOT NULL DEFAULT 'USD',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE exchange_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    from_currency TEXT NOT NULL,
    to_currency TEXT NOT NULL,
    rate INTEGER NOT NULL,
    source TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(date, from_currency, to_currency)
  );
  CREATE INDEX idx_exchange_rates_date ON exchange_rates(date);

  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('deposit', 'withdraw', 'transfer')),
    amount INTEGER NOT NULL CHECK (amount >= 0),
    fee INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
    currency TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
    counterpart TEXT,
    date TEXT NOT NULL,
    comment TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_transactions_room_date ON transactions(room_id, date);

  CREATE TABLE balance_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount >= 0),
    currency TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(room_id, date)
  );

  CREATE TABLE tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    buyin INTEGER NOT NULL CHECK (buyin >= 0),
    result INTEGER NOT NULL CHECK (result >= 0),
    currency TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_tournaments_room_date ON tournaments(room_id, date);

  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    dismissed_at TEXT
  );
  `,
  // v2: lookup index for rate queries per currency pair + day
  `
  CREATE INDEX idx_exchange_rates_lookup ON exchange_rates(from_currency, to_currency, date);
  `,
  // v3: casino write-offs — attributing balance deltas that are neither cash
  // nor tournaments to casino games; stored in USD. One per room per day.
  `
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
  `,
  // v4: room rate source (which exchange-rate feed backs the room)
  `
  ALTER TABLE rooms ADD COLUMN rate_source TEXT;
  `,
  // v5: balance entries may be auto-derived from transactions. `source`
  // distinguishes user-recorded ('manual') from derived ('auto') rows so
  // auto-adjust never overwrites user truth, and `amount` may go negative
  // (an outgoing transaction on an empty chain).
  `
  CREATE TABLE balance_entries_v5 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(room_id, date)
  );
  INSERT INTO balance_entries_v5 (id, room_id, date, amount, currency, source, created_at)
    SELECT id, room_id, date, amount, currency, 'manual', created_at FROM balance_entries;
  DROP TABLE balance_entries;
  ALTER TABLE balance_entries_v5 RENAME TO balance_entries;
  `,
  // v6: transfers move money between own rooms. `destination_room_id` points
  // at the receiving room (NULL for everything else); the fee column already
  // exists since v1 (default 0), so the transfer direction is 'out' of the
  // sender room and the receiving leg is derived from destination_room_id.
  `
  ALTER TABLE transactions ADD COLUMN destination_room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE;
  `,
  // v7: rooms get a user-chosen display color (muted/cream hex) so the room
  // name can be tinted consistently across the UI. Existing rooms get a soft
  // color by name match; new rooms default to soft white.
  `
  ALTER TABLE rooms ADD COLUMN color TEXT NOT NULL DEFAULT '#f1f5f9';

  UPDATE rooms SET color = '#f1f5f9' WHERE name LIKE '%Bybit%';
  UPDATE rooms SET color = '#fde68a' WHERE name LIKE '%GG%';
  UPDATE rooms SET color = '#6ee7b7' WHERE name LIKE '%PokerDom%';
  UPDATE rooms SET color = '#fda4af' WHERE name LIKE '%RedStar%';
  `,
  // v8: rich tournament metadata (nullable — manual rows stay NULL) +
  // a natural dedup key from GG export, and per-room manual rate overrides
  // that take precedence over any feed (e.g. the user pins the exact PokerOK
  // cash-desk CNY/USD rate instead of the fetched one).
  `
  ALTER TABLE tournaments ADD COLUMN name TEXT;
  ALTER TABLE tournaments ADD COLUMN rank INTEGER;
  ALTER TABLE tournaments ADD COLUMN entrants INTEGER;
  ALTER TABLE tournaments ADD COLUMN tournament_id INTEGER;

  CREATE UNIQUE INDEX idx_tournaments_room_tournament ON tournaments(room_id, tournament_id);

  CREATE TABLE rate_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    from_currency TEXT NOT NULL,
    to_currency TEXT NOT NULL,
    rate INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(room_id, from_currency, to_currency)
  );
  `,
  // v9: composite index for date-range analytics (statistics/summary), hits
  // when a range query is not pre-filtered by a single room.
  `
  CREATE INDEX idx_tournaments_date_room ON tournaments(date, room_id);
  `,
  // v10: pending tournament imports — the "Ожидание импорта турниров" marker.
  // Persisted (survives F5/restart) instead of client state. At most one row
  // exists per room, pinned to its LATEST manual balance date with no
  // tournaments; `reconcilePendingImports` keeps it in sync.
  `
  CREATE TABLE pending_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(room_id, date)
  );
  CREATE INDEX idx_pending_imports_room_date ON pending_imports(room_id, date);
  `,
  // v11: wallet/exchange rooms — pure balance holders with no tournaments.
  // Wallets never carry a pending tournament-import marker, so `reconcilePendingImports`
  // skips them. Bybit is the transit wallet, so it is flagged here by name
  // (case-insensitive, trimmed) instead of by hand.
  `
  ALTER TABLE rooms ADD COLUMN is_wallet INTEGER NOT NULL DEFAULT 0;
  UPDATE rooms SET is_wallet = 1 WHERE LOWER(TRIM(name)) = 'bybit';
  `,
  // v12: isolated goals module ("Цели"). The goals tables are written only by
  // `services/goals/*`; other modules never read them and never import the module
  // (leaf node in the dependency graph). `metric` has no CHECK so new metrics can
  // be added without a migration; `status` is a fixed enum. `UNIQUE(goal_id,
  // milestone)` makes system milestone events idempotent (NULLs are allowed for
  // user entries, SQLite leaves unique-index NULLs unconstrained).
  `
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

  CREATE TABLE goal_entries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id    INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL CHECK (kind IN ('system','user')),
    content    TEXT    NOT NULL,
    milestone  INTEGER,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(goal_id, milestone)
  );
  CREATE INDEX idx_goal_entries_goal ON goal_entries(goal_id, created_at);
  `,
  // v13: custom goals ("Своя") — binary goals named by the user with no
  // auto-reconciliation. `title` holds the user-provided name; the service pins
  // target_units to 1 (CHECK(target_units > 0) stays untouched), and the final
  // state is set manually via POST /api/goals/:id/close { outcome }.
  `
  ALTER TABLE goals ADD COLUMN title TEXT;
  `,
  // v14: Mystery Battle Royale (MBR) isolation. MBR tournaments (hyper-turbo,
  // GG-only, come only from the GG archive) must stop influencing MTT analytics;
  // they STAY in reconciliation, the profit chart and every money-bearing flow.
  // `is_mbr` is a pure accounting flag set by name on import (`isMbrByName`) and
  // for the already-loaded history by this backfill. Default 0 keeps manual rows
  // (name IS NULL) MTT. Both the classifier and this UPDATE use the same
  // case-insensitive trimmed prefix pattern.
  `
  ALTER TABLE tournaments ADD COLUMN is_mbr INTEGER NOT NULL DEFAULT 0;
  UPDATE tournaments SET is_mbr = 1 WHERE TRIM(name) LIKE 'Mystery Battle Royale%';
  `,
  // v15: casino transactions. Poker-room bankrolls change not only through
  // cash movements (deposit/withdraw/transfer) and tournaments, but also
  // through casino games. A `casino` row carries a SIGNED amount (win > 0,
  // loss < 0) and is a gaming P&L component, never an external cash flow, so it
  // is excluded from `flowsUsdRange`/`flowTotals` and added to the balance
  // verbatim. SQLite cannot alter a CHECK, so the table is rebuilt: the type
  // CHECK gains 'casino' and the amount CHECK becomes sign-aware per type.
  `
  CREATE TABLE transactions_v15 (
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
  INSERT INTO transactions_v15 (id, room_id, type, amount, fee, currency, direction, counterpart, destination_room_id, date, comment, created_at)
    SELECT id, room_id, type, amount, fee, currency, direction, counterpart, destination_room_id, date, comment, created_at FROM transactions;
  DROP TABLE transactions;
  ALTER TABLE transactions_v15 RENAME TO transactions;
  CREATE INDEX idx_transactions_room_date ON transactions(room_id, date);
  `,
  // v16: global key-value settings. `day_start_hour` defines the Logical Day
  // Boundary: a GG tournament that starts before that hour belongs to the
  // previous calendar day, so a night session that runs past midnight is not
  // split across two balance-reconcile days. Default 0 = plain calendar days.
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO settings (key, value) VALUES ('day_start_hour', '0');
  `,
  // v17: auto-adjust balances on transactions. A manual balance entry is now a
  // SNAPSHOT taken at the moment of recording: `base_amount` keeps the user's
  // number, `base_tx_id` remembers the highest transaction id that existed then.
  // `recomputeRoomBalances` re-derives `amount` as base + the effects of that
  // room's transactions created AFTER the snapshot (id > base_tx_id), so a
  // same-day deposit/casino/transfer recorded after the balance moves it, while
  // a balance recorded after the operations still absorbs them (no double
  // count). Backfill marks every existing manual row as absorbing every
  // transaction already on its own date, preserving the old end-of-day values.
  `
  ALTER TABLE balance_entries ADD COLUMN base_amount INTEGER;
  ALTER TABLE balance_entries ADD COLUMN base_tx_id INTEGER;
  UPDATE balance_entries
     SET base_amount = amount,
         base_tx_id = (
           SELECT COALESCE(MAX(t.id), 0) FROM transactions t
           WHERE t.room_id = balance_entries.room_id AND t.date = balance_entries.date
         )
   WHERE source = 'manual';
   `,
  // v18: revert the v17 dynamic manual-balance model. Manual balances are
  // absolute snapshots again (the runtime ignores `base_amount`/`base_tx_id`);
  // `recomputeRoomBalances` no longer rewrites them, it only rebuilds auto
  // carry-forward rows. This restores any manual `amount` that v17 had already
  // re-derived, back to the value the user actually recorded (`base_amount`).
  // The columns are kept (SQLite does not drop them cheaply) but are dead.
  `
  UPDATE balance_entries SET amount = base_amount WHERE source = 'manual' AND base_amount IS NOT NULL;
  `,
  // v19: goal checklists. Sub-tasks of a goal ("Чеклист") live as a JSON array
  // inside the goals row itself — a separate table would add FK/ordering/cascade
  // plumbing for data that no module outside `services/goals` reads. Full-list
  // replacement keeps the write atomic and idempotent; `[]` means "no
  // checklist", so a metric goal keeps its metric-driven semantics and a custom
  // goal keeps its binary manual ones.
  `
  ALTER TABLE goals ADD COLUMN checklist TEXT NOT NULL DEFAULT '[]';
  `,
  // v20: habit tracker. "Removing" a habit is a SOFT DELETE — `archived_at`
  // (a day key) is stamped instead of deleting the row, so the whole history
  // survives and old months still render the habit with its logs. The
  // habit_logs FK deliberately has NO ON DELETE action: a parent cascade could
  // wipe years of tracking in one step, which the soft-delete contract forbids
  // (the app never physically deletes a habit). A day is "empty" when no log
  // row exists, so UNIQUE(habit_id, date) makes the grid authoritative.
  `
  CREATE TABLE habits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    archived_at TEXT
  );

  CREATE TABLE habit_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id   INTEGER NOT NULL REFERENCES habits(id),
    date       TEXT    NOT NULL,
    status     TEXT    NOT NULL CHECK (status IN ('done','missed')),
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(habit_id, date)
  );
  CREATE INDEX idx_habit_logs_date ON habit_logs(date);
  `,
  // v21: goal history. A goal is never physically deleted — "closing" it
  // (the ✕ control) stamps the terminal `closed` status instead, so the whole
  // history of achieved/failed/closed goals survives. SQLite cannot alter a
  // CHECK, so `goals` is rebuilt with `closed` added to the status enum plus a
  // `closed_at` timestamp and the progress snapshot (`final_percent`/`final_units`)
  // taken at the moment the goal reached a terminal state. `goal_entries` holds
  // the diary and references goals; it is rebuilt too because dropping a parent
  // table with `PRAGMA foreign_keys = ON` would cascade-delete every entry.
  `
  ALTER TABLE goals RENAME TO goals_v20;
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
  INSERT INTO goals (id, metric, target_units, currency, deadline, title, checklist, status, created_at, achieved_at, failed_at)
    SELECT id, metric, target_units, currency, deadline, title, checklist, status, created_at, achieved_at, failed_at FROM goals_v20;
  CREATE TABLE goal_entries_v21 (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id    INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL CHECK (kind IN ('system','user')),
    content    TEXT    NOT NULL,
    milestone  INTEGER,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(goal_id, milestone)
  );
  INSERT INTO goal_entries_v21 SELECT * FROM goal_entries;
  DROP TABLE goal_entries;
  DROP TABLE goals_v20;
  ALTER TABLE goal_entries_v21 RENAME TO goal_entries;
  CREATE INDEX idx_goal_entries_goal ON goal_entries(goal_id, created_at);
  `,
  // v22: acknowledgment gate for goal outcomes. A goal that reaches a terminal
  // state (achieved/failed) is not silently filed away: `acknowledged_at` stays
  // NULL until the user dismisses the notification, so the finished goal keeps
  // showing up in "Активные" and as a persistent toast. Existing finished goals
  // are backfilled as already acknowledged — they predate the feature and must
  // not flood the user with stale toasts.
  `
  ALTER TABLE goals ADD COLUMN acknowledged_at TEXT;
  UPDATE goals SET acknowledged_at = datetime('now') WHERE status != 'active';
  `,
  // v23: habit color. The grid is the only place a habit is identified visually,
  // so the row carries a soft/cream hex validated against the same
  // `^#[0-9a-f]{6}$` allowlist as rooms. Emoji are deliberately NOT a column:
  // they live as plain text inside `name`, so renaming, emoji and color all go
  // through a single update and no picker/allowlist has to be maintained.
  `
  ALTER TABLE habits ADD COLUMN color TEXT NOT NULL DEFAULT '#f1f5f9';
  `,
  // v24: manual goal order. Goals are a hand-prioritised list, so the user drags
  // them into place and that order has to survive a reload or a restart.
  // `sort_order` ascending is the display order (history keeps its own date
  // ordering). The backfill reproduces the previous `created_at DESC, id DESC`
  // view so existing goals do not jump on upgrade, and a new goal is inserted
  // with `MIN(sort_order) - 1` so it lands on top exactly like before.
  `
  ALTER TABLE goals ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
  UPDATE goals SET sort_order = (
    SELECT COUNT(*) FROM goals AS g
    WHERE g.created_at > goals.created_at
       OR (g.created_at = goals.created_at AND g.id > goals.id)
  );
  CREATE INDEX idx_goals_sort ON goals(sort_order, id);
  `,
  // v25: manual habit order. The grid is a priority list read top to bottom, so
  // rows are dragged into place and that order has to survive a reload or a
  // restart. `sort_order` ascending is the display order; archived habits keep
  // their value, so a restore lands where the habit used to sit (ties fall back
  // to id). The backfill reproduces the previous `name COLLATE NOCASE, id` view
  // so the grid does not reshuffle on upgrade, and a new habit is inserted with
  // `MIN(sort_order) - 1` so it lands on top, matching the client's optimistic
  // prepend.
  `
  ALTER TABLE habits ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
  UPDATE habits SET sort_order = (
    SELECT COUNT(*) FROM habits AS h
    WHERE h.name COLLATE NOCASE < habits.name COLLATE NOCASE
       OR (h.name COLLATE NOCASE = habits.name COLLATE NOCASE AND h.id < habits.id)
  );
  CREATE INDEX idx_habits_sort ON habits(sort_order, id);
  `,
  // v26: a casino write-off is an ordinary casino transaction, not a marker
  // beside the ledger. `casino_writeoffs` held the residual of a closed day in a
  // side table (one row per room+day), which kept it out of the transaction
  // history and forced `computeReconcile` to re-pin it as a "smart spring" so a
  // closed day could never re-open. The residual is now the day's casino P&L —
  // the honest `R = S − T − X` arithmetic with no special cases — so every
  // write-off becomes a signed USD casino row and the table goes away.
  //
  // The rows are written as casino transactions because that is what they always
  // meant: `amount` keeps its sign, `direction` follows it, `fee` is 0 (a CHECK of
  // the casino type) and the original comment/created_at survive, so the history
  // keeps the user's own reason and the original decision date. `created_at` is
  // copied so old write-offs do not appear as today's casino results. A zero row
  // is skipped — the casino CHECK forbids it and the runtime never stored one.
  `
  INSERT INTO transactions (room_id, type, amount, fee, currency, direction, comment, date, created_at)
    SELECT room_id,
           'casino',
           amount,
           0,
           'USD',
           CASE WHEN amount > 0 THEN 'in' ELSE 'out' END,
           comment,
           date,
           created_at
      FROM casino_writeoffs
     WHERE amount <> 0
     ORDER BY id;
  DROP TABLE casino_writeoffs;
  `,
  // v27: diary image attachments. A note can carry photos, kept as a JSON array
  // of RELATIVE paths (`["diary/<uuid>.png"]`) inside the entry row itself — the
  // files live on disk under `data/uploads` and are served statically, so no
  // binary ever enters the DB (blobs would balloon the file and every backup).
  // A JSON column (like `goals.checklist`) avoids a separate table with its own
  // FK/cascade plumbing for data nothing outside `services/goals` reads.
  `
  ALTER TABLE goal_entries ADD COLUMN images TEXT NOT NULL DEFAULT '[]';
  `,
  // v28: a habit day can be "partially" kept (half a routine, a shortened run).
  // SQLite cannot alter a CHECK, so `habit_logs` is rebuilt with the wider enum
  // (`done`/`partial`/`missed`); existing rows copy over verbatim, so no old log
  // is lost or reinterpreted. The table is renamed and recreated in place — the
  // FK still points at the untouched `habits` table and the day index is rebuilt.
  `
  ALTER TABLE habit_logs RENAME TO habit_logs_v27;
  CREATE TABLE habit_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id   INTEGER NOT NULL REFERENCES habits(id),
    date       TEXT    NOT NULL,
    status     TEXT    NOT NULL CHECK (status IN ('done','partial','missed')),
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(habit_id, date)
  );
  INSERT INTO habit_logs (id, habit_id, date, status, created_at)
    SELECT id, habit_id, date, status, created_at FROM habit_logs_v27;
  DROP TABLE habit_logs_v27;
  CREATE INDEX idx_habit_logs_date ON habit_logs(date);
  `,
  // v29: deleting a destination room must not erase the SENDER's ledger row.
  // `destination_room_id` was ON DELETE CASCADE, so removing room A deleted every
  // transfer B → A straight out of B's history: B's flows lost the outflow and
  // the next recompute silently moved B's balances. A transfer whose recipient
  // is gone is an ordinary outflow of the sender (the money left), so the
  // reference is now ON DELETE SET NULL. SQLite cannot change an FK action in
  // place, so `transactions` is rebuilt; `idx_transactions_destination` backs the
  // receiving-leg lookups (`destination_room_id = ?`) and the SET NULL scan that
  // runs on every room deletion.
  `
  CREATE TABLE transactions_v29 (
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
  INSERT INTO transactions_v29 (id, room_id, type, amount, fee, currency, direction, counterpart, destination_room_id, date, comment, created_at)
    SELECT id, room_id, type, amount, fee, currency, direction, counterpart, destination_room_id, date, comment, created_at FROM transactions;
  DROP TABLE transactions;
  ALTER TABLE transactions_v29 RENAME TO transactions;
  CREATE INDEX idx_transactions_room_date ON transactions(room_id, date);
  CREATE INDEX idx_transactions_destination ON transactions(destination_room_id);
  `,
  // v30: a day-closing write-off (`recordCasinoPnl`) is a judgement about a day,
  // not an event — its balance legs are deliberately never applied, because the
  // measured snapshot already contains the result. Editing or deleting such a
  // row through the ordinary transaction API DID apply those legs, silently
  // rewriting a manual snapshot (a 300.00 balance became 0.00) and reporting the
  // day as reconciled. Write-offs are now flagged at creation and refused by
  // `updateTransaction`/`deleteTransaction`; user-entered casino rows stay
  // `writeoff = 0` and fully editable. The backfill marks the system-written
  // ones (`Авто-списание: …`); older standalone write-offs carry an arbitrary
  // user comment and cannot be recognised retroactively.
  `
  ALTER TABLE transactions ADD COLUMN writeoff INTEGER NOT NULL DEFAULT 0;
  UPDATE transactions SET writeoff = 1 WHERE type = 'casino' AND comment LIKE 'Авто-списание:%';
  `,
  // v31: a day-closing write-off records WHY the residual was attributed. The
  // ledger row itself stays an ordinary casino transaction — `type` is the
  // accounting shape (signed gaming P&L, kept out of external flows) — while
  // `writeoff_reason` is the human label the popup asks for: 'casino',
  // 'fx' (exchange-rate drift) or 'other'. The badge in «Транзакции» and the
  // popup name what actually happened instead of calling every residual a
  // casino game. Old write-offs meant casino — that is what they are backfilled
  // with; a user-entered casino row keeps NULL.
  `
  ALTER TABLE transactions ADD COLUMN writeoff_reason TEXT;
  UPDATE transactions SET writeoff_reason = 'casino' WHERE writeoff = 1;
  `,
]

let dbInstance: DatabaseSync | undefined

export function runMigrations(db: DatabaseSync): void {
  const cur = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
  const version = cur?.user_version ?? 0
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v] ?? '')
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}

export function initDb(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  runMigrations(db)
  return db
}

let transactionDepth = 0

/**
 * Runs `fn` inside a transaction (SAVEPOINT-nested for inner calls).
 *
 * The callback MUST be synchronous: `transactionDepth` is process-global state,
 * so an `await` inside `fn` would let a concurrent request interleave between
 * BEGIN and COMMIT and corrupt the nesting. The returned value is checked to
 * fail fast instead of silently committing the wrong transaction.
 */
export function withTransaction<T>(fn: () => T): T {
  const db = getDb()
  const name = `tx_${transactionDepth}`
  if (transactionDepth === 0) {
    db.exec('BEGIN')
  } else {
    db.exec(`SAVEPOINT ${name}`)
  }
  transactionDepth++
  try {
    const result = fn()
    if (result instanceof Promise) {
      throw new Error('withTransaction: callback must be synchronous (no async/await inside a transaction)')
    }
    if (transactionDepth === 1) {
      db.exec('COMMIT')
    } else {
      db.exec(`RELEASE ${name}`)
    }
    return result
  } catch (err) {
    try {
      if (transactionDepth === 1) {
        db.exec('ROLLBACK')
      } else {
        db.exec(`ROLLBACK TO ${name}`)
        db.exec(`RELEASE ${name}`)
      }
    } catch (rollbackErr) {
      // `ROLLBACK TO` keeps the savepoint alive and only `RELEASE` destroys it,
      // so a failure here can leave a stale savepoint behind: a later nested
      // `ROLLBACK TO tx_<depth>` would rewind PAST sibling writes of the outer
      // transaction and silently discard them. Retry the whole pair once — the
      // second `ROLLBACK TO` is a no-op when the first one already succeeded.
      let recovered = false
      try {
        if (transactionDepth === 1) {
          db.exec('ROLLBACK')
        } else {
          db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`)
        }
        recovered = true
      } catch {
        // the connection refuses to unwind: it is in an unknown transactional
        // state and must not be trusted with further writes
      }
      if (!recovered) {
        // the original error explains WHY the transaction broke, so it stays
        // readable in the message instead of being masked by the rollback
        // failure, which is the `cause` here (the actionable symptom)
        throw new Error(
          `withTransaction: transaction broke with ${String(err)} and could not be rolled back (${String(rollbackErr)}) — savepoint ${name} may still be open; restart the app`,
          { cause: rollbackErr }
        )
      }
    }
    throw err
  } finally {
    transactionDepth--
  }
}

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    dbInstance = initDb(join(projectRoot, 'data', 'poker-crm.sqlite'))
  }
  return dbInstance
}

export function setDbForTests(db: DatabaseSync): void {
  dbInstance = db
}

export function resetDbForTests(): void {
  dbInstance = undefined
}

export function closeDb(): void {
  const db = dbInstance
  if (!db) return
  dbInstance = undefined
  transactionDepth = 0
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } catch {
    // in-memory databases and already-closed handles have nothing to checkpoint
  }
  db.close()
}

export { projectRoot }