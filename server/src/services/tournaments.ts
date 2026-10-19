import { getDb, withTransaction } from '../db.js'
import { HttpError } from '../lib/errors.js'
import { isValidDayKey, addDays } from '../lib/date.js'
import { getRoom, validateCurrency } from './rooms.js'
import { getBalance, getBalanceBefore, listForDate, upsertBalance, recomputeRoomBalances } from './balances.js'
import { recordCasinoPnl } from './funds.js'
import type { WriteoffReason } from './funds.js'
import { computeRoomProfit, sessionRoomProfit } from './sessions.js'
import type { RoomProfit } from './sessions.js'
import { convertCross, convertToUsd, withRateCache } from './rates/convert.js'
import { pendingImportPairs, reconcilePendingImports, clearPendingImport } from './pending.js'

export interface TournamentRow {
  id: number
  roomId: number
  roomName: string
  date: string
  buyin: number
  result: number
  currency: string
  name: string | null
  rank: number | null
  entrants: number | null
  tournamentId: number | null
  isMbr: boolean
}

interface TournamentRowDb {
  id: number
  room_id: number
  room_name: string
  date: string
  buyin: number
  result: number
  currency: string
  name: string | null
  rank: number | null
  entrants: number | null
  tournament_id: number | null
  is_mbr: number
}

export interface TournamentLineInput {
  buyin: number
  result: number
  currency: string
}

/** A tournament parsed from a GG report; `date` is its own start date. */
export interface TournamentImportInput {
  tournamentId: number
  name: string | null
  date: string
  buyin: number
  result: number
  rank: number | null
  entrants: number | null
  currency: string
  buyinUsd?: number | null
  resultUsd?: number | null
}

export interface DayReconcile {
  date: string
  roomId: number
  roomName: string
  sessionProfitUsd: number | null
  tournamentProfitUsd: number
  casinoUsd: number
  remainderUsd: number | null
  discrepancyPct: number | null
  flagged: boolean
  blank: string | null
}

export interface ReconcileFlag {
  date: string
  roomId: number
  roomName: string
  tournamentCount: number
  flagged: boolean
  remainderUsd: number | null
}

/** An orphaned discrepancy surfaced in the Депозиты и выводы tab. */
export interface OrphanedDiscrepancy {
  date: string
  roomId: number
  roomName: string
  amountUsd: number
}

const DISCREPANCY_THRESHOLD = 0.05

/**
 * Calendar days of a range, by day key. A local-time loop with a fixed 24h step
 * drifts across a DST fall-back: it repeats one day and never reaches the last
 * day of the range, so a discrepancy scan silently skips it.
 */
function eachDay(dateFrom: string, dateTo: string, cb: (date: string) => void): void {
  for (let date = dateFrom; date <= dateTo; date = addDays(date, 1)) cb(date)
}

function mapRow(r: TournamentRowDb): TournamentRow {
  return {
    id: r.id,
    roomId: r.room_id,
    roomName: r.room_name,
    date: r.date,
    buyin: r.buyin,
    result: r.result,
    currency: r.currency,
    name: r.name,
    rank: r.rank,
    entrants: r.entrants,
    tournamentId: r.tournament_id,
    isMbr: r.is_mbr === 1
  }
}

const MBR_PATTERN = 'mystery battle royale'

/**
 * MBR (Mystery Battle Royale) detection by tournament name — the same
 * case-insensitive, trimmed prefix the v14 backfill migration uses. Only GG
 * produces these; they must stay out of MTT analytics while their money keeps
 * flowing through reconciliation and the profit chart.
 */
export function isMbrByName(name: string | null): boolean {
  return name !== null && name.trim().toLowerCase().startsWith(MBR_PATTERN)
}

/**
 * Lookup of (room_id:date) pairs that have at least one tournament row (MBR
 * included). A played day — even an MBR-only hyper-turbo session — counts, so
 * the day-level "has tournaments" flag stays in sync with the import-pending
 * marker, which any tournament now clears.
 */
export function tournamentsExistMap(): Map<string, true> {
  const rows = getDb()
    .prepare(`SELECT DISTINCT room_id, date FROM tournaments`)
    .all() as unknown as { room_id: number; date: string }[]
  const map = new Map<string, true>()
  for (const row of rows) map.set(`${row.room_id}:${row.date}`, true)
  return map
}

function parseLines(lines: TournamentLineInput[], roomId: number, roomName: string, date: string): TournamentRow[] {
  const cleaned: TournamentRow[] = []
  for (const line of lines) {
    if (!Number.isInteger(line.buyin) || line.buyin < 0) throw new HttpError(400, 'buyin: must be a non-negative integer (min units)')
    if (!Number.isInteger(line.result) || line.result < 0) throw new HttpError(400, 'result: must be a non-negative integer (min units)')
    const currency = validateCurrency(line.currency, 'currency')
    if (line.buyin === 0 && line.result === 0) continue
    cleaned.push({ id: 0, roomId, roomName, date, buyin: line.buyin, result: line.result, currency, name: null, rank: null, entrants: null, tournamentId: null, isMbr: false })
  }
  return cleaned
}

function parseRemovedImportIds(ids: unknown): number[] {
  if (!Array.isArray(ids)) throw new HttpError(400, 'removedImportIds must be an array of positive integers')
  const out: number[] = []
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i] as unknown
    if (!Number.isInteger(id) || (id as number) <= 0) throw new HttpError(400, `removedImportIds[${i}]: must be a positive integer`)
    if (!out.includes(id as number)) out.push(id as number)
  }
  return out
}

function parseImport(input: TournamentImportInput, index: number): TournamentRow {
  if (input === null || typeof input !== 'object') throw new HttpError(400, `imports[${index}]: must be an object`)
  const { tournamentId, date, buyin, result, rank, entrants, currency, name } = input
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) throw new HttpError(400, `imports[${index}]: tournamentId must be a positive integer`)
  if (!isValidDayKey(date)) throw new HttpError(400, `imports[${index}]: date must be a valid YYYY-MM-DD day`)
  if (!Number.isInteger(buyin) || buyin < 0) throw new HttpError(400, `imports[${index}]: buyin must be a non-negative integer (min units)`)
  if (!Number.isInteger(result) || result < 0) throw new HttpError(400, `imports[${index}]: result must be a non-negative integer (min units)`)
  if (rank !== null && (!Number.isInteger(rank) || rank < 0)) throw new HttpError(400, `imports[${index}]: rank must be null or a non-negative integer`)
  if (entrants !== null && (!Number.isInteger(entrants) || entrants < 0)) throw new HttpError(400, `imports[${index}]: entrants must be null or a non-negative integer`)
  const ccy = validateCurrency(currency, `imports[${index}].currency`)
  return { id: 0, roomId: 0, roomName: '', date, buyin, result, currency: ccy, name: name ?? null, rank, entrants, tournamentId, isMbr: isMbrByName(name ?? null) }
}

/** Profit of the rows in USD: Σ (result − buyin) converted with the day rate. */
export function tournamentProfitUsd(rows: TournamentRow[]): number {
  let total = 0
  for (const row of rows) {
    const usd = convertToUsd(row.result - row.buyin, row.currency, row.date, row.roomId)
    if (usd !== null) total += usd
  }
  return total
}

/**
 * Per room+day discrepancy summary for a date range. Days without a balance
 * entry are skipped (there is nothing to reconcile against).
 */
export function reconcileSummary(dateFrom: string, dateTo: string): ReconcileFlag[] {
  if (!isValidDayKey(dateFrom) || !isValidDayKey(dateTo)) throw new HttpError(400, 'reconcile-summary: invalid date range')

  const flags: ReconcileFlag[] = []
  withRateCache(() => {
    eachDay(dateFrom, dateTo, (date) => {
      for (const entry of listForDate(date)) {
        const reconcile = reconcileDay(entry.roomId, date)
        const count = getDb()
          .prepare('SELECT COUNT(*) AS c FROM tournaments WHERE room_id = ? AND date = ?')
          .get(entry.roomId, date) as { c: number }
        if (reconcile.flagged || count.c > 0) {
          flags.push({
            date,
            roomId: entry.roomId,
            roomName: entry.roomName,
            tournamentCount: count.c,
            flagged: reconcile.flagged,
            remainderUsd: reconcile.remainderUsd
          })
        }
      }
    })
  })
  return flags
}

/**
 * Flagged room+day mismatches that are NOT waiting for a tournament import
 * (no pending marker) — orphaned leftovers that only a "Списать" write-off can
 * close. When no range is given the whole recorded history (min..max balance
 * date) is scanned. Excludes days already attributed to casino games.
 */
export function orphanedDiscrepancies(dateFrom?: string, dateTo?: string, roomId?: number): OrphanedDiscrepancy[] {
  if (dateFrom !== undefined && !isValidDayKey(dateFrom)) throw new HttpError(400, 'transactions: invalid dateFrom')
  if (dateTo !== undefined && !isValidDayKey(dateTo)) throw new HttpError(400, 'transactions: invalid dateTo')

  const bounds = getDb().prepare('SELECT MIN(date) AS min, MAX(date) AS max FROM balance_entries').get() as
    | { min: string | null; max: string | null }
    | undefined
  if (!bounds?.min || !bounds?.max) return []
  const from = dateFrom ?? bounds.min
  const to = dateTo ?? bounds.max

  const pending = pendingImportPairs()
  const orphans: OrphanedDiscrepancy[] = []
  withRateCache(() => {
    eachDay(from, to, (date) => {
      for (const entry of listForDate(date)) {
        if (roomId !== undefined && entry.roomId !== roomId) continue
        if (pending.has(`${entry.roomId}:${date}`)) continue
        const reconcile = reconcileDay(entry.roomId, date)
        if (reconcile.flagged && reconcile.remainderUsd !== null && reconcile.remainderUsd !== 0) {
          orphans.push({ date, roomId: entry.roomId, roomName: entry.roomName, amountUsd: reconcile.remainderUsd })
        }
      }
    })
  })
  return orphans
}

/**
 * Replace the *manual* tournament rows of a room on a day; imported rows
 * (tournament_id NOT NULL) survive — they are owned by the GG report identity.
 * Blank rows (0/0) are skipped.
 */
export function replaceDayTournaments(roomId: number, date: string, lines: TournamentLineInput[]): TournamentRow[] {
  if (!isValidDayKey(date)) throw new HttpError(400, 'date: must be a valid YYYY-MM-DD day')
  const room = getRoom(roomId)
  const cleaned = parseLines(lines, roomId, room.name, date)

  withTransaction(() => {
    getDb().prepare('DELETE FROM tournaments WHERE room_id = ? AND date = ? AND tournament_id IS NULL').run(roomId, date)
    const insert = getDb().prepare('INSERT INTO tournaments (room_id, date, buyin, result, currency) VALUES (?, ?, ?, ?, ?)')
    for (const line of cleaned) {
      insert.run(roomId, date, line.buyin, line.result, line.currency)
    }
    reconcilePendingImports(roomId)
  })
  return listDayTournaments(roomId, date)
}

/**
 * Delete one imported tournament (by its report id, whichever day it landed
 * on) and re-derive the balance chain — the auto-interpolation for a day that
 * loses its last tournament is removed as well. Manual rows cannot go through
 * here: they live under the modal-date editor and have no tournament_id.
 */
export function deleteImportedTournament(roomId: number, tournamentId: number): void {
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) throw new HttpError(400, 'tournamentId: must be a positive integer')
  withTransaction(() => {
    const result = getDb().prepare('DELETE FROM tournaments WHERE room_id = ? AND tournament_id = ?').run(roomId, tournamentId)
    if (result.changes === 0) throw new HttpError(404, 'Импортированный турнир не найден')
    recomputeRoomBalances(roomId)
    reconcilePendingImports(roomId)
  })
}

export function listDayTournaments(roomId: number, date: string): TournamentRow[] {
  if (!isValidDayKey(date)) throw new HttpError(400, 'date: must be a valid YYYY-MM-DD day')
  const rows = getDb()
    .prepare(
      `SELECT t.id, t.room_id, r.name AS room_name, t.date, t.buyin, t.result, t.currency,
              t.name, t.rank, t.entrants, t.tournament_id, t.is_mbr
       FROM tournaments t JOIN rooms r ON r.id = t.room_id
       WHERE t.room_id = ? AND t.date = ?
       ORDER BY t.id`
    )
    .all(roomId, date) as unknown as TournamentRowDb[]
  return rows.map(mapRow)
}

/** Explicit signed casino transactions of a room on a day, in USD. */
function casinoTransactionsUsd(roomId: number, date: string): number {
  const transactions = getDb()
    .prepare("SELECT amount, currency FROM transactions WHERE type = 'casino' AND room_id = ? AND date = ?")
    .all(roomId, date) as unknown as { amount: number; currency: string }[]
  let total = 0
  for (const row of transactions) {
    const usd = convertToUsd(row.amount, row.currency, date, roomId)
    if (usd !== null) total += usd
  }
  return total
}

/**
 * Compare the balance-derived session profit against a set of tournament rows
 * (plus casino P&L). Flag when |remainder| exceeds 5% of the larger.
 *
 * A discrepancy is only meaningful against a balance the user actually
 * measured. An 'auto' entry is an interpolated carry-forward that replays
 * deposit/withdraw/casino but NOT tournament results, so `S = X` and the
 * residual collapses to `R ≡ −T` — a 100% phantom that no write-off can
 * honestly close (there is no measured balance to explain). Such a day reports
 * no remainder and no flag; it becomes comparable the moment a manual balance
 * is recorded for it (`upsertBalance` flips the entry to 'manual').
 *
 * `R = S − T − X` is plain ledger arithmetic with no special cases: closing a
 * day adds an ordinary casino transaction of exactly `R` (see
 * `applyWriteoff`), and any later change to the ledger — a retrospective
 * tournament import, a balance correction on this or another day — re-opens the
 * day with the part nothing explains. A write-off is a judgement about the data
 * of the day, and the ledger keeps it re-examinable instead of pinning it away.
 */
/** The `R = S − T − X` comparison — shared by the actual day and by previews
 *  that need a *projected* session (e.g. a balance re-anchored onto the
 *  import's day). The session is injected so a preview can reason about a
 *  state that does not exist in the DB yet. */
function reconcileFromSession(
  room: { id: number; name: string },
  date: string,
  rows: TournamentRow[],
  session: RoomProfit | null,
  casinoTxUsd: number
): DayReconcile {
  const tournamentProfitUsdValue = tournamentProfitUsd(rows)

  let remainderUsd: number | null = null
  let discrepancyPct: number | null = null
  let flagged = false
  let blank: string | null = null

  if (session?.profitUsd === null) {
    blank = 'нет курса для конвертации баланса'
  } else if (session === null) {
    blank = 'нет баланса за день'
  } else if (session.source === 'auto') {
    blank = 'нет ручного баланса за день — сверить не с чем, запиши его в «Балансах»'
  } else {
    remainderUsd = session.profitUsd - tournamentProfitUsdValue - casinoTxUsd
    const base = Math.max(Math.abs(session.profitUsd), Math.abs(tournamentProfitUsdValue), 1)
    discrepancyPct = Math.abs(remainderUsd) / base
    flagged = discrepancyPct > DISCREPANCY_THRESHOLD
  }

  return {
    date,
    roomId: room.id,
    roomName: room.name,
    sessionProfitUsd: session?.profitUsd ?? null,
    tournamentProfitUsd: tournamentProfitUsdValue,
    casinoUsd: casinoTxUsd,
    remainderUsd,
    discrepancyPct,
    flagged,
    blank
  }
}

function computeReconcile(roomId: number, date: string, rows: TournamentRow[]): DayReconcile {
  const room = getRoom(roomId)
  return reconcileFromSession(room, date, rows, sessionRoomProfit(roomId, date), casinoTransactionsUsd(roomId, date))
}

export function reconcileDay(roomId: number, date: string): DayReconcile {
  if (!isValidDayKey(date)) throw new HttpError(400, 'date: must be a valid YYYY-MM-DD day')
  return computeReconcile(roomId, date, listDayTournaments(roomId, date))
}

/**
 * Must the room's latest manual balance be pulled onto the batch's last day?
 * Read-only — the very same decision `saveDayBatch` runs before actually
 * moving the entry, so a preview and a save can never disagree about it.
 */
function reanchorTarget(roomId: number, batchDates: string[]): { from: string; to: string } | null {
  if (batchDates.length === 0) return null
  const db = getDb()
  const target = batchDates.reduce((a, b) => (a > b ? a : b))

  const latestManual = db
    .prepare("SELECT date FROM balance_entries WHERE room_id = ? AND source = 'manual' ORDER BY date DESC LIMIT 1")
    .get(roomId) as { date: string } | undefined
  if (!latestManual) return null
  const from = latestManual.date
  if (from <= target) return null

  const manualAtTarget = db
    .prepare("SELECT 1 FROM balance_entries WHERE room_id = ? AND date = ? AND source = 'manual'")
    .get(roomId, target)
  if (manualAtTarget) return null

  const tournamentAfter = db.prepare('SELECT 1 FROM tournaments WHERE room_id = ? AND date > ?').get(roomId, target)
  if (tournamentAfter) return null

  const txnInGap = db
    .prepare('SELECT 1 FROM transactions WHERE (room_id = ? OR destination_room_id = ?) AND date > ? AND date <= ?')
    .get(roomId, roomId, target, from)
  if (txnInGap) return null

  return { from, to: target }
}

/**
 * Compute the discrepancy for unsaved draft lines — used by the "Проверить" button.
 * Imported rows are included only for the very day being reconciled (their own
 * start date comes from the report file).
 *
 * The preview models the save's re-anchor as well: a batch that would pull the
 * room's misplaced manual balance onto its own last day (see `reanchorTarget`)
 * reconciles THAT day, not the modal one — the modal day will be left without
 * a balance once the save lands. The session is projected by re-dating the
 * manual entry onto the target day, exactly what the post-save chain computes.
 */
export function previewDayReconcile(
  roomId: number,
  date: string,
  lines: TournamentLineInput[],
  imports: TournamentImportInput[] = []
): { reconcile: DayReconcile; wouldReanchor: { from: string; to: string } | null } {
  if (!isValidDayKey(date)) throw new HttpError(400, 'date: must be a valid YYYY-MM-DD day')
  const room = getRoom(roomId)
  const cleaned = parseLines(lines, roomId, room.name, date)
  const imported = imports.map((input, i) => ({ ...parseImport(input, i), roomId, roomName: room.name }))
  const byId = new Map<number, TournamentRow>()
  for (const row of imported) byId.set(row.tournamentId as number, row)
  const deduped = [...byId.values()]

  const batchDates = deduped.map((r) => r.date)
  if (cleaned.length > 0) batchDates.push(date)
  const wouldReanchor = deduped.length > 0 ? reanchorTarget(roomId, batchDates) : null

  if (wouldReanchor) {
    const to = wouldReanchor.to
    const manual = getBalance(roomId, wouldReanchor.from)
    const session = manual ? computeRoomProfit({ ...manual, date: to }) : null
    const rows = deduped.filter((r) => r.date === to)
    const reconcile = reconcileFromSession(room, to, rows, session, casinoTransactionsUsd(roomId, to))
    return { reconcile, wouldReanchor }
  }

  const rows = [...deduped.filter((r) => r.date === date), ...cleaned]
  return { reconcile: computeReconcile(roomId, date, rows), wouldReanchor: null }
}

/**
 * Persist a "save" batch: manual lines replace the day's manual detail rows,
 * imported tournaments are upserted by (room_id, tournament_id) across their
 * own dates, then the balance chain is re-derived so every touched day's
 * missing balance is interpolated as a carry-forward auto entry.
 *
 * Marker semantics: an explicit save of at least one tournament is the user's
 * acknowledgement ("I imported what I had"), so the room's pending-import
 * marker is dropped (`clearPendingImport`) even when the batch only covered
 * older days while the balance sits on a newer, tournament-less day (e.g.
 * balance recorded today, archive holds yesterday's games). An empty save
 * falls back to `reconcilePendingImports`, which keeps/re-derives the marker
 * from the newest manual balance day.
 *
 * `options.writeoff` rides along with the save: the popup's write-off choice
 * closes the modal day through the very same core the Транзакции tab uses, in
 * this transaction (`options.writeoffReason` names why — casino / rate drift /
 * other). That is what makes the button atomic — the import
 * and the closing casino transaction land together or not at all, and the
 * returned reconciles already describe the closed day (no second round-trip).
 * The re-anchor runs BEFORE the write-off: a batch saved a day late leaves the
 * modal day with an interpolated balance, and closing it would be refused with
 * nothing saved — pulling the snapshot onto the modal day first is what gives
 * the write-off a real measurement to reconcile against. `recomputeRoomBalances`
 * still runs before both, so the residual is computed on committed state.
 */
/**
 * Anchor a room's latest manual balance to the import's own dates.
 *
 * The balance form has no date field — it always writes "today", so a session
 * played on day D and reported later creates a phantom session on the entry
 * day with all of D's money attached to it. The import knows the real play
 * dates, so when a batch is saved the misplaced balance (recorded after the
 * imported games, on a day with no tournaments and no transactions of its
 * own) is moved to the last day of the batch instead. The user enters no
 * dates anywhere: import dates own the sessions.
 *
 * Deliberate guards — the move is skipped when it would lie about money:
 * - the balance day carries its own tournaments or transactions (between the
 *   batch and the balance), i.e. something really happened there;
 * - tournaments exist after the batch (the import is retrospective and the
 *   balance already measures a later state);
 * - a manual anchor already sits on the target day (UNIQUE room+date).
 *
 * Runs inside the caller's transaction, before the optional write-off: a
 * write-off reconciles against a manual balance, so the re-anchor has to make
 * the modal day manual first (otherwise the day is still "auto" and the close
 * is refused with nothing saved).
 *
 * `requireTo` pins the destination day. «Списать» passes the modal day, so a
 * write-off can never pull the snapshot onto a different day than the one it
 * closes — the closed day would silently lose its basis.
 */
function reanchorBalanceToBatch(roomId: number, batchDates: string[], requireTo?: string): { from: string; to: string } | null {
  const move = reanchorTarget(roomId, batchDates)
  if (move === null) return null
  if (requireTo !== undefined && move.to !== requireTo) return null

  const db = getDb()
  db.prepare("DELETE FROM balance_entries WHERE room_id = ? AND date = ? AND source = 'auto'").run(roomId, move.to)
  db.prepare("UPDATE balance_entries SET date = ? WHERE room_id = ? AND date = ? AND source = 'manual'").run(move.to, roomId, move.from)
  recomputeRoomBalances(roomId)
  return move
}

export function saveDayBatch(
  roomId: number,
  modalDate: string,
  lines: TournamentLineInput[],
  imports: TournamentImportInput[] = [],
  removedImportIds: number[] = [],
  options: { writeoff?: boolean; writeoffReason?: WriteoffReason } = {}
): { rows: TournamentRow[]; reconciles: DayReconcile[]; reanchored: { from: string; to: string } | null } {
  if (!isValidDayKey(modalDate)) throw new HttpError(400, 'date: must be a valid YYYY-MM-DD day')
  const room = getRoom(roomId)
  const removed = parseRemovedImportIds(removedImportIds)
  const cleaned = parseLines(lines, roomId, room.name, modalDate)
  const imported = imports.map((input, i) => ({ ...parseImport(input, i), roomId, roomName: room.name }))
  const byId = new Map<number, TournamentRow>()
  for (const row of imported) byId.set(row.tournamentId as number, row)
  const deduped = [...byId.values()]
  const affectedDates = [...new Set([modalDate, ...deduped.map((r) => r.date)])].sort()

  const reanchored = withTransaction(() => {
    const db = getDb()
    db.prepare('DELETE FROM tournaments WHERE room_id = ? AND date = ? AND tournament_id IS NULL').run(roomId, modalDate)
    const insertManual = db.prepare('INSERT INTO tournaments (room_id, date, buyin, result, currency) VALUES (?, ?, ?, ?, ?)')
    for (const line of cleaned) {
      insertManual.run(roomId, modalDate, line.buyin, line.result, line.currency)
    }
    const deleteRemoved = db.prepare('DELETE FROM tournaments WHERE room_id = ? AND tournament_id = ?')
    for (const id of removed) {
      deleteRemoved.run(roomId, id)
    }
    const upsert = db.prepare(
      `INSERT INTO tournaments (room_id, date, buyin, result, currency, name, rank, entrants, tournament_id, is_mbr)
       VALUES (@roomId, @date, @buyin, @result, @currency, @name, @rank, @entrants, @tournamentId, @isMbr)
       ON CONFLICT(room_id, tournament_id) DO UPDATE SET
         date = excluded.date,
         buyin = excluded.buyin,
         result = excluded.result,
         currency = excluded.currency,
         name = excluded.name,
         rank = excluded.rank,
         entrants = excluded.entrants,
         is_mbr = excluded.is_mbr`
    )
    for (const row of deduped) {
      upsert.run({
        roomId,
        date: row.date,
        buyin: row.buyin,
        result: row.result,
        currency: row.currency,
        name: row.name,
        rank: row.rank,
        entrants: row.entrants,
        tournamentId: row.tournamentId,
        isMbr: row.isMbr ? 1 : 0
      })
    }
    recomputeRoomBalances(roomId)
    if (cleaned.length > 0 || deduped.length > 0) clearPendingImport(roomId)
    else reconcilePendingImports(roomId)
    // Order matters: the write-off below closes `modalDate`, so that day must
    // already be manual — the re-anchor is what makes it so when the snapshot
    // still sits on a later day (import saved a day late). The re-anchor is only
    // allowed to land on `modalDate` while a write-off rides along: «Списать»
    // closes the day the popup is open on and must not move the balance to some
    // other imported day.
    let reanchored: { from: string; to: string } | null = null
    if (deduped.length > 0) {
      const batchDates = deduped.map((r) => r.date)
      if (cleaned.length > 0) batchDates.push(modalDate)
      reanchored = reanchorBalanceToBatch(roomId, batchDates, options.writeoff ? modalDate : undefined)
    }
    if (options.writeoff) {
      const reason = options.writeoffReason ?? 'casino'
      applyWriteoff(roomId, modalDate, reason, writeoffComment(reason, modalDate))
    }
    return reanchored
  })

  const reconcileDates = [...new Set([...affectedDates, ...(reanchored ? [reanchored.from, reanchored.to] : [])])].sort()
  return {
    rows: listDayTournaments(roomId, modalDate),
    reconciles: reconcileDates.map((d) => reconcileDay(roomId, d)),
    reanchored
  }
}

/**
 * Adjust today's balance entry so the session profit matches tournaments
 * (+ casino write-off). delta_target = tournaments + casino + (in − out).
 */
export function adjustBalanceToTournaments(roomId: number, date: string): DayReconcile {
  getRoom(roomId)
  const current = getBalanceRow(roomId, date)
  if (!current) throw new HttpError(400, 'No balance recorded for this day')
  const prev = getBalanceBefore(roomId, date)

  const reconcile = reconcileDay(roomId, date)
  if (reconcile.blank || reconcile.remainderUsd === null || reconcile.sessionProfitUsd === null) {
    throw new HttpError(400, reconcile.blank ?? 'Cannot adjust balance: missing conversion data')
  }

  // sessionProfit = deltaUsd − (in − out)  →  deltaUsd_target = tournaments + casino + (in − out)
  const session = sessionRoomProfit(roomId, date) as NonNullable<ReturnType<typeof sessionRoomProfit>>
  const deltaUsdTarget = reconcile.tournamentProfitUsd + reconcile.casinoUsd + (session.flowInUsd - session.flowOutUsd)
  // Both operands must live in `current.currency` before they are added: min
  // units of different currencies are not comparable (a RUB kopeck is not a USD
  // cent), so a previous entry in another currency is converted the same way
  // `buildRoomProfit` does it — with this day's frozen rate.
  const prevUnits = prev === null ? 0 : convertCross(prev.amount, prev.currency, current.currency, date, roomId)
  if (prevUnits === null) throw new HttpError(400, 'Cannot adjust balance: no rate for the previous balance currency')
  const deltaUnits = convertCross(deltaUsdTarget, 'USD', current.currency, date, roomId)
  if (deltaUnits === null) throw new HttpError(400, 'Cannot adjust balance: no rate for currency')

  upsertBalance(roomId, date, prevUnits + deltaUnits, current.currency)
  return reconcileDay(roomId, date)
}

function getBalanceRow(roomId: number, date: string): { amount: number; currency: string } | null {
  const row = getDb()
    .prepare('SELECT amount, currency FROM balance_entries WHERE room_id = ? AND date = ?')
    .get(roomId, date) as { amount: number; currency: string } | undefined
  return row ?? null
}

/**
 * The single write-off implementation behind every way of closing a day: the
 * write-off choice of the import popup, the `writeoff` flag of a save batch (the
 * popup rides on it, so "save the import + close the day" is one atomic step)
 * and the «Списать» button of the Депозиты и выводы tab. All of them write the
 * very same thing, only the comment and the `reason` differ.
 *
 * The whole leftover (session − tournaments − casino) becomes an ordinary
 * `casino` transaction of that exact amount in USD — the ledger itself, not a
 * marker next to it. It is written with `recordCasinoPnl`, which deliberately
 * does NOT move the balance: the day is reconciled against a balance the user
 * already measured, and that snapshot already contains the delta being
 * attributed (a normal casino transaction *does* move it, see `createTransaction`
 * — which is exactly why it can never close a day: `R` would stay unchanged).
 * `reason` is metadata on that row: whether the residual looked like casino
 * play, exchange-rate drift or something else. It never changes the arithmetic.
 *
 * Consequences of the ledger being honest: a day with nothing left to explain
 * writes no row (pressing the button again is a no-op and never overwrites a
 * comment), and any later change to the ledger — a retrospective tournament
 * import, a balance correction on this or another day — re-opens the day with
 * the part nothing explains, which then gets its own row.
 *
 * Deliberately opens no transaction of its own: it joins the caller's, which is
 * what makes the in-batch write-off atomic. A day that cannot be reconciled
 * (no balance of its own / no rate) throws and takes the whole batch with it —
 * saving an import the user wanted reconciled is never the better half.
 */
function applyWriteoff(roomId: number, date: string, reason: WriteoffReason, comment: string): DayReconcile {
  // read AFTER the caller's writes: `saveDayBatch` persists tournaments and
  // re-anchors the balance, then calls this inside the same transaction, so `S`
  // is the real snapshot and `T` is already the imported total
  const reconcile = reconcileDay(roomId, date)
  const amount = reconcile.remainderUsd
  if (reconcile.blank || amount === null) {
    throw new HttpError(400, reconcile.blank ?? 'Cannot write off: missing conversion data')
  }
  if (amount === 0) return reconcile
  recordCasinoPnl({ roomId, type: 'casino', amount, currency: 'USD', date, comment }, reason)
  return reconcileDay(roomId, date)
}

/** The system comment a write-off writes itself when the user gives none. */
function writeoffComment(reason: WriteoffReason, date: string): string {
  if (reason === 'fx') return `Авто-списание: остаток дня — разница курсов (${date})`
  if (reason === 'other') return `Авто-списание: остаток дня — прочее (${date})`
  return `Авто-списание: баланс за день относится к казино (${date})`
}

/**
 * The write-off of the import popup as a standalone call — the same core the
 * save batch uses, with a self-written comment.
 */
export function writeoffRemainder(roomId: number, date: string, reason: WriteoffReason = 'casino'): DayReconcile {
  return withTransaction(() => applyWriteoff(roomId, date, reason, writeoffComment(reason, date)))
}

/**
 * "Списать" from the Депозиты и выводы tab: attribute an orphaned discrepancy
 * with a user-provided comment and reason. A non-empty comment is mandatory —
 * the write-off is a deliberate judgement call. Same core as
 * `writeoffRemainder`: an ordinary casino transaction of the whole remainder,
 * written as its own row so an earlier decision is never rewritten.
 */
export function writeoffDiscrepancy(roomId: number, date: string, comment: string, reason: WriteoffReason = 'casino'): DayReconcile {
  getRoom(roomId)
  if (!isValidDayKey(date)) throw new HttpError(400, 'date: must be a valid YYYY-MM-DD day')
  const text = typeof comment === 'string' ? comment.trim() : ''
  if (!text) throw new HttpError(400, 'comment: обязательно укажите причину списания')
  if (text.length > 500) throw new HttpError(400, 'comment: не более 500 символов')
  return withTransaction(() => applyWriteoff(roomId, date, reason, text))
}