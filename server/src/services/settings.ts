/**
 * Global key-value settings (v16). Stored as TEXT in a tiny `settings` table;
 * typed accessors keep the rest of the app free of string juggling. The first
 * (and so far only) setting is `day_start_hour` — the Logical Day Boundary:
 * a tournament that starts before that hour is attributed to the previous
 * calendar day, so a night session past midnight is not split in two.
 */

import { getDb, withTransaction } from '../db.js'
import { HttpError } from '../lib/errors.js'

export const DAY_START_HOUR_KEY = 'day_start_hour'
export const DAY_START_HOUR_MIN = 0
export const DAY_START_HOUR_MAX = 12

function read(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

function write(key: string, value: string): void {
  withTransaction(() => {
    getDb()
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value)
  })
}

/** Current Logical Day Boundary hour; falls back to 0 for a missing/corrupt row. */
export function getDayStartHour(): number {
  const raw = read(DAY_START_HOUR_KEY)
  if (raw === null) return DAY_START_HOUR_MIN
  const hour = Number(raw)
  return Number.isInteger(hour) && hour >= DAY_START_HOUR_MIN && hour <= DAY_START_HOUR_MAX ? hour : DAY_START_HOUR_MIN
}

/** Persists the Logical Day Boundary hour; rejects non-integers outside 0..12. */
export function setDayStartHour(hour: unknown): number {
  if (typeof hour !== 'number' || !Number.isInteger(hour) || hour < DAY_START_HOUR_MIN || hour > DAY_START_HOUR_MAX) {
    throw new HttpError(400, `dayStartHour должен быть целым числом от ${DAY_START_HOUR_MIN} до ${DAY_START_HOUR_MAX}`)
  }
  write(DAY_START_HOUR_KEY, String(hour))
  return hour
}

/** All settings in the shape consumed by GET /api/settings. */
export function getSettings(): { dayStartHour: number } {
  return { dayStartHour: getDayStartHour() }
}
