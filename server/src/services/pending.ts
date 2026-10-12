import { getDb } from '../db.js'

export interface PendingImport {
  roomId: number
  roomName: string
  date: string
}

/** All pending (room_id, date) pairs as "roomId:date" lookup keys. */
export function pendingImportPairs(): Map<string, true> {
  const rows = getDb().prepare('SELECT room_id, date FROM pending_imports').all() as unknown as { room_id: number; date: string }[]
  const map = new Map<string, true>()
  for (const row of rows) map.set(`${row.room_id}:${row.date}`, true)
  return map
}

/** Pending rows joined with room names (used for tests). */
export function listPendingImports(): PendingImport[] {
  const rows = getDb()
    .prepare(
      `SELECT p.room_id, r.name AS room_name, p.date
       FROM pending_imports p JOIN rooms r ON r.id = p.room_id
       ORDER BY p.date, r.name`
    )
    .all() as unknown as { room_id: number; room_name: string; date: string }[]
  return rows.map((r) => ({ roomId: r.room_id, roomName: r.room_name, date: r.date }))
}

/**
 * Explicit "user pressed Save" acknowledgement: drop the room's pending
 * import marker. Works for the live workflow where an archive only covers
 * older days while the balance is written for today — the button must not nag
 * once the user deliberately saved. The marker is re-armed by the next balance
 * write (`upsertBalance` → `reconcilePendingImports`), so the "record balance
 * → import → save" loop keeps prompting until tournaments actually land on the
 * newest manual day. Must be called inside `withTransaction`.
 */
export function clearPendingImport(roomId: number): void {
  getDb().prepare('DELETE FROM pending_imports WHERE room_id = ?').run(roomId)
}

/**
 * Single source of truth for a room's "import pending" marker. A pending row
 * exists iff the room's LATEST manual balance date has NO tournaments. Any
 * previous pending row (e.g. for an older manual date) is removed, so a
 * balance change "kills" the old marker and re-evaluates the new one. Must be
 * called inside `withTransaction`.
 */
export function reconcilePendingImports(roomId: number): void {
  const db = getDb()
  db.prepare('DELETE FROM pending_imports WHERE room_id = ?').run(roomId)
  const isWallet = db.prepare('SELECT is_wallet FROM rooms WHERE id = ?').get(roomId) as { is_wallet: number } | undefined
  if (isWallet?.is_wallet) return
  const latest = db
    .prepare(`SELECT MAX(date) AS date FROM balance_entries WHERE room_id = ? AND source = 'manual'`)
    .get(roomId) as { date: string | null } | undefined
  if (!latest?.date) return
  const hasTournaments = db
    .prepare(`SELECT 1 AS one FROM tournaments WHERE room_id = ? AND date = ? LIMIT 1`)
    .get(roomId, latest.date)
  if (hasTournaments) return
  db.prepare('INSERT INTO pending_imports (room_id, date) VALUES (?, ?)').run(roomId, latest.date)
}