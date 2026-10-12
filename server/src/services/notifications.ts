import { getDb } from '../db.js'

export interface Notification {
  id: number
  kind: string
  message: string
  createdAt: string
  dismissedAt: string | null
}

interface NotificationRow {
  id: number
  kind: string
  message: string
  created_at: string
  dismissed_at: string | null
}

export function listActive(): Notification[] {
  const rows = getDb()
    .prepare('SELECT * FROM notifications WHERE dismissed_at IS NULL ORDER BY created_at DESC')
    .all() as unknown as NotificationRow[]
  return rows.map(mapRow)
}

function mapRow(r: NotificationRow): Notification {
  return {
    id: r.id,
    kind: r.kind,
    message: r.message,
    createdAt: r.created_at,
    dismissedAt: r.dismissed_at
  }
}

/** Create a notification, or refresh the message if an active one of the same kind already exists. */
export function add(kind: string, message: string): Notification {
  const existing = getDb().prepare('SELECT * FROM notifications WHERE kind = ? AND dismissed_at IS NULL LIMIT 1').get(kind) as
    | NotificationRow
    | undefined
  if (existing) {
    getDb().prepare("UPDATE notifications SET message = ?, created_at = datetime('now') WHERE id = ?").run(message, existing.id)
    const row = getDb().prepare('SELECT * FROM notifications WHERE id = ?').get(existing.id) as unknown as NotificationRow
    return mapRow(row)
  }
  const info = getDb().prepare('INSERT INTO notifications (kind, message) VALUES (?, ?)').run(kind, message)
  const row = getDb().prepare('SELECT * FROM notifications WHERE id = ?').get(Number(info.lastInsertRowid)) as unknown as NotificationRow
  return mapRow(row)
}

/** Dismiss all active notifications of a kind (used when the problem is resolved). */
export function resolveKind(kind: string): void {
  getDb().prepare("UPDATE notifications SET dismissed_at = datetime('now') WHERE kind = ? AND dismissed_at IS NULL").run(kind)
}

export function dismiss(id: number): void {
  getDb().prepare("UPDATE notifications SET dismissed_at = datetime('now') WHERE id = ?").run(id)
}

export function countActive(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS c FROM notifications WHERE dismissed_at IS NULL').get() as { c: number }
  return row.c
}