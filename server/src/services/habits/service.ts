import { HttpError } from '../../lib/errors.js'
import { addDays, currentMonthKey, dayKey, isValidDayKey, isValidMonthKey, monthEnd, monthStart } from '../../lib/date.js'
import { validateColor } from '../../lib/color.js'
import { withTransaction } from '../../db.js'
import {
  clearHabitArchived,
  deleteLog,
  insertHabit,
  listActiveHabitRows,
  listArchivedHabitRows,
  listLogRowsForHabit,
  listLogRowsForMonth,
  requireHabit,
  setHabitSortOrder,
  stampHabitArchived,
  updateHabitRow,
  upsertLog
} from './db.js'
import type { Habit, HabitHistoryItem, HabitLog, HabitStats, HabitStatus, HabitWithLogs } from './types.js'

const MAX_HABIT_NAME = 100

// Counts code points, not UTF-16 units, so an emoji in the name costs one
// character instead of two (or more) and cannot eat the user's budget.
function charCount(value: string): number {
  return [...value].length
}

function validateName(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, 'name: must be a string')
  const name = value.trim()
  const length = charCount(name)
  if (length < 1 || length > MAX_HABIT_NAME) throw new HttpError(400, `name: must be 1-${MAX_HABIT_NAME} characters`)
  return name
}

function validateMonth(value: unknown): string {
  if (value === undefined || value === null || value === '') return currentMonthKey()
  if (typeof value !== 'string' || !isValidMonthKey(value)) throw new HttpError(400, 'month: must be YYYY-MM')
  return value
}

function validateDate(value: unknown): string {
  if (typeof value !== 'string' || !isValidDayKey(value)) throw new HttpError(400, 'date: invalid date')
  return value
}

function validateStatus(value: unknown): HabitStatus | null {
  if (value === null || value === undefined) return null
  if (value !== 'done' && value !== 'partial' && value !== 'missed') throw new HttpError(400, 'status: must be done, partial, missed or null')
  return value
}

// An archived habit disappears from every month, past ones included: the grid
// only ever renders habits that are currently tracked. Archived habits (and all
// of their logs) stay reachable through the history view and `restoreHabit`.
export function listHabits(monthValue: unknown): HabitWithLogs[] {
  const month = validateMonth(monthValue)
  const end = monthEnd(month)
  const habits = listActiveHabitRows()
  const logs = listLogRowsForMonth(monthStart(month), end)
  const byHabit = new Map<number, Record<string, HabitStatus>>()
  for (const log of logs) {
    const bucket = byHabit.get(log.habitId) ?? {}
    bucket[log.date] = log.status
    byHabit.set(log.habitId, bucket)
  }
  return habits.map((habit) => ({ ...habit, logs: byHabit.get(habit.id) ?? {} }))
}

export function createHabit(nameValue: unknown, colorValue: unknown): Habit {
  return insertHabit(validateName(nameValue), validateColor(colorValue))
}

function validateOrderIds(value: unknown): number[] {
  if (!Array.isArray(value)) throw new HttpError(400, 'ids: must be an array')
  const ids: number[] = []
  for (const raw of value) {
    if (!Number.isInteger(raw) || (raw as number) <= 0) throw new HttpError(400, 'ids: must contain positive integers')
    if (ids.includes(raw as number)) throw new HttpError(400, 'ids: must not contain duplicates')
    ids.push(raw as number)
  }
  const known = new Set(listActiveHabitRows().map((habit) => habit.id))
  for (const id of ids) {
    if (!known.has(id)) throw new HttpError(400, `ids: unknown habit ${id}`)
  }
  return ids
}

// Only the habits the grid shows take part: the ids that come in occupy the top
// slots in that exact order and everything else keeps its relative place, so a
// client that sends just the visible rows can never shuffle the archive.
// Archived habits keep their old `sort_order`, which is what makes a restore
// land where the habit used to sit.
export function reorderHabits(input: unknown): Habit[] {
  const ids = validateOrderIds(input)
  const current = listActiveHabitRows()
  const moved = new Set(ids)
  const rest = current.filter((habit) => !moved.has(habit.id)).map((habit) => habit.id)
  const order = [...ids, ...rest]
  withTransaction(() => order.forEach((id, index) => setHabitSortOrder(id, index)))
  return listActiveHabitRows()
}

export function updateHabit(id: number, input: { name?: unknown; color?: unknown }): Habit {
  const current = requireHabit(id)
  const name = input.name !== undefined ? validateName(input.name) : current.name
  const color = input.color !== undefined ? validateColor(input.color) : current.color
  return updateHabitRow(id, name, color)
}

export function setHabitLog(id: number, dateValue: unknown, statusValue: unknown): HabitLog | null {
  requireHabit(id)
  const day = validateDate(dateValue)
  const status = validateStatus(statusValue)
  if (status === null) {
    deleteLog(id, day)
    return null
  }
  upsertLog(id, day, status)
  return { date: day, status }
}

export function archiveHabit(id: number): Habit {
  const habit = requireHabit(id)
  if (habit.archivedAt !== null) return habit
  return stampHabitArchived(id, dayKey())
}

export function restoreHabit(id: number): Habit {
  const habit = requireHabit(id)
  if (habit.archivedAt === null) return habit
  return clearHabitArchived(id)
}

export function listHabitHistory(): HabitHistoryItem[] {
  return listArchivedHabitRows().map((habit) => {
    const logs: Record<string, HabitStatus> = {}
    for (const log of listLogRowsForHabit(habit.id)) logs[log.date] = log.status
    return { ...habit, logs, stats: computeStats(logs) }
  })
}

// A day counts as tracked once it carries any log. `partial` is a full success
// for the completion rate (a half-kept habit still moves the needle), but only a
// strict `done` extends the streak — a partial day is a real achievement, not a
// flawless one.
function computeStats(logs: Record<string, HabitStatus>): HabitStats {
  const dates = Object.keys(logs).sort()
  let done = 0
  let partial = 0
  let missed = 0
  let longestDoneStreak = 0
  let run = 0
  let previous: string | null = null
  for (const date of dates) {
    const status = logs[date]
    if (status === 'done') {
      done += 1
      run = previous !== null && addDays(previous, 1) === date ? run + 1 : 1
      if (run > longestDoneStreak) longestDoneStreak = run
    } else if (status === 'partial') {
      partial += 1
      run = 0
    } else {
      missed += 1
      run = 0
    }
    previous = date
  }
  const tracked = done + partial + missed
  return {
    done,
    partial,
    missed,
    tracked,
    completionRate: tracked === 0 ? null : Math.round(((done + partial) / tracked) * 100),
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    longestDoneStreak
  }
}
