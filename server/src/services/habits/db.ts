import { getDb } from '../../db.js'
import { HttpError } from '../../lib/errors.js'
import type { Habit, HabitStatus } from './types.js'

interface HabitRow {
  id: number
  name: string
  color: string
  created_at: string
  archived_at: string | null
  sort_order: number
}

interface HabitLogRow {
  habit_id: number
  date: string
  status: HabitStatus
}

function mapHabit(r: HabitRow): Habit {
  return { id: r.id, name: r.name, color: r.color, createdAt: r.created_at, archivedAt: r.archived_at, sortOrder: r.sort_order }
}

export function listActiveHabitRows(): Habit[] {
  const rows = getDb()
    .prepare('SELECT * FROM habits WHERE archived_at IS NULL ORDER BY sort_order, id')
    .all() as unknown as HabitRow[]
  return rows.map(mapHabit)
}

export function listArchivedHabitRows(): Habit[] {
  const rows = getDb()
    .prepare('SELECT * FROM habits WHERE archived_at IS NOT NULL ORDER BY archived_at DESC, name COLLATE NOCASE, id')
    .all() as unknown as HabitRow[]
  return rows.map(mapHabit)
}

export function listLogRowsForMonth(monthStartKey: string, monthEndKey: string): { habitId: number; date: string; status: HabitStatus }[] {
  const rows = getDb()
    .prepare('SELECT habit_id, date, status FROM habit_logs WHERE date BETWEEN ? AND ?')
    .all(monthStartKey, monthEndKey) as unknown as HabitLogRow[]
  return rows.map((r) => ({ habitId: r.habit_id, date: r.date, status: r.status }))
}

export function listLogRowsForHabit(habitId: number): { date: string; status: HabitStatus }[] {
  const rows = getDb().prepare('SELECT date, status FROM habit_logs WHERE habit_id = ? ORDER BY date').all(habitId) as unknown as {
    date: string
    status: HabitStatus
  }[]
  return rows.map((r) => ({ date: r.date, status: r.status }))
}

export function getHabit(id: number): Habit | null {
  const row = getDb().prepare('SELECT * FROM habits WHERE id = ?').get(id) as unknown as HabitRow | undefined
  return row ? mapHabit(row) : null
}

export function requireHabit(id: number): Habit {
  const habit = getHabit(id)
  if (!habit) throw new HttpError(404, 'Habit not found')
  return habit
}

export function insertHabit(name: string, color: string): Habit {
  const info = getDb()
    .prepare('INSERT INTO habits (name, color, sort_order) VALUES (?, ?, (SELECT COALESCE(MIN(sort_order), 0) - 1 FROM habits))')
    .run(name, color)
  return requireHabit(Number(info.lastInsertRowid))
}

export function setHabitSortOrder(id: number, sortOrder: number): void {
  getDb().prepare('UPDATE habits SET sort_order = ? WHERE id = ?').run(sortOrder, id)
}

export function updateHabitRow(id: number, name: string, color: string): Habit {
  getDb().prepare('UPDATE habits SET name = ?, color = ? WHERE id = ?').run(name, color, id)
  return requireHabit(id)
}

export function stampHabitArchived(id: number, archivedAt: string): Habit {
  getDb().prepare('UPDATE habits SET archived_at = ? WHERE id = ?').run(archivedAt, id)
  return requireHabit(id)
}

export function clearHabitArchived(id: number): Habit {
  getDb().prepare('UPDATE habits SET archived_at = NULL WHERE id = ?').run(id)
  return requireHabit(id)
}

export function upsertLog(habitId: number, date: string, status: HabitStatus): void {
  getDb()
    .prepare(
      `INSERT INTO habit_logs (habit_id, date, status) VALUES (?, ?, ?)
       ON CONFLICT(habit_id, date) DO UPDATE SET status = excluded.status`
    )
    .run(habitId, date, status)
}

export function deleteLog(habitId: number, date: string): void {
  getDb().prepare('DELETE FROM habit_logs WHERE habit_id = ? AND date = ?').run(habitId, date)
}
