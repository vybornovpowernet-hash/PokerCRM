import { getDb } from '../../db.js'

export interface RateRow {
  id: number
  date: string
  fromCurrency: string
  toCurrency: string
  rate: number
  source: string
  updatedAt: string
}

interface RateRowRow {
  id: number
  date: string
  from_currency: string
  to_currency: string
  rate: number
  source: string
  updated_at: string
}

function mapRow(r: RateRowRow): RateRow {
  return {
    id: r.id,
    date: r.date,
    fromCurrency: r.from_currency,
    toCurrency: r.to_currency,
    rate: r.rate,
    source: r.source,
    updatedAt: r.updated_at
  }
}

/** Scaled rate for (from,to) on a specific local day, or null if unknown. */
export function getScaledRate(from: string, to: string, date: string): number | null {
  const row = getDb()
    .prepare('SELECT rate FROM exchange_rates WHERE from_currency = ? AND to_currency = ? AND date = ?')
    .get(from, to, date) as { rate: number } | undefined
  return row ? row.rate : null
}

/** Latest known scaled rate for a pair regardless of day, or null. */
export function getLatestScaledRate(from: string, to: string): number | null {
  const row = getDb()
    .prepare('SELECT rate FROM exchange_rates WHERE from_currency = ? AND to_currency = ? ORDER BY date DESC LIMIT 1')
    .get(from, to) as { rate: number } | undefined
  return row ? row.rate : null
}

export function upsertRate(date: string, from: string, to: string, rateScaled: number, source: string): void {
  getDb()
    .prepare(
      `INSERT INTO exchange_rates (date, from_currency, to_currency, rate, source)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(date, from_currency, to_currency)
       DO UPDATE SET rate = excluded.rate, source = excluded.source, updated_at = datetime('now')`
    )
    .run(date, from, to, rateScaled, source)
}

function parseDbTimestamp(raw: string): Date {
  return new Date(`${raw.replace(' ', 'T')}Z`)
}

export function lastRateUpdate(): Date | null {
  const row = getDb().prepare('SELECT MAX(updated_at) AS u FROM exchange_rates').get() as { u: string | null } | undefined
  return row?.u ? parseDbTimestamp(row.u) : null
}

export function isRateStale(maxAgeMs: number): boolean {
  const last = lastRateUpdate()
  if (!last) return true
  return Date.now() - last.getTime() > maxAgeMs
}

export function ratesForDate(date: string): RateRow[] {
  const rows = getDb().prepare('SELECT * FROM exchange_rates WHERE date = ?').all(date) as unknown as RateRowRow[]
  return rows.map(mapRow)
}