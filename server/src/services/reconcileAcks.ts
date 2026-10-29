import { getDb, withTransaction } from '../db.js'
import { HttpError } from '../lib/errors.js'
import { isValidDayKey } from '../lib/date.js'

/**
 * A user's explicit decision to accept a day that the ledger cannot explain.
 *
 * Deliberately NOT a write-off: no casino row is created and no money moves.
 * The stored `remainderUsd` is the exact residual (`R = S − T − X`, min units of
 * USD) that was on screen when the user accepted it, so the suppression can be
 * re-validated later: if the balance, the tournaments or the casino rows change
 * and `R` no longer equals this number, the discrepancy comes back.
 */
export interface ReconcileAck {
  roomId: number
  date: string
  remainderUsd: number
  note: string | null
  createdAt: string
}

interface ReconcileAckDb {
  room_id: number
  date: string
  remainder_usd: number
  note: string | null
  created_at: string
}

export const MAX_ACK_NOTE = 500

/** Trimmed optional note, or `null`; >500 chars is rejected. */
export function validateAckNote(note: unknown): string | null {
  if (note === undefined || note === null) return null
  if (typeof note !== 'string') throw new HttpError(400, 'note: должен быть строкой')
  const text = note.trim()
  if (text.length === 0) return null
  if (text.length > MAX_ACK_NOTE) throw new HttpError(400, `note: не более ${MAX_ACK_NOTE} символов`)
  return text
}

function mapRow(row: ReconcileAckDb): ReconcileAck {
  return {
    roomId: row.room_id,
    date: row.date,
    remainderUsd: row.remainder_usd,
    note: row.note,
    createdAt: row.created_at
  }
}

export function getAck(roomId: number, date: string): ReconcileAck | null {
  const row = getDb()
    .prepare('SELECT room_id, date, remainder_usd, note, created_at FROM reconcile_acks WHERE room_id = ? AND date = ?')
    .get(roomId, date) as unknown as ReconcileAckDb | undefined
  return row ? mapRow(row) : null
}

/**
 * `roomId:date` → accepted remainder for a whole range, so the Sessions pass
 * stays a single query instead of one lookup per room and day.
 */
export function acksInRange(dateFrom: string, dateTo: string): Map<string, number> {
  if (!isValidDayKey(dateFrom) || !isValidDayKey(dateTo)) throw new HttpError(400, 'acks: invalid date range')
  const rows = getDb()
    .prepare('SELECT room_id, date, remainder_usd FROM reconcile_acks WHERE date >= ? AND date <= ?')
    .all(dateFrom, dateTo) as unknown as { room_id: number; date: string; remainder_usd: number }[]
  const map = new Map<string, number>()
  for (const row of rows) map.set(`${row.room_id}:${row.date}`, row.remainder_usd)
  return map
}

/**
 * Upsert the acknowledgement of a room+day. Re-accepting updates the stored
 * residual (a stale ack must never be trusted); an omitted note keeps the
 * earlier text instead of erasing the user's reason.
 */
export function saveAck(roomId: number, date: string, remainderUsd: number, note: string | null): ReconcileAck {
  if (!isValidDayKey(date)) throw new HttpError(400, 'date: must be a valid YYYY-MM-DD day')
  if (!Number.isInteger(remainderUsd) || remainderUsd === 0) {
    throw new HttpError(400, 'remainderUsd: must be a non-zero integer (min units)')
  }
  withTransaction(() => {
    getDb()
      .prepare(
        `INSERT INTO reconcile_acks (room_id, date, remainder_usd, note)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(room_id, date) DO UPDATE SET
           remainder_usd = excluded.remainder_usd,
           note = COALESCE(excluded.note, reconcile_acks.note),
           created_at = datetime('now')`
      )
      .run(roomId, date, remainderUsd, note)
  })
  return getAck(roomId, date) as ReconcileAck
}

/** Returns `true` when an acknowledgement existed and was removed. */
export function deleteAck(roomId: number, date: string): boolean {
  if (!isValidDayKey(date)) throw new HttpError(400, 'date: must be a valid YYYY-MM-DD day')
  return getDb().prepare('DELETE FROM reconcile_acks WHERE room_id = ? AND date = ?').run(roomId, date).changes > 0
}
